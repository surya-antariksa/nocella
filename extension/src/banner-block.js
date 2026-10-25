// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

/**
 * Owns `Main.messageTray.bannerBlocked` (ADR 0004). GNOME Shell 46 only has a setter,
 * so the value before Nocella is read from the private `_bannerBlocked` and restored on
 * disable. Without the setter the notch mirrors GNOME banners instead.
 *
 * Blocking never starts in the middle of a GNOME banner: GNOME would keep that banner
 * "shown" but invisible, and it has already marked it read. Instead the block waits
 * until GNOME's banner (and any it queued, e.g. after fullscreen) has finished.
 */
export class BannerBlock {
    constructor() {
        this._tray = Main.messageTray;
        const descriptor = findDescriptor(this._tray, 'bannerBlocked');
        this._supported = typeof descriptor?.set === 'function';
        this._initial = this._tray?._bannerBlocked === true;
        this._wanted = this._initial;
        this._visibleId = 0;
        if (!this._supported)
            console.log('[nocella] bannerBlocked is not available; mirroring GNOME banners');
    }

    /** @returns {boolean} */
    get supported() {
        return this._supported;
    }

    /** @returns {boolean} GNOME's actual value, which panel menus may also change */
    get blocked() {
        return this._supported && this._tray._bannerBlocked === true;
    }

    /** @returns {boolean} a block is waiting for GNOME's banner to finish */
    get waiting() {
        return this._visibleId !== 0;
    }

    /** @param {boolean} blocked */
    set(blocked) {
        if (!this._supported)
            return;
        this._wanted = blocked;
        if (blocked && this._gnomeShowsBanner()) {
            this._waitForBanner();
            return;
        }
        this._stopWaiting();
        this._apply(blocked);
    }

    /**
     * Drops notifications the notch already showed from GNOME's banner queue, so
     * unblocking does not show them a second time. Uses the private queue; skipped when
     * it is not there.
     *
     * @param {(notification: any) => boolean} shownByNotch
     */
    forgetShown(shownByNotch) {
        const queue = this._tray?._notificationQueue;
        if (!Array.isArray(queue))
            return;
        const kept = queue.filter(notification => !shownByNotch(notification));
        if (kept.length === queue.length)
            return;
        this._tray._notificationQueue = kept;
        this._tray.emit('queue-changed');
    }

    /** Puts back the value from before Nocella. */
    restore() {
        this._stopWaiting();
        if (this._supported)
            this._apply(this._initial);
    }

    /** @returns {boolean} */
    _gnomeShowsBanner() {
        const state = this._tray._notificationState;
        return typeof state === 'number' && state !== MessageTray.State.HIDDEN;
    }

    _waitForBanner() {
        if (this._visibleId)
            return;
        // The tray actor hides once GNOME has no banner left to show.
        this._visibleId = this._tray.connect('notify::visible', () => {
            if (this._gnomeShowsBanner())
                return;
            this._stopWaiting();
            this._apply(this._wanted);
        });
    }

    _stopWaiting() {
        if (this._visibleId)
            this._tray.disconnect(this._visibleId);
        this._visibleId = 0;
    }

    /** @param {boolean} blocked */
    _apply(blocked) {
        if (this._tray._bannerBlocked !== blocked)
            this._tray.bannerBlocked = blocked;
    }
}

/**
 * @param {any} object
 * @param {string} name
 * @returns {PropertyDescriptor | undefined}
 */
function findDescriptor(object, name) {
    for (let proto = object; proto; proto = Object.getPrototypeOf(proto)) {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (descriptor)
            return descriptor;
    }
    return undefined;
}
