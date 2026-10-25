// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {centeredX} from '../geometry.js';
import {Duration} from '../tokens.js';
import {iconButton} from './components/icon-button.js';

/** @typedef {'collapsed' | 'peek' | 'transient' | 'pinned'} SurfaceMode */

const DOT_COLORS = ['accent', 'success', 'warning', 'danger'];

/**
 * @param {any} actor an `St.Widget`
 * @param {string} name
 * @param {boolean} enabled
 */
function setStyleClass(actor, name, enabled) {
    if (enabled)
        actor.add_style_class_name(name);
    else
        actor.remove_style_class_name(name);
}

/**
 * The notch actor: a header that always holds the clock, a tab bar for the pinned
 * panel, and a body that shows one page at a time. Owns size, position, and material;
 * knows nothing about data providers.
 */
export class NotchSurface {
    /**
     * @param {object} params
     * @param {() => void} params.onClose the close button of the pinned panel
     */
    constructor({onClose}) {
        this.actor = new St.BoxLayout({
            name: 'nocella',
            style_class: 'nocella',
            vertical: true,
            reactive: true,
            track_hover: true,
            // No clip_to_allocation: it would also cut off the panel's outer shadow.
            accessible_name: _('Notch'),
        });

        this._header = new St.Widget({
            style_class: 'nocella-header',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
        });
        this.actor.add_child(this._header);

        // BinLayout centers the label through its align properties. No x/y_expand here:
        // Clutter propagates expand flags to the parent, and an expanding header would
        // grow with the panel and push the clock down.
        this.clockLabel = new St.Label({
            style_class: 'nocella-clock',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._header.add_child(this.clockLabel);

        // BinLayout only honors x_align END together with x_expand. The header already
        // expands horizontally, so this does not change its size.
        this._dot = new St.Widget({
            style_class: 'nocella-dot',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._header.add_child(this._dot);

        this._closeButton = iconButton({
            iconName: 'pan-up-symbolic',
            accessibleName: _('Close'),
            onClick: onClose,
        });
        this._closeButton.x_expand = true;
        this._closeButton.x_align = Clutter.ActorAlign.END;
        this._closeButton.y_align = Clutter.ActorAlign.CENTER;
        this._header.add_child(this._closeButton);

        this._tabBar = new St.Bin({style_class: 'nocella-tabbar', x_expand: true});
        this.actor.add_child(this._tabBar);

        this._body = new St.Widget({
            style_class: 'nocella-content',
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._body);

        /** @type {any} */
        this._page = null;
        /** @type {SurfaceMode} */
        this._mode = 'collapsed';
        /** @type {string | null} */
        this._kind = null;
        this.setMode('collapsed', null);
    }

    /** @returns {SurfaceMode} */
    get mode() {
        return this._mode;
    }

    /** @returns {any} the close button, for keyboard focus */
    get closeButton() {
        return this._closeButton;
    }

    /** @param {any} actor the segmented control */
    setTabBar(actor) {
        this._tabBar.set_child(actor);
    }

    /**
     * Switches material and chrome: collapsed is the black notch (level 0), peek and
     * transients use level 1, and the pinned panel level 2.
     *
     * @param {SurfaceMode} mode
     * @param {string | null} kind transient kind, for its corner radius
     */
    setMode(mode, kind) {
        this._mode = mode;
        const level1 = mode === 'peek' || mode === 'transient';
        setStyleClass(this.actor, 'peek', level1);
        setStyleClass(this.actor, 'expanded', mode === 'pinned');
        if (this._kind)
            this.actor.remove_style_class_name(`kind-${this._kind}`);
        this._kind = mode === 'transient' ? kind : null;
        if (this._kind)
            this.actor.add_style_class_name(`kind-${this._kind}`);

        // A transient replaces the clock with its content, like the Dynamic Island.
        this._header.visible = mode !== 'transient';
        this._closeButton.visible = mode === 'pinned';
        this._dot.visible = mode === 'collapsed';
        this._tabBar.visible = mode === 'pinned' && this._tabBar.child !== null;
    }

    /**
     * Status dot in the collapsed notch: gray when idle, or a status color.
     *
     * @param {string | null} color `accent`, `success`, `warning`, `danger`, or null for gray
     */
    setDot(color) {
        for (const name of DOT_COLORS)
            setStyleClass(this._dot, name, name === color);
    }

    /** @param {boolean} light the pinned panel follows the light theme */
    setLight(light) {
        setStyleClass(this.actor, 'light', light);
    }

    /**
     * Shows `page` in the body. The previous page is only removed, not destroyed, so the
     * next opening is fast. The new one fades in after a short delay, so text never
     * changes while the size animates (docs/03-desain-visual.md, "Motion").
     *
     * @param {any} page an actor, or null for an empty body
     * @param {boolean} animate
     */
    setPage(page, animate) {
        if (page === this._page)
            return;
        if (this._page)
            this._body.remove_child(this._page);
        this._page = page;
        if (!page)
            return;
        this._body.add_child(page);
        page.remove_transition('opacity');
        if (animate) {
            page.opacity = 0;
            page.ease({
                opacity: 255,
                delay: Duration.CONTENT_DELAY_MS,
                duration: Duration.CONTENT_FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            page.opacity = 255;
        }
    }

    /** @returns {any} */
    get page() {
        return this._page;
    }

    /**
     * Keeps the header as tall as the collapsed notch, so the clock does not move when
     * the panel opens.
     *
     * @param {number} height device pixels
     */
    setHeaderHeight(height) {
        this._header.height = height;
    }

    /**
     * Height the content needs at `width`, in device pixels. The actor's own preferred
     * height is not usable: its height is set explicitly while it animates.
     *
     * @param {number} width device pixels
     * @returns {number}
     */
    naturalHeight(width) {
        const node = this.actor.get_theme_node();
        const inner = Math.max(0, width - node.get_horizontal_padding());
        let height = node.get_vertical_padding();
        for (const child of [this._header, this._tabBar, this._body]) {
            if (child.visible)
                height += child.get_preferred_height(inner)[1];
        }
        return height;
    }

    /**
     * Resizes the surface and keeps it centered at the top edge of `monitor`. `x` is
     * eased together with `width`, so the center stays fixed during the animation.
     *
     * @param {import('../geometry.js').Rect} monitor
     * @param {import('../geometry.js').Dimensions} size device pixels
     * @param {number} duration milliseconds; 0 applies the change immediately
     * @param {number} mode a `Clutter.AnimationMode`
     */
    moveTo(monitor, size, duration, mode) {
        this.actor.ease({
            x: centeredX(monitor, size.width),
            y: monitor.y,
            width: size.width,
            height: size.height,
            duration,
            mode,
        });
    }

    destroy() {
        this._page = null;
        this.actor.destroy();
    }
}
