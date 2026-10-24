# ADR 0001: GNOME Shell extension sebagai stack

Status: **diusulkan**, menunggu persetujuan.

Tanggal: 2026-10-24

## Konteks

Perangkat target menjalankan Ubuntu dengan GNOME Shell 46.0 di Wayland. GNOME tidak
mengimplementasikan protokol `wlr-layer-shell`, sehingga aplikasi yang mengandalkan
layer-shell tidak bisa menempel di atas layar. Lingkungan juga tidak memiliki
`quickshell`, `eww`, `waybar`, atau `ags`.

Ada tiga jalan yang masuk akal:

1. GNOME Shell extension (GJS, St, Clutter).
2. Pindah ke compositor yang mendukung layer-shell (Hyprland atau sway), lalu pakai
   Quickshell.
3. Membuat prototipe UI di toolkit lain tanpa integrasi desktop penuh.

## Keputusan

Memakai **GNOME Shell extension**. Notch dibuat sebagai aktor Clutter yang dipasang
lewat `Main.layoutManager.addChrome()`. Semua data diambil dari dalam proses shell
lewat GObject, D-Bus, GSettings, dan berkas sistem.

## Alasan

- Satu-satunya opsi yang berjalan di desktop yang sudah dipakai tanpa mengganti
  compositor, session manager, dan kebiasaan.
- Akses langsung ke `Main.panel`, `Main.messageTray`, `Main.layoutManager`, dan
  `global.display`. Tidak perlu jembatan untuk notifikasi, workspace, dan window.
- Tidak ada layer-shell, tidak ada XWayland, tidak ada compositor tambahan.
- Distribusi mudah: satu folder di `~/.local/share/gnome-shell/extensions/`.
- Animasi Clutter berjalan di frame clock yang sama dengan shell, jadi tidak ada
  tearing atau latency tambahan.

## Konsekuensi

Yang didapat:

- Integrasi penuh dengan panel, notifikasi, workspace, dan session mode.
- Performa terbaik karena tidak ada proses perantara untuk UI.
- Bisa membaca API privat yang tidak tersedia untuk aplikasi luar.

Yang dikorbankan:

- Tidak bisa memakai QML, React, atau toolkit UI modern. Semua manual dengan St.
- Terikat pada versi GNOME Shell. Update GNOME bisa mematahkan API privat.
- Bug bisa membekukan seluruh desktop, bukan hanya aplikasi.
- Tidak ada hot reload yang benar-benar nyaman. Nested shell memperlambat iterasi.
- Pengembangan di Wayland memerlukan logout/login untuk beberapa perubahan.

## Alternatif yang ditolak

### Hyprland + Quickshell

Secara teknis paling bebas: QML, animasi mulus, layer-shell, hot reload. Tapi pengguna
harus pindah compositor, kehilangan workflow GNOME (Ubuntu dock, gesture, setting,
ekstensi lain), dan mengonfigurasi ulang semuanya. Itu perubahan besar hanya untuk satu
widget. Ditolak untuk v1.

### eww / Waybar / GTK4 layer-shell

Tidak jalan di GNOME Wayland karena tidak ada `wlr-layer-shell`. Di X11 bisa dengan
trik always-on-top, tapi sesi ini Wayland. Ditolak.

### Prototipe web/Electron

Bisa membuat UI yang cantik dengan HTML/CSS, tapi tidak bisa menempel di atas panel,
tidak bisa membaca notifikasi shell, dan boros memori. Ditolak.

## Risiko utama

API privat GNOME Shell. Yang dipakai di rancangan ini:

- `Main.panel.statusArea.dateMenu`
- `Main.panel._centerBox` (kalau perlu)
- `Main.messageTray.bannerBlocked`
- `resource:///org/gnome/shell/ui/status/volume.js` (kalau memakai Gvc lewat shell)

Setiap pemakaian harus dibungkus guard dan punya fallback. Kalau API hilang, fitur
terkait dimatikan, ekstensi tetap hidup.

## Kapan keputusan ini ditinjau ulang

- Kalau GNOME 47/48 mengubah API sampai lebih dari 30% kode harus ditulis ulang.
- Kalau pengguna benar-benar pindah ke Hyprland.
- Kalau kebutuhan visual tidak bisa dicapai dengan St/Clutter setelah 2 minggu mencoba.
