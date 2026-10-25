# 04. Interaksi

## Prinsip

Notch bereaksi terhadap peristiwa, bukan terhadap kursor. Kursor hanya dipakai untuk
membuka sesuatu yang memang sudah menarik perhatian. Ini mencegah notch terbuka setiap
kali mouse lewat di tengah atas layar.

## Trigger

| Trigger | Aksi | Delay | State tujuan |
|---|---|---|---|
| Kursor berhenti di notch | Peek ringkasan | 140 ms | PEEK |
| Kursor pergi dari peek | Tutup | 320 ms | COLLAPSED |
| Klik notch | Buka panel penuh | langsung | PINNED |
| Klik di luar panel | Tutup | langsung | COLLAPSED |
| `Escape` | Tutup | langsung | COLLAPSED |
| Hotkey `<Super>i` | Buka/tutup panel | langsung | PINNED/COLLAPSED |
| Notifikasi masuk | Tampilkan notifikasi | langsung | TRANSIENT |
| Lagu berganti | Tampilkan media | langsung | TRANSIENT |
| Volume berubah | Tampilkan slider | 80 ms (debounce) | TRANSIENT |
| Sesi agen selesai | Tampilkan status | langsung | TRANSIENT |
| Workspace berganti | Indikator kecil | langsung | TRANSIENT (1,2 detik) |
| Layar penuh | Sembunyikan | langsung | SUPPRESSED |
| Layar terkunci | GNOME menonaktifkan ekstensi (`disable()`) | langsung | tidak ada, ekstensi mati sampai unlock |
| Overview terbuka | Sembunyikan | langsung | SUPPRESSED |

Hotkey default bisa diubah di preferensi. Sebelum dipakai, `enable()` mencari konflik di
schema pintasan GNOME (shell, mutter, wm, media-keys). Kalau `<Super>i` sudah dipakai dan
pengguna belum memilih pintasan sendiri, yang didaftarkan adalah kunci `hotkey-fallback`
(`<Super>F9`). Pengaturan pengguna tidak ditulis, jadi `<Super>i` kembali sendiri kalau
bentroknya hilang.

## Rasa macOS

Interaksi harus terasa seperti macOS: responsif, tenang, dan tidak berlebihan.

- **Klik terasa instan.** Animasi buka 300 ms, tapi konten pertama sudah terlihat dalam
  80 ms. Jangan menunggu animasi selesai untuk menampilkan data.
- **Tekan memberi umpan balik.** Tombol mengecil ke 0.94 selama 90 ms, lalu kembali.
  Tidak ada ripple, tidak ada glow.
- **Hover halus.** Latar tombol berubah dalam 140 ms. Tidak ada perubahan ukuran saat
  hover, kecuali slider.
- **Segmen bergeser, bukan berkedip.** Indikator tab aktif meluncur 180 ms. Konten
  crossfade 160 ms.
- **Tidak ada bounce.** Jangan memakai `EASE_OUT_BACK`, `EASE_OUT_ELASTIC`, atau spring.
  Itu bahasa iPhone, bukan MacBook.
- **Klik di luar menutup.** Seperti popover macOS. `Escape` juga menutup.
- **Klik kanan tidak melakukan apa-apa.** Jangan menyembunyikan preferensi di klik kanan.
- **Kursor tidak berubah menjadi tangan** di seluruh panel. Hanya tombol dan tautan yang
  memakai kursor pointer.
- **Fokus keyboard terlihat jelas.** Outline biru 2 px, bukan hanya perubahan warna.

## Prioritas konten

Saat beberapa event datang bersamaan, hanya satu yang tampil. Arbiter memakai tabel ini:

| Prioritas | Event | TTL | Kunci koalesensi |
|---:|---|---:|---|
| 100 | Notifikasi urgensi kritis | sampai ditanggapi, maks 60 dtk | id notifikasi |
| 90 | Notifikasi normal | 6 dtk | aplikasi |
| 85 | Agen AI gagal | 6 dtk | id sesi |
| 80 | Media: lagu berganti | 4 dtk | `media` |
| 75 | Agen AI selesai | 5 dtk | id sesi |
| 70 | Volume berubah | 1,5 dtk | `volume` |
| 60 | Media: play/pause | 2 dtk | `media` |
| 50 | Agen AI sedang bekerja | 3 dtk | id sesi |
| 40 | Workspace berganti | 1,2 dtk | `workspace` |
| 30 | Umpan balik toggle | 1,5 dtk | id toggle |

Aturan:

1. Prioritas lebih tinggi selalu menang, kecuali state sedang PINNED.
2. Prioritas sama: event terbaru menggantikan yang lama, timer di-reset.
3. Prioritas lebih rendah saat TRANSIENT: masuk antrean, maksimal 5 item. Item dengan
   prioritas terendah dibuang lebih dulu; di antara prioritas yang sama, yang paling lama.
4. Antrean dikosongkan saat state menjadi PINNED atau COLLAPSED.
5. Event dengan `coalesceKey` yang sama dengan konten aktif atau item antrean tidak
   membuat tampilan baru: payload diganti nilai terbaru dan TTL di-reset. Arbiter tidak
   memakai jendela waktu. Debounce per sumber (volume 80 ms, media 100 ms, notifikasi
   500 ms) terjadi di provider sebelum event sampai ke arbiter, lihat tabel koalesensi
   di `07-performa.md`. Contoh: menaikkan volume dengan keyboard 10 kali hanya
   menghasilkan satu tampilan dengan nilai akhir.
6. Notifikasi dari aplikasi yang sama dalam 3 detik digabung menjadi satu kartu dengan
   teks `+2 notifikasi lain`.

## Perilaku per state

### COLLAPSED

- Menampilkan jam dan titik status.
- Tidak ada timer yang berjalan selain timer menit jam.
- Hover tidak langsung membuka. Butuh 140 ms berhenti, supaya gerakan cepat ke panel
  kanan tidak memicu peek.
- Klik di mana pun pada notch membuka panel penuh.

### PEEK

- Tinggi 64 px, hanya satu baris ringkasan.
- Kalau ada media, tampilkan media. Kalau tidak, tampilkan notifikasi terakhir. Kalau
  tidak ada keduanya, tampilkan tanggal lengkap dan jumlah notifikasi.
- Klik saat peek langsung membuka view yang sesuai, bukan view default.
- Kursor keluar: timer 320 ms. Kalau kursor masuk lagi, timer dibatalkan.
- Peek tidak pernah menampilkan lebih dari satu item.

### TRANSIENT

- Konten otomatis, tidak mengambil fokus keyboard.
- Timer berjalan sesuai TTL. Hover membatalkan timer selama kursor di atas notch.
- Klik membuka view penuh untuk konten tersebut dan mengubah state ke PINNED.
- Notifikasi kritis bertahan sampai pengguna menanggapinya (klik, aksi, atau tutup),
  dengan batas pengaman 60 detik sesuai prinsip "kembali ke semula". Setelah itu notch
  kembali ke COLLAPSED, badge merah tetap terlihat, dan notifikasi tetap ada di pusat
  notifikasi GNOME.
- Kalau pengguna sedang mengetik (ada window fokus dengan input), notch tetap muncul,
  tapi tidak berbunyi dan tidak mengambil fokus.

### PINNED

- Panel penuh dengan header, segmented control, dan konten.
- Tab memakai segmented control ala macOS, bukan garis bawah. Indikator aktif bergeser
  saat tab berubah.
- Tidak menutup sendiri, kecuali idle 3 menit tanpa interaksi dan tidak ada media yang
  sedang diputar. Ini bisa dimatikan di preferensi.
- Event baru tidak mengganti tab. Tab yang punya event baru menampilkan titik.
- Klik di luar, `Escape`, atau klik chevron menutup.
- Fokus keyboard masuk ke panel. `Tab` berputar di dalam panel. `Shift+Tab` sebaliknya.

### SUPPRESSED

- Aktor disembunyikan (`hide()`), bukan hanya transparan. Tidak ada render, tidak ada
  timer berat.
- Penyebab: fullscreen di monitor primer, overview terbuka, atau pengguna mematikan
  notch lewat preferensi. Layar terkunci bukan SUPPRESSED, karena GNOME menonaktifkan
  ekstensi (lihat "Overview dan lock screen").
- Masuk SUPPRESSED langsung mengembalikan `bannerBlocked` ke `false`, sebelum
  notifikasi berikutnya datang (ADR 0004).
- Saat kembali normal, state selalu COLLAPSED, bukan state sebelumnya. Ini mencegah
  panel terbuka tiba-tiba setelah menonton video.

## Interaksi dengan fitur GNOME

### Jam

Jam GNOME di tengah panel disembunyikan selama ekstensi aktif. Notch mengambil alih
perannya:

- Klik notch membuka panel dengan tab "Hari ini" berisi kalender dan notifikasi.
- Format jam mengikuti `org.gnome.desktop.interface clock-format` (`12h`/`24h`).
- Klik kalender membuka GNOME Calendar kalau terpasang, kalau tidak tidak melakukan apa-apa.
- Saat ekstensi dinonaktifkan, jam GNOME muncul kembali.

Ini keputusan yang berisiko. Kalau ada ekstensi lain yang bergantung pada
`Main.panel.statusArea.dateMenu`, keduanya bisa bentrok. ADR 0003 mencatat alasannya.

### Notifikasi

Dua pilihan. Keputusannya tercatat di ADR 0004:

**A. Cermin pasif.** Banner GNOME tetap muncul, notch hanya menampilkan ulang. Aman,
tapi pengguna melihat notifikasi dua kali.

**B. Ambil alih banner.** Set `Main.messageTray.bannerBlocked = true` hanya selama
notch terlihat dan mampu menampilkan notifikasi, notch yang menampilkan. Lebih bersih,
tapi memakai API privat dan bisa berubah di GNOME 47.

Rancangan memilih B untuk v1 dengan syarat ADR 0004: `bannerBlocked` bernilai `false`
saat SUPPRESSED, saat pembaca layar aktif, dan setelah `disable()`. A menjadi fallback
otomatis kalau properti `bannerBlocked` tidak ada. Notifikasi tetap masuk ke pusat notifikasi GNOME; yang
diambil hanya bannernya.

Do Not Disturb mengikuti `org.gnome.desktop.notifications show-banners`. Saat DND aktif,
notch tidak menampilkan notifikasi sama sekali, hanya menaikkan badge. Ini mencegah
notch menjadi jalan belakang untuk mengganggu pengguna.

### Volume

Notch menampilkan slider saat volume berubah, tapi tidak menampilkan slider saat aplikasi
mengubah volume sendiri (misalnya video call menurunkan volume). Perbedaan ini perlu
penanda: event dari `wpctl` tidak membawa asal perubahan. Solusi sementara: hanya tampilkan
kalau perubahan terjadi dalam 300 ms setelah tombol media ditekan. Kalau tidak bisa
dibedakan, matikan notifikasi volume otomatis dan cukup tampilkan di panel pinned.

### Workspace

Indikator workspace muncul 1,2 detik saat workspace berganti. Isinya: nomor workspace,
jumlah total, dan judul window yang fokus. Tidak membuka panel.

Kalau `org.gnome.mutter dynamic-workspaces` aktif (default), jumlah workspace berubah.
Indikator menampilkan `2/4`, bukan titik-titik tetap.

### Fullscreen

- Fullscreen dideteksi lewat sinyal `in-fullscreen-changed` milik `global.display` dan
  `Main.layoutManager.primaryMonitor.inFullscreen`, lalu state machine pindah ke
  SUPPRESSED. `trackFullscreen` tidak dipakai, karena ia menyembunyikan aktor tanpa
  memberi tahu state machine sehingga `bannerBlocked` bisa tertinggal `true`.
- Notifikasi tetap masuk ke pusat notifikasi. Notch tidak muncul, `bannerBlocked`
  bernilai `false`, dan banner GNOME mengikuti aturan bawaannya.
- Hotkey tetap membuka panel (PINNED) di atas fullscreen. Ini jalan keluar kalau
  pengguna butuh sesuatu saat menonton. `bannerBlocked` tetap `false` selama itu, dan
  menutup panel mengembalikan state ke SUPPRESSED.
- Saat keluar fullscreen, notch kembali ke COLLAPSED.

### Overview dan lock screen

- `Main.overview` signal `showing`/`hidden`: sembunyikan saat overview terbuka.
- Layar terkunci: `metadata.json` sengaja tidak memuat `session-modes`, jadi GNOME
  memanggil `disable()` saat mengunci dan `enable()` setelah unlock. Tidak perlu
  handler `unlock-dialog`. Konsekuensinya, `enable()` dan `disable()` berjalan setiap
  kali layar dikunci, jadi keduanya harus cepat dan bebas kebocoran.
- Jangan mencoba menggambar di atas lock screen. Itu area keamanan dan bukan tempat
  ekstensi pihak ketiga.

### Monitor

v1 hanya monitor primer. Kalau monitor primer berubah (colok/cabut HDMI), notch pindah
ke monitor baru dan kembali ke COLLAPSED. Kalau resolusi berubah, lebar panel di-clamp
ke `monitor.width - 32`.

Multi-monitor dengan notch di tiap layar masuk roadmap v2. Itu bukan sekadar menambah
aktor: notifikasi dan media harus dibagi atau diduplikasi, dan itu keputusan desain
tersendiri.

## Edge case

| Kasus | Perilaku |
|---|---|
| Tidak ada player MPRIS | Tab media menampilkan keadaan kosong, bukan spinner |
| Player MPRIS hilang saat diputar | Tahan 2 detik, lalu kosongkan. Jangan langsung menutup panel |
| Artwork gagal dimuat | Kotak abu-abu dengan ikon musik |
| Notifikasi tanpa judul | Tampilkan nama aplikasi sebagai judul |
| Notifikasi tanpa aksi | Hanya kartu, tanpa tombol |
| 20 notifikasi masuk sekaligus | Gabung per aplikasi, tampilkan `+N`, maksimal 3 kartu |
| Bridge agen mati | Tab agen disembunyikan, tidak ada error berulang di log |
| Suhu tidak tersedia | Baris suhu disembunyikan, bukan menampilkan 0°C |
| Baterai tidak ada (desktop) | Baris baterai disembunyikan |
| Jam diubah ke 12 jam | Notch mengikuti, lebar menyesuaikan |
| Teks diperbesar 200% | Panel tumbuh ke bawah, lebar maksimal 480 px, teks tidak terpotong |
| Animasi dimatikan | Semua transisi instan, tidak ada crossfade |
| Ekstensi lain juga memakai `addChrome` di tengah | Notch tetap di atas, tapi bisa tumpang tindih. Catat di README |
| Shell restart saat panel terbuka | State hilang, kembali ke COLLAPSED |
| Suspend lalu resume | Timer di-reset, MPRIS disambung ulang, state COLLAPSED |
| Pengguna menekan Escape saat peek | Tutup, jangan buka apa pun |
| Klik kanan pada notch | Tidak ada aksi di v1. Jangan dipakai untuk preferensi |

## Preferensi pengguna

Awalnya hanya yang benar-benar dibutuhkan:

| Kunci | Default | Arti |
|---|---|---|
| `notch-enabled` | `true` | Matikan seluruh notch tanpa menonaktifkan ekstensi |
| `auto-expand-media` | `true` | Tampilkan media saat lagu berganti |
| `auto-expand-notifications` | `true` | Tampilkan notifikasi di notch |
| `intercept-banners` | `true` | Ambil alih banner GNOME; matikan untuk mode cermin |
| `auto-expand-volume` | `true` | Tampilkan slider volume |
| `auto-expand-agent` | `true` | Tampilkan status agen |
| `idle-collapse-minutes` | `3` | Tutup panel pinned setelah idle, 0 = tidak pernah |
| `hotkey` | `<Super>i` | Pintasan buka/tutup |

Preferensi lain (posisi, blur, tema, ukuran) ditunda sampai ada kebutuhan nyata. Setiap
kunci baru menambah beban uji dan dokumentasi. Posisi selalu di tengah pada v1 karena
notch yang menempel harus menutupi area jam.
