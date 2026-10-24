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
        this._settings = this.getSettings();
        this._nocella = new Nocella(this);
        this._nocella.enable();
    }

    disable() {
        this._nocella?.disable();
        this._nocella = null;
        this._settings = null;
    }
}
```

Tidak ada `init()`. Sejak GNOME 45, `enable()` dan `disable()` adalah satu-satunya
siklus hidup yang perlu.

## Aktor utama

```js
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const COLLAPSED_WIDTH = 196;
const COLLAPSED_HEIGHT = 32;

export class Nocella {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();

        this._actor = new St.Widget({
            name: 'nocella',
            style_class: 'nocella',
            reactive: true,
            track_hover: true,
            can_focus: true,
            layout_manager: new Clutter.BinLayout(),
            width: COLLAPSED_WIDTH,
            height: COLLAPSED_HEIGHT,
        });

        this._actor.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 1)
                return Clutter.EVENT_PROPAGATE;
            this.toggle();
            return Clutter.EVENT_STOP;
        });
    }

    enable() {
        Main.layoutManager.addChrome(this._actor, {
            affectsInputRegion: true,
            affectsStruts: false,
            trackFullscreen: false, // visibility is owned by the state machine
        });

        this._reposition();
        this._monitorsChangedId = Main.layoutManager.connect(
            'monitors-changed', () => this._reposition());
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const width = this._actor.width || COLLAPSED_WIDTH;
        const x = Math.round(monitor.x + (monitor.width - width) / 2);
        const y = monitor.y;
        this._actor.set_position(x, y);
    }

    toggle() {
        if (this._expanded)
            this.collapse();
        else
            this.expand();
    }

    expand() {
        const width = 420;
        const height = 240;
        this._expanded = true;
        this._actor.add_style_class_name('expanded');
        this._actor.ease({
            width,
            height,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => this._reposition(),
        });
    }

    collapse() {
        this._expanded = false;
        this._actor.remove_style_class_name('expanded');
        this._actor.ease({
            width: COLLAPSED_WIDTH,
            height: COLLAPSED_HEIGHT,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_IN_QUART,
            onComplete: () => this._reposition(),
        });
    }

    disable() {
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._actor) {
            Main.layoutManager.removeChrome(this._actor);
            this._actor.destroy();
            this._actor = null;
        }
    }
}
```

Catatan penting:

- `width` dan `height` di animasi memicu layout tiap frame. Ini masih wajar untuk satu
  aktor. Kalau nanti terasa berat, ganti dengan `Clutter.PropertyTransition` atau
  animasi `scale` dengan kompensasi ukuran.
- `_reposition()` harus dipanggil setelah animasi selesai, karena `x` bergantung pada
  lebar. Kalau dipanggil tiap frame, posisi bergerak halus tapi biaya layout naik.
- `addChrome` menempatkan aktor di bawah `global.top_window_group`, jadi popup shell
  tetap di atas notch. Ini yang diinginkan. Jangan pakai `addTopChrome` kecuali notch
  perlu menutupi popup.

## Mengambil alih area jam

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
`bannerBlocked` bisa tertinggal `true` saat fullscreen.

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
    background-color: rgba(18, 18, 20, 0.96);
    background-gradient-direction: vertical;
    background-gradient-start: rgba(255, 255, 255, 0.04);
    background-gradient-end: rgba(255, 255, 255, 0);
    border-radius: 0 0 20px 20px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35),
                inset 0 -1px 0 rgba(255, 255, 255, 0.08);
    padding: 0 12px;
}

.nocella.expanded {
    background-color: rgba(24, 24, 26, 0.82);
    background-gradient-direction: vertical;
    background-gradient-start: rgba(255, 255, 255, 0.06);
    background-gradient-end: rgba(255, 255, 255, 0);
    border-radius: 0 0 26px 26px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.55),
                0 2px 8px rgba(0, 0, 0, 0.35),
                inset 0 -1px 0 rgba(255, 255, 255, 0.10);
    padding: 0;
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
`border`, `border-radius` (termasuk empat nilai), `box-shadow` (termasuk `inset`),
`padding`, `margin`, `spacing`, `color`, `font-family`, `font-size`, `font-weight`,
`font-feature-settings`, `letter-spacing`, `text-align`, dan properti `-st-` tertentu.
Tidak ada `display: flex`, tidak ada `calc()`, tidak ada `backdrop-filter`, tidak ada
variabel CSS.

St tidak mendukung border per sisi seperti `border-bottom`. Untuk hairline 1 px di tepi
bawah, pakai `box-shadow: inset 0 -1px 0 <warna>`.

Karena tidak ada variabel, tema terang dibuat dengan style class terpisah. Notch
tertutup tetap hitam; hanya panel terbuka yang berubah:

```css
.nocella.expanded.light {
    background-color: rgba(250, 250, 252, 0.84);
    color: #1D1D1F;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18),
                0 2px 8px rgba(0, 0, 0, 0.10),
                inset 0 -1px 0 rgba(0, 0, 0, 0.08);
}

.nocella.expanded.light .card {
    background-color: rgba(0, 0, 0, 0.04);
}

.nocella.expanded.light .card:hover {
    background-color: rgba(0, 0, 0, 0.07);
}
```

Faux vibrancy: tidak ada blur asli. Lapisan yang dipakai hanya `background-color`
translusen, gradient vertikal tipis, hairline, dan bayangan. Ini cukup untuk wallpaper
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
mkdir -p ~/.local/share/gnome-shell/extensions/nocella@antariksa
cp -r extension.js metadata.json prefs.js stylesheet.css src schemas \
  ~/.local/share/gnome-shell/extensions/nocella@antariksa/
glib-compile-schemas ~/.local/share/gnome-shell/extensions/nocella@antariksa/schemas/
gnome-extensions enable nocella@antariksa
```

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
dbus-run-session -- gnome-shell --nested --wayland
```

Nested shell membuka jendela GNOME Shell di dalam sesi Wayland yang sudah ada. Ekstensi
yang sama ikut termuat. Ini jauh lebih aman daripada memuat kode baru ke shell utama.
Kalau nested shell tidak mau start, cek `journalctl` dan pastikan `mutter` versi sama.

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
gnome-extensions pack \
  --force \
  --podir=po \
  --extra-source=src \
  --schema=schemas/org.gnome.shell.extensions.nocella.gschema.xml
```

Hasilnya `nocella@antariksa.shell-extension.zip`, bisa dipasang dengan
`gnome-extensions install --force`.

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
