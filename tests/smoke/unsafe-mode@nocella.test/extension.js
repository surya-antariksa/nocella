// SPDX-License-Identifier: GPL-2.0-or-later

// Installed only into the isolated smoke-test session, never into a real one.
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class UnsafeModeExtension extends Extension {
    enable() {
        global.context.unsafe_mode = true;
    }

    disable() {
        global.context.unsafe_mode = false;
    }
}
