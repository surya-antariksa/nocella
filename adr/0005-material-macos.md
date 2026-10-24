# ADR 0005: Bahasa visual MacBook dan faux vibrancy

Status: **diusulkan**, menunggu persetujuan.

Tanggal: 2026-10-24

## Konteks

Nocella harus terasa seperti bagian dari macOS: modern, minimalis, tenang, dan rapi.
Referensi utamanya adalah notch MacBook, menu bar macOS, Control Center, dan Dynamic
Island dari iPhone. Ketiganya punya bahasa yang berbeda:

- Notch MacBook: menempel di tepi atas, hitam pekat, lebar, dangkal, tanpa border.
- Menu bar macOS: tipografi kecil, hairline, material gelap transparan.
- Control Center: kartu membulat, segmented control, switch kapsul, slider tipis.
- Dynamic Island: pill melayang, animasi membesar, konten dinamis.

Kalau semuanya dicampur tanpa keputusan, hasilnya bisa terlihat seperti tema macOS
palsu: terlalu banyak blur, terlalu banyak gradient, dan bentuk yang tidak konsisten.

## Keputusan

1. **Bentuk mengikuti MacBook, perilaku mengikuti Dynamic Island.** Notch menempel di
   tepi atas (`y=0`), sudut atas siku, sudut bawah membulat. Saat terbuka, ia tumbuh ke
   bawah seperti sheet, bukan menjadi pill melayang.
2. **Material memakai faux vibrancy.** Tidak ada `backdrop-filter` di v1. Efek kaca
   dibuat dari translusensi 82%, gradient vertikal tipis, hairline, dan bayangan lembut.
3. **Satu aksen biru macOS** `#0A84FF`, dengan hijau/oranye/merah hanya untuk status.
4. **Tipografi mengikuti font sistem**, dengan Inter sebagai pengganti opsional. Tidak
   mendistribusikan SF Pro.
5. **Kontrol memakai bahasa macOS**: segmented control, switch kapsul, slider tipis,
   tombol ikon bulat.
6. **Motion pendek tanpa bounce.** Buka 300 ms, tutup 220 ms, easing quint/quart.
7. **Notch tertutup tetap hitam di tema terang**, seperti bezel hardware. Panel terbuka
   mengikuti tema.

## Alasan

- Bentuk yang menempel menghindari kesan "widget melayang" dan membuat Nocella terasa
  menyatu dengan panel GNOME.
- Faux vibrancy cukup untuk wallpaper gelap dan jauh lebih murah daripada blur asli.
  St tidak punya backdrop blur, dan `Shell.BlurEffect` memblur isi aktor, bukan latar.
- Satu aksen dan banyak ruang kosong adalah inti dari minimalisme macOS. Menambah warna
  akan merusaknya.
- Segmented control lebih dekat ke macOS daripada tab bergaris bawah.
- Motion tanpa bounce membedakan Nocella dari Dynamic Island dan membuatnya terasa
  dewasa.

## Konsekuensi

Yang didapat:

- Tampilan konsisten dan mudah dikenali.
- Biaya render rendah karena tidak ada blur.
- Banyak keputusan visual sudah ditentukan, jadi implementasi lebih cepat.

Yang dikorbankan:

- Tidak ada blur asli. Di atas wallpaper yang sangat ramai, panel bisa terasa sedikit
  kurang "kaca".
- Notch hitam di tema terang bisa terlihat kontras. Itu disengaja, tapi belum tentu
  disukai semua orang.
- Font SF Pro tidak bisa dipakai. Inter atau Ubuntu Sans hanya mendekati.
- Switch dan slider perlu digambar sendiri dengan Cairo, bukan widget siap pakai.
- Notch yang menempel tidak bisa dipindah ke bawah panel tanpa mengubah bentuk.

## Alternatif yang ditolak

### Pill melayang ala Dynamic Island

Lebih mudah dianimasikan dan lebih "modern" dalam arti iPhone. Tapi tidak cocok dengan
MacBook dan membuat panel GNOME terlihat seperti dua lapisan terpisah. Ditolak.

### Blur asli dengan Shell.BlurEffect

Bisa dicoba, tapi memblur isi aktor, bukan latar. Untuk mendapatkan backdrop blur,
perlu clone background dan biaya render besar. Belum sepadan untuk v1. Ditunda.

### Tema macOS penuh

Meniru dock, traffic light, menu bar, dan ikon macOS akan terasa seperti skin, bukan
desain. Nocella hanya mengambil notch dan bahasa materialnya. Ditolak.

### Memakai GTK4/Adw untuk panel

Tidak bisa menempel di panel GNOME dan menambah proses terpisah. Ditolak.

## Kapan ditinjau ulang

- Kalau pengguna ingin notch bisa dipindah ke bawah panel.
- Kalau blur asli bisa dibuat murah dan stabil.
- Kalau Inter terbukti tidak tersedia dan tampilan terlalu berbeda dari referensi.
- Kalau GNOME 47+ menyediakan API material yang lebih baik.
