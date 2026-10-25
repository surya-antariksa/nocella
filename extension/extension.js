// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

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
