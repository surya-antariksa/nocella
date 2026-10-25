// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClockTakeover} from './clock-takeover.js';
import {collapsedSize, pinnedSize} from './geometry.js';
import {Duration} from './tokens.js';
import {NotchSurface} from './ui/surface.js';
import {SignalGroup} from './util/signal-group.js';

/**
 * Wires the notch surface into GNOME Shell: chrome placement, clock, layout changes,
 * and visibility. Phase 1 only: a click toggles between the collapsed notch and an
 * empty pinned panel. The state machine replaces this toggle in phase 2.
 */
export class Nocella {
    constructor() {
        this._signals = new SignalGroup();
        /** @type {Set<string>} */
        this._suppressReasons = new Set();
        this._expanded = false;

        /** @type {NotchSurface | null} */
        this._surface = null;
        /** @type {ClockTakeover | null} */
        this._clockTakeover = null;
        /** @type {any} */
        this._wallClock = null;
        /** @type {any} */
        this._clockBinding = null;
        /** @type {any} */
        this._interfaceSettings = null;
        /** @type {any} */
        this._themeContext = null;
    }

    enable() {
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);

        const surface = new NotchSurface();
        this._surface = surface;
        this._signals.add(surface.actor,
            surface.actor.connect('button-press-event', (_actor, event) => this._onButtonPress(event)));

        // Visibility is owned here, not by trackFullscreen, so later phases can keep
        // bannerBlocked in sync with it (ADR 0004).
        Main.layoutManager.addChrome(surface.actor, {
            affectsInputRegion: true,
            affectsStruts: false,
            trackFullscreen: false,
        });

        this._wallClock = new GnomeDesktop.WallClock({time_only: true});
        this._clockBinding = this._wallClock.bind_property('clock',
            surface.clockLabel, 'text', GObject.BindingFlags.SYNC_CREATE);

        const relayout = () => this._applyGeometry(0);
        this._signals.add(Main.layoutManager,
            Main.layoutManager.connect('monitors-changed', () => {
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

        this._signals.add(global.display,
            global.display.connect('in-fullscreen-changed', () => this._syncFullscreen()));
        this._signals.add(Main.overview,
            Main.overview.connect('showing', () => this._suppress('overview')));
        this._signals.add(Main.overview,
            Main.overview.connect('hidden', () => this._release('overview')));

        relayout();
        this._syncFullscreen();
        if (Main.overview.visible)
            this._suppress('overview');

        // Hide the GNOME clock last, once the notch is in place (ADR 0003).
        this._clockTakeover = new ClockTakeover();
        this._clockTakeover.enable();
    }

    disable() {
        this._clockTakeover?.disable();
        this._clockTakeover = null;

        this._signals.clear();

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

        this._suppressReasons.clear();
        this._expanded = false;
        this._interfaceSettings = null;
        this._themeContext = null;
    }

    /**
     * @param {any} event a `Clutter.Event`
     * @returns {boolean}
     */
    _onButtonPress(event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        this._setExpanded(!this._expanded, true);
        return Clutter.EVENT_STOP;
    }

    /**
     * @param {boolean} expanded
     * @param {boolean} animate
     */
    _setExpanded(expanded, animate) {
        this._expanded = expanded;
        this._surface?.setExpanded(expanded);

        if (!animate)
            this._applyGeometry(0);
        else if (expanded)
            this._applyGeometry(Duration.OPEN_MS, Clutter.AnimationMode.EASE_OUT_QUINT);
        else
            this._applyGeometry(Duration.CLOSE_MS, Clutter.AnimationMode.EASE_IN_QUART);
    }

    /**
     * @param {number} duration milliseconds
     * @param {number} [mode] a `Clutter.AnimationMode`
     */
    _applyGeometry(duration, mode = Clutter.AnimationMode.LINEAR) {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || !this._surface)
            return;

        const scaleFactor = this._themeContext.scale_factor;
        const collapsed = collapsedSize({
            scaleFactor,
            panelHeight: Main.panel.height,
            use12h: this._interfaceSettings.get_string('clock-format') === '12h',
        });
        const size = this._expanded ? pinnedSize({scaleFactor}) : collapsed;

        this._surface.setHeaderHeight(collapsed.height);
        this._surface.moveTo(monitor, size, duration, mode);
    }

    _syncFullscreen() {
        if (Main.layoutManager.primaryMonitor?.inFullscreen)
            this._suppress('fullscreen');
        else
            this._release('fullscreen');
    }

    /**
     * Hides the notch for as long as at least one reason is active. Fullscreen and the
     * overview can overlap, hence a set instead of a flag.
     *
     * @param {string} reason
     */
    _suppress(reason) {
        this._suppressReasons.add(reason);
        if (this._expanded)
            this._setExpanded(false, false);
        this._surface?.actor.hide();
    }

    /**
     * Shows the notch again, always collapsed, once no reason is left.
     *
     * @param {string} reason
     */
    _release(reason) {
        this._suppressReasons.delete(reason);
        if (this._suppressReasons.size === 0)
            this._surface?.actor.show();
    }
}
