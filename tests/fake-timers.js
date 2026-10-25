// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

/** @typedef {import('../extension/src/util/timer-group.js').Timers} Timers */

/**
 * A manual clock implementing the `Timers` interface from timer-group.js.
 *
 * @implements {Timers}
 */
export class FakeTimers {
    constructor() {
        this._now = 0;
        this._nextId = 1;
        /** @type {Map<number, {at: number, interval: number, callback: () => void}>} */
        this._pending = new Map();
    }

    /**
     * @param {number} ms
     * @param {() => void} callback
     * @returns {number}
     */
    timeout(ms, callback) {
        const id = this._nextId++;
        this._pending.set(id, {at: this._now + ms, interval: 0, callback});
        return id;
    }

    /**
     * @param {number} ms
     * @param {() => void} callback
     * @returns {number}
     */
    every(ms, callback) {
        const id = this._nextId++;
        this._pending.set(id, {at: this._now + ms, interval: ms, callback});
        return id;
    }

    /** @param {number} id */
    remove(id) {
        this._pending.delete(id);
    }

    /** @returns {number} */
    now() {
        return this._now;
    }

    /** @returns {number} timers still pending */
    get size() {
        return this._pending.size;
    }

    /**
     * Moves the clock forward, firing due timers in order.
     *
     * @param {number} ms
     */
    advance(ms) {
        const end = this._now + ms;
        for (;;) {
            let dueId = 0;
            let due = null;
            for (const [id, timer] of this._pending) {
                if (timer.at <= end && (!due || timer.at < due.at)) {
                    dueId = id;
                    due = timer;
                }
            }
            if (!due)
                break;
            this._now = due.at;
            if (due.interval > 0)
                due.at += due.interval;
            else
                this._pending.delete(dueId);
            due.callback();
        }
        this._now = end;
    }
}
