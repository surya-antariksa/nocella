# 02. Arsitektur

## Bentuk sistem

Notch adalah satu aktor Clutter yang dipasang sebagai chrome di atas panel GNOME.
Di dalamnya ada lapisan UI, lapisan state, dan sekumpulan provider data. Provider tidak
saling bicara. Semuanya mengirim event ke arbiter, arbiter memutuskan apa yang tampil,
lalu state machine mengatur ukuran dan isi.

```
                    ┌──────────────────────────────────────────┐
                    │              gnome-shell                 │
                    │                                          │
  /proc, MPRIS,     │  ┌────────────┐      ┌───────────────┐   │
  D-Bus, GSettings ─┼─▶│  Provider  │─────▶│    Arbiter    │   │
  Meta, MessageTray │  │  (8 modul) │      │ prioritas +   │   │
                    │  └────────────┘      │ koalesensi    │   │
                    │         ▲            └───────┬───────┘   │
                    │         │                    ▼           │
                    │  ┌──────┴─────┐      ┌───────────────┐   │
                    │  │  Settings  │      │ State machine │   │
                    │  │  GSettings │      │ COLLAPSED ... │   │
                    │  └────────────┘      └───────┬───────┘   │
                    │                              ▼           │
                    │                      ┌───────────────┐   │
                    │                      │   Notch UI    │   │
                    │                      │ St + Clutter  │   │
                    │                      └───────┬───────┘   │
                    │                              │           │
                    │                    Main.layoutManager     │
                    │                    .addChrome(actor)      │
                    └──────────────────────────────────────────┘
```

## Modul

### Inti

| Modul | Tanggung jawab | Tidak boleh |
|---|---|---|
| `nocella.js` | Membuat aktor, memasang ke layout manager, meneruskan event UI | Mengambil data sendiri |
| `state.js` | State machine, timer auto-collapse, transisi ukuran | Tahu detail provider |
| `arbiter.js` | Memilih konten berdasarkan prioritas, koalesensi, antrean | Mengubah aktor langsung |
| `ui/surface.js` | Mengatur ukuran, radius, bayangan, animasi buka/tutup | Menyimpan data domain |
| `settings.js` | Membaca GSettings, menerbitkan sinyal perubahan | Menyimpan state runtime |

### Provider

Setiap provider punya antarmuka yang sama:

```js
class Provider {
    constructor(settings, emit) {}
    start() {}          // connect signals/timers; called on enable
    stop() {}           // disconnect all signals/timers; must be idempotent
    snapshot() {}       // latest data, used when a view opens
}
```

Provider mengirim event lewat `emit({type, priority, payload, ttl, coalesceKey})`.
Provider tidak pernah memanggil UI. Kalau provider gagal, ia hanya berhenti mengirim
event; provider lain tetap jalan.

| Provider | Sumber | Event utama |
|---|---|---|
| `clock` | `GLib.timeout_add_seconds` | menit berubah |
| `media` | MPRIS D-Bus | track berubah, play/pause, posisi |
| `volume` | Gvc, fallback `wpctl` (polling saat terbuka) | volume berubah, output berubah |
| `notifications` | `Main.messageTray` | notifikasi masuk, dihapus |
| `system` | `/proc`, `/sys` | sampel CPU/RAM/suhu/baterai |
| `workspaces` | `global.workspace_manager`, `global.display` | workspace/window berubah |
| `quicksettings` | GSettings + NetworkManager/BlueZ D-Bus | toggle berubah |
| `agent` | D-Bus bridge (`id.antariksa.Nocella.Agent`) | sesi mulai, selesai, error |

### UI

| Modul | Isi |
|---|---|
| `views/today.js` | Jam besar, tanggal, kalender bulan, daftar notifikasi |
| `views/media.js` | Artwork, judul, artis, progress, kontrol, slider volume |
| `views/system.js` | Metrik, sparkline, quick settings, slider brightness |
| `views/agent.js` | Daftar sesi agen dan status |
| `views/workspaces.js` | Grid workspace dan judul window |
| `components/*` | Tombol ikon, slider, progress bar, badge, segmented control, kartu notifikasi, tile quick settings |

Satu view hanya boleh hidup selama dibutuhkan. Saat notch mengecil, view berat
(grafik sistem, daftar notifikasi) dihentikan timer-nya dan aktornya disembunyikan,
bukan dihancurkan, supaya pembukaan berikutnya cepat.

## State machine

```
              hover 140 ms
  ┌───────────┐ ──────────────▶ ┌────────┐
  │ COLLAPSED │                 │  PEEK  │
  └─────┬─────┘ ◀────────────── └───┬────┘
        │        leave 320 ms       │ klik
        │ event transien            ▼
        ▼                      ┌────────┐
  ┌───────────┐    klik        │ PINNED │
  │ TRANSIENT │ ─────────────▶ │        │
  └─────┬─────┘                └───┬────┘
        │ timeout                  │ klik luar / Esc
        └──────────┬───────────────┘
                   ▼
             ┌───────────┐
             │ COLLAPSED │
             └───────────┘

  SUPPRESSED: dari state mana pun saat fullscreen atau overview.
              Kembali ke COLLAPSED saat kondisi normal.
              Layar terkunci tidak lewat state ini: GNOME memanggil disable().
```

| State | Ukuran | Timer | Konten |
|---|---|---|---|
| COLLAPSED | 196x32 | tidak ada | jam + badge |
| PEEK | 300x64 | 320 ms setelah kursor pergi | ringkasan aktivitas terakhir |
| TRANSIENT | 320-420 x 60-92 | sesuai TTL event (1,2-6 detik; notifikasi kritis maks 60 detik) | satu konten |
| PINNED | 420 x 220-340 | tidak ada, kecuali idle 3 menit | view penuh dengan tab |
| SUPPRESSED | 0 (disembunyikan) | tidak ada | tidak ada |

Aturan transisi:

- Event baru saat TRANSIENT: kalau prioritas lebih tinggi, ganti konten dan reset timer.
  Kalau lebih rendah, masukkan antrean dengan masa hidup 5 detik.
- Event baru saat PINNED: jangan ganti view. Naikkan badge dan tampilkan titik di tab
  yang bersangkutan.
- Klik notch saat TRANSIENT memindahkan state ke PINNED tanpa animasi ulang.
- Escape selalu menuju COLLAPSED, kecuali sedang ada dialog konfirmasi.
- Kehilangan fokus (klik di luar) menuju COLLAPSED.
- `disable()` memaksa COLLAPSED lalu menghancurkan aktor.
- SUPPRESSED dipicu oleh state machine sendiri dari sinyal fullscreen dan overview,
  bukan lewat `trackFullscreen`, supaya visibilitas dan `bannerBlocked` selalu sinkron.

## Alur data satu event

Contoh: lagu berganti.

1. `media` menerima `PropertiesChanged` dari MPRIS.
2. Provider menyusun payload `{title, artist, artUrl, status}` dan memanggil
   `emit({type: 'media-changed', priority: 80, ttl: 4000, coalesceKey: 'media'})`.
3. Arbiter membandingkan dengan konten aktif. Tidak ada yang lebih tinggi, jadi
   `media-changed` menang.
4. State machine pindah ke TRANSIENT, menyimpan state sebelumnya.
5. `ui/surface.js` menganimasikan ukuran dari 196x32 ke 380x68 selama 300 ms.
6. `views/media.js` diisi dari payload, lalu berlangganan update posisi selama terlihat.
7. Setelah 4 detik tanpa hover, timer habis, state kembali ke COLLAPSED, view berhenti
   berlangganan.

## Batas kepercayaan dan isolasi kegagalan

- Semua panggilan ke API privat GNOME dibungkus helper dengan `try/catch` dan pengecekan
  keberadaan properti. Kalau tidak ada, fitur dimatikan, ekstensi tetap hidup.
- Setiap provider dijalankan dalam `try/catch` saat start. Provider yang gagal dicatat
  di log dan dilewati.
- Tidak ada `GLib.timeout_add` tanpa ID yang disimpan. Semua timer dihentikan di
  `stop()`.
- Tidak ada signal yang tidak dilepas. Setiap `connect()` disimpan ID-nya.
- Tidak ada akses jaringan langsung dari ekstensi di v1. Kalau nanti perlu (misalnya
  artwork HTTP), lewat helper proses terpisah supaya kegagalan jaringan tidak memblokir
  shell.

## Struktur berkas ekstensi

```
nocella@antariksa/
├── metadata.json
├── extension.js
├── prefs.js
├── stylesheet.css
├── schemas/
│   └── org.gnome.shell.extensions.nocella.gschema.xml
├── src/
│   ├── nocella.js
│   ├── state.js
│   ├── arbiter.js
│   ├── settings.js
│   ├── providers/
│   │   ├── clock.js
│   │   ├── media.js
│   │   ├── volume.js
│   │   ├── notifications.js
│   │   ├── system.js
│   │   ├── workspaces.js
│   │   ├── quicksettings.js
│   │   └── agent.js
│   ├── ui/
│   │   ├── surface.js
│   │   ├── views/
│   │   └── components/
│   └── util/
│       ├── dbus.js
│       ├── proc.js
│       └── guards.js
├── po/
└── README.md
```

Semua impor internal memakai path relatif ESM, misalnya
`import {MediaProvider} from './providers/media.js';`. Tidak ada `node_modules`, tidak
ada bare import. Ini syarat mutlak karena loader GNOME Shell tidak mengenal resolusi
modul Node.

## Keputusan yang masih terbuka

| Pertanyaan | Default sementara | Kapan diputuskan |
|---|---|---|
| Satu aktor atau beberapa aktor | Satu aktor dengan child view | Fase 1, setelah ukur performa |
| View dihancurkan atau disembunyikan | Disembunyikan, timer dihentikan | Fase 1 |
| Blur latar | Tidak, faux vibrancy 82% | Fase 2, setelah uji visual |
| Sumber data bridge agen | API lokal OpenCode, fallback baca SQLite read-only. Ekstensi hanya bicara D-Bus ke bridge, tidak pernah membaca berkas agen | Fase 6 |
| Dukungan GNOME 47+ | Belum | Setelah v1 rilis |
