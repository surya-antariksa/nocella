// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

/**
 * @typedef {object} Disconnectable
 * @property {(id: number) => void} disconnect
 */

/**
 * Remembers signal handler IDs so they can all be disconnected at once.
 */
export class SignalGroup {
    constructor() {
        /** @type {Array<[Disconnectable, number]>} */
        this._items = [];
    }

    /**
     * @param {Disconnectable} object
     * @param {number} id the value returned by `object.connect()`
     * @returns {number}
     */
    add(object, id) {
        this._items.push([object, id]);
        return id;
    }

    /** Disconnects every handler. Safe to call more than once. */
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
