// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

/**
 * Content a provider wants to show in the notch (docs/04-interaksi.md, "Prioritas
 * konten").
 *
 * @typedef {object} NotchEvent
 * @property {string} type e.g. `media-changed`, `notification`, `volume-changed`
 * @property {number} priority higher wins
 * @property {number} ttl how long the transient stays, in milliseconds
 * @property {string} [coalesceKey] events with the same key replace each other
 * @property {any} [payload]
 */

/**
 * @typedef {'show' | 'update' | 'queued' | 'dropped'} PushResult
 *   `show`: the event is the new current content. `update`: it replaced the payload of
 *   the current content (reset its TTL, do not animate). `queued`/`dropped`: it waits
 *   behind higher-priority content, or was discarded because the queue is full.
 */

/**
 * Decides which single event is shown, using priority, coalescing, and a short queue.
 * Pure logic: no timers and no UI. The state machine owns the TTL timer and asks
 * `next()` when the current content expires.
 */
export class Arbiter {
    /**
     * @param {object} [params]
     * @param {() => number} [params.now] monotonic milliseconds
     * @param {number} [params.queueLimit]
     * @param {number} [params.queueLifetime] milliseconds a queued event stays valid
     */
    constructor({now = () => Date.now(), queueLimit = 5, queueLifetime = 5000} = {}) {
        this._now = now;
        this._queueLimit = queueLimit;
        this._queueLifetime = queueLifetime;
        /** @type {NotchEvent | null} */
        this._current = null;
        /** @type {Array<{event: NotchEvent, expiresAt: number, order: number}>} */
        this._queue = [];
        this._order = 0;
    }

    /** @returns {NotchEvent | null} */
    get current() {
        return this._current;
    }

    /** @returns {NotchEvent[]} queued events, highest priority first */
    get queue() {
        this._dropExpired();
        return this._sortedQueue().map(item => item.event);
    }

    /**
     * @param {NotchEvent} event
     * @returns {PushResult}
     */
    push(event) {
        this._dropExpired();
        const key = event.coalesceKey;

        if (!this._current) {
            this._current = event;
            return 'show';
        }

        if (key !== undefined && key === this._current.coalesceKey) {
            this._current = event;
            return 'update';
        }

        const queued = key === undefined ? undefined : this._queue.find(item => item.event.coalesceKey === key);
        if (queued) {
            queued.event = event;
            queued.expiresAt = this._now() + this._queueLifetime;
            return 'queued';
        }

        if (event.priority >= this._current.priority) {
            this._current = event;
            return 'show';
        }

        const item = {event, expiresAt: this._now() + this._queueLifetime, order: this._order++};
        this._queue.push(item);
        if (this._queue.length > this._queueLimit) {
            // Drop the lowest priority; among equals, the oldest, so fresh news survives.
            const victim = [...this._queue].sort((a, b) => a.event.priority - b.event.priority ||
                a.order - b.order)[0];
            this._queue = this._queue.filter(other => other !== victim);
            if (victim === item)
                return 'dropped';
        }
        return 'queued';
    }

    /**
     * Ends the current content and promotes the best queued event, if any.
     *
     * @returns {NotchEvent | null} the new current content
     */
    next() {
        this._dropExpired();
        const [best] = this._sortedQueue();
        if (best)
            this._queue = this._queue.filter(item => item !== best);
        this._current = best?.event ?? null;
        return this._current;
    }

    /** Forgets the current content and the queue (state became PINNED or COLLAPSED). */
    clear() {
        this._current = null;
        this._queue = [];
    }

    _dropExpired() {
        const now = this._now();
        this._queue = this._queue.filter(item => item.expiresAt > now);
    }

    _sortedQueue() {
        // Highest priority first; among equals, the oldest first.
        return [...this._queue].sort((a, b) => b.event.priority - a.event.priority || a.order - b.order);
    }
}
