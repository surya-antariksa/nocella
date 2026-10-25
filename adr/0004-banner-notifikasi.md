# ADR 0004: Mengambil alih banner notifikasi

Status: **diterima** (2026-10-24).

Tanggal: 2026-10-24

## Konteks

GNOME menampilkan notifikasi sebagai banner di atas layar. Notch juga ingin menampilkan
notifikasi. Kalau keduanya aktif, pengguna melihat notifikasi dua kali: satu banner
GNOME, satu kartu notch.

Ada tiga pilihan:

1. **Cermin.** Banner GNOME tetap muncul, notch hanya menampilkan ulang.
2. **Ambil alih.** Banner GNOME disembunyikan selama notch aktif, notch yang menampilkan.
3. **Ganti pusat notifikasi.** Membuat sistem notifikasi sendiri. Terlalu besar dan
   berisiko.

## Keputusan

Memakai **opsi 2 dengan syarat ketat**:

- `Main.messageTray.bannerBlocked = true` hanya ketika notch benar-benar terlihat dan
  mampu menampilkan notifikasi.
- Kalau notch SUPPRESSED (fullscreen, overview), `bannerBlocked = false` supaya banner
  GNOME tetap muncul. SUPPRESSED dipicu state machine dari sinyal fullscreen dan
  overview, bukan lewat `trackFullscreen`, supaya transisi ini tidak terlewat.
- Saat layar terkunci, GNOME menonaktifkan ekstensi dan `disable()` memulihkan nilai
  `bannerBlocked`.
- Kalau notifikasi tidak bisa ditampilkan notch (misalnya urgensi rendah, atau view
  gagal dibuat), banner tetap muncul.
- Kalau `bannerBlocked` tidak ada di versi GNOME yang dipakai, otomatis jatuh ke mode
  cermin.
- Kalau pembaca layar aktif, interception dimatikan secara default. Banner GNOME lebih
  teruji untuk aksesibilitas daripada kartu notch.

Notifikasi tetap masuk ke pusat notifikasi GNOME. Yang diambil hanya bannernya.

## Alasan

- Notch menjadi satu tempat untuk melihat aktivitas, tanpa duplikasi.
- Banner GNOME menutupi konten dan tidak bisa diatur ukurannya. Notch bisa.
- Pusat notifikasi tetap berfungsi, jadi tidak ada data yang hilang.
- Dengan syarat di atas, notifikasi tidak pernah hilang hanya karena notch kebetulan
  tersembunyi.

## Konsekuensi

Yang didapat:

- Tidak ada notifikasi ganda.
- Tampilan konsisten dengan desain notch.
- Aksi notifikasi bisa ditempatkan di dalam kartu.

Yang dikorbankan:

- Memakai API privat (`bannerBlocked`) yang bisa berubah.
- Harus mengelola state `bannerBlocked` dengan hati-hati. Kalau lupa mengembalikan ke
  `false`, semua banner hilang meskipun ekstensi dinonaktifkan.
- Notifikasi yang tidak ditampilkan notch (LOW) tidak muncul sebagai banner. Pengguna
  hanya melihat badge.
- Aksesibilitas belum tentu setara. Pembaca layar mungkin tidak mengumumkan notifikasi
  yang bannernya diblokir.
- Kalau notch crash saat banner diblokir, notifikasi bisa hilang sampai shell restart.

Mitigasi:

- `disable()` selalu memulihkan `bannerBlocked` ke nilai sebelum ekstensi aktif
  (biasanya `false`).
- Simpan nilai sebelumnya dan pulihkan, jangan asumsikan `false`.
- Blokir hanya saat `_canPresentNotification()` benar.
- Uji dengan Orca. Kalau pengumuman ganda atau hilang, matikan interception saat
  screen reader aktif.
- Sediakan preferensi `intercept-banners` supaya pengguna bisa mematikan.

## Aturan state

| State notch | `bannerBlocked` | Alasan |
|---|---|---|
| COLLAPSED | `true` | Notch bisa membesar untuk menampilkan |
| PEEK | `true` | Sama |
| TRANSIENT | `true` | Sedang menampilkan |
| PINNED | `true` | Notch terlihat, badge bisa dipakai |
| SUPPRESSED | `false` | Notch tidak terlihat, banner harus muncul |
| Disabled | nilai awal (biasanya `false`) | Ekstensi tidak aktif |
| Layar terkunci | nilai awal (biasanya `false`) | GNOME memanggil `disable()` |
| Screen reader aktif | `false` | Aksesibilitas |

Transisi ke SUPPRESSED harus langsung mengembalikan `bannerBlocked` ke `false` sebelum
notifikasi berikutnya datang. Jangan menunggu idle.

## Catatan implementasi (fase 3)

Hal yang terbukti di GNOME 46 saat implementasi (`src/banner-block.js`,
`src/providers/notifications.js`):

- `bannerBlocked` hanya punya setter. Nilai awal dibaca dari `_bannerBlocked` privat dan
  dipulihkan di `disable()`.
- Selama diblokir, GNOME tetap mengantrekan banner. Begitu blokir dilepas, antrean itu
  ditampilkan. Karena itu, sebelum melepas blokir, notifikasi yang sudah ditampilkan notch
  dihapus dari `_notificationQueue` privat (dengan pengecekan keberadaannya).
- DND melepas blokir. Notch tidak menampilkan apa pun, dan GNOME tetap menampilkan banner
  kritis sesuai aturannya sendiri.
- Saat banner tidak diblokir (mode cermin, atau SUPPRESSED), handler GNOME untuk
  `notification-request-banner` berjalan lebih dulu dan menandai notifikasi dibaca saat
  menampilkan bannernya. Keputusan notch memakai status `acknowledged` dari saat
  `notification-added`, yang datang tepat sebelumnya.
- Di fullscreen, GNOME sendiri menahan banner biasa dan hanya menampilkan yang kritis.
  Notifikasi tidak hilang; ia menunggu di antrean GNOME.
- Handler GNOME untuk `in-fullscreen-changed` berjalan lebih dulu daripada milik Nocella.
  Saat keluar fullscreen, GNOME langsung menampilkan banner yang ditahan dan menandainya
  dibaca. Karena itu blokir tidak pernah dipasang di tengah banner GNOME
  (`_notificationState` bukan HIDDEN). Blokir menunggu sampai tray GNOME kosong, sehingga
  notifikasi yang ditahan tampil sebagai banner GNOME dan tidak beku tak terlihat. Banner
  kritis GNOME bertahan sampai ditanggapi; selama itu notch berperan sebagai cermin.
- Hanya notifikasi yang benar-benar tampil di notch yang dihapus dari antrean GNOME saat
  blokir dilepas. Notifikasi yang dibuang saat SUPPRESSED, PINNED, atau oleh arbiter tetap
  menunggu bannernya.
- GNOME memutar suara notifikasi hanya saat menampilkan bannernya sendiri. Saat blokir
  aktif, notch yang memanggil `playSound()` ketika notifikasi pertama kali tampil.
- Notifikasi berhint `transient` dihapus (`EXPIRED`) setelah keluar dari notch, seperti
  yang dilakukan GNOME saat bannernya hilang.
- `bannerBlocked` juga ditulis GNOME saat menu panel di kotak tengah dibuka. Nocella
  membandingkan dengan nilai sebenarnya (`_bannerBlocked`), bukan cache.

## Alternatif yang ditolak

### Cermin sejak awal

Paling aman dan paling sederhana. Tapi pengalaman pengguna buruk: notifikasi muncul dua
kali, dan notch terlihat seperti duplikat yang tidak perlu. Ditolak untuk default,
tetap tersedia sebagai fallback.

### Mengganti pusat notifikasi

Membuat `NotificationDaemon` sendiri atau memfilter D-Bus `org.freedesktop.Notifications`.
Terlalu invasif, bisa bentrok dengan GNOME Shell, dan kehilangan integrasi kalender.
Ditolak.

### Menyembunyikan banner secara global tanpa syarat

Kalau notch tersembunyi di fullscreen, notifikasi hilang. Ditolak.

## Kapan ditinjau ulang

- Kalau `bannerBlocked` dihapus atau diubah di GNOME 47/48.
- Kalau uji Orca menunjukkan notifikasi tidak diumumkan.
- Kalau pengguna melaporkan notifikasi hilang saat fullscreen atau lock.
- Kalau ada cara resmi dari GNOME untuk menyerahkan presentasi banner ke ekstensi.
