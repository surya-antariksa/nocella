// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {Size} from './tokens.js';

/**
 * @typedef {object} Rect
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {object} Dimensions
 * @property {number} width
 * @property {number} height
 */

/**
 * Left edge that centers `width` horizontally on `monitor`, in whole pixels.
 *
 * @param {Rect} monitor
 * @param {number} width
 * @returns {number}
 */
export function centeredX(monitor, width) {
    return Math.round(monitor.x + (monitor.width - width) / 2);
}

/**
 * Collapsed notch size in device pixels. The height follows the GNOME panel so the
 * notch sits flush with it; `panelHeight` is already in device pixels.
 *
 * @param {object} params
 * @param {number} params.scaleFactor
 * @param {number} params.panelHeight 0 when the panel is not allocated yet
 * @param {boolean} params.use12h
 * @returns {Dimensions}
 */
export function collapsedSize({scaleFactor, panelHeight, use12h}) {
    const width = use12h ? Size.COLLAPSED_WIDTH_12H : Size.COLLAPSED_WIDTH;
    const height = panelHeight > 0
        ? panelHeight
        : Size.PANEL_HEIGHT_FALLBACK * scaleFactor;
    return {width: width * scaleFactor, height};
}

/**
 * Pinned panel size in device pixels.
 *
 * @param {object} params
 * @param {number} params.scaleFactor
 * @returns {Dimensions}
 */
export function pinnedSize({scaleFactor}) {
    return {
        width: Size.PINNED_WIDTH * scaleFactor,
        height: Size.PINNED_HEIGHT * scaleFactor,
    };
}
