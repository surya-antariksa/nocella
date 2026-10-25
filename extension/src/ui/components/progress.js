// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * Fills a rounded rectangle on a Cairo context.
 *
 * @param {any} cr
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} radius
 */
export function roundedRect(cr, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    cr.newSubPath();
    cr.arc(x + width - r, y + r, r, -Math.PI / 2, 0);
    cr.arc(x + width - r, y + height - r, r, 0, Math.PI / 2);
    cr.arc(x + r, y + height - r, r, Math.PI / 2, Math.PI);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.closePath();
    cr.fill();
}

/**
 * A thin progress bar drawn with Cairo: a translucent track and an accent fill.
 * Repaints only when the value changes.
 */
export class ProgressBar {
    /**
     * @param {object} [params]
     * @param {number} [params.height] logical pixels
     */
    constructor({height = 3} = {}) {
        this._fraction = 0;
        this._light = false;
        this.actor = new St.DrawingArea({
            style: `height: ${height}px;`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.connect('repaint', area => this._repaint(area));
    }

    /** @param {number} fraction 0..1 */
    setFraction(fraction) {
        const value = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
        // Sub-pixel changes are invisible; skip the repaint.
        if (Math.abs(value - this._fraction) * Math.max(1, this.actor.width) < 0.25)
            return;
        this._fraction = value;
        this.actor.queue_repaint();
    }

    /** @param {boolean} light */
    setLight(light) {
        if (this._light === light)
            return;
        this._light = light;
        this.actor.queue_repaint();
    }

    /** @param {any} area */
    _repaint(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        const radius = height / 2;
        if (this._light)
            cr.setSourceRGBA(0, 0, 0, 0.10);
        else
            cr.setSourceRGBA(1, 1, 1, 0.14);
        roundedRect(cr, 0, 0, width, height, radius);
        if (this._fraction > 0) {
            cr.setSourceRGBA(10 / 255, 132 / 255, 1, 1);
            roundedRect(cr, 0, 0, Math.max(height, width * this._fraction), height, radius);
        }
        cr.$dispose();
    }
}
