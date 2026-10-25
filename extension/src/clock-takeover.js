// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Hides the GNOME panel clock while the notch shows its own (ADR 0003).
 *
 * Uses the private `Main.panel.statusArea.dateMenu`. Only the button is hidden, not its
 * container: the panel calls `container.show()` whenever it rebuilds its boxes, which
 * would otherwise undo the takeover.
 */
export class ClockTakeover {
    constructor() {
        /** @type {any} */
        this._dateMenu = null;
    }

    enable() {
        const dateMenu = Main.panel.statusArea?.dateMenu;
        if (!dateMenu) {
            console.warn('[nocella] Panel clock not found; leaving it untouched');
            return;
        }

        // Another extension may have hidden the clock already. Only restore what we hid.
        if (!dateMenu.visible)
            return;

        dateMenu.hide();
        this._dateMenu = dateMenu;
    }

    disable() {
        this._dateMenu?.show();
        this._dateMenu = null;
    }
}
