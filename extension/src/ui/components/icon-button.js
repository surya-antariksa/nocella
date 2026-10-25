// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Duration} from '../../tokens.js';

/**
 * Makes a button shrink to 0.94 while pressed, the macOS press feedback
 * (docs/04-interaksi.md, "Rasa macOS"). No ripple, no glow.
 *
 * @param {any} button an `St.Button`
 */
export function addPressFeedback(button) {
    button.set_pivot_point(0.5, 0.5);
    button.connect('notify::pressed', () => {
        const scale = button.pressed ? 0.94 : 1;
        button.ease({
            scale_x: scale,
            scale_y: scale,
            duration: Duration.PRESS_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    });
}

/**
 * A 32 px round icon button. The handlers live on the button itself and go away with it.
 *
 * @param {object} params
 * @param {string} params.iconName a symbolic icon
 * @param {string} params.accessibleName
 * @param {() => void} params.onClick
 * @param {string} [params.styleClass] extra style classes
 * @returns {any} the `St.Button`
 */
export function iconButton({iconName, accessibleName, onClick, styleClass = ''}) {
    const button = new St.Button({
        style_class: `nocella-icon-button ${styleClass}`.trim(),
        can_focus: true,
        track_hover: true,
        accessible_name: accessibleName,
        child: new St.Icon({icon_name: iconName, icon_size: 16}),
    });
    addPressFeedback(button);
    button.connect('clicked', () => onClick());
    return button;
}

/**
 * Changes the icon of a button made by `iconButton()`.
 *
 * @param {any} button
 * @param {string} iconName
 */
export function setButtonIcon(button, iconName) {
    if (button.child.icon_name !== iconName)
        button.child.icon_name = iconName;
}

/**
 * A pill-shaped text button (notification actions, "Clear").
 *
 * @param {object} params
 * @param {string} params.label
 * @param {() => void} params.onClick
 * @param {boolean} [params.primary] the blue main action
 * @returns {any} the `St.Button`
 */
export function pillButton({label, onClick, primary = false}) {
    const button = new St.Button({
        style_class: primary ? 'nocella-pill primary' : 'nocella-pill',
        label,
        can_focus: true,
        track_hover: true,
    });
    addPressFeedback(button);
    button.connect('clicked', () => onClick());
    return button;
}
