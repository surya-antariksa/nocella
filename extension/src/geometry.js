// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {Size, TransientSize} from './tokens.js';

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

/**
 * Size of the surface for a state, in device pixels. Heights grow to fit the content
 * (`naturalHeight`, e.g. with large text) but never shrink below the design size, and
 * the width never exceeds the monitor minus a margin.
 *
 * @param {object} params
 * @param {'collapsed' | 'peek' | 'transient' | 'pinned'} params.mode
 * @param {string} [params.kind] transient kind, a key of `TransientSize`
 * @param {number} params.scaleFactor
 * @param {Dimensions} params.collapsed from `collapsedSize()`
 * @param {number} [params.naturalHeight] device pixels the content asks for
 * @param {Rect} params.monitor
 * @returns {Dimensions}
 */
export function surfaceSize({mode, kind, scaleFactor, collapsed, naturalHeight = 0, monitor}) {
    const s = scaleFactor;
    let width;
    let height;
    switch (mode) {
    case 'peek':
        width = Size.PEEK_WIDTH * s;
        height = Math.max(Size.PEEK_HEIGHT * s, collapsed.height + Size.PEEK_LINE_HEIGHT * s);
        break;
    case 'transient': {
        const design = TransientSize[kind ?? ''] ?? TransientSize.toggle;
        width = design.width * s;
        height = design.height * s;
        break;
    }
    case 'pinned':
        width = Size.PINNED_WIDTH * s;
        height = Size.PINNED_MIN_HEIGHT * s;
        break;
    default:
        return collapsed;
    }
    width = Math.min(Math.max(width, collapsed.width), monitor.width - 2 * Size.MONITOR_MARGIN * s);
    height = Math.max(height, collapsed.height, Math.ceil(naturalHeight));
    return {width: Math.round(width), height: Math.min(Math.round(height), monitor.height)};
}
