// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEY = 'hotkey';
const FALLBACK_KEY = 'hotkey-fallback';

// Schemas whose shortcuts a new binding could collide with (docs/04-interaksi.md).
const SHORTCUT_SCHEMAS = [
    'org.gnome.shell.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.mutter.wayland.keybindings',
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
];

/**
 * @param {string} accelerator
 * @returns {string}
 */
function normalize(accelerator) {
    return accelerator.toLowerCase().replace(/\s+/g, '');
}

/**
 * Names of shortcuts that already use `accelerator`, as `schema key`.
 *
 * @param {string} accelerator
 * @returns {string[]}
 */
export function findConflicts(accelerator) {
    const wanted = normalize(accelerator);
    const source = Gio.SettingsSchemaSource.get_default();
    const conflicts = [];
    for (const id of SHORTCUT_SCHEMAS) {
        const schema = source?.lookup(id, true);
        if (!schema)
            continue;
        const settings = new Gio.Settings({settings_schema: schema});
        for (const key of schema.list_keys()) {
            const value = settings.get_value(key);
            if (value.get_type_string() !== 'as')
                continue;
            if (value.deepUnpack().some((/** @type {string} */ a) => normalize(a) === wanted))
                conflicts.push(`${id} ${key}`);
        }
    }
    return conflicts;
}

/**
 * Registers the panel shortcut. When the default <Super>i is already taken and the user
 * has not chosen a shortcut of their own, the `hotkey-fallback` key (<Super>F9) is
 * registered instead. Nothing is written to the user's settings, so freeing <Super>i
 * later brings it back.
 */
export class Hotkey {
    /**
     * @param {any} settings the extension's `Gio.Settings`
     * @param {() => void} handler
     */
    constructor(settings, handler) {
        this._settings = settings;
        this._handler = handler;
        /** @type {string | null} */
        this._key = null;
    }

    enable() {
        let key = KEY;
        // Only the default is checked: a shortcut the user picked is their decision.
        const current = this._settings.get_strv(KEY);
        if (this._settings.get_user_value(KEY) === null && current.length > 0 &&
            findConflicts(current[0]).length > 0) {
            key = FALLBACK_KEY;
            console.log(`[nocella] ${current[0]} is already used; the panel shortcut is ` +
                `${this._settings.get_strv(FALLBACK_KEY).join(', ')}`);
        }
        const action = Main.wm.addKeybinding(key, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.POPUP, () => this._handler());
        this._key = action === Meta.KeyBindingAction.NONE ? null : key;
        if (!this._key)
            console.log('[nocella] The panel shortcut could not be registered');
    }

    /** @returns {string | null} the settings key in use */
    get key() {
        return this._key;
    }

    disable() {
        if (this._key)
            Main.wm.removeKeybinding(this._key);
        this._key = null;
    }
}
