// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Drives a headless GNOME Shell and checks the phase 1 gate (G1). Run through
// tests/smoke/run.sh, which isolates the session; never point this at a real session.
//
// Usage: gjs -m driver.js <output-dir> <scale>

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

const UUID = 'nocella@antariksa';
const State = {ACTIVE: 1, INACTIVE: 2};
const [outDir, scaleArg = '1'] = ARGV;
const scale = Number(scaleArg);
const resolution = scale === 2 ? '3840x2160' : '1920x1080';

let failures = 0;

/**
 * @param {string} name
 * @param {boolean} passed
 * @param {unknown} [detail]
 */
function check(name, passed, detail) {
    if (passed) {
        print(`ok - ${name}`);
    } else {
        failures++;
        print(`not ok - ${name}${detail === undefined ? '' : `\n  ${JSON.stringify(detail)}`}`);
    }
}

/** @param {number} ms */
function sleep(ms) {
    GLib.usleep(ms * 1000);
}

/**
 * Evaluates JavaScript inside the shell under test and returns the JSON result.
 *
 * @param {string} code
 * @returns {any}
 */
function evaluate(code) {
    const reply = Gio.DBus.session.call_sync('org.gnome.Shell', '/org/gnome/Shell',
        'org.gnome.Shell', 'Eval', new GLib.Variant('(s)', [code]),
        new GLib.VariantType('(bs)'), Gio.DBusCallFlags.NONE, 10000, null);
    const [ok, json] = reply.deepUnpack();
    if (!ok)
        throw new Error(`Eval failed: ${json || 'unsafe mode is off'}`);
    return json === '' ? undefined : JSON.parse(json);
}

/**
 * @param {() => boolean} predicate
 * @param {number} timeoutMs
 * @returns {boolean}
 */
function waitFor(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if (predicate())
                return true;
        } catch {
            // The shell or the helper extension is not ready yet.
        }
        sleep(250);
    }
    return false;
}

/**
 * @param {string} name
 * @param {{x: number, y: number, width: number, height: number}} area
 */
function screenshot(name, area) {
    const path = `${outDir}/${name}-x${scale}.png`;
    Gio.DBus.session.call_sync('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'ScreenshotArea',
        new GLib.Variant('(iiiibs)', [area.x, area.y, area.width, area.height, false, path]),
        new GLib.VariantType('(bs)'), Gio.DBusCallFlags.NONE, 10000, null);
    print(`# screenshot ${path}`);
}

const INFO = `(() => {
    const actor = Main.layoutManager.uiGroup.get_children().find(c => c.name === 'nocella');
    const monitor = Main.layoutManager.primaryMonitor;
    return {
        notch: actor ? {
            x: actor.x, y: actor.y, width: actor.width, height: actor.height,
            visible: actor.visible,
            expanded: actor.has_style_class_name('expanded'),
            clock: actor.get_child_at_index(0).get_child_at_index(0).text,
            headerHeight: actor.get_child_at_index(0).height,
        } : null,
        monitor: {x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height},
        scale: global.display.get_monitor_scale(Main.layoutManager.primaryIndex),
        panelHeight: Main.panel.height,
        gnomeClockVisible: Main.panel.statusArea.dateMenu.visible,
        uiChildren: Main.layoutManager.uiGroup.get_n_children(),
        overview: Main.overview.visible,
        panel: {
            pseudoClass: Main.panel.get_style_pseudo_class(),
            translationY: Main.layoutManager.panelBox.translation_y,
        },
    };
})()`;

/** @returns {any} */
function info() {
    return evaluate(INFO);
}

/** @param {boolean} expanded */
function setExpanded(expanded) {
    evaluate(`Main.extensionManager.lookup('${UUID}').stateObj._nocella._setExpanded(${expanded}, true)`);
}

/**
 * Clicks the center of the notch through a virtual pointer, so the real event path
 * (button-press-event, button check) is exercised. The device is kept on globalThis so
 * it outlives the Eval call until its events are processed.
 *
 * @param {'PRIMARY' | 'SECONDARY'} button
 */
function clickNotch(button) {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        const actor = Main.layoutManager.uiGroup.get_children().find(c => c.name === 'nocella');
        const [x, y] = actor.get_transformed_position();
        globalThis.nocellaTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const pointer = globalThis.nocellaTestPointer;
        const now = GLib.get_monotonic_time();
        pointer.notify_absolute_motion(now, x + actor.width / 2, y + actor.height / 2);
        pointer.notify_button(now + 1000, Clutter.BUTTON_${button}, Clutter.ButtonState.PRESSED);
        pointer.notify_button(now + 2000, Clutter.BUTTON_${button}, Clutter.ButtonState.RELEASED);
    })()`);
}

/** @returns {number} */
function extensionState() {
    return evaluate(`Main.extensionManager.lookup('${UUID}')?.state ?? 0`);
}

/**
 * @param {any} state
 * @param {number} width logical pixels at scale 1
 * @param {number} height logical pixels at scale 1, or 0 for the panel height
 */
function expectGeometry(state, width, height) {
    const n = state.notch;
    const w = width * state.scale;
    const h = height === 0 ? state.panelHeight : height * state.scale;
    const x = Math.round(state.monitor.x + (state.monitor.width - w) / 2);
    return n !== null && n.width === w && n.height === h && n.x === x && n.y === state.monitor.y;
}

function run() {
    if (!waitFor(() => evaluate('true') === true, 60000)) {
        check('shell starts with unsafe mode on', false);
        return;
    }
    check('nocella is active', waitFor(() => extensionState() === State.ACTIVE, 20000),
        extensionState());

    evaluate('Main.overview.hide()');
    waitFor(() => info().overview === false, 5000);
    // Clear the "unsafe mode" banner so it does not cover the screenshots.
    evaluate('Main.messageTray.getSources().forEach(source => source.destroy())');
    sleep(800);

    let state = info();
    print(`# ${JSON.stringify(state)}`);
    check(`monitor scale is ${scale}`, state.scale === scale, state.scale);
    check('collapsed notch is centered, flush with the top, panel height',
        expectGeometry(state, 196, 0), state);
    check('notch is visible and collapsed', state.notch?.visible && !state.notch.expanded);
    check('notch shows the clock', /\d/.test(state.notch?.clock ?? ''), state.notch?.clock);
    check('GNOME clock is hidden', state.gnomeClockVisible === false);
    // ScreenshotArea takes logical coordinates and multiplies them by the scale itself.
    const area = {
        x: (state.monitor.x + state.monitor.width / 2) / scale - 300,
        y: state.monitor.y / scale,
        width: 600,
        height: 300,
    };
    screenshot('collapsed', area);

    setExpanded(true);
    sleep(700);
    state = info();
    check('pinned panel is 420x240 and stays centered', expectGeometry(state, 420, 240), state.notch);
    check('pinned panel uses the expanded material', state.notch?.expanded === true);
    check('clock stays in a header as tall as the panel', state.notch?.headerHeight === state.panelHeight,
        {header: state.notch?.headerHeight, panel: state.panelHeight});
    screenshot('expanded', area);

    setExpanded(false);
    sleep(600);
    state = info();
    check('collapses back to the notch', expectGeometry(state, 196, 0) && !state.notch.expanded,
        state.notch);

    clickNotch('PRIMARY');
    sleep(700);
    state = info();
    check('a primary click opens the panel', state.notch?.expanded === true &&
        expectGeometry(state, 420, 240), state.notch);
    clickNotch('PRIMARY');
    sleep(600);
    state = info();
    check('a second primary click closes it', state.notch?.expanded === false &&
        expectGeometry(state, 196, 0), state.notch);
    clickNotch('SECONDARY');
    sleep(600);
    check('a secondary click does nothing', info().notch?.expanded === false);

    clickNotch('PRIMARY');
    sleep(700);
    evaluate('Main.overview.show()');
    sleep(1000);
    check('opening the overview while pinned hides the notch', info().notch?.visible === false);
    evaluate('Main.overview.hide()');
    sleep(1000);
    state = info();
    check('after the overview the notch is back collapsed, not pinned',
        state.notch?.visible === true && state.notch.expanded === false &&
        expectGeometry(state, 196, 0), state.notch);

    // Programmatic toggles: stresses the animation path faster than clicks can.
    for (let i = 0; i < 20; i++) {
        setExpanded(true);
        sleep(60);
        setExpanded(false);
        sleep(60);
    }
    sleep(600);
    check('20 rapid open/close cycles end collapsed and centered', expectGeometry(info(), 196, 0),
        info().notch);

    evaluate('Main.overview.show()');
    sleep(1000);
    check('notch hides in the overview', info().notch?.visible === false);
    evaluate('Main.overview.hide()');
    sleep(1000);
    state = info();
    check('notch returns collapsed after the overview', state.notch?.visible &&
        expectGeometry(state, 196, 0));

    const baseline = info().uiChildren;
    let cyclesOk = true;
    for (let i = 0; i < 20 && cyclesOk; i++) {
        evaluate(`Main.extensionManager.disableExtension('${UUID}')`);
        cyclesOk = waitFor(() => extensionState() === State.INACTIVE, 5000);
        const off = info();
        if (off.notch !== null || off.gnomeClockVisible !== true) {
            check(`disable ${i + 1} removes the notch and restores the GNOME clock`, false, off);
            cyclesOk = false;
            break;
        }
        evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
        cyclesOk &&= waitFor(() => extensionState() === State.ACTIVE, 5000);
    }
    check('20 disable/enable cycles succeed', cyclesOk);
    sleep(500);
    state = info();
    check('no actors leak across cycles', state.uiChildren === baseline,
        {before: baseline, after: state.uiChildren});
    check('notch is back after the cycles', state.notch?.visible && expectGeometry(state, 196, 0));
}

try {
    run();
} catch (e) {
    check('driver ran without exceptions', false, `${e}`);
}

if (failures > 0)
    System.exit(1);
