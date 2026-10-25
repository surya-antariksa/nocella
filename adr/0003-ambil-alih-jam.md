# ADR 0003: Notch mengambil alih area jam

Status: **diterima** (2026-10-24).

Tanggal: 2026-10-24

## Konteks

GNOME Shell menempatkan jam di tengah panel atas. Notch juga harus berada di tengah
atas. Keduanya tidak bisa menempati ruang yang sama tanpa salah satu terlihat aneh.

Ada empat kemungkinan:

1. Notch di bawah panel, jam tetap di tempatnya.
2. Jam disembunyikan, notch menggantikannya.
3. Jam dipindah ke kiri atau kanan, notch di tengah.
4. Notch menelan widget jam GNOME dan menampilkannya di dalam notch.

## Keputusan

**Jam GNOME disembunyikan, notch menggantikannya.** Notch menampilkan jam di state
collapsed, dan panel pinned menyediakan tanggal, kalender bulan, serta daftar notifikasi
sebagai pengganti menu jam GNOME.

Saat ekstensi dinonaktifkan, jam GNOME ditampilkan kembali.

## Alasan

- Notch terlihat seperti bagian dari panel, bukan widget yang melayang di bawahnya.
- Tidak ada dua jam yang berdekatan.
- Ruang tengah panel memang sudah menjadi milik jam. Mengambil alihnya paling sedikit
  mengubah tata letak panel.
- Klik notch bisa langsung membuka kalender dan notifikasi, yang merupakan fungsi utama
  jam GNOME. Jadi tidak ada fungsi yang hilang, hanya berpindah tempat.

## Konsekuensi

Yang didapat:

- Tata letak bersih, satu elemen di tengah.
- Notch bisa mengatur sendiri ukuran dan isi tanpa bertabrakan dengan jam.
- Jam bisa menjadi bagian dari animasi buka/tutup.

Yang dikorbankan:

- Menu jam GNOME (kalender, notifikasi, cuaca) tidak lagi bisa dibuka dengan klik jam
  biasa. Notch harus menyediakan penggantinya.
- Ekstensi lain yang mengandalkan `Main.panel.statusArea.dateMenu` bisa terganggu.
- Kalau notch gagal dimuat, pengguna kehilangan jam sampai ekstensi dinonaktifkan.
- Jam tidak lagi bisa diakses saat notch SUPPRESSED (fullscreen, overview). Saat layar
  terkunci, GNOME menonaktifkan ekstensi dan lock screen memakai jamnya sendiri, jadi
  tidak masalah. Di fullscreen, jam hilang
  sampai keluar fullscreen atau memanggil hotkey.

Mitigasi:

- `disable()` selalu mengembalikan visibilitas jam.
- Kalau pembuatan notch gagal di `enable()`, jangan sembunyikan jam.
- Panel pinned punya tab "Hari ini" dengan kalender dan notifikasi.
- Kalau pengguna butuh jam GNOME, nonaktifkan ekstensi. Tidak ada opsi `hide-clock` di
  v1 karena notch yang menempel selalu menempati area jam.

## Alternatif yang ditolak

### Notch di bawah panel

Aman, tidak mengubah apa pun. Tapi terlihat seperti widget terpisah, bukan bagian dari
panel. Jarak dari tepi atas membuatnya kurang seperti "notch" dan lebih seperti
"floating pill". Ditolak untuk v1. Bisa ditinjau ulang kalau ada kebutuhan nyata.

### Jam dipindah ke kiri/kanan

Mengubah tata letak panel secara global. Tombol Activities dan indikator status bisa
bergeser, dan ekstensi lain yang menempatkan diri di kiri/kanan bisa bentrok. Ditolak
karena dampaknya lebih luas daripada menyembunyikan jam.

### Menelan widget jam GNOME

Memindahkan `dateMenu` ke dalam aktor notch secara teknis mungkin, tapi merusak menu,
aksesibilitas, dan layout panel. Widget itu bukan dirancang untuk dipindah. Ditolak.

## Risiko

| Risiko | Mitigasi |
|---|---|
| `statusArea.dateMenu` tidak ada di versi lain | Cek keberadaan, jangan sembunyikan apa pun, catat log |
| Ekstensi lain juga menyembunyikan jam | Deteksi `visible` sebelum menyembunyikan, pulihkan hanya kalau kita yang menyembunyikan |
| Pengguna butuh menu jam GNOME | Sediakan tab "Hari ini", atau nonaktifkan ekstensi |
| Notch gagal enable | Jangan sembunyikan jam sampai notch benar-benar siap |

## Kapan ditinjau ulang

- Kalau pengguna lebih sering memakai menu jam GNOME daripada notch.
- Kalau ada ekstensi lain yang konflik dan tidak bisa diselesaikan.
- Kalau GNOME mengubah tata letak panel di versi mendatang.
