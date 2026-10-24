# Nocella

Notch pintar bergaya MacBook untuk Ubuntu GNOME 46 Wayland.

Nocella menempel di tepi atas layar seperti notch MacBook, lalu membesar seperti
Dynamic Island saat ada media, notifikasi, atau aktivitas lain. Setelah selesai, ia
kembali menjadi potongan hitam kecil yang tenang.

Status: **rancangan**. Belum ada kode ekstensi. Folder ini hanya berisi dokumen desain,
keputusan arsitektur, dan rencana kerja. Tujuannya menyepakati bentuk, perilaku, dan
batasan teknis dulu sebelum menulis satu baris JavaScript pun.

## Arah desain

| Aspek | Keputusan |
|---|---|
| Bentuk | Notch menempel di tepi atas, sudut atas 0, sudut bawah membulat. Bukan pill melayang |
| Material | Hitam pekat saat tertutup, kaca gelap translusen saat terbuka. Tanpa blur asli di v1 |
| Tipografi | Inter kalau terpasang, fallback Ubuntu Sans/Cantarell. Ukuran kecil, berat 500-600 untuk judul |
| Warna | Netral hitam/abu, aksen biru macOS `#0A84FF`, status hijau/oranye/merah |
| Kontrol | Segmented control, switch kapsul, slider tipis, tombol ikon bulat |
| Gerak | Halus dan pendek, tanpa bounce. Buka 300 ms, tutup 220 ms |

Detail bentuk, material, dan token visual ada di
[adr/0005-material-macos.md](adr/0005-material-macos.md).

## Ringkasan keputusan

| Hal | Keputusan | Alasan singkat |
|---|---|---|
| Stack | GNOME Shell extension (GJS + St/Clutter) | Satu-satunya jalan yang benar-benar bisa menempel di atas GNOME Wayland tanpa mengganti desktop |
| Bahasa | JavaScript + JSDoc, cek tipe lewat `jsconfig.json` | GJS mengeksekusi JS langsung, tanpa build step. TypeScript bisa menyusul |
| Bahasa kode | Inggris untuk identifier, komentar, log, pesan error, tes, dan schema. Teks UI lewat gettext dengan msgid Inggris, terjemahan di `po/id.po` | Konsisten dengan ekosistem GNOME dan siap diterjemahkan. Aturan lengkap di [docs/09-roadmap.md](docs/09-roadmap.md#konvensi-kode) |
| Framework | Tidak ada. Pakai pola extension resmi GNOME 45+ | Framework UI yang ada menambah build step dan tetap bergantung pada API privat GNOME |
| Posisi | Menempati area jam di tengah panel atas, memanjang ke bawah saat terbuka | Menghindari tabrakan dengan jam dan tidak menutupi konten lain saat tertutup |
| Bentuk | Notch menempel di tepi atas, bukan pill melayang | Mengikuti bahasa visual MacBook, lebih menyatu dengan panel |
| Material | Faux vibrancy: translusensi, gradient, hairline. Tanpa `backdrop-filter` | St tidak punya backdrop blur. Blur asli ditunda ke v2 |
| Monitor | Hanya monitor primer di v1 | Menjaga ruang lingkup; multi-monitor masuk roadmap |
| Isi | Jam, media, volume, notifikasi, sistem, workspace/window, quick settings, status agen AI | Semua fitur yang diminta, disusun bertahap |

## Peta dokumen

| Berkas | Isi |
|---|---|
| [docs/01-konsep.md](docs/01-konsep.md) | Masalah, ide, prinsip, non-goals, skenario pemakaian |
| [docs/02-arsitektur.md](docs/02-arsitektur.md) | Komponen, alur data, state machine, batas modul |
| [docs/03-desain-visual.md](docs/03-desain-visual.md) | Bahasa visual MacBook, geometri, material, warna, tipografi, komponen, motion |
| [docs/palet-warna.svg](docs/palet-warna.svg) | Palet warna inti: tema gelap, tema terang, aksen, dan status |
| [docs/04-interaksi.md](docs/04-interaksi.md) | Trigger, hover, klik, prioritas konten, fullscreen, edge case |
| [docs/05-fitur.md](docs/05-fitur.md) | Spesifikasi tiap fitur, sumber data, API, risiko |
| [docs/06-implementasi-gnome.md](docs/06-implementasi-gnome.md) | Struktur ekstensi, API GNOME, CSS, cara pasang dan debug |
| [docs/07-performa.md](docs/07-performa.md) | Anggaran CPU/memori, strategi polling, cara profiling |
| [docs/08-pengujian.md](docs/08-pengujian.md) | Matriks uji, kasus manual, uji beban, aksesibilitas |
| [docs/09-roadmap.md](docs/09-roadmap.md) | Fase kerja, gate persetujuan, estimasi |
| [adr/](adr/) | Keputusan arsitektur: stack, bahasa, posisi, notifikasi, material |
| [riset/2026-10-24-opsi-stack.md](riset/2026-10-24-opsi-stack.md) | Perbandingan opsi stack, hasil cek lingkungan, referensi visual |

## Cara membaca

Kalau baru pertama kali: baca `01-konsep.md`, lalu `03-desain-visual.md` dan
`04-interaksi.md`. Kalau mau menilai kelayakan teknis: `02-arsitektur.md`,
`05-fitur.md`, dan `06-implementasi-gnome.md`. Alasan tiap keputusan besar ada di `adr/`.

## Batasan yang tidak bisa dinegosiasikan

1. GNOME Shell 46 Wayland tidak mendukung `wlr-layer-shell`. Quickshell, eww, Waybar,
   dan GTK4 layer-shell tidak bisa dipakai di sesi ini.
2. Ekstensi berjalan di dalam proses `gnome-shell`. Bug di ekstensi bisa membekukan
   seluruh desktop. Semua kode harus defensif dan selalu punya `disable()` yang bersih.
3. Banyak API menarik di GNOME Shell bersifat privat (garis bawah). API itu bisa berubah
   tanpa peringatan. Setiap pemakaian harus dicatat dan punya fallback.
4. Jam GNOME ada tepat di tengah panel, lokasi yang sama dengan notch. Salah satu harus
   mengalah. Rancangan ini memilih notch mengambil alih area jam.
5. St bukan browser. Tidak ada `backdrop-filter`, `display: flex`, atau variabel CSS.
   Efek kaca dibuat dengan lapisan warna, gradient, dan hairline.
6. Ekstensi lain yang memasang chrome di tengah panel bisa tumpang tindih dengan notch.
   v1 tidak punya deteksi konflik otomatis; kalau terjadi, catat di log.

## Lingkungan acuan

- Ubuntu dengan GNOME Shell 46.0, sesi Wayland (`ubuntu-wayland`)
- Monitor primer HDMI-1, 1920x1080, skala 1
- Panel GNOME berwarna `#131313`, tinggi 32 px
- Tema gelap (`color-scheme: prefer-dark`), animasi aktif
- `gjs`, `python3`, `node` tersedia. `quickshell`, `eww`, `waybar`, `ags` tidak ada.
- MPRIS aktif (Firefox terdeteksi), PipeWire tersedia lewat `wpctl`

## Lisensi

Copyright (C) 2026 Surya Antariksa

Nocella dirilis di bawah GNU General Public License versi 2 atau (sesuai pilihan Anda)
versi yang lebih baru (`GPL-2.0-or-later`), sama seperti GNOME Shell. Teks lengkapnya
ada di [LICENSE](LICENSE).
