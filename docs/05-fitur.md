# 05. Spesifikasi Fitur

Urutan di dokumen ini mengikuti prioritas pembangunan, bukan urutan tab di UI.
Setiap fitur punya sumber data, tampilan, aksi, cara gagal, dan perkiraan usaha.

## 1. Jam, tanggal, dan kalender

### Sumber

- Waktu: `GnomeDesktop.WallClock({time_only: true})`, sumber yang sama dengan jam panel
  GNOME. Ia sudah menangani pergantian menit, zona waktu, resume, locale, dan
  `clock-format`. Properti `clock` di-bind ke label notch.
- Format: `org.gnome.desktop.interface clock-format` (`12h` atau `24h`) hanya dibaca
  untuk lebar notch (206 px untuk 12 jam).
- Tanggal: `GLib.DateTime.format("%A, %d %B")` mengikuti locale.
- Kalender bulan ini: dihitung sendiri dengan `GLib.DateTime`, tidak perlu pustaka.
- Acara kalender: ditunda. v1 hanya tombol "Buka Kalender" yang menjalankan
  `gnome-calendar` lewat `Gio.AppInfo.launch_default_for_uri` atau `Shell.App`.

### Tampilan

| State | Isi |
|---|---|
| Collapsed | `14:32` |
| Peek | `14:32` + tanggal + jumlah notifikasi |
| Pinned tab "Hari ini" | Jam besar, tanggal, kalender bulan, daftar notifikasi terbaru |

### Aksi

- Klik jam di panel pinned: tidak ada (sudah di dalam panel).
- Klik tanggal: buka GNOME Calendar kalau terpasang.
- Klik notifikasi: `notification.activate()`.

### Gagal

Kalau GNOME Calendar tidak terpasang, tanggal tampil sebagai teks biasa yang tidak bisa
diklik, sesuai `04-interaksi.md`. Jangan crash. (Diputuskan di fase 2; notifikasi
"tidak terpasang" ditolak karena ikut lewat notch sebagai gangguan.)

### Usaha: 2 hari

## 2. Media dan volume

### Media: sumber

MPRIS lewat D-Bus sesi:

1. Dapatkan daftar nama: panggil `org.freedesktop.DBus.ListNames`, filter prefix
   `org.mpris.MediaPlayer2.`.
2. Untuk tiap nama, buat `Gio.DBusProxy` ke path `/org/mpris/MediaPlayer2`, interface
   `org.mpris.MediaPlayer2.Player`.
3. Baca properti: `PlaybackStatus`, `Metadata`, `CanGoNext`, `CanGoPrevious`, `CanPlay`,
   `CanPause`, `Volume`.
4. Kontrol: method `PlayPause`, `Next`, `Previous`, `SetPosition` (butuh `TrackId`).
5. Pantau `PropertiesChanged` dan `Seeked`.

Kunci metadata yang dipakai:

| Kunci | Pemakaian |
|---|---|
| `xesam:title` | Judul |
| `xesam:artist` | Artis, gabung dengan `, ` |
| `xesam:album` | Album, hanya di pinned |
| `mpris:artUrl` | Artwork, hanya `file://` di v1 |
| `mpris:length` | Durasi, mikrodetik |
| `mpris:trackid` | Deteksi lagu berganti |

Posisi tidak dikirim lewat `PropertiesChanged`. Simpan posisi terakhir saat `Seeked`
atau saat proxy dibuat, lalu hitung sendiri dengan `GLib.get_monotonic_time()` selama
status `Playing`. Saat pause, bekukan. Saat track berubah, reset ke 0.

Pemilihan player aktif:

1. Player yang statusnya `Playing` menang.
2. Kalau tidak ada yang playing, player yang terakhir mengirim perubahan menang.
3. Kalau tidak ada, tab media kosong.

Jangan menampilkan lebih dari satu player di v1. Dropdown pemilih player masuk v2.

### Media: tampilan

| State | Isi |
|---|---|
| Peek | `♪ Judul, Artis` satu baris |
| Transient | Artwork 48 px (radius 12), judul, artis, progress 3 px, tombol play/pause |
| Pinned | Artwork 64 px (radius 14), judul, artis, album, progress dengan waktu, prev/play/next, slider volume |

Progress bar diperbarui tiap 1 detik lewat timer, bukan tiap frame. Timer hanya hidup
saat tab media terlihat.

### Volume: sumber

Ada dua jalur, dipilih saat implementasi:

**A. Gvc (disarankan).** `import Gvc from 'gi://Gvc';` lalu buat
`new Gvc.MixerControl({name: 'Nocella'})`. Ini pustaka yang sama yang dipakai GNOME
Shell untuk slider volume. Event yang tersedia: `state-changed`,
`default-sink-changed`, `notify::volume`, `notify::is-muted` pada stream default.

Risiko: Gvc adalah pustaka privat GNOME Shell, typelib-nya ada di
`/usr/lib/gnome-shell/Gvc-1.0.typelib`, bukan di path GI umum. `libgvc.so` juga hanya
bisa di-resolve di dalam proses shell; `gjs` biasa gagal mengimpornya. Bungkus dengan
`try/catch` dan fallback ke B. Jangan mengandalkan Gvc sebagai satu-satunya jalur.

**B. wpctl.** Jalankan `wpctl get-volume @DEFAULT_AUDIO_SINK@` untuk membaca dan
`wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+` untuk mengubah. Tidak ada event subscription
yang sederhana, jadi polling 500 ms hanya saat panel terbuka. Di state collapsed tidak
ada polling.

Jalur A dipakai kalau `gi://Gvc` berhasil diimpor. Jalur B hanya fallback.

### Volume: tampilan

| State | Isi |
|---|---|
| Transient | Ikon speaker, slider, persentase, nama output (maks 1 baris) |
| Pinned | Slider volume + tombol mute + dropdown output |

Slider memakai `St.DrawingArea` atau `St.Bin` dengan aktor isi. Drag memakai
`Clutter.PanGesture` atau `Clutter.DragAction`; jangan memasang pan gesture global.
Saat drag, jangan memanggil `wpctl` tiap frame. Simpan nilai, panggil setelah 80 ms
diam, dan sekali saat drag selesai.

### Gagal

- Tidak ada player: tab media kosong dengan teks "Tidak ada media diputar".
- Player hilang saat diputar: tahan 2 detik, lalu kosongkan.
- Artwork bukan `file://`: pakai placeholder.
- Gvc gagal dan `wpctl` tidak ada: sembunyikan kontrol volume, jangan tampilkan slider
  yang tidak berfungsi.

### Usaha: 5 hari (media 3, volume 2)

## 3. Notifikasi

### Sumber

`Main.messageTray` (objek `MessageTray.MessageTray`). API yang dipakai:

| API | Keterangan |
|---|---|
| `getSources()` | Daftar sumber notifikasi |
| signal `source-added` / `source-removed` | Sumber baru/hilang |
| signal `queue-changed` | Ada perubahan antrean |
| `source.notifications` | Array notifikasi milik sumber |
| `source.open()` | Buka aplikasi sumber |
| `notification.title`, `.body` | Teks |
| `notification.gicon` | Ikon |
| `notification.urgency` | `MessageTray.Urgency.LOW/NORMAL/HIGH/CRITICAL` |
| `notification.actions` | Array `MessageTray.Action` dengan `label` dan `activate()` |
| `notification.activate()` | Aksi default |
| `notification.acknowledged` | Sudah dibaca |
| `notification.destroy(reason)` | Hapus dari pusat notifikasi |
| `Main.messageTray.bannerBlocked = true` | Sembunyikan banner GNOME |

`bannerBlocked` sudah dicek ada di GNOME Shell 46 (`messageTray.js`, setter di baris
828). Di GNOME 47+ properti ini bisa berubah. Kalau tidak ada, pakai mode cermin.

### Tampilan

| State | Isi |
|---|---|
| Transient | Ikon aplikasi 28 px (radius 8), nama aplikasi, judul, satu baris isi, maks 2 aksi |
| Pinned tab "Hari ini" | Daftar 5 terbaru, tombol "Bersihkan" bergaya pill, klik untuk aksi default |
| Badge | Titik oranye di notch kalau ada yang belum dibaca |

Gaya kartu mengikuti `03-desain-visual.md`: latar `rgba(255,255,255,0.05)`, radius 16,
judul 13 px/600, isi 12 px/400 secondary, waktu 10 px tertiary. Aksi utama memakai pill
biru `#0A84FF`, aksi sekunder memakai pill `rgba(255,255,255,0.08)`. Tidak ada border
tebal dan tidak ada warna aksen pada seluruh kartu.

Aturan:

- Notifikasi `LOW` tidak pernah muncul sebagai transien. Hanya masuk daftar.
- Notifikasi `CRITICAL` bertahan sampai pengguna menutup atau membuka aksinya, dengan
  batas pengaman 60 detik. Setelah itu notch menutup dan badge merah tetap terlihat.
- Notifikasi dari aplikasi yang sama digabung dalam jendela 3 detik.
- Daftar pinned menampilkan 5 notifikasi terbaru. Tombol "Lihat semua" memperluas
  daftar di dalam panel (`St.ScrollView`, maksimal 50 terbaru) yang dibangun hanya saat
  dibuka. Pusat notifikasi GNOME tidak dibuka dari sini karena `dateMenu`
  disembunyikan (ADR 0003).
- Jangan menampilkan isi notifikasi di layar terkunci. GNOME menonaktifkan ekstensi
  saat layar dikunci (`metadata.json` tanpa `session-modes`), jadi ini otomatis.

### Aksi

- Klik kartu: `notification.activate()`.
- Klik aksi: `action.activate()`.
- Klik "Bersihkan": `notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED)`.
- Klik kanan: tidak ada.

### Gagal

- `bannerBlocked` tidak ada: banner GNOME tetap muncul, notch menjadi cermin. Catat di
  log sekali, jangan tiap notifikasi.
- Notifikasi tanpa `body`: tampilkan hanya judul.
- Notifikasi tanpa `gicon`: pakai ikon aplikasi dari `source.icon` atau ikon generik.
- Notifikasi sangat panjang: elipsis dua baris, jangan memperbesar panel.

### Usaha: 4 hari

## 4. System monitor

### Sumber

| Metrik | Berkas/API | Rumus |
|---|---|---|
| CPU | `/proc/stat` baris `cpu` | `100 * (1 - Δidle / Δtotal)` |
| RAM | `/proc/meminfo` | `(MemTotal - MemAvailable) / MemTotal` |
| Swap | `/proc/meminfo` | `(SwapTotal - SwapFree) / SwapTotal` |
| Disk | `Gio.File.new_for_path('/').query_filesystem_info('filesystem::size,filesystem::free', null)` | `1 - free/size` |
| Network | `/proc/net/dev` | Δbytes / Δdetik, skip `lo` |
| Suhu | `/sys/class/thermal/thermal_zone*/temp` | milidegree / 1000 |
| Baterai | `/sys/class/power_supply/BAT*/capacity`, `status` | langsung |
| Load | `/proc/loadavg` | langsung |
| Uptime | `/proc/uptime` | langsung |

Pembacaan berkas memakai `GLib.file_get_contents` (sinkron, kecil) atau
`Gio.File.load_contents_async`. Untuk berkas `/proc` dan `/sys`, sinkron tidak masalah
karena ukurannya beberapa KB dan sudah di page cache. Jangan membaca `/proc` tiap frame.

Suhu: pilih zona dengan tipe `x86_pkg_temp`, `acpitz`, atau `k10temp`. Kalau tidak ada,
sembunyikan baris. Jangan memilih zona pertama begitu saja karena bisa zona baterai.

### Polling

| State | Interval | Timer |
|---|---|---|
| Collapsed | tidak ada | 0 |
| Peek | tidak ada | 0 |
| Transient | tidak ada | 0 |
| Pinned, tab sistem | 1 detik | satu timer |
| Pinned, tab lain | tidak ada | 0 |

Saat tab sistem dibuka, ambil sampel pertama langsung, lalu mulai timer. Saat tab
ditutup, hentikan timer dan buang sampel. Ini membuat biaya sistem monitor nol saat
tidak dilihat.

### Tampilan

Tab sistem berisi:

```
CPU     12%   ▁▂▃▅▆▅▃▂▁▂▃▅
RAM     4.2 / 15.6 GB   ▁▁▂▂▃▃▂▁
Disk    61%   (tidak perlu grafik)
Net     ↓ 1.2 MB/s  ↑ 240 KB/s
Suhu    52°C
Baterai 84%  (mengisi)
```

Di bawah blok metrik ada grid quick settings dan slider brightness. Detailnya di
bagian 6.

Grafik sparkline: `St.DrawingArea` 60 sampel, lebar 120 px, tinggi 24 px, digambar dengan
Cairo. Riwayat disimpan di ring buffer. Warna grafik mengikuti aksen, dengan area di
bawah kurva 12% opasitas.

Angka memakai satuan biner (KiB/MiB/GiB) dan satu desimal. Jangan menampilkan
`4.199999 GB`.

### Gagal

- Berkas tidak ada: baris disembunyikan.
- Pembacaan gagal sekali: pakai sampel terakhir, jangan reset grafik.
- Gagal 5 kali berturut-turut: hentikan timer, tampilkan "Data tidak tersedia".
- Desktop tanpa baterai: baris baterai hilang, tinggi panel menyesuaikan.

### Usaha: 3 hari

## 5. Workspace dan window

### Sumber

- `global.workspace_manager.get_active_workspace_index()`
- `global.workspace_manager.n_workspaces` dan signal `notify::n-workspaces`
- signal `active-workspace-changed`
- `global.display.focus_window` dan signal `notify::focus-window`
- `window.get_title()`, `window.get_wm_class()`, `window.minimized`
- `Shell.WindowTracker.get_default().get_window_app(window)` untuk nama dan ikon aplikasi

### Tampilan

| State | Isi |
|---|---|
| Transient | `Workspace 2/4` + judul window, 1,2 detik |
| Pinned tab | Grid workspace 1..N, judul window aktif, tombol pindah |

Klik workspace memanggil `workspace.activate(global.get_current_time())`. Klik window
memanggil `window.activate(global.get_current_time())` dan `window.unminimize()` kalau
perlu.

Jangan menampilkan thumbnail window di v1. Itu memerlukan `Clutter.Clone` dari
`window.get_compositor_private()` dan bisa mahal untuk banyak window.

### Gagal

- Window fokus `null` (desktop): tampilkan nama workspace saja.
- Dynamic workspace aktif: jumlah berubah, grid menyesuaikan.
- Window tanpa judul: tampilkan nama aplikasi.

### Usaha: 2 hari

## 6. Quick settings

Bagian ini hidup di tab "Sistem", di bawah metrik. Bukan tab terpisah, supaya panel
tidak penuh dan tetap terasa seperti Control Center macOS.

### Sumber dan aksi

| Toggle | Baca | Ubah | Catatan |
|---|---|---|---|
| Wi-Fi | NetworkManager `WirelessEnabled` | set properti yang sama | Butuh `Gio.DBus.system` |
| Bluetooth | BlueZ adapter `Powered` | set properti | Cari adapter lewat ObjectManager |
| Mode gelap | `org.gnome.desktop.interface color-scheme` | `prefer-dark` / `default` | |
| Night light | `org.gnome.settings-daemon.plugins.color night-light-enabled` | set | |
| Jangan ganggu | `org.gnome.desktop.notifications show-banners` | set | `false` = DND |
| Power mode | `net.hadess.PowerProfiles` properti `ActiveProfile` | set | Kalau service ada |
| Screenshot | `org.gnome.Shell.Screenshot` method `Screenshot` | panggil | Layar penuh dulu |
| Kunci layar | `org.gnome.ScreenSaver` method `Lock` | panggil | |

Wi-Fi dan Bluetooth memakai D-Bus sistem. Jangan memanggil `nmcli`/`bluetoothctl` tiap
toggle; subprocess hanya untuk fallback.

### Tampilan

Grid 4 kolom, tile 84x72 dengan radius 16, ikon 20 px, dan label 10 px. Toggle aktif
memakai latar `rgba(10, 132, 255, 0.18)` dan ikon biru `#0A84FF`. Toggle nonaktif
memakai latar `rgba(255, 255, 255, 0.05)` dan ikon secondary. Slider brightness di
bawah grid, memakai track 4 px dan knob 14 px. Slider volume ada di tab Media, bukan
di sini, supaya tidak ada dua kontrol untuk hal yang sama.

Brightness: `org.gnome.SettingsDaemon.Power.Screen` D-Bus properti `Brightness`
(0-100). Kalau tidak ada (desktop tanpa backlight), sembunyikan slider.

### Gagal

- NetworkManager tidak ada: toggle Wi-Fi disembunyikan.
- BlueZ tidak ada: toggle Bluetooth disembunyikan.
- PowerProfiles tidak ada: toggle power disembunyikan.
- Aksi gagal: kembalikan posisi toggle ke state sebenarnya, tampilkan toast kecil di
  dalam panel. Jangan biarkan toggle "aktif" padahal gagal.

### Usaha: 3 hari

## 7. Status agen AI

Ini fitur yang paling terikat ke lingkungan pengguna dan paling mudah salah desain.
Karena itu ada lapisan bridge terpisah.

### Arsitektur

```
OpenCode / Claude / lainnya
        │  (SQLite, HTTP, atau hook)
        ▼
nocella-agent-bridge        proses Python kecil, di luar gnome-shell
        │  D-Bus: id.antariksa.Nocella.Agent1
        ▼
ekstensi (provider agent.js)
```

Bridge berjalan sebagai service user, bukan di dalam shell. Kalau bridge mati, shell
tidak terpengaruh. Kalau OpenCode berubah format database, hanya bridge yang perlu
diperbaiki.

### Antarmuka D-Bus

Nama: `id.antariksa.Nocella.Agent`
Path: `/id/antariksa/Nocella/Agent`
Interface: `id.antariksa.Nocella.Agent1`

```text
method ListSessions() -> a(ssssssutttt)
    id, title, directory, model, status, outcome, pid,
    tokens_in, tokens_out, updated_unix, started_unix

method GetSummary() -> a{sv}
    active (u), waiting (u), error (u), tokens_today (t), model (s)

signal SessionChanged(s id, a{sv} data)
signal SummaryChanged(a{sv} data)
```

Status yang dipakai UI: `working`, `waiting-permission`, `idle`, `done`, `error`.
Jangan menampilkan status yang tidak bisa dibuktikan. Kalau bridge hanya tahu
"time_updated baru saja", sebut `aktif`, bukan `sedang menulis kode`.

### Sumber data OpenCode v2

Database: `~/.local/share/opencode/opencode.db` (SQLite, WAL). Tabel `session_v2` punya
kolom yang cukup: `id`, `title`, `directory`, `parent_id`, `model`, `tokens_input`,
`tokens_output`, `tokens_reasoning`, `time_created`, `time_updated`, `time_idle`,
`idle_outcome`, `permission`.

Bridge membuka database read-only (`mode=ro`), tidak pernah menulis. Polling 2 detik,
atau memantau perubahan `-wal` lewat `Gio.FileMonitor` lalu debounce 500 ms. Jangan
membaca seluruh isi pesan; hanya metadata sesi.

Alternatif yang lebih stabil: kalau OpenCode server lokal sedang berjalan, bridge
memanggil API-nya (`/api/session`) alih-alih membaca database. Bridge memilih sumber
secara otomatis dan menandai sumber mana yang dipakai di log.

### Tampilan

| State | Isi |
|---|---|
| Collapsed | Titik biru kalau ada sesi aktif, abu-abu kalau tidak |
| Transient selesai | `OpenCode · selesai · 2m 14d · 18.4k token` |
| Transient error | Ikon peringatan, nama sesi, pesan singkat |
| Pinned tab "Agen" | Daftar sesi: proyek, model, status, durasi, token |

Status ditampilkan sebagai pill kecil 20 px: titik 6 px + label 10 px/600. Warna:
biru `#0A84FF` untuk aktif, oranye `#FF9F0A` untuk menunggu izin, hijau `#30D158`
untuk selesai, merah `#FF453A` untuk error, abu `#6E6E73` untuk idle. Angka token
memakai tabular numerals dan satuan `k`/`M`, bukan angka mentah.

Baris sesi 48 px: nama proyek 12 px/600, model 10 px secondary, status pill di kanan,
durasi 10 px tertiary. Tidak ada avatar dan tidak ada ikon besar.

Klik sesi membuka terminal di direktori proyek (`kgx --working-directory=...` atau
terminal default). Jangan menjalankan `opencode` atau perintah lain secara otomatis.
Cukup buka terminal di direktori itu, atau salin ID sesi.

### Privasi

Yang boleh ditampilkan: nama proyek (basename direktori), model, status, token, durasi.
Yang tidak boleh: isi prompt, isi jawaban, path lengkap, nama berkas, kunci API.
Ini sejalan dengan aturan proyek `ai-agent-dashboard`.

### Gagal

- Bridge tidak ada: tab agen disembunyikan sepenuhnya, bukan menampilkan error.
- Database terkunci: coba lagi 5 detik, jangan spam log.
- Skema database berubah: bridge mencatat versi skema dan berhenti dengan pesan jelas.
- Sesi lebih dari 20: tampilkan 5 terbaru, sisanya di "Lihat semua".

### Usaha: 6 hari (bridge 3, UI 3)

## Ringkasan usaha

| Fitur | Hari | Prioritas |
|---|---:|---|
| Kerangka ekstensi, panel, jam, material | 5 | P0 |
| State machine dan arbiter | 2 | P0 |
| Media | 3 | P0 |
| Notifikasi | 4 | P0 |
| Volume | 2 | P1 |
| System monitor | 3 | P1 |
| Workspace dan window | 2 | P1 |
| Quick settings | 3 | P2 |
| Agen AI (bridge + UI) | 6 | P2 |
| Preferensi, poles, dokumentasi | 5 | P2 |
| **Total** | **35 hari** | |

Estimasi ini untuk satu orang yang sudah familiar dengan GJS. Kalau belum, tambah
50-100% untuk fase belajar dan debugging API privat.
