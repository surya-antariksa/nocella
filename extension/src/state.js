// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

/** @typedef {import('./arbiter.js').NotchEvent} NotchEvent */
/** @typedef {import('./util/timer-group.js').Timers} Timers */

/** States from docs/02-arsitektur.md. */
export const State = Object.freeze({
    COLLAPSED: 'collapsed',
    PEEK: 'peek',
    TRANSIENT: 'transient',
    PINNED: 'pinned',
    SUPPRESSED: 'suppressed',
});

/** Delays from docs/04-interaksi.md, in milliseconds. */
export const Delay = Object.freeze({
    PEEK: 140,
    PEEK_LEAVE: 320,
});

/**
 * Suppression reasons the hotkey may open the panel over (docs/04-interaksi.md,
 * "Fullscreen"). The overview and a disabled notch always win.
 */
const PINNABLE_OVER = new Set(['fullscreen']);

/**
 * @typedef {object} StateChange
 * @property {string} state
 * @property {string} previous
 * @property {NotchEvent | null} content the transient content, if any
 * @property {string | null} view the pinned view, if any
 */

/**
 * Owns the notch state and every timer tied to it: peek on hover, leave delay,
 * transient TTL, and the pinned idle timeout. Pure logic; the UI follows `onChange`.
 */
export class StateMachine {
    /**
     * @param {object} params
     * @param {Timers} params.timers
     * @param {(change: StateChange) => void} params.onChange
     * @param {() => NotchEvent | null} params.nextTransient asked when a transient expires
     * @param {() => number} [params.idleCollapseMs] 0 disables the pinned idle timeout
     * @param {() => boolean} [params.canIdleCollapse] false keeps the panel open (media)
     */
    constructor({timers, onChange, nextTransient, idleCollapseMs = () => 0, canIdleCollapse = () => true}) {
        this._timers = timers;
        this._onChange = onChange;
        this._nextTransient = nextTransient;
        this._idleCollapseMs = idleCollapseMs;
        this._canIdleCollapse = canIdleCollapse;

        /** @type {string} */
        this._state = State.COLLAPSED;
        /** @type {NotchEvent | null} */
        this._content = null;
        /** @type {string | null} */
        this._view = null;
        this._hovered = false;
        /** @type {Set<string>} */
        this._reasons = new Set();
        this._pinnedOverSuppression = false;

        /** @type {Record<'peek' | 'leave' | 'ttl' | 'idle', number>} */
        this._timerIds = {peek: 0, leave: 0, ttl: 0, idle: 0};
    }

    /** @returns {string} */
    get state() {
        return this._state;
    }

    /** @returns {NotchEvent | null} */
    get content() {
        return this._content;
    }

    /** @returns {string | null} */
    get view() {
        return this._view;
    }

    /** @returns {boolean} at least one suppression reason is active */
    get suppressed() {
        return this._reasons.size > 0;
    }

    /** @returns {boolean} pinned through the hotkey while suppressed (fullscreen) */
    get pinnedOverSuppression() {
        return this._pinnedOverSuppression;
    }

    hoverEnter() {
        this._hovered = true;
        switch (this._state) {
        case State.COLLAPSED:
            this._restart('peek', Delay.PEEK, () => this._set(State.PEEK));
            break;
        case State.PEEK:
            this._cancel('leave');
            break;
        case State.TRANSIENT:
            // Hovering holds the transient for as long as the pointer stays.
            this._cancel('ttl');
            break;
        }
    }

    hoverLeave() {
        this._hovered = false;
        this._cancel('peek');
        switch (this._state) {
        case State.PEEK:
            this._restart('leave', Delay.PEEK_LEAVE, () => this._set(State.COLLAPSED));
            break;
        case State.TRANSIENT:
            this._startTtl();
            break;
        }
    }

    /**
     * A click on the notch opens the pinned panel. Clicks inside an open panel belong
     * to its controls, so they do nothing here.
     *
     * @param {string} view the view to open, chosen by the caller from the content
     */
    click(view) {
        if (this._state === State.COLLAPSED || this._state === State.PEEK ||
            this._state === State.TRANSIENT)
            this._set(State.PINNED, {view});
    }

    /**
     * The hotkey: opens the panel, or closes it when it is open. It may open the panel
     * over a fullscreen window.
     *
     * @param {string} view
     */
    toggle(view) {
        if (this._state === State.PINNED) {
            this.close();
            return;
        }
        if (this._state === State.SUPPRESSED) {
            if (![...this._reasons].every(reason => PINNABLE_OVER.has(reason)))
                return;
            this._pinnedOverSuppression = true;
        }
        this._set(State.PINNED, {view});
    }

    /** Escape, a click outside, or the close button. */
    close() {
        if (this._state === State.COLLAPSED || this._state === State.SUPPRESSED)
            return;
        this._pinnedOverSuppression = false;
        this._set(this.suppressed ? State.SUPPRESSED : State.COLLAPSED);
    }

    /**
     * Switches the pinned view (a tab).
     *
     * @param {string} view
     */
    selectView(view) {
        if (this._state !== State.PINNED || this._view === view)
            return;
        this._view = view;
        this.interaction();
        this._emit(State.PINNED);
    }

    /**
     * Shows new content as a transient. Ignored while pinned or suppressed; the caller
     * raises a badge instead.
     *
     * @param {NotchEvent} event
     */
    showTransient(event) {
        if (this._state === State.PINNED || this._state === State.SUPPRESSED)
            return;
        this._set(State.TRANSIENT, {content: event});
    }

    /**
     * Replaces the payload of the content on screen and resets its TTL, without a new
     * transition (coalescing).
     *
     * @param {NotchEvent} event
     */
    updateTransient(event) {
        if (this._state !== State.TRANSIENT)
            return;
        this._content = event;
        this._startTtl();
        this._emit(State.TRANSIENT);
    }

    /**
     * Any user activity inside the pinned panel; restarts the idle timeout.
     */
    interaction() {
        if (this._state === State.PINNED)
            this._startIdle();
    }

    /**
     * @param {string} reason e.g. `fullscreen`, `overview`, `disabled`
     */
    suppress(reason) {
        this._reasons.add(reason);
        if (this._state === State.SUPPRESSED)
            return;
        if (this._state === State.PINNED && this._pinnedOverSuppression && PINNABLE_OVER.has(reason))
            return;
        this._pinnedOverSuppression = false;
        this._set(State.SUPPRESSED);
    }

    /**
     * Once no reason is left, the notch comes back collapsed, never in its old state.
     *
     * @param {string} reason
     */
    release(reason) {
        this._reasons.delete(reason);
        if (this._reasons.size > 0)
            return;
        this._pinnedOverSuppression = false;
        if (this._state === State.SUPPRESSED)
            this._set(State.COLLAPSED);
    }

    /** Cancels every timer. The machine stays usable; `disable()` calls this. */
    destroy() {
        for (const name of /** @type {const} */ (['peek', 'leave', 'ttl', 'idle']))
            this._cancel(name);
    }

    /**
     * @param {string} state
     * @param {{content?: NotchEvent | null, view?: string | null}} [params]
     */
    _set(state, {content = null, view = null} = {}) {
        const previous = this._state;
        this._cancel('peek');
        this._cancel('leave');
        this._cancel('ttl');
        this._cancel('idle');

        this._state = state;
        this._content = state === State.TRANSIENT ? content : null;
        this._view = state === State.PINNED ? view : null;

        if (state === State.TRANSIENT)
            this._startTtl();
        else if (state === State.PINNED)
            this._startIdle();
        else if (state === State.PEEK && !this._hovered)
            this._restart('leave', Delay.PEEK_LEAVE, () => this._set(State.COLLAPSED));

        this._emit(previous);
    }

    /** @param {string} previous */
    _emit(previous) {
        this._onChange({state: this._state, previous, content: this._content, view: this._view});
    }

    _startTtl() {
        this._cancel('ttl');
        if (this._hovered || !this._content)
            return;
        this._restart('ttl', this._content.ttl, () => {
            const next = this._nextTransient();
            if (next)
                this._set(State.TRANSIENT, {content: next});
            else
                this._set(State.COLLAPSED);
        });
    }

    _startIdle() {
        const ms = this._idleCollapseMs();
        if (ms <= 0) {
            this._cancel('idle');
            return;
        }
        this._restart('idle', ms, () => {
            if (this._canIdleCollapse())
                this.close();
            else
                this._startIdle();
        });
    }

    /**
     * @param {'peek' | 'leave' | 'ttl' | 'idle'} name
     * @param {number} ms
     * @param {() => void} callback
     */
    _restart(name, ms, callback) {
        this._cancel(name);
        this._timerIds[name] = this._timers.timeout(ms, () => {
            this._timerIds[name] = 0;
            callback();
        });
    }

    /** @param {'peek' | 'leave' | 'ttl' | 'idle'} name */
    _cancel(name) {
        if (this._timerIds[name]) {
            this._timers.remove(this._timerIds[name]);
            this._timerIds[name] = 0;
        }
    }
}
