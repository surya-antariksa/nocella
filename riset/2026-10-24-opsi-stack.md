# Riset: Opsi Stack Nocella

Tanggal: 2026-10-24
Lingkungan: Ubuntu, GNOME Shell 46.0, Wayland, HDMI-1 1920x1080

## Hasil cek lingkungan

```text
DESKTOP=ubuntu:GNOME
SESSION=wayland
WAYLAND=wayland-0
GNOME Shell 46.0
HDMI-1 connected primary 1920x1080+0+0
gjs 1.80.2
python3, node v20.19.5 tersedia
quickshell, qs, gtk4-layer-shell, waybar, eww, ags: tidak ada
wpctl ada, pactl tidak ada
MPRIS: Firefox terdeteksi
Gvc typelib: /usr/lib/gnome-shell/Gvc-1.0.typelib
```

Implikasi: semua alat berbasis `wlr-layer-shell` tidak bisa dipakai. Pilihan yang
tersisa adalah ekstensi GNOME Shell, atau pindah compositor.

## Perbandingan opsi

| Opsi | Jalan di GNOME Wayland? | Akses notifikasi/panel | Kebebasan visual | Usaha | Risiko |
|---|---|---|---|---|---|
| GNOME Shell extension (GJS/St) | Ya | Penuh, termasuk API privat | Sedang | Sedang | API privat berubah |
| Hyprland + Quickshell | Tidak di GNOME, ya di Hyprland | Tidak langsung, perlu jembatan | Tinggi | Tinggi (pindah DE) | Konfigurasi ulang total |
| Sway + Waybar | Sama seperti di atas | Terbatas | Sedang | Tinggi | Sama |
| X11 + eww | Ya di X11, tidak di Wayland GNOME | Terbatas | Tinggi | Sedang | Harus pindah sesi X11 |
| GTK4 layer-shell | Tidak | Tidak | Tinggi | Sedang | Tidak jalan di GNOME |
| Web/Electron overlay | Tidak | Tidak | Tinggi | Rendah | Tidak terintegrasi, boros |

### Kenapa layer-shell tidak jalan

GNOME Shell (Mutter) tidak mengimplementasikan protokol `wlr-layer-shell`. Protokol itu
dibuat untuk compositor berbasis wlroots. Aplikasi yang meminta layer `top` akan gagal
mendapat permukaan, atau muncul sebagai window biasa yang tidak selalu di atas.

Quickshell, eww, Waybar, dan AGS semuanya bergantung pada layer-shell untuk menempel di
atas. Di GNOME, mereka tidak bisa menjadi chrome. Beberapa bisa berjalan sebagai window
biasa, tapi itu bukan notch.

### Kenapa ekstensi GNOME menang

Ekstensi berjalan di dalam proses `gnome-shell`, sehingga bisa:

- Memasang aktor di `Main.layoutManager.uiGroup` lewat `addChrome()`.
- Membaca `Main.panel`, `Main.messageTray`, `global.display`, dan `global.workspace_manager`.
- Menggunakan frame clock yang sama dengan shell, tanpa compositor tambahan.
- Mengakses MPRIS, GSettings, dan D-Bus seperti aplikasi lain.

Harganya: St/Clutter bukan toolkit modern, dan API privat bisa berubah.

## JavaScript vs TypeScript

GJS menjalankan JavaScript langsung. TypeScript harus ditranspilasi. Di ekstensi GNOME:

- Shell memuat `extension.js` dari folder ekstensi. Tidak ada resolusi `node_modules`.
- Hasil TypeScript harus di-bundle menjadi satu atau beberapa berkas ESM yang bisa
  di-resolve shell.
- Source map tidak didukung dengan baik di stack trace shell.
- `ts-for-gir` bisa menghasilkan tipe untuk GI (St, Clutter, Gio), tapi tidak untuk API
  privat seperti `Main.panel.statusArea.dateMenu` atau `Main.messageTray.bannerBlocked`.
- Type checking tetap berguna, tapi tidak menangkap risiko utama proyek ini.

Keputusan: JavaScript + JSDoc + `@ts-check`. TypeScript ditunda sampai kode membesar
atau ada kontributor lain. Detail di `adr/0002-javascript-dulu.md`.

## Framework dan template

| Nama | Bintang (2026-10-24) | Fungsi | Catatan |
|---|---:|---|---|
| `gjsify/ts-for-gir` | 291 | Generator tipe TypeScript untuk GI | Berguna kalau migrasi ke TS |
| `gjsify/gjsify` | 24 | Toolchain JS modern untuk GJS | Berat untuk satu widget |
| `jmmaranan/gnome-shell-ext-template` | 26 | Template ekstensi JS | Paling matang dari yang ditemukan |
| `tommie-lie/gnome-shell-extensions-template` | 6 | Template ekstensi JS | Sederhana |
| `amkige/gnome-shell-extension-ts-template` | 4 | Template TS + bundling | Kecil, belum teruji |
| `Aylur/gnome-shell-extension-template` | 2 | Template memakai Gnim | Eksperimental |
| `Aylur/gnim` | kecil | UI deklaratif untuk GJS | Menarik, tapi menambah dependensi |

Tidak ada framework resmi GNOME. Ekstensi resmi GNOME memakai GJS polos dengan St.
Mengikuti pola itu mengurangi kejutan.

## Catatan tentang versi

- `shell-version` di `metadata.json` sebaiknya hanya `46` sampai versi lain diuji.
- GNOME 45+ memakai ESM. `imports.*` sudah dihapus.
- GNOME 46 punya `St.Settings:color-scheme`, tapi belum punya `accent-color` GSettings.
- `Main.messageTray.bannerBlocked` ada di 46. Belum diverifikasi di 47/48.
- `Gvc` ada di `/usr/lib/gnome-shell/`, bukan di path GI umum. `libgvc.so` hanya bisa
  di-resolve di dalam proses shell; `gjs` standalone gagal mengimpornya.

## Sumber yang dicek

- Dokumentasi GNOME Shell extension: <https://gjs.guide/extensions/>
- GNOME Shell 46 source (diekstrak dari `libshell-14.so`):
  `js/ui/messageTray.js`, `js/ui/panel.js`, `js/ui/layout.js`,
  `js/ui/status/volume.js`
- Quickshell: <https://quickshell.org/>
- wlr-layer-shell protocol: <https://wayland.app/protocols/wlr-layer-shell-unstable-v1>
- ts-for-gir: <https://github.com/gjsify/ts-for-gir>
- gjsify: <https://github.com/gjsify/gjsify>
- Template ekstensi: repo yang disebut di tabel

## Kesimpulan

Untuk mesin ini, GNOME Shell extension adalah satu-satunya pilihan yang memenuhi
kebutuhan tanpa mengubah desktop. JavaScript + JSDoc adalah titik awal yang paling
murah. TypeScript dan framework UI bisa dievaluasi setelah v1 stabil.

Kalau tujuan berubah menjadi "punya desktop Hyprland dengan notch QML", seluruh
rancangan ini tidak berlaku dan harus dimulai dari asumsi yang berbeda.
