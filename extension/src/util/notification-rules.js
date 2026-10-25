// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Pure rules for notifications (docs/05-fitur.md, "Notifikasi"; docs/04-interaksi.md).

/** Values of `MessageTray.Urgency` in GNOME Shell 46. */
export const Urgency = Object.freeze({LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3});

/** Notifications from the same app within this window share one card. */
export const GROUP_WINDOW_MS = 3000;

/**
 * Whether a notification that asks for a banner becomes a transient in the notch.
 *
 * @param {object} params
 * @param {number} params.urgency
 * @param {boolean} params.acknowledged already read
 * @param {boolean} params.appShowsBanners the per-app GNOME policy
 * @param {boolean} params.doNotDisturb `show-banners` is off
 * @param {boolean} params.autoExpand `auto-expand-notifications`
 * @returns {'transient' | 'badge' | 'none'} `badge`: listed and counted, not shown
 */
export function presentation({urgency, acknowledged, appShowsBanners, doNotDisturb, autoExpand}) {
    if (acknowledged)
        return 'none';
    if (urgency === Urgency.LOW || doNotDisturb || !autoExpand)
        return 'badge';
    if (!appShowsBanners && urgency !== Urgency.CRITICAL)
        return 'badge';
    return 'transient';
}

/**
 * The arbiter event for a notification. Critical ones stay up to 60 s and never merge;
 * others merge per app.
 *
 * @param {object} params
 * @param {number} params.urgency
 * @param {string} params.key unique per notification
 * @param {string} params.sourceKey unique per app source
 * @param {number} params.extra other notifications merged into this card
 * @returns {import('../arbiter.js').NotchEvent}
 */
export function notificationEvent({urgency, key, sourceKey, extra}) {
    const critical = urgency === Urgency.CRITICAL;
    return {
        type: 'notification',
        priority: critical ? 100 : 90,
        ttl: critical ? 60000 : 6000,
        coalesceKey: critical ? `notification:${key}` : `app:${sourceKey}`,
        payload: {key, extra, critical},
    };
}

/**
 * Counts notifications of one app that arrive close together, for "+N more".
 */
export class GroupCounter {
    constructor() {
        /** @type {Map<string, {start: number, count: number}>} */
        this._groups = new Map();
    }

    /**
     * @param {string} sourceKey
     * @param {number} nowMs
     * @returns {number} how many earlier notifications this one joins (0 for a new card)
     */
    add(sourceKey, nowMs) {
        const group = this._groups.get(sourceKey);
        if (group && nowMs - group.start <= GROUP_WINDOW_MS) {
            group.count++;
            return group.count - 1;
        }
        this._groups.set(sourceKey, {start: nowMs, count: 1});
        return 0;
    }

    /**
     * The current "+N" of an app's group without counting a new notification, for
     * updates of a notification already shown.
     *
     * @param {string} sourceKey
     * @param {number} nowMs
     * @returns {number}
     */
    peek(sourceKey, nowMs) {
        const group = this._groups.get(sourceKey);
        return group && nowMs - group.start <= GROUP_WINDOW_MS ? group.count - 1 : 0;
    }

    clear() {
        this._groups.clear();
    }
}

/**
 * Splits an age into the unit used in the UI ("now", "5 min", "2 h", "3 d").
 *
 * @param {number} seconds
 * @returns {{unit: 'now' | 'minutes' | 'hours' | 'days', value: number}}
 */
export function relativeAge(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60)
        return {unit: 'now', value: 0};
    if (s < 3600)
        return {unit: 'minutes', value: Math.floor(s / 60)};
    if (s < 86400)
        return {unit: 'hours', value: Math.floor(s / 3600)};
    return {unit: 'days', value: Math.floor(s / 86400)};
}

/**
 * Badge color from unread notifications: red for critical, orange otherwise.
 *
 * @param {Array<{urgency: number, acknowledged: boolean}>} notifications
 * @returns {'danger' | 'warning' | null}
 */
export function unreadBadge(notifications) {
    let color = null;
    for (const n of notifications) {
        if (n.acknowledged)
            continue;
        if (n.urgency === Urgency.CRITICAL)
            return 'danger';
        color = 'warning';
    }
    return color;
}
