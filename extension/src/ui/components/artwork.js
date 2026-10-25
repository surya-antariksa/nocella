// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';

/**
 * Album artwork with rounded corners, or a gray box with a music icon when there is
 * none or it cannot be loaded (docs/04-interaksi.md, "Edge case").
 */
export class Artwork {
    /**
     * @param {object} [params]
     * @param {boolean} [params.large] 64 px instead of 48 px
     */
    constructor({large = false} = {}) {
        this.actor = new St.Bin({
            style_class: large ? 'nocella-artwork large' : 'nocella-artwork',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._placeholder = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: large ? 24 : 20,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.set_child(this._placeholder);
        /** @type {string | null} */
        this._url = null;
    }

    /** @param {string | null} url a `file://` URL, already filtered by the provider */
    setUrl(url) {
        if (url === this._url)
            return;
        this._url = url;
        const path = url ? Gio.File.new_for_uri(url).get_path() : null;
        // St clips a background image to the border radius; an St.Icon would not.
        if (path && fileExists(path) && !/["\\\n]/.test(path)) {
            this.actor.set_style(`background-image: url("${path}"); background-size: cover;`);
            this._placeholder.hide();
        } else {
            this.actor.set_style(null);
            this._placeholder.show();
        }
    }
}

/**
 * @param {string} path
 * @returns {boolean}
 */
function fileExists(path) {
    return Gio.File.new_for_path(path).query_exists(null);
}
