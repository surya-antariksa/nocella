// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Arbiter} from './arbiter.js';
import {BannerBlock} from './banner-block.js';
import {ClockTakeover} from './clock-takeover.js';
import {collapsedSize, surfaceSize} from './geometry.js';
import {Hotkey} from './hotkey.js';
import {MediaProvider} from './providers/media.js';
import {NotificationsProvider} from './providers/notifications.js';
import {State, StateMachine} from './state.js';
import {Duration, Size} from './tokens.js';
import {SegmentedControl} from './ui/components/segmented.js';
import {NotchSurface} from './ui/surface.js';
import {MediaPage, MediaTransient, mediaPeekLine} from './ui/views/media.js';
import {NotificationList, NotificationTransient} from './ui/views/notifications.js';
import {TodayPage} from './ui/views/today.js';
import {SignalGroup} from './util/signal-group.js';
import {TimerGroup} from './util/timer-group.js';

/** @typedef {import('./arbiter.js').NotchEvent} NotchEvent */
/** @typedef {import('./state.js').StateChange} StateChange */

/**
 * @typedef {object} Page
 * @property {any} actor
 * @property {() => void} show
 * @property {() => void} hide
 * @property {() => void} refresh
 * @property {() => void} destroy
 * @property {(light: boolean) => void} [setLight]
 */

/**
 * Transient kind and pinned view for each event type. The kind picks the size
 * (tokens.js `TransientSize`) and the view is opened when the transient is clicked.
 */
const EVENT_ROUTES = Object.freeze({
    'media-changed': {kind: 'media', view: 'media'},
    'media-status': {kind: 'media', view: 'media'},
    'notification': {kind: 'notification', view: 'today'},
});

/**
 * Wires the notch into GNOME Shell: chrome placement, clock, state machine, arbiter,
 * providers, views, input, and visibility.
 */
export class Nocella {
    /** @param {any} settings the extension's `Gio.Settings` */
    constructor(settings) {
        this._settings = settings;
        this._signals = new SignalGroup();
        this._timers = new TimerGroup();
        /** @type {any} */
        this._grab = null;
        /** @type {Map<string, Page>} */
        this._pinnedPages = new Map();
        /** @type {Map<string, Page>} */
        this._transientPages = new Map();
        /** @type {Page | null} */
        this._visiblePage = null;
        /** @type {string} */
        this._lastView = 'today';
        /** @type {Array<{start: () => void, stop: () => void}>} */
        this._providers = [];

        /** @type {any} */
        this._surface = null;
        /** @type {any} */
        this._state = null;
        /** @type {any} */
        this._arbiter = null;
        /** @type {any} */
        this._clockTakeover = null;
        /** @type {any} */
        this._wallClock = null;
        /** @type {any} */
        this._clockBinding = null;
        /** @type {any} */
        this._interfaceSettings = null;
        /** @type {any} */
        this._themeContext = null;
        /** @type {any} */
        this._hotkey = null;
        /** @type {any} */
        this._media = null;
        /** @type {any} */
        this._tabs = null;
        /** @type {any} */
        this._peekLabel = null;
        this._sleepWatchId = 0;
        /** @type {any} */
        this._notifications = null;
        /** @type {any} */
        this._notificationList = null;
        /** @type {any} */
        this._banner = null;
        /** @type {any} */
        this._a11ySettings = null;
        /** @type {any} */
        this._notificationSettings = null;
        /** @type {string | null} the notification transient on screen */
        this._shownNotification = null;
    }

    enable() {
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        this._arbiter = new Arbiter({now: () => this._timers.now()});
        this._state = new StateMachine({
            timers: this._timers,
            onChange: change => this._onStateChanged(change),
            nextTransient: () => this._arbiter.next(),
            idleCollapseMs: () => this._settings.get_int('idle-collapse-minutes') * 60000,
            canIdleCollapse: () => !this._media?.playing,
        });

        const surface = new NotchSurface({onClose: () => this._state.close()});
        this._surface = surface;
        this._tabs = new SegmentedControl(id => this._state.selectView(id));
        surface.setTabBar(this._tabs.actor);
        this._peekLabel = new St.Label({
            style_class: 'nocella-peek-line',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._signals.add(surface.actor,
            surface.actor.connect('button-press-event', (_actor, event) => this._onButtonPress(event)));
        this._signals.add(surface.actor,
            surface.actor.connect('notify::hover', () => this._onHoverChanged()));
        this._signals.add(surface.actor,
            surface.actor.connect('captured-event', (_actor, event) => this._onCapturedEvent(event)));
        this._signals.add(surface.actor,
            surface.actor.connect('key-press-event', (_actor, event) => this._onKeyPress(event)));

        // Visibility is owned by the state machine, not by trackFullscreen, so later
        // phases can keep bannerBlocked in sync with it (ADR 0004).
        Main.layoutManager.addChrome(surface.actor, {
            affectsInputRegion: true,
            affectsStruts: false,
            trackFullscreen: false,
        });

        this._wallClock = new GnomeDesktop.WallClock({time_only: true});
        this._clockBinding = this._wallClock.bind_property('clock',
            surface.clockLabel, 'text', GObject.BindingFlags.SYNC_CREATE);

        this._media = new MediaProvider({
            emit: event => this._onEvent(event),
            changed: () => this._refreshPages(['media']),
            autoExpand: () => this._settings.get_boolean('auto-expand-media'),
        });
        this._providers.push(this._media);
        this._notifications = new NotificationsProvider({
            emit: event => this._onEvent(event),
            changed: () => {
                // A notification closed elsewhere also ends its transient.
                const content = this._state?.content;
                if (content?.type === 'notification' && !this._notifications.find(content.payload.key))
                    this._state.close();
                this._refreshPages(['today', 'notification']);
                this._syncDot();
            },
            autoExpand: () => this._settings.get_boolean('auto-expand-notifications'),
        });
        this._providers.push(this._notifications);

        this._notificationList = new NotificationList({
            provider: this._notifications,
            onDone: () => this._state.close(),
        });
        this._addPinnedPage('today', new TodayPage({
            wallClock: this._wallClock,
            onLaunch: () => this._state.close(),
            notifications: this._notificationList,
        }));
        this._addPinnedPage('media', new MediaPage(this._media));
        this._transientPages.set('media', new MediaTransient(this._media));
        this._transientPages.set('notification', new NotificationTransient({
            provider: this._notifications,
            payload: () => this._state.content?.payload ?? null,
            onDone: () => this._state.close(),
        }));
        this._syncTabs();

        const relayout = () => this._applyGeometry(0);
        this._signals.add(Main.layoutManager,
            Main.layoutManager.connect('monitors-changed', () => {
                // A new primary monitor brings the notch back collapsed
                // (docs/04-interaksi.md, "Monitor").
                if (this._state.state !== State.SUPPRESSED)
                    this._state.close();
                relayout();
                // A new primary monitor can differ in fullscreen state without
                // in-fullscreen-changed being emitted.
                this._syncFullscreen();
            }));
        this._signals.add(Main.panel,
            Main.panel.connect('notify::height', relayout));
        this._signals.add(this._themeContext,
            this._themeContext.connect('notify::scale-factor', relayout));
        this._signals.add(this._interfaceSettings,
            this._interfaceSettings.connect('changed::clock-format', relayout));
        const stSettings = St.Settings.get();
        this._signals.add(stSettings,
            stSettings.connect('notify::color-scheme', () => this._syncTheme()));

        this._signals.add(global.display,
            global.display.connect('in-fullscreen-changed', () => this._syncFullscreen()));
        this._signals.add(Main.overview,
            Main.overview.connect('showing', () => {
                this._state.suppress('overview');
                this._syncBanner();
            }));
        this._signals.add(Main.overview,
            Main.overview.connect('hidden', () => {
                this._state.release('overview');
                this._syncBanner();
            }));
        this._signals.add(this._settings,
            this._settings.connect('changed::notch-enabled', () => this._syncEnabled()));

        // Banner takeover (ADR 0004): every input of the decision is watched.
        this._banner = new BannerBlock();
        this._a11ySettings = new Gio.Settings({schema_id: 'org.gnome.desktop.a11y.applications'});
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        const syncBanner = () => this._syncBanner();
        for (const key of ['intercept-banners', 'auto-expand-notifications'])
            this._signals.add(this._settings, this._settings.connect(`changed::${key}`, syncBanner));
        this._signals.add(this._a11ySettings,
            this._a11ySettings.connect('changed::screen-reader-enabled', syncBanner));
        this._signals.add(this._notificationSettings,
            this._notificationSettings.connect('changed::show-banners', syncBanner));

        this._hotkey = new Hotkey(this._settings, () => this._state.toggle(this._lastView));
        this._hotkey.enable();

        // After resume: back to collapsed and fresh provider connections
        // (docs/04-interaksi.md, "Edge case").
        try {
            this._sleepWatchId = Gio.DBus.system.signal_subscribe('org.freedesktop.login1',
                'org.freedesktop.login1.Manager', 'PrepareForSleep', '/org/freedesktop/login1', null,
                Gio.DBusSignalFlags.NONE, (_c, _s, _p, _i, _n, params) => {
                    const [sleeping] = params.deepUnpack();
                    if (!sleeping)
                        this._onResume();
                });
        } catch (e) {
            console.log(`[nocella] Suspend notifications are not available: ${e}`);
        }

        for (const provider of this._providers) {
            try {
                provider.start();
            } catch (e) {
                // A failing provider only loses its own feature (docs/02-arsitektur.md).
                console.warn(`[nocella] A provider failed to start: ${e}`);
            }
        }

        this._syncTheme();
        this._syncDot();
        relayout();
        this._syncFullscreen();
        if (Main.overview.visible)
            this._state.suppress('overview');

        // Hide the GNOME clock last, once the notch is in place (ADR 0003).
        this._clockTakeover = new ClockTakeover();
        this._syncEnabled();
        this._syncBanner();

        // Pages live hidden in the surface; measuring them once at idle keeps the first
        // click under the open-time target.
        surface.preload([this._peekLabel,
            ...[...this._pinnedPages.values(), ...this._transientPages.values()].map(page => page.actor)]);
        this._timers.timeout(0, () => {
            this._surface?.warmUp(Size.PINNED_WIDTH * this._themeContext.scale_factor);
        });
    }

    disable() {
        // GNOME banners come back first, so nothing is lost if anything below fails.
        if (this._banner) {
            try {
                this._banner.forgetShown(n => this._notifications?.wasShown(n) ?? false);
            } finally {
                this._banner.restore();
                this._banner = null;
            }
        }

        this._clockTakeover?.disable();
        this._clockTakeover = null;

        this._hotkey?.disable();
        this._hotkey = null;
        if (this._sleepWatchId) {
            Gio.DBus.system.signal_unsubscribe(this._sleepWatchId);
            this._sleepWatchId = 0;
        }

        // Stop the state timers, then drop the modal grab before the actor goes away.
        this._state?.destroy();
        this._releaseModal();
        this._signals.clear();

        for (const provider of this._providers) {
            try {
                provider.stop();
            } catch (e) {
                console.warn(`[nocella] A provider failed to stop: ${e}`);
            }
        }
        this._providers = [];
        this._media = null;
        this._notifications = null;
        // The list lives inside the today page and goes away with it.
        this._notificationList = null;
        this._a11ySettings = null;
        this._notificationSettings = null;

        this._visiblePage = null;
        this._surface?.setPage(null, false);
        for (const page of [...this._pinnedPages.values(), ...this._transientPages.values()])
            page.destroy();
        this._pinnedPages.clear();
        this._transientPages.clear();
        this._peekLabel?.destroy();
        this._peekLabel = null;
        this._tabs = null;

        this._clockBinding?.unbind();
        this._clockBinding = null;
        // Dispose now so the wall clock drops its minute timer without waiting for GC.
        this._wallClock?.run_dispose();
        this._wallClock = null;

        if (this._surface) {
            Main.layoutManager.removeChrome(this._surface.actor);
            this._surface.destroy();
            this._surface = null;
        }

        this._timers.clear();
        this._state = null;
        this._arbiter = null;
        this._interfaceSettings = null;
        this._themeContext = null;
    }

    _onResume() {
        this._state.close();
        for (const provider of this._providers) {
            try {
                provider.stop();
                provider.start();
            } catch (e) {
                console.log(`[nocella] A provider did not restart after resume: ${e}`);
            }
        }
    }

    /**
     * Shows an event as if a provider had sent it. For Looking Glass and the smoke test.
     *
     * @param {NotchEvent} event
     */
    debugEmit(event) {
        this._onEvent(event);
    }

    /**
     * @param {string} id
     * @param {Page} page
     */
    _addPinnedPage(id, page) {
        this._pinnedPages.set(id, page);
    }

    _syncTabs() {
        const segments = [
            {id: 'today', iconName: 'x-office-calendar-symbolic', label: _('Today')},
            {id: 'media', iconName: 'audio-x-generic-symbolic', label: _('Media')},
        ].filter(segment => this._pinnedPages.has(segment.id));
        this._tabs.setSegments(segments);
    }

    /**
     * Routes provider content: a badge while pinned or suppressed, otherwise the
     * arbiter decides whether it shows, updates the current transient, or waits.
     *
     * @param {NotchEvent} event
     */
    _onEvent(event) {
        const state = this._state?.state;
        if (!state)
            return;
        const route = EVENT_ROUTES[event.type];
        if (state === State.PINNED) {
            // New content never replaces the open view; its tab gets a dot instead.
            if (route)
                this._tabs.setDot(route.view, true);
            return;
        }
        if (state === State.SUPPRESSED)
            return;
        if (state !== State.TRANSIENT)
            this._arbiter.clear();

        const result = this._arbiter.push(event);
        if (result === 'show')
            this._state.showTransient(event);
        else if (result === 'update')
            this._state.updateTransient(event);
        else
            return;
        if (event.type === 'notification' && this._state.content === event)
            this._onNotificationShown(event.payload.key);
    }

    /**
     * A notification is on screen in the notch. GNOME only plays its sound when it shows
     * the banner itself, so with banners blocked the notch plays it.
     *
     * @param {string} key
     */
    _onNotificationShown(key) {
        const notification = this._notifications.find(key)?.notification;
        // Updates of a notification already on screen do not play the sound again.
        if (!notification || this._notifications.wasShown(notification))
            return;
        this._notifications.markShown(key);
        if (this._banner?.blocked)
            notification.playSound?.();
    }

    /** @param {StateChange} change */
    _onStateChanged({state, previous, content, view}) {
        if (state === State.COLLAPSED || state === State.PINNED)
            this._arbiter.clear();

        // A notification that leaves the screen expires if it was marked transient.
        const shownKey = content?.type === 'notification' ? content.payload.key : null;
        if (this._shownNotification && this._shownNotification !== shownKey)
            this._notifications?.expireIfTransient(this._shownNotification);
        this._shownNotification = shownKey;

        if (state === State.PINNED && view)
            this._lastView = view;
        if (previous === State.PINNED && state !== State.PINNED)
            this._releaseModal();

        const surface = this._surface;
        surface.actor.visible = state !== State.SUPPRESSED;

        /** @type {Page | null} */
        let page = null;
        let pageActor = null;
        switch (state) {
        case State.PEEK:
            this._peekLabel.text = this._peekText();
            pageActor = this._peekLabel;
            surface.setMode('peek', null);
            break;
        case State.TRANSIENT: {
            const kind = EVENT_ROUTES[content?.type ?? '']?.kind ?? null;
            page = kind ? this._transientPages.get(kind) ?? null : null;
            surface.setMode('transient', kind);
            break;
        }
        case State.PINNED:
            page = this._pinnedPages.get(view ?? 'today') ?? this._pinnedPages.get('today') ?? null;
            this._tabs.select(view, previous === State.PINNED);
            surface.setMode('pinned', null);
            break;
        default:
            surface.setMode('collapsed', null);
        }

        if (page !== this._visiblePage) {
            this._visiblePage?.hide();
            this._visiblePage = page;
            page?.show();
        } else {
            page?.refresh();
        }
        surface.setPage(page?.actor ?? pageActor, true);

        if (state === State.PINNED && previous !== State.PINNED)
            this._takeModal();
        this._syncDot();
        this._syncBanner();

        if (state === State.SUPPRESSED) {
            // Hidden at once with the collapsed size, so it comes back without shrinking.
            this._applyGeometry(0);
            return;
        }
        const opening = state !== State.COLLAPSED;
        if (opening)
            this._applyGeometry(Duration.OPEN_MS, Clutter.AnimationMode.EASE_OUT_QUINT);
        else
            this._applyGeometry(Duration.CLOSE_MS, Clutter.AnimationMode.EASE_IN_QUART);
    }

    /**
     * @param {string[]} ids pages whose data changed
     */
    _refreshPages(ids) {
        if (this._state?.state === State.PEEK && ids.includes('media')) {
            this._peekLabel.text = this._peekText();
            return;
        }
        if (!this._visiblePage)
            return;
        const visible = [...this._pinnedPages.entries(), ...this._transientPages.entries()]
            .filter(([id, page]) => page === this._visiblePage && ids.includes(id));
        if (visible.length === 0)
            return;
        this._visiblePage.refresh();
        // Content can change height (e.g. a track without artist); follow it gently.
        this._applyGeometry(Duration.CONTENT_FADE_MS, Clutter.AnimationMode.EASE_OUT_QUAD);
    }

    /** @returns {string} the one-line peek summary (docs/04-interaksi.md, "PEEK") */
    _peekText() {
        const media = this._media ? mediaPeekLine(this._media.snapshot()) : null;
        if (media)
            return media;
        const entries = this._notifications?.snapshot().entries ?? [];
        const latest = entries.find(entry => !entry.notification.acknowledged);
        if (latest) {
            const {notification, source} = latest;
            return `${source.title}: ${notification.title || notification.body || ''}`.trim();
        }
        const date = GLib.DateTime.new_now_local().format('%A, %e %B').replace(/\s+/g, ' ');
        return entries.length > 0
            ? `${date} · ${ngettext('%d notification', '%d notifications', entries.length).format(entries.length)}`
            : date;
    }

    /** @returns {string} the view a click opens from the current state */
    _viewForClick() {
        const state = this._state.state;
        if (state === State.TRANSIENT)
            return EVENT_ROUTES[this._state.content?.type ?? '']?.view ?? 'today';
        if (state === State.PEEK && this._media && mediaPeekLine(this._media.snapshot()))
            return 'media';
        return 'today';
    }

    /**
     * @param {any} event a `Clutter.Event`
     * @returns {boolean}
     */
    _onButtonPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;
        // Inside the open panel, clicks belong to its controls.
        if (this._state.state === State.PINNED) {
            this._state.interaction();
            return Clutter.EVENT_PROPAGATE;
        }
        this._state.click(this._viewForClick());
        return Clutter.EVENT_STOP;
    }

    _onHoverChanged() {
        if (this._surface.actor.hover)
            this._state.hoverEnter();
        else
            this._state.hoverLeave();
    }

    /**
     * While pinned the panel holds a modal grab, so every press reaches it; a press
     * outside the panel closes it like a macOS popover.
     *
     * @param {any} event
     * @returns {boolean}
     */
    _onCapturedEvent(event) {
        if (this._state.state !== State.PINNED || !this._grab)
            return Clutter.EVENT_PROPAGATE;
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        const actor = this._surface.actor;
        const [ax, ay] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        if (x >= ax && x < ax + width && y >= ay && y < ay + height) {
            // Buttons swallow their presses, so idle time is reset here, before them.
            this._state.interaction();
            return Clutter.EVENT_PROPAGATE;
        }
        this._state.close();
        return Clutter.EVENT_STOP;
    }

    /**
     * @param {any} event
     * @returns {boolean}
     */
    _onKeyPress(event) {
        if (this._state.state !== State.PINNED)
            return Clutter.EVENT_PROPAGATE;
        this._state.interaction();
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this._state.close();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Tab || symbol === Clutter.KEY_ISO_Left_Tab) {
            const backward = symbol === Clutter.KEY_ISO_Left_Tab ||
                (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            const focus = global.stage.get_key_focus();
            this._surface.actor.navigate_focus(focus,
                backward ? St.DirectionType.TAB_BACKWARD : St.DirectionType.TAB_FORWARD, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _takeModal() {
        if (this._grab)
            return;
        this._grab = Main.pushModal(this._surface.actor, {actionMode: Shell.ActionMode.POPUP});
        // Focus starts at the tabs (docs/03-desain-visual.md, "Aksesibilitas").
        const first = this._tabs.selectedButton ?? this._surface.closeButton;
        first?.grab_key_focus();
    }

    _releaseModal() {
        if (!this._grab)
            return;
        const grab = this._grab;
        this._grab = null;
        try {
            Main.popModal(grab);
        } catch (e) {
            console.warn(`[nocella] Could not release the modal grab: ${e}`);
        }
    }

    /**
     * @param {number} duration milliseconds
     * @param {number} [mode] a `Clutter.AnimationMode`
     */
    _applyGeometry(duration, mode = Clutter.AnimationMode.LINEAR) {
        const monitor = Main.layoutManager.primaryMonitor;
        const surface = this._surface;
        if (!monitor || !surface)
            return;

        const scaleFactor = this._themeContext.scale_factor;
        const collapsed = collapsedSize({
            scaleFactor,
            panelHeight: Main.panel.height,
            use12h: this._interfaceSettings.get_string('clock-format') === '12h',
        });
        surface.setHeaderHeight(collapsed.height);

        const kind = EVENT_ROUTES[this._state.content?.type ?? '']?.kind;
        const params = {mode: surface.mode, kind, scaleFactor, collapsed, monitor};
        let size = surfaceSize(params);
        if (surface.mode !== 'collapsed')
            size = surfaceSize({...params, naturalHeight: surface.naturalHeight(size.width)});
        surface.moveTo(monitor, size, duration, mode);
    }

    /** Suppression can change without a state change (pinned over fullscreen). */
    _syncFullscreen() {
        if (Main.layoutManager.primaryMonitor?.inFullscreen)
            this._state.suppress('fullscreen');
        else
            this._state.release('fullscreen');
        this._syncBanner();
    }

    /** `notch-enabled` off hides the notch and gives the GNOME clock back. */
    _syncEnabled() {
        if (this._settings.get_boolean('notch-enabled')) {
            this._state.release('disabled');
            this._clockTakeover.enable();
        } else {
            this._state.suppress('disabled');
            this._clockTakeover.disable();
        }
        this._syncBanner();
    }

    _syncTheme() {
        // GNOME Settings writes `default` for its light style and `prefer-dark` for dark.
        const light = St.Settings.get().color_scheme !== St.SystemColorScheme.PREFER_DARK;
        this._surface.setLight(light);
        for (const page of this._pinnedPages.values())
            page.setLight?.(light);
    }

    /**
     * Whether GNOME's banners are blocked (ADR 0004, "Aturan state"): only while the
     * notch is visible and able to show notifications, and never with a screen reader,
     * during do not disturb (GNOME keeps applying its own critical rules), or with the
     * takeover turned off. Unblocking first drops what the notch already showed from
     * GNOME's queue, so nothing is shown twice.
     */
    _syncBanner() {
        if (!this._banner)
            return;
        const state = this._state.state;
        const blocked = this._settings.get_boolean('intercept-banners') &&
            this._settings.get_boolean('auto-expand-notifications') &&
            !this._a11ySettings.get_boolean('screen-reader-enabled') &&
            this._notificationSettings.get_boolean('show-banners') &&
            state !== State.SUPPRESSED && !this._state.pinnedOverSuppression;
        if (!blocked)
            this._banner.forgetShown(n => this._notifications.wasShown(n));
        this._banner.set(blocked);
    }

    /** Status dot: red or orange for unread notifications, gray when idle. */
    _syncDot() {
        this._surface?.setDot(this._notifications?.snapshot().badge ?? null);
    }
}
