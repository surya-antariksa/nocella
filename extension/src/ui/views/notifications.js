// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {relativeAge} from '../../util/notification-rules.js';
import {pillButton} from '../components/icon-button.js';

/** @typedef {import('../../providers/notifications.js').NotificationsProvider} NotificationsProvider */
/** @typedef {import('../../providers/notifications.js').NotificationEntry} NotificationEntry */

/** Cards shown in the "Today" list before "Show all" (docs/05-fitur.md). */
const LIST_PREVIEW = 5;
/** Actions shown on a card; the rest stay in GNOME's own list. */
const MAX_ACTIONS = 2;

/**
 * @param {string} styleClass
 * @param {string} text
 * @returns {any}
 */
function label(styleClass, text = '') {
    const result = new St.Label({style_class: styleClass, text, x_expand: true});
    result.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return result;
}

/**
 * @param {any} datetime a `GLib.DateTime`
 * @returns {string}
 */
export function ageText(datetime) {
    const seconds = datetime ? GLib.DateTime.new_now_local().to_unix() - datetime.to_unix() : 0;
    const {unit, value} = relativeAge(seconds);
    switch (unit) {
    case 'minutes':
        return ngettext('%d min', '%d min', value).format(value);
    case 'hours':
        return ngettext('%d h', '%d h', value).format(value);
    case 'days':
        return ngettext('%d d', '%d d', value).format(value);
    default:
        return _('now');
    }
}

/**
 * Plain text of a notification body; markup is stripped, not rendered.
 *
 * @param {any} notification
 * @returns {string}
 */
function bodyText(notification) {
    const body = notification.body ?? '';
    let plain = body;
    if (notification.useBodyMarkup) {
        // Pango decodes entities such as &amp; as well; broken markup falls back to
        // dropping the tags.
        try {
            plain = Pango.parse_markup(body, -1, '')[2];
        } catch {
            plain = body.replace(/<[^>]*>/g, '');
        }
    }
    return plain.replace(/\s+/g, ' ').trim();
}

/**
 * A notification card: app icon, app name and age, title, one line of body, and up to
 * two action pills (docs/03-desain-visual.md, "Notifikasi").
 *
 * @param {object} params
 * @param {NotificationEntry} params.entry
 * @param {NotificationsProvider} params.provider
 * @param {number} [params.extra] merged notifications, shown as "+N more"
 * @param {boolean} [params.clickable] the card activates the notification
 * @param {() => void} [params.onDone] after a click was handled
 * @param {any[]} [params.actionButtons] receives the action pills, for focus and tests
 * @returns {any}
 */
export function notificationCard({entry, provider, extra = 0, clickable = false, onDone = () => {},
    actionButtons = []}) {
    const {notification, source, key} = entry;
    const content = new St.BoxLayout({style_class: 'nocella-row', x_expand: true});
    const card = clickable
        ? new St.Button({
            style_class: 'nocella-card clickable',
            can_focus: true,
            track_hover: true,
            x_expand: true,
            child: content,
            accessible_name: notification.title || source.title || _('Notification'),
        })
        : new St.Bin({style_class: 'nocella-card', x_expand: true, child: content});
    if (clickable) {
        card.connect('clicked', () => {
            provider.activate(key);
            onDone();
        });
    }

    content.add_child(new St.Icon({
        gicon: notification.gicon ?? source.icon ?? null,
        fallback_icon_name: 'dialog-information-symbolic',
        icon_size: 28,
        y_align: Clutter.ActorAlign.START,
    }));

    const text = new St.BoxLayout({style_class: 'nocella-stack', vertical: true, x_expand: true});
    const top = new St.BoxLayout({x_expand: true});
    top.add_child(label('nocella-caption', source.title ?? ''));
    const age = new St.Label({style_class: 'nocella-caption', text: ageText(notification.datetime)});
    top.add_child(age);
    text.add_child(top);
    // Notifications without a title show the app name instead (docs/04-interaksi.md).
    text.add_child(label('nocella-title', notification.title || source.title || ''));
    const body = bodyText(notification);
    if (body)
        text.add_child(label('nocella-secondary', body));
    if (extra > 0) {
        text.add_child(label('nocella-caption',
            ngettext('+%d more notification', '+%d more notifications', extra).format(extra)));
    }

    const actions = notification.actions.slice(0, MAX_ACTIONS);
    if (actions.length > 0) {
        const row = new St.BoxLayout({style_class: 'nocella-row', x_align: Clutter.ActorAlign.START});
        actions.forEach((action, index) => {
            const button = pillButton({
                label: action.label,
                primary: index === 0,
                onClick: () => {
                    provider.invokeAction(key, index);
                    onDone();
                },
            });
            actionButtons.push(button);
            row.add_child(button);
        });
        text.add_child(row);
    }
    content.add_child(text);
    return card;
}

/** The transient for a new notification, 420x92. */
export class NotificationTransient {
    /**
     * @param {object} params
     * @param {NotificationsProvider} params.provider
     * @param {() => any} params.payload the payload of the content on screen
     * @param {() => void} params.onDone a card action was used; the notch closes
     */
    constructor({provider, payload, onDone}) {
        this._provider = provider;
        this._payload = payload;
        this._onDone = onDone;
        this.actor = new St.Bin({style_class: 'nocella-transient', x_expand: true});
        /** @type {any[]} */
        this.actionButtons = [];
    }

    show() {
        this.refresh();
    }

    hide() {}

    refresh() {
        const payload = this._payload();
        const entry = payload ? this._provider.find(payload.key) : null;
        this.actor.child?.destroy();
        this.actionButtons = [];
        if (!entry)
            return;
        this.actor.set_child(notificationCard({
            entry,
            provider: this._provider,
            extra: payload.extra,
            onDone: this._onDone,
            actionButtons: this.actionButtons,
        }));
    }

    destroy() {
        this.actor.destroy();
    }
}

/**
 * The notification list inside "Today": the newest five, "Clear", and "Show all", which
 * builds a scrollable list of up to 50 only when asked for.
 */
export class NotificationList {
    /**
     * @param {object} params
     * @param {NotificationsProvider} params.provider
     * @param {() => void} params.onDone a notification was activated; the panel closes
     */
    constructor({provider, onDone}) {
        this._provider = provider;
        this._onDone = onDone;
        this._expanded = false;
        this._visible = false;
        this._rendered = '';

        this.actor = new St.BoxLayout({style_class: 'nocella-stack', vertical: true, x_expand: true});
        const header = new St.BoxLayout({style_class: 'nocella-row', x_expand: true});
        header.add_child(label('nocella-title', _('Notifications')));
        this._clear = pillButton({label: _('Clear'), onClick: () => provider.clearAll()});
        header.add_child(this._clear);
        this.actor.add_child(header);

        this._empty = new St.Label({style_class: 'nocella-empty', text: _('No notifications')});
        this.actor.add_child(this._empty);
        // The list scrolls inside a fixed area, so the panel does not grow past the
        // screen; "Show all" only adds more cards to it.
        this._cards = new St.BoxLayout({style_class: 'nocella-page-list', vertical: true, x_expand: true});
        this._scroll = new St.ScrollView({
            style_class: 'nocella-scroll',
            x_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._cards,
        });
        this.actor.add_child(this._scroll);
        this._more = pillButton({
            label: _('Show all'),
            onClick: () => {
                this._expanded = true;
                this.refresh();
            },
        });
        this._more.x_align = Clutter.ActorAlign.CENTER;
        this.actor.add_child(this._more);
    }

    show() {
        this._visible = true;
        this._expanded = false;
        this.refresh();
        // Opening the list is reading it, as with GNOME's message list.
        this._provider.acknowledgeAll();
    }

    hide() {
        this._visible = false;
        this._expanded = false;
        this._cards.destroy_all_children();
        this._rendered = '';
    }

    refresh() {
        if (!this._visible)
            return;
        const {entries} = this._provider.snapshot();
        this._empty.visible = entries.length === 0;
        this._clear.visible = entries.length > 0;
        this._scroll.visible = entries.length > 0;
        this._more.visible = !this._expanded && entries.length > LIST_PREVIEW;

        const shown = this._expanded ? entries : entries.slice(0, LIST_PREVIEW);
        // Rebuild only when the list or a notification's text changed, not on every
        // acknowledgement.
        const rendered = shown.map(({key, notification: n}) => `${key}:${n.title}:${n.body}`).join('\n');
        if (rendered === this._rendered)
            return;
        this._rendered = rendered;
        this._cards.destroy_all_children();
        for (const entry of shown) {
            this._cards.add_child(notificationCard({
                entry,
                provider: this._provider,
                clickable: true,
                onDone: this._onDone,
            }));
        }
    }

    destroy() {
        this.actor.destroy();
    }
}
