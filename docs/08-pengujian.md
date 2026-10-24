# 08. Pengujian

## Tingkatan

| Tingkat | Apa yang diuji | Alat | Kapan |
|---|---|---|---|
| Unit | Arbiter, state machine, formatter, parser | `gjs -m tests/*.js` | Setiap perubahan logika murni |
| Integrasi | Ekstensi dimuat, aktor muncul, signal tersambung | Nested shell | Setiap fitur selesai |
| Manual | Interaksi, visual, edge case | Sesi Wayland asli | Sebelum merge |
| Soak | Kebocoran, stabilitas | 2 jam pemakaian | Sebelum rilis |
| Regresi | Perilaku lama tidak rusak | Checklist | Sebelum rilis |

## Unit test tanpa shell

Logika murni tidak boleh bergantung pada `St` atau `Main`. Pisahkan ke modul yang hanya
memakai GLib/GObject. Contoh yang bisa diuji tanpa display:

- `arbiter.js`: prioritas, koalesensi, antrean.
- `state.js`: transisi dan timer (dengan timer palsu).
- `format.js`: durasi, byte, suhu, waktu.
- `mpris.js`: parser metadata.
- `proc.js`: parser `/proc/stat`, `/proc/meminfo`, `/proc/net/dev`.

Contoh kerangka:

```js
// tests/arbiter.test.js
import {Arbiter} from '../src/arbiter.js';

function assertEqual(actual, expected, message) {
    if (actual !== expected)
        throw new Error(`${message}: ${actual} !== ${expected}`);
}

const arbiter = new Arbiter();
arbiter.push({type: 'volume', priority: 70, ttl: 1500});
arbiter.push({type: 'notification', priority: 90, ttl: 6000});
assertEqual(arbiter.current.type, 'notification', 'highest priority wins');
assertEqual(arbiter.queue.length, 1, 'the rest is queued');
```

Jalankan:

```bash
gjs -m tests/arbiter.test.js
```

GJS tidak menyediakan modul `assert` Node. Tulis helper kecil seperti di atas, atau
pakai `GLib.test` kalau butuh runner yang lebih lengkap. Jangan menambahkan
Jest/Vitest. Itu membawa Node dan build step yang tidak diperlukan.

## Matriks kompatibilitas

| Dimensi | Nilai wajib uji | Catatan |
|---|---|---|
| GNOME Shell | 46 | Versi acuan |
| GNOME Shell | 47, 48 | Best effort, setelah v1 |
| Sesi | Wayland | Acuan |
| Sesi | X11 | Tidak dijanjikan, tapi jangan crash |
| Monitor | 1x 1920x1080 | Acuan |
| Monitor | 2 monitor, skala beda | Notch hanya di primer |
| Skala | 1x, 2x | Teks dan ikon tajam |
| Tema | Gelap, terang | Kontras cukup |
| Jam | 12h, 24h | Lebar notch menyesuaikan |
| Bahasa | Indonesia, Inggris | Tidak ada teks terpotong |
| Animasi | Aktif, nonaktif | Tidak ada transisi tertinggal |
| DND | Aktif, nonaktif | Notifikasi tidak bocor |
| Fullscreen | Video, game | Notch hilang |
| Lock screen | Terkunci, unlock | Ekstensi nonaktif saat terkunci, aktif lagi setelah unlock tanpa error atau kebocoran |
| Overview | Buka, tutup | Notch hilang saat overview |
| Dynamic workspace | Aktif, nonaktif | Jumlah workspace benar |

## Kasus uji manual

### A. Dasar

| # | Langkah | Harapan |
|---|---|---|
| A1 | Enable ekstensi | Notch muncul di tengah atas, jam GNOME hilang |
| A2 | Disable ekstensi | Jam GNOME kembali, tidak ada sisa aktor |
| A3 | Enable lalu disable 10 kali | Tidak ada error, memori stabil |
| A4 | Ganti tema gelap/terang | Notch tertutup tetap hitam, panel terbuka mengikuti tema, kontras tetap |
| A5 | Ubah skala 100% → 200% | Notch tetap di tengah, teks tidak kabur |
| A6 | Ubah format jam 24h → 12h | Jam berubah, lebar notch menyesuaikan |

### B. Buka/tutup

| # | Langkah | Harapan |
|---|---|---|
| B1 | Klik notch | Panel terbuka 420x240, animasi halus |
| B2 | Klik di luar | Panel menutup |
| B3 | Tekan Escape | Panel menutup |
| B4 | Tekan hotkey | Panel buka/tutup |
| B5 | Hover 140 ms | Peek muncul, bukan panel penuh |
| B6 | Hover lalu cepat pergi | Peek tidak muncul |
| B7 | Buka panel, diamkan 3 menit | Panel menutup sendiri |
| B8 | Buka panel, putar musik, diamkan 3 menit | Panel tetap terbuka |

### C. Media

| # | Langkah | Harapan |
|---|---|---|
| C1 | Putar lagu di Firefox | Transien media muncul 4 detik |
| C2 | Ganti lagu cepat 3 kali | Hanya satu kartu, lagu terakhir |
| C3 | Pause lagu | Transien play/pause muncul |
| C4 | Klik play/pause di notch | Player benar-benar pause/play |
| C5 | Tutup Firefox saat diputar | Kartu kosong setelah 2 detik, tidak error |
| C6 | Lagu tanpa artwork | Placeholder, bukan gambar rusak |
| C7 | Lagu berdurasi > 1 jam | Progress dan waktu benar |
| C8 | Seek di player | Progress notch ikut menyesuaikan |

### D. Notifikasi

| # | Langkah | Harapan |
|---|---|---|
| D1 | Kirim notifikasi `notify-send` | Notch muncul, banner GNOME tidak dobel |
| D2 | Notifikasi dengan aksi | Tombol aksi muncul dan berfungsi |
| D3 | 10 notifikasi cepat | Digabung, tidak membanjiri |
| D4 | Notifikasi kritis | Bertahan sampai ditanggapi, menutup setelah 60 detik, badge merah tetap |
| D5 | Aktifkan DND, kirim notifikasi | Notch tidak muncul, badge naik |
| D6 | Notifikasi saat fullscreen | Notch tidak muncul, `bannerBlocked` `false`, masuk pusat notifikasi |
| D7 | Klik "Bersihkan" | Notifikasi hilang dari pusat GNOME juga |
| D8 | Notifikasi tanpa judul | Nama aplikasi dipakai sebagai judul |
| D9 | Masuk fullscreen saat kartu notifikasi tampil | Notch hilang, `bannerBlocked` langsung `false`, banner berikutnya tidak hilang |

### E. Sistem

| # | Langkah | Harapan |
|---|---|---|
| E1 | Buka tab sistem | Angka muncul dalam < 1 detik |
| E2 | Buka tab lain | Timer sistem berhenti (cek log/perf) |
| E3 | Jalankan `stress-ng --cpu 4` | CPU naik di notch |
| E4 | Isi RAM | Angka RAM naik |
| E5 | Unduh file besar | Network naik |
| E6 | Cabut charger | Status baterai berubah |
| E7 | Sensor suhu tidak ada (mock) | Baris suhu hilang, bukan 0°C |

### F. Workspace

| # | Langkah | Harapan |
|---|---|---|
| F1 | Pindah workspace | Indikator 1,2 detik muncul |
| F2 | Buka window baru | Judul window berubah |
| F3 | Alt-tab cepat | Tidak ada spam, judul akhir benar |
| F4 | Tutup semua window | Nama workspace saja |
| F5 | Ubah jumlah workspace dinamis | Indikator `n/total` benar |

### G. Volume dan quick settings

| # | Langkah | Harapan |
|---|---|---|
| G1 | Tekan tombol volume | Slider muncul 1,5 detik |
| G2 | Tahan tombol volume | Nilai bergerak halus, tidak antre |
| G3 | Drag slider di panel | Volume berubah, tidak crackle |
| G4 | Mute | Ikon berubah, slider ke 0 |
| G5 | Toggle Wi-Fi | Status Wi-Fi benar-benar berubah |
| G6 | Toggle Bluetooth | Status Bluetooth berubah |
| G7 | Toggle dark mode | Tema berubah |
| G8 | Toggle DND | Notifikasi berhenti muncul |
| G9 | Screenshot | File tersimpan, ada notifikasi |

### H. Agen AI

| # | Langkah | Harapan |
|---|---|---|
| H1 | Bridge mati | Tab agen hilang, tidak ada error |
| H2 | Sesi OpenCode aktif | Titik biru, status `aktif` |
| H3 | Sesi selesai | Transien selesai muncul |
| H4 | Sesi error | Transien error, warna danger |
| H5 | 5 sesi bersamaan | Daftar 5, tidak berkedip |
| H6 | Bridge restart | Ekstensi menyambung ulang otomatis |

### I. Lingkungan

| # | Langkah | Harapan |
|---|---|---|
| I1 | Fullscreen video | Notch hilang |
| I2 | Keluar fullscreen | Notch kembali collapsed |
| I3 | Buka overview | Notch hilang |
| I4 | Tutup overview | Notch kembali |
| I5 | Kunci layar | Notch tidak terlihat |
| I6 | Unlock | Notch collapsed |
| I7 | Cabut monitor primer | Notch pindah ke monitor tersisa |
| I8 | Colok monitor 2 | Notch tetap di primer |
| I9 | Suspend/resume | Notch collapsed, media tersambung lagi |
| I10 | Restart shell | Ekstensi dimuat ulang tanpa error |

## Uji visual MacBook

Lakukan dengan screenshot pada skala 1 dan 2, di atas wallpaper gelap dan terang.

| # | Yang diperiksa | Harapan |
|---|---|---|
| V1 | Bentuk tertutup | Menempel di tepi atas, tanpa gap, sudut atas siku |
| V2 | Sudut bawah | Membulat 16 px, tidak terlihat seperti kapsul penuh |
| V3 | Warna tertutup | Hitam pekat, tidak ada bayangan, hairline bawah samar |
| V4 | Panel terbuka | Sudut bawah 26 px, terlihat seperti sheet dari notch |
| V5 | Material | Transluensi terasa, gradient tidak berlebihan, hairline 1 px |
| V6 | Segmented control | Indikator aktif bergeser, bukan underline |
| V7 | Switch | Track dan knob proporsional, target klik 40x24 |
| V8 | Slider | Track 4 px, knob 14 px, tidak ada knob raksasa |
| V9 | Warna | Hanya satu aksen biru, status memakai hijau/oranye/merah |
| V10 | Tipografi | Judul 13/600, body 12/400, caption 10/500 |
| V11 | Motion | Tidak ada bounce, tidak ada overshoot |
| V12 | Tema terang | Notch tertutup tetap hitam, panel terbuka terang |
| V13 | Skala 2 | Hairline tetap 1 px CSS (2 px device), tidak buram |
| V14 | Wallpaper ramai | Teks tetap terbaca, panel tidak transparan berlebihan |

Kalau salah satu gagal, jangan lanjut ke fase berikutnya. Tampilan yang "hampir benar"
akan terasa salah setiap hari.

## Uji beban

### Notifikasi berturut-turut

```bash
for i in $(seq 1 100); do
  notify-send "Tes $i" "Isi notifikasi nomor $i"
  sleep 0.1
done
```

Yang diperiksa: memori setelah 100 notifikasi, jumlah kartu di panel, waktu respons
klik, dan apakah ada notifikasi yang menggantung.

### Media berulang

Ganti lagu 50 kali dengan jeda 200 ms. Yang diperiksa: jumlah proxy MPRIS, memori,
dan apakah progress bar mengikuti lagu terakhir.

### Buka/tutup

Buka dan tutup panel 200 kali. Yang diperiksa: RSS, jumlah child aktor, dan waktu buka
pada 20 iterasi terakhir (tidak boleh melambat).

### Soak 2 jam

Biarkan desktop idle 2 jam dengan ekstensi aktif dan satu lagu diputar. Catat:

- RSS awal dan akhir.
- Jumlah wakeup.
- Error di `journalctl`.
- Apakah notch masih responsif.

## Aksesibilitas

| Uji | Cara | Harapan |
|---|---|---|
| Keyboard saja | Cabut mouse, pakai Tab/Enter/Escape | Semua fungsi bisa diakses |
| Fokus terlihat | Tab sampai tombol | Outline jelas, bukan hanya warna |
| Orca | Aktifkan pembaca layar | Nama tombol terbaca, notifikasi diumumkan sekali |
| Kontras | Ukur dengan alat | Teks >= 4.5:1 |
| Text scaling | Set 200% | Tidak ada teks terpotong |
| Reduced motion | Matikan animasi | Tidak ada transisi |
| Warna buta | Simulasi deuteranopia | Status tidak hanya dibedakan warna |

## Pemeriksaan log

Sebelum rilis:

```bash
journalctl --since "10 minutes ago" -o cat /usr/bin/gnome-shell \
  | grep -iE "smart.?notch|js error|exception|warning" \
  | grep -v "IGNORED"
```

Tidak boleh ada:

- `JS ERROR`
- `Object ... has been already disposed`
- `Attempting to connect to ... after destroy`
- `TypeError: ... is undefined`
- Peringatan CSS berulang

## Definisi selesai

Sebuah fitur dianggap selesai kalau:

1. Semua kasus uji fitur itu lulus.
2. Tidak menambah error di log.
3. Tidak menambah wakeup saat collapsed.
4. `disable()` bersih.
5. Ada dokumentasi singkat di `docs/05-fitur.md` kalau perilakunya berubah.
6. Sudah diuji di tema gelap dan terang.
7. Sudah diuji dengan animasi aktif dan nonaktif.
8. Mengikuti konvensi kode di `09-roadmap.md`: kode, komentar, log, pesan error, dan
   pesan tes dalam bahasa Inggris; teks UI lewat `_()`.

## Yang tidak diuji otomatis

- Tampilan visual dan estetika.
- Rasa animasi.
- Interaksi dengan aplikasi tertentu (Spotify, Firefox, Telegram).
- Perilaku pada hardware yang tidak tersedia.

Untuk hal-hal ini, catat hasil manual di bagian akhir PR atau di berkas catatan rilis.
Jangan mengklaim "sudah diuji" tanpa menyebut lingkungannya.
