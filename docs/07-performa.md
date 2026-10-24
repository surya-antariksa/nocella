# 07. Performa

Ekstensi berjalan di proses yang sama dengan compositor. Satu frame yang terlewat
terasa sebagai lag di seluruh desktop, bukan hanya di notch. Karena itu anggaran
performanya ketat dan diukur, bukan dirasa-rasa.

## Anggaran

| Metrik | Target | Batas merah |
|---|---|---|
| CPU saat collapsed, idle | < 0.2% | 1% |
| Wakeup saat collapsed | < 5 per menit | 30 per menit |
| Tambahan RSS | < 15 MB | 40 MB |
| Waktu buka (collapsed → terlihat) | < 100 ms | 200 ms |
| Durasi animasi buka | 300 ms, tanpa frame drop | > 2 frame drop |
| CPU saat pinned tab sistem | < 1.5% | 4% |
| CPU saat media playing, pinned | < 1% | 3% |
| Waktu render ulang sparkline | < 2 ms | 8 ms |

Angka ini diukur di mesin acuan (1920x1080, GNOME 46, Wayland). Kalau hardware lebih
lambat, target turun proporsional, bukan dibiarkan.

## Prinsip

### 1. Tidak ada pekerjaan saat tidak terlihat

Ini aturan terpenting. Saat collapsed:

- Tidak ada polling `/proc`.
- Tidak ada polling volume.
- Tidak ada timer progress media.
- Tidak ada render sparkline.
- Yang berjalan hanya timer menit jam dan signal dari D-Bus/MPRIS yang memang pasif.

Signal D-Bus tetap masuk, tapi handler hanya menyimpan nilai dan memutuskan apakah perlu
menampilkan sesuatu. Handler tidak boleh melakukan pekerjaan berat.

### 2. Event-driven dulu, polling kemudian

Urutan preferensi:

1. Signal GObject (`notify::`, `changed`, `active-workspace-changed`).
2. Signal D-Bus (`PropertiesChanged`, `Seeked`).
3. `Gio.FileMonitor` untuk berkas.
4. Timer polling, hanya saat terlihat.

Polling 1 detik untuk CPU dan RAM tidak bisa dihindari karena `/proc` tidak punya event.
Tapi polling itu hanya hidup saat tab sistem terbuka.

### 3. Koalesensi dan debounce

| Sumber | Jendela | Alasan |
|---|---|---|
| Volume | 80 ms | Drag slider menghasilkan puluhan event |
| Media metadata | 100 ms | Beberapa player mengirim beberapa properti berurutan |
| Notifikasi | 500 ms | Meredam ledakan sinyal `queue-changed`. Pengelompokan per aplikasi (3 detik) terjadi di arbiter |
| Resize/monitor | 250 ms | Colok cabut monitor bisa memicu beberapa signal |
| Sparkline | 1 detik | Tidak perlu lebih halus |

### 4. Jangan memblokir main loop

Panggilan sinkron yang lambat membekukan seluruh desktop. Yang dilarang di UI thread:

- `Gio.DBus.*.call_sync()` dengan timeout panjang.
- `Gio.Subprocess` mode sinkron (`spawn_sync`, `communicate_utf8`).
- Membaca berkas besar.
- `GLib.spawn_command_line_sync`.
- HTTP request.

Yang diizinkan:

- `GLib.file_get_contents` untuk `/proc` dan `/sys` (kecil, di page cache).
- `Gio.DBusProxy.new_for_bus_sync` saat enable (sekali, timeout pendek).
- `Gio.Settings` baca/tulis (cepat, tapi tetap jangan tiap frame).

Untuk `wpctl`, pakai `Gio.Subprocess` async dan batalkan proses sebelumnya kalau masih
jalan. Jangan menumpuk proses.

### 5. Alokasi di hot path

Callback yang dipanggil tiap detik tetap hot path. Hindari:

- Membuat `Gio.File` baru tiap sampel. Simpan satu objek.
- Membuat regex baru tiap parse. Simpan di level modul.
- Membuat string format baru tiap frame. Format hanya saat nilai berubah.
- `Array.map/filter` berantai untuk 60 sampel. Pakai loop dan ring buffer.

## Material

Faux vibrancy tidak memblur apa pun. Ia hanya menumpuk warna translusen, gradient, dan
hairline di atas panel. Biayanya hampir sama dengan latar biasa.

Blur asli berbeda. `Shell.BlurEffect` memblur isi aktor, bukan latar di belakangnya.
Kalau nanti dipakai untuk meniru kaca, ia harus:

- Hanya aktif saat panel diam, bukan saat animasi ukuran.
- Tidak dipasang di aktor yang berisi teks, karena teks ikut kabur.
- Diukur dengan `perf` sebelum dijadikan default.
- Bisa dimatikan lewat preferensi.

Untuk v1, tidak ada blur. Ini keputusan performa sekaligus keputusan visual.

## Strategi per fitur

### Media

- Satu proxy per player, bukan satu proxy per pembacaan.
- Properti `Metadata` di-parse sekali per perubahan, bukan tiap detik.
- Progress dihitung dari `GLib.get_monotonic_time()` dan durasi, bukan polling D-Bus.
- Timer progress 1 detik hanya saat tab media terlihat dan status `Playing`.
- Artwork di-cache berdasarkan URL di `Map` dengan batas 10 entri. Jangan memuat ulang
  gambar yang sama tiap lagu.

### Notifikasi

- Jangan menyalin seluruh daftar notifikasi tiap `queue-changed`. Ambil 5 teratas saja.
  Daftar lengkap (maksimal 50) dibangun hanya saat "Lihat semua" dibuka.
- Simpan referensi ke notifikasi, bukan salinan teksnya.
- Jangan memanggil `notification.activate()` dari handler signal; itu bisa memicu
  reentrancy. Jadwalkan lewat `GLib.idle_add`.

### Sistem

- Satu timer, bukan satu timer per metrik.
- Baca semua berkas dalam satu callback, lalu hitung.
- Ring buffer 60 elemen, alokasi sekali.
- Sparkline digambar hanya kalau tab terlihat. Saat tab disembunyikan, hentikan timer
  dan jangan panggil `queue_repaint()`.
- Suhu: baca daftar zona sekali saat start, jangan scan direktori tiap detik.

### Volume

- Gvc memberi event, jadi tidak ada polling.
- Fallback `wpctl`: polling 500 ms hanya saat panel terbuka. Saat collapsed, tidak ada.
- Jangan spawn proses untuk membaca volume saat drag. Simpan nilai lokal, tulis sekali
  setelah debounce.

### Workspace dan window

- Signal `notify::focus-window` bisa datang beruntun saat alt-tab. Debounce 50 ms.
- Jangan membaca judul window tiap frame. Simpan saat fokus berubah.
- Jangan membuat thumbnail window di v1.

### Agen

- Bridge di proses terpisah, jadi polling database tidak membebani shell.
- Ekstensi hanya menerima signal D-Bus. Kalau bridge mengirim update tiap detik, itu
  masih wajar. Kalau lebih sering, bridge yang harus memperlambat.
- Jangan menampilkan animasi loop untuk status "working". Cukup titik statis atau
  progress indeterminate yang berhenti saat tidak terlihat.

## Cara mengukur

### CPU dan memori

```bash
PID=$(pgrep -n -f 'gnome-shell')
top -b -n 1 -p "$PID" | tail -2
ps -o rss= -p "$PID"
```

Bandingkan sebelum dan sesudah ekstensi aktif, dalam keadaan idle yang sama (tidak ada
window beranimasi, tidak ada video).

### Wakeup

```bash
PID=$(pgrep -n -f 'gnome-shell')
perf stat -e context-switches,cpu-clock -p "$PID" sleep 60
```

Atau `powertop` selama 2 menit di state collapsed. Ekstensi yang baik tidak menambah
wakeup berarti.

### Frame drop saat animasi

Cara paling praktis: rekam layar 60 fps saat membuka/menutup notch, lalu periksa frame
yang terlewat. Untuk pengukuran di dalam shell, catat `global.get_current_time()` di
`onComplete` dan bandingkan dengan durasi yang diminta. Selisih lebih dari 30 ms berarti
ada frame yang hilang.

### Kebocoran

Uji siklus:

```bash
for i in $(seq 1 50); do
  gnome-extensions disable nocella@antariksa
  gnome-extensions enable nocella@antariksa
done
```

Setelah 50 siklus:

- Jumlah child `Main.layoutManager.uiGroup` harus sama seperti sebelum uji.
- RSS tidak boleh naik lebih dari 5 MB.
- Tidak ada error "object already disposed" di log.
- Tidak ada timer yang masih menulis log setelah disable.

### Waktu buka

Tambahkan log sementara:

```js
const t0 = GLib.get_monotonic_time();
this._actor.ease({
    // ...
    onComplete: () => {
        const ms = (GLib.get_monotonic_time() - t0) / 1000;
        console.log(`notch expand: ${ms.toFixed(1)} ms`);
    },
});
```

Hapus log setelah pengukuran. Jangan biarkan log pengukuran tertinggal di rilis.

## Anti-pola yang harus dihindari

| Anti-pola | Kenapa buruk |
|---|---|
| `set_interval(16, ...)` untuk animasi | Menggandakan pekerjaan Clutter, frame tidak sinkron |
| `actor.ease` sambil mengubah `style_class` tiap frame | Reparse CSS tiap frame |
| Membuat aktor baru tiap update | Alokasi dan destroy terus-menerus, GC pressure |
| `console.log` di handler tiap detik | Log I/O di main loop |
| `Gio.DBus.session.call_sync` di handler | Membekukan compositor |
| Membaca `/proc` di `notify::focus-window` | Bisa dipanggil ratusan kali saat alt-tab |
| Menyimpan seluruh riwayat notifikasi | Memori tumbuh tanpa batas |
| Blur di aktor yang dianimasikan | Biaya render naik drastis |
| Mencoba `backdrop-filter` di St | Tidak ada, hasilnya nol atau error CSS |
| Gradient berlapis di dalam animasi ukuran | Reparse dan render ulang tiap frame |
| Timer tanpa `GLib.source_remove` | Timer hantu setelah disable |
| Menjalankan `wpctl` tiap 100 ms saat collapsed | Wakeup dan proses berlebihan |

## Checklist sebelum rilis

- [ ] Collapsed: 0 timer sistem, 0 timer media, 0 render sparkline.
- [ ] Buka/tutup 20 kali berturut-turut, tidak ada kebocoran aktor.
- [ ] Disable saat panel terbuka, tidak ada error di log.
- [ ] Disable saat media playing, timer progress berhenti.
- [ ] Cabut/colok monitor, notch reposition tanpa error.
- [ ] Fullscreen masuk/keluar 10 kali, visibilitas benar.
- [ ] 100 notifikasi berturut-turut, memori stabil.
- [ ] Teks diperbesar 200%, tidak ada teks terpotong.
- [ ] Animasi dimatikan, tidak ada transisi yang tertinggal.
- [ ] `journalctl` bersih setelah 10 menit pemakaian normal.
