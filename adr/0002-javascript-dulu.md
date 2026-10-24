# ADR 0002: JavaScript + JSDoc untuk v1, bukan TypeScript

Status: **diusulkan**, menunggu persetujuan.

Tanggal: 2026-10-24

## Konteks

GJS menjalankan JavaScript di atas SpiderMonkey di dalam proses GNOME Shell. Tidak ada
Node.js, tidak ada `package.json` yang dibaca shell, dan tidak ada loader modul yang
mengenal `node_modules`. Sejak GNOME 45, ekstensi memakai ES module dengan impor
`gi://` dan `resource:///`.

TypeScript bukan bahasa runtime. Ia harus ditranspilasi ke JavaScript sebelum shell
bisa memuatnya. Ada dua cara:

1. **ts-for-gir** menghasilkan definisi tipe untuk library GObject Introspection
   (St, Clutter, Gio, GLib, Shell). Repositori `gjsify/ts-for-gir` punya sekitar 291
   bintang dan aktif.
2. **gjsify** menyediakan toolchain lengkap (esbuild, polyfill Node, resolver) untuk
   menjalankan ekosistem JavaScript di GJS. Repositorinya sekitar 24 bintang.

Ada juga template ekstensi TypeScript, semuanya kecil: `amkige/gnome-shell-extension-ts-template`
(4 bintang), `c-jacquin/gnome-shell-extension-ts-template` (0), dan
`refined-gnome/gnome-shell-extension-ts-template` (0). Template JavaScript lebih
matang: `jmmaranan/gnome-shell-ext-template` (26 bintang) dan
`tommie-lie/gnome-shell-extensions-template` (6).

Framework UI yang relevan:

| Opsi | Apa itu | Kenapa tidak dipakai di v1 |
|---|---|---|
| Gnim (Aylur) | Pustaka UI deklaratif/JSX untuk GJS | Menambah build step dan dependensi; komunitas kecil; API privat tetap tidak bertipe |
| gjsify | Toolchain JS modern untuk GJS | Berat untuk ekstensi satu widget; polyfill tidak diperlukan |
| ts-for-gir | Generator tipe untuk GI | Berguna nanti, belum perlu untuk v1 |
| Astal/AGS | GTK layer-shell | Tidak jalan di GNOME |
| Quickshell | QML layer-shell | Butuh compositor wlroots |

## Keputusan

v1 ditulis dalam **JavaScript modern (ESM) + JSDoc + `// @ts-check`**, dengan
`jsconfig.json` untuk editor. Tidak ada build step. Tidak ada `node_modules` di folder
ekstensi.

Struktur pengecekan tipe:

```json
{
  "compilerOptions": {
    "checkJs": true,
    "allowJs": true,
    "noEmit": true,
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": false
  },
  "include": ["src/**/*.js", "extension.js", "prefs.js"]
}
```

`strict: false` disengaja. Banyak objek GNOME tidak punya tipe, dan `strict: true`
akan menghasilkan ratusan error yang tidak bisa diperbaiki tanpa definisi tipe GI.

Contoh JSDoc:

```js
/**
 * @param {{title: string, artist: string, duration: number}} track
 * @returns {string}
 */
export function formatTrack(track) {
    return `${track.title} · ${track.artist}`;
}
```

## Alasan

1. **Shell memuat JavaScript langsung.** Tidak ada langkah build yang bisa lupa
   dijalankan, tidak ada source map yang tidak didukung, tidak ada perbedaan antara
   kode yang dites dan kode yang dimuat.
2. **Debugging langsung.** `console.log`, Looking Glass, dan stack trace menunjuk ke
   berkas asli. Dengan TypeScript, stack trace menunjuk ke hasil bundle.
3. **API privat tidak bertipe.** Sebagian besar risiko proyek ini ada di API privat
   GNOME (`_centerBox`, `bannerBlocked`, `statusArea`). ts-for-gir hanya menghasilkan
   tipe untuk API publik GObject. TypeScript tidak akan menangkap kesalahan di API
   privat, jadi keuntungan utamanya berkurang.
4. **Iterasi cepat.** Fase 1-3 adalah eksperimen visual dan perilaku. Build step
   menambah 2-5 detik tiap perubahan, dan di Wayland sering harus logout/login.
5. **Sedikit dependensi.** Ekstensi yang tidak punya `node_modules` lebih mudah
   diaudit, dipasang, dan dipaketkan.
6. **Komunitas.** Contoh dan bantuan GNOME extension hampir semuanya JavaScript.
   Mencari solusi untuk masalah API privat lebih mudah kalau kodenya JavaScript.

## Konsekuensi

Yang didapat:

- Tidak ada build step, tidak ada bundler, tidak ada source map.
- Waktu iterasi paling pendek.
- Kode bisa dibaca langsung di folder ekstensi.
- Lebih mudah dibandingkan dengan kode GNOME Shell sendiri.

Yang dikorbankan:

- Tidak ada jaminan tipe saat compile. Kesalahan tipe baru ketahuan saat runtime.
- Refactor besar lebih berisiko.
- JSDoc menambah verbositas, terutama untuk objek data.
- Tidak bisa memakai fitur TypeScript seperti enum, decorator, atau generics.

Mitigasi:

- `// @ts-check` di semua berkas logika.
- Unit test untuk modul murni (arbiter, parser, formatter).
- Tipe data didokumentasikan lewat JSDoc `@typedef`.
- Guard runtime untuk API privat, bukan hanya asumsi tipe.

## Kapan pindah ke TypeScript

Migrasi layak dipertimbangkan kalau salah satu terjadi:

1. Kode melewati 5.000 baris dan refactor mulai sering.
2. Ada lebih dari satu kontributor tetap.
3. `ts-for-gir` sudah menyediakan tipe untuk versi GNOME yang dipakai.
4. Waktu debugging kesalahan tipe runtime melebihi waktu yang dihemat dari build step.

Kalau migrasi dilakukan:

- Gunakan `ts-for-gir` untuk tipe GI.
- Gunakan esbuild untuk bundle ke satu `extension.js` (shell tidak bisa resolve
  `node_modules`).
- Pertahankan folder `src/` sebagai sumber, hasil build di `dist/`.
- Jalankan build otomatis sebelum `gnome-extensions pack`.
- Uji hasil bundle di nested shell, bukan hanya `tsc --noEmit`.

## Alternatif yang ditolak

### TypeScript penuh sejak awal

Menambah build step, dependensi, dan kompleksitas pada fase yang paling eksperimental.
Keuntungan tipe belum sebanding karena API privat tidak bertipe. Ditolak untuk v1,
bukan ditolak selamanya.

### Gnim

Menarik untuk UI deklaratif, tapi menambah dependensi dan build step, serta belum jelas
apakah bisa menangani animasi ukuran dan chrome actor tanpa konflik. Bisa dievaluasi
setelah v1.

### Tidak ada pengecekan tipe sama sekali

JSDoc + `@ts-check` murah dan tidak menambah build step. Menolaknya berarti kehilangan
manfaat gratis. Ditolak.
