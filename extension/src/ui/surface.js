// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {centeredX} from '../geometry.js';

/**
 * The notch actor: a header that always holds the clock, and a body for the pinned
 * views. Owns size, position, and material; knows nothing about data providers.
 */
export class NotchSurface {
    constructor() {
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

        // Empty until the pinned views arrive in later phases.
        this._body = new St.Widget({
            style_class: 'nocella-body',
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._body);
    }

    /**
     * Switches between the collapsed notch material and the pinned panel material.
     *
     * @param {boolean} expanded
     */
    setExpanded(expanded) {
        if (expanded)
            this.actor.add_style_class_name('expanded');
        else
            this.actor.remove_style_class_name('expanded');
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
        this.actor.destroy();
    }
}
