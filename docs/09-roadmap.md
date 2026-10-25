# 09. Roadmap

Rancangan ini sengaja dipecah menjadi fase kecil dengan gate. Setiap gate punya kriteria
lulus yang jelas. Kalau gate tidak lulus, jangan lanjut ke fase berikutnya.

## Ringkasan

| Fase | Hasil | Hari | Gate |
|---|---|---:|---|
| 0 | Dokumen rancangan disetujui | 0 | G0 |
| 1 | Kerangka ekstensi, notch, jam, material, animasi | 5 | G1 |
| 2 | State machine, arbiter, media | 5 | G2 |
| 3 | Notifikasi | 4 | G3 |
| 4 | System monitor, workspace | 5 | G4 |
| 5 | Volume, quick settings | 5 | G5 |
| 6 | Bridge agen dan UI | 6 | G6 |
| 7 | Poles visual macOS, aksesibilitas, rilis | 5 | G7 |
| **Total** | | **35** | |

Estimasi 35 hari berlaku untuk orang yang sudah familiar dengan GJS. Kalau belum, tambah
50-100% (sekitar 50-70 hari), sesuai catatan di `05-fitur.md`.

## Konvensi kode

Berlaku sejak berkas kode pertama di fase 1, untuk ekstensi, bridge agen, tes, dan skrip.

- Semua kode ditulis dalam bahasa Inggris: nama berkas, identifier (variabel, fungsi,
  kelas, konstanta), komentar, JSDoc, pesan log, pesan error, serta nama dan pesan tes.
- Kunci, `summary`, dan `description` di GSettings schema dalam bahasa Inggris.
- `name` dan `description` di `metadata.json` dalam bahasa Inggris.
- Nama tipe event, status, dan antarmuka D-Bus (`media-changed`, `working`,
  `id.antariksa.Nocella.Agent1`) dalam bahasa Inggris dan tidak diterjemahkan.
- Teks yang tampil ke pengguna selalu lewat gettext (`_()`, `ngettext()`) dengan msgid
  bahasa Inggris. Terjemahan Indonesia ada di `po/id.po`. Tidak ada string UI mentah
  di kode.
- Teks UI berbahasa Indonesia di dokumen desain (misalnya "Tidak ada media diputar")
  adalah acuan untuk `po/id.po`, bukan string sumber di kode.
- Dokumen di `docs/`, `adr/`, dan `riset/` tetap berbahasa Indonesia.
- Setiap gate memeriksa diff fasenya terhadap aturan ini. G7 menjalankan audit penuh.

## Fase 0: Rancangan

**Status: selesai.** G0 disetujui 2026-10-24.

Keluaran:

- Folder `nocella/` dengan dokumen ini.
- Keputusan stack, bahasa, posisi, notifikasi, dan material tercatat di `adr/`.
- Daftar fitur dan non-goals disepakati.

Gate G0:

- [x] Setuju memakai GNOME Shell extension, bukan pindah ke Hyprland/Quickshell.
- [x] Setuju JavaScript + JSDoc untuk v1.
- [x] Setuju notch mengambil alih area jam.
- [x] Setuju bentuk notch menempel di tepi atas (`y=0`), sudut atas siku, sudut bawah membulat.
- [x] Setuju faux vibrancy tanpa blur asli di v1, dengan aksen biru macOS `#0A84FF`.
- [x] Setuju palet warna dan material di `03-desain-visual.md` (lihat `palet-warna.svg`).
- [x] Setuju notifikasi diambil alih (`bannerBlocked`), dengan fallback cermin.
- [x] Setuju ruang lingkup v1: satu monitor, tanpa blur, tanpa kalender acara.
- [x] Setuju konvensi kode: semua kode dalam bahasa Inggris, teks UI lewat gettext.

Kalau salah satu belum disetujui, jangan mulai fase 1.

## Fase 1: Kerangka

**Hari 1-5. Status: selesai.** G1 lulus 2026-10-25 lewat smoke test skala 1 dan 2.

Pekerjaan:

1. `metadata.json`, `extension.js`, `stylesheet.css`.
2. Aktor `St.Widget` dengan `addChrome`, posisi tengah, ukuran notch 196x32, `y=0`.
3. Sembunyikan jam GNOME, tampilkan jam sendiri.
4. Token visual dari `03-desain-visual.md`: hitam notch, hairline, radius `0 0 16px 16px`,
   font stack, dan satu aksen biru. Tulis sebagai konstanta JS, bukan variabel CSS.
5. Animasi buka 300 ms `EASE_OUT_QUINT` dan tutup 220 ms `EASE_IN_QUART`, dengan tombol debug.
6. `disable()` yang benar-benar bersih.
7. Skrip pasang dan nested shell.
8. Kerangka gettext (`gettext-domain`, folder `po/`, impor `_()`) dan `jsconfig.json`.

Keluaran: notch bisa diklik, membuka kotak kosong dengan material yang benar, menutup,
dan jam kembali saat disable.

Gate G1:

- [x] Notch muncul di tengah pada skala 1 dan 2, tanpa gap di tepi atas (smoke test).
- [x] Sudut atas siku, sudut bawah membulat, tidak terlihat seperti kapsul (screenshot).
- [x] Buka/tutup 20 kali tanpa error (smoke test; klik asli diuji terpisah lewat pointer
      virtual).
- [x] Disable mengembalikan jam GNOME (smoke test, 20 siklus).
- [x] Tidak ada timer atau signal yang tersisa setelah disable (smoke test dengan
      instrumentasi `connect`, `bind_property`, dan timer JS, disable saat panel terbuka;
      kontrol negatif membuktikan signal, timer, dan detak jam yang bocor tertangkap).
- [x] Waktu buka < 100 ms sampai perubahan pertama terlihat (dari handler klik asli sampai
      frame pertama dengan ukuran notch yang berubah, tanpa latensi input: median 9,1 ms
      dan maks 14,0 ms di skala 1, median 20,9 ms dan maks 25,3 ms di skala 2, headless).
- [x] Screenshot skala 1 dan 2 dibandingkan dengan `03-desain-visual.md` (piksel di atas
      panel acuan `#131313`: badan `#000000`, sudut atas siku, sudut bawah membulat,
      hairline 6% setebal 1 px CSS, material panel terbuka sesuai token).
- [x] Kode fase 1 mengikuti konvensi kode: bahasa Inggris, string UI lewat `_()`.

Risiko utama: `Main.panel.height` belum tersedia saat enable. Fallback ke 32.

## Fase 2: State machine, arbiter, media

**Hari 6-10.**

Pekerjaan:

1. `state.js` dengan state COLLAPSED, PEEK, TRANSIENT, PINNED, SUPPRESSED.
2. `arbiter.js` dengan prioritas, TTL, koalesensi, antrean.
3. Provider MPRIS: daftar player, metadata, kontrol, progress.
4. View media untuk peek, transien, dan pinned.
5. Hover dan klik sesuai `04-interaksi.md`.
6. Event debug untuk memicu transien tanpa media asli.

Keluaran: lagu berganti memunculkan kartu media, klik membuka panel media.

Gate G2:

- [ ] Ganti lagu 50 kali, memori stabil.
- [ ] Hanya satu kartu meskipun event beruntun.
- [ ] Progress benar untuk lagu > 1 jam.
- [ ] Player hilang tidak membuat error.
- [ ] Collapsed tidak punya timer progress.
- [ ] Semua unit test arbiter lulus.

## Fase 3: Notifikasi

**Hari 11-14.**

Pekerjaan:

1. Provider notifikasi: `Main.messageTray`, `source-added`, `queue-changed`.
2. Ambil alih banner dengan `bannerBlocked`, fallback cermin.
3. Kartu notifikasi dengan ikon, judul, isi, aksi.
4. Badge dan daftar di panel pinned.
5. Integrasi DND.
6. Uji 100 notifikasi berturut-turut.

Keluaran: notifikasi muncul di notch, banner GNOME tidak dobel.

Gate G3:

- [ ] `notify-send` muncul di notch.
- [ ] Banner GNOME tidak muncul saat notch aktif.
- [ ] Aksi notifikasi berfungsi.
- [ ] Saat DND, notifikasi tidak memunculkan transien di notch, hanya menaikkan badge.
- [ ] Masuk fullscreen mengembalikan `bannerBlocked` ke `false` (uji D9).
- [ ] 100 notifikasi tidak membuat memori naik > 10 MB.
- [ ] Fallback cermin bekerja kalau `bannerBlocked` dihapus (simulasi mock).

Risiko utama: API `bannerBlocked` bisa berubah di GNOME 47. Fallback harus benar-benar
diuji, bukan hanya ditulis.

## Fase 4: System monitor dan workspace

**Hari 15-19.**

Pekerjaan:

1. Parser `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`.
2. Suhu, baterai, disk.
3. Ring buffer dan sparkline `St.DrawingArea`.
4. Timer 1 detik hanya saat tab terlihat.
5. Provider workspace dan window.
6. Indikator workspace transien.

Keluaran: tab sistem dan tab workspace berfungsi.

Gate G4:

- [ ] CPU/RAM/network akurat dibanding `htop`/`btop` dalam toleransi 5%.
- [ ] Timer berhenti saat tab ditutup (diverifikasi lewat log).
- [ ] Tidak ada pembacaan `/proc` saat collapsed.
- [ ] Sparkline tidak menyebabkan frame drop.
- [ ] Dynamic workspace benar.

## Fase 5: Volume dan quick settings

**Hari 20-24.**

Pekerjaan:

1. Integrasi Gvc, fallback `wpctl`.
2. Slider volume, mute, output device.
3. Toggle Wi-Fi, Bluetooth, dark mode, night light, DND.
4. Brightness dan power mode kalau tersedia.
5. Screenshot dan lock screen.
6. Penanganan kegagalan toggle.

Keluaran: bagian quick settings di tab Sistem berfungsi, slider volume muncul saat tombol
volume ditekan.

Gate G5:

- [ ] Slider mengikuti volume sistem, dua arah.
- [ ] Drag tidak menghasilkan puluhan panggilan `wpctl`.
- [ ] Toggle Wi-Fi/Bluetooth benar-benar mengubah state.
- [ ] Toggle yang gagal kembali ke posisi semula.
- [ ] Gvc tidak tersedia → fallback jalan.
- [ ] Tidak ada polling volume saat collapsed.

## Fase 6: Agen AI

**Hari 25-30.**

Pekerjaan:

1. Bridge Python dengan D-Bus service.
2. Pembacaan `opencode.db` read-only atau API lokal.
3. Skema status: working, waiting-permission, idle, done, error.
4. Provider D-Bus di ekstensi.
5. View daftar sesi dan transien selesai/error.
6. Uji bridge mati, restart, skema berubah.

Keluaran: status sesi OpenCode terlihat di notch.

Gate G6:

- [ ] Bridge mati → tab hilang, tidak ada error.
- [ ] Sesi selesai → transien muncul < 2 detik.
- [ ] Tidak ada isi prompt yang bocor ke UI atau log.
- [ ] Bridge restart → ekstensi menyambung ulang.
- [ ] Database terkunci → bridge menunggu, bukan crash.
- [ ] 20 sesi → UI tetap responsif.

Risiko utama: skema `opencode.db` berubah. Bridge harus mencatat versi dan gagal dengan
pesan jelas, bukan menebak kolom.

## Fase 7: Poles dan rilis

**Hari 31-35.**

Pekerjaan:

1. Preferensi lengkap.
2. Aksesibilitas: nama tombol, fokus, Orca.
3. Tema terang: notch tertutup tetap hitam, panel terbuka mengikuti tema.
4. Text scaling, reduced motion, dan fallback tanpa animasi.
5. Poles visual: switch, slider, dan segmented control versi Cairo; audit radius,
   hairline, dan tipografi terhadap `03-desain-visual.md`.
6. Uji soak 2 jam.
7. Packing dan dokumentasi instalasi.
8. Catatan rilis dan known issues.
9. Terjemahan `po/id.po` dari teks UI di dokumen desain.

Keluaran: zip ekstensi yang bisa dipasang, dokumentasi, dan daftar batasan.

Gate G7:

- [ ] Semua checklist di `08-pengujian.md` lulus, termasuk uji visual V1-V14.
- [ ] Tidak ada error di log setelah 2 jam.
- [ ] RSS stabil.
- [ ] Zip terpasang di sesi bersih.
- [ ] README menjelaskan cara pasang, cara hapus, dan known issues.
- [ ] Notch terlihat konsisten di tema gelap dan terang.
- [ ] Audit bahasa: tidak ada identifier, komentar, log, atau pesan tes berbahasa
      Indonesia; semua string UI lewat `_()` dan `po/id.po` lengkap.

## Setelah v1

Ide yang sengaja ditunda, urut dari yang paling mungkin:

1. **Dukungan GNOME 47/48.** Periksa `bannerBlocked`, `St.Settings`, dan `statusArea`.
2. **Multi-monitor.** Notch di tiap layar atau hanya layar yang dipilih.
3. **Blur latar.** Hanya kalau biaya render terbukti rendah.
4. **Kalender acara.** Lewat Evolution Data Server, bukan scraper.
5. **Pemilih player MPRIS.** Dropdown kalau ada lebih dari satu player.
6. **Gestur.** Swipe ke bawah untuk membuka, swipe ke atas untuk menutup.
7. **Tema kustom.** Ukuran, warna, dan posisi.
8. **Dukungan agen lain.** Claude Code, Gemini CLI, lewat bridge yang sama.
9. **Cuaca dan saham.** Butuh jaringan, jadi butuh desain cache dan privasi.
10. **Pengganti OSD volume/brightness.** Kalau notch sudah stabil, OSD GNOME bisa
    dimatikan agar tidak dobel.

## Risiko

| Risiko | Dampak | Kemungkinan | Mitigasi |
|---|---|---|---|
| API privat berubah di GNOME 47 | Fitur mati | Tinggi | Guard + fallback + uji versi baru |
| `bannerBlocked` dihapus | Notifikasi dobel | Sedang | Mode cermin otomatis |
| Gvc tidak tersedia | Volume mati | Rendah | Fallback `wpctl` |
| MPRIS tidak konsisten | Metadata salah | Sedang | Parser defensif, uji beberapa player |
| Skema `opencode.db` berubah | Agen mati | Sedang | Bridge terpisah, versi skema |
| Animasi berat di GPU lemah | Desktop lag | Sedang | Ukur, sediakan mode tanpa animasi |
| Konflik dengan ekstensi lain | Notch tidak muncul | Rendah | Deteksi `addChrome` lain, log |
| Ubuntu update GNOME | Semua berubah | Tinggi | Pin `shell-version`, uji tiap rilis |
| Ekstensi memblokir shell | Desktop beku | Rendah | Nested shell, try/catch, disable bersih |
| Faux vibrancy terlihat kotor di wallpaper ramai | Kesan murahan | Sedang | Naikkan opasitas, uji V14, blur asli ditunda |
| Notifikasi sensitif tampil | Privasi | Sedang | Hormati lock screen dan DND |

## Prinsip saat macet

Kalau suatu fitur memakan waktu lebih dari 2 hari tanpa kemajuan, jangan paksa. Tulis
apa yang sudah dicoba, matikan fitur di balik setting, dan lanjut ke fase berikutnya.
Notch yang stabil dengan 5 fitur lebih berharga daripada notch yang penuh tapi membekukan
desktop.
