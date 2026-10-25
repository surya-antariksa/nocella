# 06. Implementasi di GNOME Shell 46

Dokumen ini bukan kode final. Isinya kerangka yang sudah diverifikasi terhadap GNOME
Shell 46 di mesin ini, plus jebakan yang harus dihindari.

## Fakta lingkungan yang sudah dicek

| Hal | Hasil |
|---|---|
| GNOME Shell | 46.0 |
| Sesi | Wayland (`ubuntu-wayland`) |
| Modul ES | Didukung sejak GNOME 45, `import` dari `gi://` dan `resource:///` |
| `St`, `Clutter`, `Shell`, `Gvc` | Tersedia di `/usr/lib/gnome-shell/` |
| `Main.layoutManager.addChrome` | Ada, dengan opsi `trackFullscreen` |
| `Main.messageTray.bannerBlocked` | Ada (setter) |
| `Main.panel.statusArea.dateMenu` | Ada, dipakai untuk menyembunyikan jam |
| `St.Settings:color-scheme` | Ada |
| `accent-color` GSettings | Tidak ada (baru di GNOME 47) |
| MPRIS | Firefox terdeteksi lewat D-Bus |
| Audio | PipeWire, `wpctl` ada, `pactl` tidak ada |
| Gvc typelib | `/usr/lib/gnome-shell/Gvc-1.0.typelib` (butuh `libgvc.so` yang hanya ada di path shell) |

## metadata.json

```json
{
  "uuid": "nocella@antariksa",
  "name": "Nocella",
  "description": "MacBook-style notch with Dynamic Island behavior for GNOME Shell",
  "shell-version": ["46"],
  "settings-schema": "org.gnome.shell.extensions.nocella",
  "gettext-domain": "nocella",
  "version": 1
}
```

`uuid` harus sama dengan nama folder di `~/.local/share/gnome-shell/extensions/`.
`shell-version` sengaja hanya `46` sampai versi lain diuji.
`session-modes` sengaja tidak diisi. GNOME memanggil `disable()` saat layar dikunci dan
`enable()` setelah unlock, sehingga notch dan `bannerBlocked` tidak pernah aktif di
lock screen. `name` dan `description` ditulis dalam bahasa Inggris.

## extension.js

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Nocella} from './src/nocella.js';

export default class NocellaExtension extends Extension {
    enable() {
        this._nocella = new Nocella();
        try {
            this._nocella.enable();
        } catch (e) {
            // Never leave a half-built notch behind, or a hidden GNOME clock.
            this._nocella.disable();
            this._nocella = null;
            throw e;
        }
    }

    disable() {
        this._nocella?.disable();
        this._nocella = null;
    }
}
```

Tidak ada `init()`. Sejak GNOME 45, `enable()` dan `disable()` adalah satu-satunya
siklus hidup yang perlu. Kalau `enable()` gagal di tengah jalan, `disable()` langsung
dipanggil, jadi tidak ada aktor setengah jadi atau jam GNOME yang tertinggal
tersembunyi. `getSettings()` baru dipakai saat ada fitur yang membaca preferensi.

## Aktor utama

Implementasinya ada di `extension/src/ui/surface.js` (aktor, ukuran, material) dan
`extension/src/nocella.js` (chrome, jam, relayout, visibilitas). Pokoknya:

- Aktor akar adalah `St.BoxLayout` vertikal bernama `nocella`: header setinggi notch
  tertutup berisi jam, lalu body untuk view pinned. Header tetap di atas saat panel
  membesar, jadi jam tidak bergeser.
- Dipasang dengan `Main.layoutManager.addChrome(actor, {affectsInputRegion: true,
  affectsStruts: false, trackFullscreen: false})`.
- Ukuran di `src/tokens.js` adalah piksel logis skala 1. Ukuran yang diatur lewat JS
  dikalikan `St.ThemeContext.get_for_stage(global.stage).scale_factor`; St hanya
  menskalakan ukuran di CSS. Tinggi notch tertutup mengikuti `Main.panel.height` (sudah
  piksel device), dengan fallback 32 px logis.
- Buka dan tutup memakai `actor.ease()` pada `x`, `width`, dan `height` sekaligus.
  Karena `x` ikut di-ease, pusat notch diam selama animasi. Memusatkan ulang di
  `onComplete` membuat panel tumbuh ke kanan lalu melompat.
- `ease()` milik GNOME Shell sudah menghormati `enable-animations` (durasi menjadi 0),
  jadi tidak perlu cek manual.
- Relayout langsung (durasi 0) saat `monitors-changed`, `notify::height` pada panel,
  `notify::scale-factor`, dan perubahan `clock-format`.
- Jangan memasang `clip_to_allocation` pada aktor akar; bayangan luar panel ikut
  terpotong.
- `addChrome` menempatkan aktor di bawah `global.top_window_group`, jadi popup shell
  tetap di atas notch. Ini yang diinginkan. Jangan pakai `addTopChrome` kecuali notch
  perlu menutupi popup.
- `width` dan `height` di animasi memicu layout tiap frame. Untuk satu aktor ini masih
  wajar. Kalau nanti terasa berat, pertimbangkan animasi `scale` dengan kompensasi ukuran.

## Mengambil alih area jam

Implementasinya di `extension/src/clock-takeover.js`. Ia menyembunyikan tombol
`dateMenu`, bukan kontainernya, karena panel memanggil `container.show()` setiap kali
menyusun ulang isinya. Ia juga hanya memulihkan jam yang ia sembunyikan sendiri.
Bentuk ringkasnya:

```js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

enableClockTakeover() {
    this._dateMenu = Main.panel.statusArea.dateMenu;
    if (!this._dateMenu)
        return;

    this._clockWasVisible = this._dateMenu.visible;
    this._dateMenu.hide();
}

restoreClock() {
    if (this._dateMenu && this._clockWasVisible)
        this._dateMenu.show();
    this._dateMenu = null;
}
```

Ini memakai API privat (`statusArea`, `dateMenu`). Kalau `statusArea.dateMenu` tidak ada,
notch tetap jalan tapi jam GNOME tidak disembunyikan, sehingga terjadi tumpang tindih.
Deteksi dan catat di log.

Alternatif yang lebih sopan: pindahkan jam ke kiri dengan mengubah `_centerBox`, tapi itu
lebih invasif dan merusak menu kalender. Menyembunyikan lalu menggantinya di notch lebih
mudah dikembalikan.

## Visibilitas: fullscreen, overview, lock screen

State machine adalah satu-satunya pemilik visibilitas. `trackFullscreen` tidak dipakai,
karena ia menyembunyikan aktor tanpa memberi tahu state machine, sehingga
`bannerBlocked` bisa tertinggal `true` saat fullscreen. Di fase 1, `Nocella`
(`src/nocella.js`) yang memegang himpunan alasan ini; state machine mengambil alih di
fase 2. `monitors-changed` juga menyinkronkan ulang status fullscreen, karena monitor
utama baru belum tentu memicu `in-fullscreen-changed`.

```js
this._signals.add(global.display, global.display.connect('in-fullscreen-changed', () => {
    if (Main.layoutManager.primaryMonitor?.inFullscreen)
        this._state.suppress('fullscreen');
    else
        this._state.release('fullscreen');
}));
this._signals.add(Main.overview,
    Main.overview.connect('showing', () => this._state.suppress('overview')));
this._signals.add(Main.overview,
    Main.overview.connect('hidden', () => this._state.release('overview')));
```

`suppress(reason)` menambah alasan ke sebuah `Set`, menyembunyikan aktor, dan langsung
mengembalikan `bannerBlocked` ke `false`. `release(reason)` menghapus alasan; kalau
`Set` sudah kosong, aktor tampil lagi di state COLLAPSED, bukan state sebelumnya.
Fullscreen dan overview bisa terjadi bersamaan, karena itu alasan disimpan sebagai
himpunan, bukan boolean.

Layar terkunci tidak perlu handler. Karena `metadata.json` tidak memuat `session-modes`,
GNOME memanggil `disable()` saat mengunci dan `enable()` setelah unlock.

Di GNOME 46, overview tetap menampilkan chrome actor kalau tidak disembunyikan manual,
jadi sinyal overview wajib.

## Sinyal dan pembersihan

Semua `connect()` harus lewat helper yang menyimpan ID:

```js
export class SignalGroup {
    constructor() {
        this._items = [];
    }

    add(object, id) {
        this._items.push([object, id]);
        return id;
    }

    clear() {
        for (const [object, id] of this._items) {
            try {
                object.disconnect(id);
            } catch {
                // Object already disposed; nothing left to do.
            }
        }
        this._items = [];
    }
}
```

Timer juga:

```js
import GLib from 'gi://GLib';

export class TimerGroup {
    constructor() {
        this._ids = new Set();
    }

    every(seconds, callback) {
        const id = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            callback();
            return GLib.SOURCE_CONTINUE;
        });
        this._ids.add(id);
        return id;
    }

    clear() {
        for (const id of this._ids)
            GLib.source_remove(id);
        this._ids.clear();
    }
}
```

Aturan: `disable()` harus bisa dipanggil dua kali tanpa error. Setelah `disable()`,
tidak boleh ada timer atau signal yang masih memanggil kode notch.

## CSS

```css
.nocella {
    background-color: #000000;
    box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.06);
    border-radius: 0 0 16px 16px;
    padding: 0 16px;
    color: #F5F5F7;
    font-family: "SF Pro Text", "SF Pro Display", "Inter",
                 "Ubuntu Sans", "Cantarell", sans-serif;
}

.nocella.peek {
    background-gradient-direction: vertical;
    /* rgba(18, 18, 20, 0.96) with 4% white composited on top */
    background-gradient-start: rgba(28, 28, 30, 0.96);
    background-gradient-end: rgba(18, 18, 20, 0.96);
    border-radius: 0 0 20px 20px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    padding: 0 12px;
}

.nocella.expanded {
    background-gradient-direction: vertical;
    /* rgba(24, 24, 26, 0.82) with 6% white composited on top */
    background-gradient-start: rgba(41, 41, 43, 0.83);
    background-gradient-end: rgba(24, 24, 26, 0.82);
    border-radius: 0 0 26px 26px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55);
}

.nocella .card {
    background-color: rgba(255, 255, 255, 0.05);
    border-radius: 16px;
    padding: 12px;
}

.nocella .card:hover {
    background-color: rgba(255, 255, 255, 0.08);
}

.nocella .hairline {
    background-color: rgba(255, 255, 255, 0.10);
    height: 1px;
}
```

St CSS bukan CSS browser. Yang didukung: `background-color`, `background-gradient-*`,
`border`, `border-radius` (termasuk empat nilai), `box-shadow` (satu bayangan, luar atau `inset`),
`padding`, `margin`, `spacing`, `color`, `font-family`, `font-size`, `font-weight`,
`font-feature-settings`, `letter-spacing`, `text-align`, dan properti `-st-` tertentu.
Tidak ada `display: flex`, tidak ada `calc()`, tidak ada `backdrop-filter`, tidak ada
variabel CSS.

St tidak mendukung border per sisi seperti `border-bottom`. Untuk hairline 1 px di tepi
bawah, pakai `box-shadow: inset 0 -1px 0 <warna>`.

Dua perilaku St yang terbukti di fase 1 dan mudah terlewat:

- `background-gradient-start/end` menggantikan `background-color`. Stop gradient harus
  membawa warna permukaan, bukan putih transparan yang ditumpuk di atasnya.
- Satu aktor hanya punya satu `box-shadow`. Daftar yang mencampur bayangan luar dan
  `inset` tidak digambar sama sekali. Hairline di panel yang punya bayangan besar butuh
  aktor terpisah.

Karena tidak ada variabel, tema terang dibuat dengan style class terpisah. Notch
tertutup tetap hitam; hanya panel terbuka yang berubah:

```css
.nocella.expanded.light {
    /* The gradient replaces background-color, so override both stops. */
    background-gradient-start: rgba(251, 251, 253, 0.85);
    background-gradient-end: rgba(250, 250, 252, 0.84);
    color: #1D1D1F;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
}

.nocella.expanded.light .card {
    background-color: rgba(0, 0, 0, 0.04);
}

.nocella.expanded.light .card:hover {
    background-color: rgba(0, 0, 0, 0.07);
}
```

Faux vibrancy: tidak ada blur asli. Lapisan yang dipakai hanya gradient
vertikal translusen, hairline, dan bayangan. Ini cukup untuk wallpaper
gelap dan jauh lebih murah daripada `Shell.BlurEffect`. Detail di
`adr/0005-material-macos.md`.

Deteksi tema:

```js
const settings = St.Settings.get();
this._colorSchemeId = settings.connect('notify::color-scheme', () => this._updateTheme());
```

`St.Settings:color-scheme` ada di GNOME 46. Jangan membaca `gtk-theme` dan menebak.

## Komponen yang digambar sendiri

St tidak punya switch, slider, atau segmented control bawaan yang terlihat seperti
macOS. Tiga komponen ini digambar dengan `St.DrawingArea` dan Cairo:

- **Switch**: track 40x24, radius 12, knob 20. Gambar track dan knob, lalu animasikan
  posisi knob dengan `Clutter.PropertyTransition` 180 ms.
- **Slider**: track 4 px, fill, dan knob 14 px. Tangani drag dengan
  `Clutter.PanGesture` yang dipasang hanya di aktor slider, bukan di stage.
- **Segmented control**: kontainer `St.BoxLayout` dengan latar kapsul, segmen
  `St.Button`, dan indikator aktif berupa `St.Widget` yang digeser dengan `ease`.

Jangan memakai widget GTK di dalam shell. GTK berjalan di proses lain dan tidak bisa
dimasukkan ke aktor Clutter.

Untuk slider volume, jangan menggambar ulang tiap frame. Gambar ulang hanya saat nilai
berubah, dan gunakan `queue_repaint()` setelah nilai di-debounce.

## Preferensi

```js
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

export default class NocellaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: _('Notch')});

        const enabled = new Adw.SwitchRow({title: _('Enable notch')});
        settings.bind('notch-enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enabled);

        page.add(group);
        window.add(page);
    }
}
```

Semua teks UI memakai `_()` dengan msgid bahasa Inggris; terjemahan Indonesia ada di
`po/id.po`.

Preferensi berjalan di proses terpisah (GTK4/Adw), jadi tidak bisa mengakses
`Main.*`. Semua komunikasi lewat GSettings.

## GSettings schema

```xml
<?xml version="1.0" encoding="UTF-8"?>
<schemalist>
  <schema id="org.gnome.shell.extensions.nocella"
          path="/org/gnome/shell/extensions/nocella/">
    <key name="notch-enabled" type="b">
      <default>true</default>
      <summary>Enable the notch</summary>
    </key>
    <key name="hotkey" type="as">
      <default><![CDATA[['<Super>i']]]></default>
      <summary>Shortcut to toggle the notch panel</summary>
    </key>
    <key name="intercept-banners" type="b">
      <default>true</default>
      <summary>Show notifications in the notch instead of GNOME banners</summary>
    </key>
  </schema>
</schemalist>
```

`hotkey` bertipe `as` karena `Main.wm.addKeybinding()` membaca pintasan dari kunci
GSettings berupa array string. Kunci bertipe `s` membuat pendaftaran pintasan gagal.

Setelah mengubah schema:

```bash
glib-compile-schemas schemas/
```

Schema ini sengaja minimal. Kunci seperti `auto-expand-*`, `idle-collapse-minutes`, dan
preferensi tampilan ditambahkan saat fase fiturnya dikerjakan, bukan sekaligus di awal.

Tanpa langkah ini, `getSettings()` gagal dan ekstensi tidak bisa enable.

## Memasang dan mengetes

### Cara cepat (sesi saat ini)

```bash
scripts/install.sh
# log out and back in on Wayland, then:
gnome-extensions enable nocella@antariksa
```

`scripts/install.sh` memanggil `scripts/pack.sh` lalu `gnome-extensions install --force`.

Di Wayland, ekstensi baru atau perubahan `metadata.json` biasanya butuh logout/login.
Perubahan JavaScript biasa bisa dicoba dengan mematikan lalu menyalakan ekstensi:

```bash
gnome-extensions disable nocella@antariksa
gnome-extensions enable nocella@antariksa
```

Kalau shell membeku, pindah ke TTY (`Ctrl+Alt+F3`), login, lalu akhiri sesi dengan
perintah logout biasa. Di Wayland, GNOME Shell tidak bisa di-restart di tempat seperti
di X11. `gnome-shell --replace` dan `pkill` tidak didukung dan bisa mematikan sesi.
Simpan pekerjaan sebelum mencoba kode yang berisiko.

### Nested shell (disarankan saat pengembangan)

```bash
scripts/nested.sh [skala]
```

Nested shell membuka jendela GNOME Shell di dalam sesi Wayland yang sudah ada, hanya
dengan Nocella aktif. Skrip ini memakai sandbox yang sama dengan smoke test: dconf,
folder ekstensi, dan session bus privat, stub `ibus-daemon`, dan scope systemd ber-batas
RAM. Pengaturan sesi asli tidak dibaca maupun ditulis. Jangan menjalankan
`dbus-run-session -- gnome-shell --nested` langsung: tanpa pengaman itu shell nested
menyalakan `ibus-daemon` sendiri yang bisa tertinggal dan membengkak (lihat
`08-pengujian.md`). Tutup jendelanya untuk mengakhiri. Log ada di
`build/smoke/shell-nested.log`.

### Smoke test headless

`tests/smoke/run.sh` menjalankan GNOME Shell headless yang terisolasi penuh dan memeriksa
gate fase 1 secara otomatis. Detail dan pengaman memorinya ada di `08-pengujian.md`.

### Log

```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

`console.log()` dari ekstensi muncul di sini. Jangan membanjiri log dengan pesan tiap
frame; batasi dengan penghitung atau hanya saat error.

### Looking Glass

`Alt+F2`, ketik `lg`, Enter. Di tab "Evaluator" bisa menjalankan:

```js
Main.panel.statusArea.dateMenu.visible
Main.layoutManager.primaryMonitor
```

Ini alat utama untuk memeriksa API privat sebelum menulis kode.

### Packing

```bash
scripts/pack.sh
```

Hasilnya `build/nocella@antariksa.shell-extension.zip`. Skrip ini memakai
`--extra-source=src`, schema, dan `--podir=po`. Kalau `msgfmt` (paket `gettext`) tidak
ada, ia mem-pack salinan tanpa `po/` dan memberi peringatan, karena `gnome-extensions
pack` selalu mencoba mengompilasi `po/` bila folder itu ada.

## Jebakan yang sudah diketahui

| Jebakan | Akibat | Penanganan |
|---|---|---|
| `imports.*` | Gagal total di GNOME 45+ | Pakai ESM |
| `import ... from 'gi://St'` tanpa default | Error "no default export" | `import St from 'gi://St'` |
| `node_modules` atau bare import | Loader shell tidak menemukan modul | Bundle atau hindari dependensi |
| `GLib.timeout_add` tanpa disimpan | Timer jalan setelah disable, shell error | Selalu simpan ID |
| Signal tidak dilepas | Callback ke objek yang sudah dihancurkan | SignalGroup |
| `actor.destroy()` lalu `disconnect` | Error "object already disposed" | Bungkus try/catch |
| `Main.panel.height` saat enable | Kadang 0 sebelum layout | Fallback 32 |
| Ukuran aktor lewat JS di skala 2 | Notch setengah ukuran | Kalikan `scale_factor` |
| Memusatkan ulang di `onComplete` | Panel tumbuh ke kanan lalu melompat | Ease `x` bersama `width` |
| Stop gradient putih transparan | Panel keruh terang, `background-color` hilang | Stop membawa warna permukaan |
| `box-shadow` campur luar dan `inset` | Tidak ada bayangan sama sekali | Satu bayangan per aktor |
| `clip_to_allocation` di aktor akar | Bayangan luar terpotong | Jangan dipasang |
| Shell uji di session bus privat | Shell menyalakan `ibus-daemon` sendiri yang tertinggal dan membengkak | Stub `ibus-daemon`, scope dengan `MemoryMax` |
| `addChrome` dengan `affectsStruts: true` | Panel bawah ikut bergeser | Jangan pakai struts |
| Animasi `width`/`height` sambil ganti teks | Teks melompat, layout berkedip | Fade konten dulu |
| `St.Icon` dengan nama ikon salah | Ikon kosong, tidak ada error | Cek `Gtk.IconTheme.has_icon` atau fallback |
| CSS `display: flex` | Tidak dikenal, diabaikan | Pakai `St.BoxLayout` |
| `St.Widget` tanpa `reactive` | Klik tidak diterima | Set `reactive: true` |
| `track_hover` tanpa `reactive` | Hover tidak terdeteksi | Set keduanya |
| Memanggil `wpctl` tiap frame saat drag | CPU naik, audio crackle | Debounce 80 ms |
| Membaca `/proc` tiap frame | Boros | Timer 1 detik hanya saat terlihat |

## Urutan implementasi yang disarankan

1. `metadata.json`, `extension.js`, aktor kosong, `addChrome`, CSS. Pastikan muncul dan
   bisa diklik.
2. Sembunyikan jam, tampilkan jam sendiri di notch. Pastikan restore saat disable.
3. Animasi buka/tutup dan reposition.
4. State machine dan arbiter dengan event palsu (tombol debug).
5. Provider media, lalu notifikasi.
6. Provider sistem dan workspace.
7. Volume, quick settings.
8. Bridge agen dan UI-nya.
9. Poles visual: switch, slider, segmented control, audit radius/hairline/tipografi.
10. Preferensi, aksesibilitas, pengujian.

Jangan mengerjakan semua provider sebelum animasi dan state machine stabil. Kalau
fondasi berubah, semua provider harus ikut diubah.
