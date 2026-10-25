// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {GroupCounter, notificationEvent, presentation, unreadBadge} from '../util/notification-rules.js';
import {SignalGroup} from '../util/signal-group.js';
import {TimerGroup} from '../util/timer-group.js';

/** @typedef {import('../arbiter.js').NotchEvent} NotchEvent */

/** Only the newest ones are kept for the list (docs/05-fitur.md: "maksimal 50 terbaru"). */
const MAX_ENTRIES = 50;

/**
 * @typedef {object} NotificationEntry
 * @property {string} key
 * @property {any} notification a `MessageTray.Notification`, owned by GNOME
 * @property {any} source a `MessageTray.Source`
 */

/**
 * @typedef {object} Tracked
 * @property {string} key
 * @property {SignalGroup} signals
 * @property {boolean | null} acknowledgedWhenAdded read state right before the first
 *   banner request, or null once used (or for notifications found at start)
 * @property {boolean} requested a banner was requested before (later requests are updates)
 * @property {number} pending a deferred banner decision
 */

/**
 * GNOME notifications from `Main.messageTray`. GNOME keeps owning them: they stay in its
 * notification list, and this provider only reads them, asks the notch to show new ones,
 * and forwards clicks. Nothing polls; everything reacts to message tray signals.
 */
export class NotificationsProvider {
    /**
     * @param {object} params
     * @param {(event: NotchEvent) => void} params.emit
     * @param {() => void} params.changed
     * @param {() => boolean} params.autoExpand `auto-expand-notifications`
     */
    constructor({emit, changed, autoExpand}) {
        this._emit = emit;
        this._changed = changed;
        this._autoExpand = autoExpand;
        this._signals = new SignalGroup();
        this._timers = new TimerGroup();
        this._groups = new GroupCounter();
        /** @type {Map<any, SignalGroup>} */
        this._sourceSignals = new Map();
        /** @type {Map<any, Tracked>} */
        this._tracked = new Map();
        /** @type {NotificationEntry[]} newest first */
        this._entries = [];
        /** @type {WeakSet<any>} */
        this._shown = new WeakSet();
        this._nextKey = 1;
        /** @type {any} */
        this._notificationSettings = null;
    }

    start() {
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const tray = Main.messageTray;
        this._signals.add(tray, tray.connect('source-added', (_tray, source) => this._addSource(source)));
        this._signals.add(tray, tray.connect('source-removed', (_tray, source) => this._removeSource(source)));
        for (const source of tray.getSources())
            this._addSource(source);
    }

    stop() {
        this._signals.clear();
        for (const signals of this._sourceSignals.values())
            signals.clear();
        this._sourceSignals.clear();
        for (const {signals} of this._tracked.values())
            signals.clear();
        this._tracked.clear();
        this._entries = [];
        this._groups.clear();
        this._timers.clear();
        this._notificationSettings = null;
    }

    /** @returns {boolean} `show-banners` is off */
    get doNotDisturb() {
        return this._notificationSettings?.get_boolean('show-banners') === false;
    }

    /**
     * @returns {{entries: NotificationEntry[], badge: 'danger' | 'warning' | null}}
     */
    snapshot() {
        return {entries: [...this._entries], badge: unreadBadge(this._entries.map(e => e.notification))};
    }

    /**
     * @param {string} key
     * @returns {NotificationEntry | null}
     */
    find(key) {
        return this._entries.find(entry => entry.key === key) ?? null;
    }

    /**
     * Called once the notch really put the notification on screen; only those are
     * dropped from GNOME's banner queue later.
     *
     * @param {string} key
     */
    markShown(key) {
        const entry = this.find(key);
        if (entry)
            this._shown.add(entry.notification);
    }

    /** @param {any} notification */
    wasShown(notification) {
        return this._shown.has(notification);
    }

    /** Marks every listed notification as read, like opening GNOME's message list. */
    acknowledgeAll() {
        for (const {notification} of this._entries) {
            if (!notification.acknowledged)
                notification.acknowledged = true;
        }
    }

    /** @param {string} key */
    activate(key) {
        this.find(key)?.notification.activate();
    }

    /**
     * @param {string} key
     * @param {number} index
     */
    invokeAction(key, index) {
        this.find(key)?.notification.actions[index]?.activate();
    }

    /** Removes every listed notification from GNOME too ("Clear"). */
    clearAll() {
        for (const {notification} of [...this._entries])
            notification.destroy(MessageTray.NotificationDestroyedReason.DISMISSED);
    }

    /**
     * Ends a transient notification after the notch showed it, as GNOME does when its
     * banner hides; it does not stay in the list.
     *
     * @param {string} key
     */
    expireIfTransient(key) {
        const notification = this.find(key)?.notification;
        if (notification?.isTransient)
            notification.destroy(MessageTray.NotificationDestroyedReason.EXPIRED);
    }

    /**
     * Also used when GNOME adds a source again, e.g. after its policy was re-enabled; the
     * notifications it already has are picked up then.
     *
     * @param {any} source
     */
    _addSource(source) {
        if (this._sourceSignals.has(source))
            return;
        const signals = new SignalGroup();
        signals.add(source, source.connect('notification-added',
            (_source, notification) => this._track(notification, source, true)));
        signals.add(source, source.connect('notification-removed',
            (_source, notification) => this._untrack(notification)));
        signals.add(source, source.connect('notification-request-banner',
            (_source, notification) => this._onRequestBanner(notification, source)));
        this._sourceSignals.set(source, signals);
        for (const notification of source.notifications)
            this._track(notification, source, false);
    }

    /** @param {any} source */
    _removeSource(source) {
        this._sourceSignals.get(source)?.clear();
        this._sourceSignals.delete(source);
        for (const entry of this._entries.filter(e => e.source === source))
            this._untrack(entry.notification);
    }

    /**
     * @param {any} notification
     * @param {any} source
     * @param {boolean} isNew from `notification-added`, i.e. a banner request follows
     */
    _track(notification, source, isNew) {
        if (this._tracked.has(notification))
            return;
        const key = `n${this._nextKey++}`;
        const signals = new SignalGroup();
        signals.add(notification, notification.connect('notify::acknowledged', () => this._changed()));
        // `notification-added` comes right before the first banner request. When banners
        // are not blocked, GNOME's handler for that request runs first and acknowledges
        // the notification as it shows its banner, so the state from here is the real one.
        this._tracked.set(notification, {
            key,
            signals,
            acknowledgedWhenAdded: isNew ? notification.acknowledged : null,
            requested: !isNew,
            pending: 0,
        });
        this._entries.unshift({key, notification, source});
        while (this._entries.length > MAX_ENTRIES)
            this._untrack(this._entries[this._entries.length - 1].notification);
        this._changed();
    }

    /** @param {any} notification */
    _untrack(notification) {
        const tracked = this._tracked.get(notification);
        if (!tracked)
            return;
        tracked.signals.clear();
        if (tracked.pending)
            this._timers.remove(tracked.pending);
        this._tracked.delete(notification);
        this._entries = this._entries.filter(entry => entry.notification !== notification);
        this._changed();
    }

    /**
     * The decision waits for an idle moment: on updates GNOME's notification daemon
     * emits the request before it has set the new urgency and actions.
     *
     * @param {any} notification
     * @param {any} source
     */
    _onRequestBanner(notification, source) {
        this._track(notification, source, false);
        const tracked = this._tracked.get(notification);
        if (!tracked)
            return;
        const acknowledged = tracked.acknowledgedWhenAdded ?? notification.acknowledged;
        tracked.acknowledgedWhenAdded = null;
        if (tracked.pending)
            return;
        tracked.pending = this._timers.timeout(0, () => {
            tracked.pending = 0;
            this._decide(notification, source, tracked, acknowledged);
        });
    }

    /**
     * @param {any} notification
     * @param {any} source
     * @param {Tracked} tracked
     * @param {boolean} acknowledged
     */
    _decide(notification, source, tracked, acknowledged) {
        const update = tracked.requested;
        tracked.requested = true;
        const decision = presentation({
            urgency: notification.urgency,
            acknowledged,
            appShowsBanners: source.policy?.showBanners !== false,
            doNotDisturb: this.doNotDisturb,
            autoExpand: this._autoExpand(),
        });
        if (decision !== 'transient')
            return;
        // Grouped by app name: GNOME makes one source per sending process, so two
        // notify-send calls from the same app are two sources.
        const sourceKey = source.title || 'unknown';
        const now = this._timers.now();
        // An update of the same notification is not another notification.
        const extra = update ? this._groups.peek(sourceKey, now) : this._groups.add(sourceKey, now);
        this._emit(notificationEvent({urgency: notification.urgency, key: tracked.key, sourceKey, extra}));
    }
}
