// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Design tokens from docs/03-desain-visual.md. Sizes are logical pixels at scale 1;
// multiply by the St scale factor before applying them to actors.

export const Size = Object.freeze({
    COLLAPSED_WIDTH: 196,
    // 12-hour clocks need room for the AM/PM suffix.
    COLLAPSED_WIDTH_12H: 206,
    PANEL_HEIGHT_FALLBACK: 32,
    PINNED_WIDTH: 420,
    PINNED_HEIGHT: 240,
});

export const Duration = Object.freeze({
    OPEN_MS: 300,
    CLOSE_MS: 220,
});

// Colors are mirrored in stylesheet.css (St has no CSS variables). The JS copy is the
// source for components drawn with Cairo.
export const Color = Object.freeze({
    NOTCH: '#000000',
    ACCENT: '#0A84FF',
    SUCCESS: '#30D158',
    WARNING: '#FF9F0A',
    DANGER: '#FF453A',
    DARK: Object.freeze({
        SURFACE: 'rgba(24, 24, 26, 0.82)',
        SURFACE_SOLID: '#18181A',
        CARD: 'rgba(255, 255, 255, 0.05)',
        CARD_HOVER: 'rgba(255, 255, 255, 0.08)',
        HAIRLINE: 'rgba(255, 255, 255, 0.10)',
        TEXT: '#F5F5F7',
        TEXT_SECONDARY: '#A1A1A6',
        TEXT_TERTIARY: '#6E6E73',
    }),
    LIGHT: Object.freeze({
        SURFACE: 'rgba(250, 250, 252, 0.84)',
        SURFACE_SOLID: '#FAFAFC',
        CARD: 'rgba(0, 0, 0, 0.04)',
        CARD_HOVER: 'rgba(0, 0, 0, 0.07)',
        HAIRLINE: 'rgba(0, 0, 0, 0.08)',
        TEXT: '#1D1D1F',
        TEXT_SECONDARY: '#6E6E73',
        TEXT_TERTIARY: '#8E8E93',
    }),
});
