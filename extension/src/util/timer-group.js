// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import GLib from 'gi://GLib';

/**
 * The timer interface the pure modules (state machine, providers) depend on, so tests
 * can swap in a fake clock.
 *
 * @typedef {object} Timers
 * @property {(ms: number, callback: () => void) => number} timeout one-shot; returns an ID
 * @property {(ms: number, callback: () => void) => number} every repeating; returns an ID
 * @property {(id: number) => void} remove safe to call with a finished or unknown ID
 * @property {() => number} now monotonic milliseconds
 */

/**
 * Main-loop timers whose IDs are all remembered, so `clear()` removes every one of them.
 *
 * @implements {Timers}
 */
export class TimerGroup {
    constructor() {
        /** @type {Set<number>} */
        this._ids = new Set();
    }

    /**
     * @param {number} ms
     * @param {() => void} callback
     * @returns {number}
     */
    timeout(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, Math.round(ms)), () => {
            this._ids.delete(id);
            callback();
            return GLib.SOURCE_REMOVE;
        });
        this._ids.add(id);
        return id;
    }

    /**
     * @param {number} ms
     * @param {() => void} callback
     * @returns {number}
     */
    every(ms, callback) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, Math.round(ms)), () => {
            callback();
            return GLib.SOURCE_CONTINUE;
        });
        this._ids.add(id);
        return id;
    }

    /** @param {number} id */
    remove(id) {
        if (this._ids.delete(id))
            GLib.source_remove(id);
    }

    /** @returns {number} */
    now() {
        return GLib.get_monotonic_time() / 1000;
    }

    /** @returns {number} */
    get size() {
        return this._ids.size;
    }

    /** Removes every pending timer. Safe to call more than once. */
    clear() {
        for (const id of this._ids)
            GLib.source_remove(id);
        this._ids.clear();
    }
}
