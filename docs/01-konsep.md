# 01. Konsep

Nocella adalah nama proyek untuk notch pintar ini. Bentuknya mengikuti notch MacBook,
perilakunya mengikuti Dynamic Island.

## Masalah

Panel GNOME 46 sudah punya jam, indikator status, dan menu quick settings. Tapi
semuanya tersebar: media di menu terpisah, notifikasi muncul sebagai banner di atas
layar, status sistem tidak terlihat sama sekali, dan status agen AI (OpenCode, Claude,
dsb.) hanya bisa dilihat dengan pindah ke terminal.

Akibatnya, untuk tahu "apa yang sedang terjadi" pengguna harus membuka beberapa tempat
berbeda. Notifikasi juga menutupi konten dan hilang sendiri sebelum sempat dibaca.

## Ide

Satu notch kecil di tengah atas layar yang selalu terlihat, lalu membesar saat ada
sesuatu yang layak dilihat. Setelah selesai, ia mengecil lagi. Bentuknya meniru notch
MacBook: menempel di tepi atas, hitam, sudut atas siku, sudut bawah membulat. Perilakunya
meniru Dynamic Island: muncul, membesar, dan menghilang sesuai konteks.

Di desktop ada keuntungan tambahan: layar jauh lebih lebar, jadi ekspansi bisa
menampilkan informasi lebih banyak tanpa menutupi banyak area.

Nocella bukan pengganti panel GNOME. Ia hidup di dalam panel, mengambil area tengah, dan
meminjam ruang ke bawah hanya saat terbuka.

## Prinsip desain

1. **Tenang secara default.** Saat tidak ada aktivitas, notch hanya menampilkan jam.
   Tidak ada grafik bergerak, tidak ada angka CPU yang berkedip.
2. **Satu hal pada satu waktu.** Hanya satu konten transien yang boleh mengambil alih
   notch. Konten lain mengantre atau digabung.
3. **Kembali ke semula.** Setiap ekspansi otomatis punya batas waktu. Notch tidak boleh
   tertinggal terbuka karena bug.
4. **Tidak mencuri fokus.** Notch tidak pernah mengambil fokus keyboard kecuali pengguna
   mengklik atau menekan hotkey. Notifikasi tidak boleh membuat notch merebut perhatian
   saat pengguna sedang mengetik atau menonton fullscreen.
5. **Jujur saat gagal.** Kalau data tidak tersedia (MPRIS mati, sensor tidak ada), notch
   menampilkan keadaan kosong yang jelas, bukan angka palsu atau spinner abadi.
6. **Murah.** Saat tertutup, ekstensi mendekati nol wakeup dan nol CPU. Semua polling
   berat hanya hidup saat notch terbuka.
7. **Tenang seperti macOS.** Hitam, abu, satu biru. Tidak ada gradient ramai, tidak ada
   animasi memantul, tidak ada elemen yang berebut perhatian.

## Non-goals

- Bukan pengganti dock, launcher, atau alt-tab.
- Bukan sistem notifikasi baru. Notifikasi GNOME tetap sumber kebenaran; notch hanya
  menampilkan ulang dan menyediakan aksi cepat.
- Bukan panel kontrol pengganti quick settings GNOME di v1. Quick settings di notch
  adalah pintasan, bukan duplikat penuh.
- Bukan aplikasi lintas desktop. Khusus GNOME Shell 46, dengan kemungkinan dukungan
  47/48 setelah v1 stabil.
- Bukan proyek GTK/QML. Tidak ada rencana memindahkan UI ke toolkit lain.

## Skenario pemakaian

### S1. Meja kerja, tidak ada aktivitas

Notch 196x32 di tengah atas berisi jam `14:32` dan satu titik kecil status agen.
Panel kiri dan kanan tetap seperti biasa. Notch tidak menghalangi apa pun.

### S2. Lagu berganti

Spotify/Firefox memutar lagu baru. Notch melebar ke 380x68 selama 4 detik, menampilkan
artwork 48 px, judul, artis, dan progress bar tipis. Klik membuka tampilan media penuh
(420x240) dengan tombol previous/play/next dan slider volume. Setelah 4 detik tanpa
interaksi, kembali ke notch tertutup.

### S3. Notifikasi masuk

Notifikasi Telegram masuk. Notch melebar ke 420x92, menampilkan ikon aplikasi, judul,
satu baris isi, dan dua aksi (Buka, Tandai dibaca) kalau tersedia. Banner GNOME
disembunyikan supaya tidak dobel. Notch bertahan 6 detik, atau sampai pengguna
mengarahkan kursor ke sana.

### S4. Volume diubah

Pengguna menekan tombol volume keyboard. Notch menampilkan slider volume dan nama output
selama 1,5 detik. Perubahan beruntun digabung, bukan membuat antrean.

### S5. Melihat status sistem

Pengguna mengklik notch. Panel terbuka ke 420x240. Tab ringkas menampilkan CPU, RAM,
disk, network, suhu, dan baterai. Grafik hanya bergerak selama panel terbuka. Klik di
luar menutup.

### S6. Agen AI selesai bekerja

Sesi OpenCode menyelesaikan tugas. Notch menampilkan baris status: nama model, durasi,
jumlah token, dan status akhir. Kalau ada error, warna status berubah dan teks menyebut
kegagalan. Klik membuka detail sesi.

### S7. Fullscreen

Pengguna menonton video fullscreen. Notch disembunyikan sepenuhnya. Notifikasi tetap
masuk ke pusat notifikasi GNOME, tapi tidak memunculkan notch. Hotkey tetap bisa
memanggil notch kalau benar-benar diperlukan.

## Istilah

| Istilah | Arti |
|---|---|
| Notch | Bentuk Nocella saat tertutup |
| Peek | Ekspansi singkat saat kursor berhenti di atas notch, belum terkunci |
| Pinned | Notch terbuka karena klik atau hotkey, tidak menutup sendiri |
| Transien | Konten yang muncul otomatis lalu hilang sendiri |
| Provider | Modul yang memasok data ke notch (media, sistem, agen, dst.) |
| Arbiter | Penentu konten mana yang tampil saat beberapa provider aktif bersamaan |
| Chrome | Aktor Clutter yang dipasang di atas UI GNOME lewat `Main.layoutManager.addChrome` |

## Pertanyaan yang sengaja belum dijawab

Beberapa hal lebih baik diputuskan setelah prototipe pertama terlihat:

- Apakah blur asli layak ditambahkan setelah v1, atau faux vibrancy sudah cukup.
- Apakah jam tetap di notch saat terbuka, atau pindah ke kanan atas.
- Apakah status agen AI layak selalu terlihat, atau hanya saat aktif.
- Apakah perlu gestur swipe untuk membuka, atau klik saja cukup.
- Apakah perlu waveform kecil saat media diputar, atau cukup titik status.

Jawaban sementara ada di dokumen desain, tapi keputusan final menunggu fase 1.
