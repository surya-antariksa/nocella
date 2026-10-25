// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Phase 1 gate (G1): placement, material, clicks, overview, open time, clean disable.

import GdkPixbuf from 'gi://GdkPixbuf';

import {
    State, UUID, check, checkCleanDisable, clickNotch, clickOutside, evaluate, expectGeometry,
    nocellaState,
    extensionState, info, near, outDir, pixelAt, scale, screenshot, setExpanded, sleep, waitFor,
} from './lib.js';

/**
 * Opens the panel through real clicks and times each open from the click handler to the
 * first painted frame in which the notch has changed size. Target from
 * docs/07-performa.md: under 100 ms.
 *
 * @param {number} samples
 */
function measureOpenTime(samples) {
    evaluate(`(() => {
        const nocella = Main.extensionManager.lookup('${UUID}').stateObj._nocella;
        const actor = nocella._surface.actor;
        const timing = globalThis.nocellaTestTiming = {start: 0, width: 0, samples: []};
        nocella._onButtonPress = function (event) {
            if (this._state.state !== 'pinned') {
                timing.start = GLib.get_monotonic_time();
                timing.width = actor.get_allocation_box().get_width();
            }
            return Object.getPrototypeOf(this)._onButtonPress.call(this, event);
        };
        timing.paintId = global.stage.connect('after-paint', () => {
            if (timing.start && actor.get_allocation_box().get_width() !== timing.width) {
                timing.samples.push((GLib.get_monotonic_time() - timing.start) / 1000);
                timing.start = 0;
            }
        });
    })()`);

    /** @type {number[]} */
    let times = [];
    try {
        for (let i = 0; i < samples; i++) {
            clickNotch('PRIMARY');
            sleep(500);
            const opened = nocellaState();
            if (opened.state !== 'pinned')
                print(`# open click ${i + 1} left the notch ${JSON.stringify(opened)}`);
            clickOutside();
            sleep(400);
        }
    } finally {
        times = evaluate(`(() => {
            const timing = globalThis.nocellaTestTiming;
            global.stage.disconnect(timing.paintId);
            delete Main.extensionManager.lookup('${UUID}').stateObj._nocella._onButtonPress;
            delete globalThis.nocellaTestTiming;
            return timing.samples;
        })()`);
    }
    const sorted = [...times].sort((a, b) => a - b);
    const middle = sorted.length / 2;
    const median = sorted.length % 2 === 1 ? sorted[Math.floor(middle)]
        : (sorted[middle - 1] + sorted[middle]) / 2;
    const max = sorted[sorted.length - 1];
    print(`# open time over ${times.length} clicks: median ${median?.toFixed(1)} ms, ` +
        `max ${max?.toFixed(1)} ms`);
    check(`every open shows its first frame within 100 ms (${samples} clicks)`,
        times.length === samples && max < 100, times);
}

/**
 * Compares the notch against docs/03-desain-visual.md over the reference panel color.
 * The panel is forced to #131313 (stock Yaru) inside the test shell only, because the
 * installed theme may make the panel transparent.
 *
 * @param {{x: number, y: number, width: number, height: number}} area logical pixels
 */
function checkReferencePanel(area) {
    const PANEL = [0x13, 0x13, 0x13];
    // The enable/disable cycles bring the "unsafe mode" banner back.
    evaluate('Main.messageTray.getSources().forEach(source => source.destroy())');
    evaluate("Main.panel.set_style('background-color: #131313;')");
    sleep(400);

    let state = info();
    const n = state.notch;
    const s = scale;
    // Screenshot pixels are device pixels with their origin at the area's corner.
    const left = n.x - area.x * s;
    const right = left + n.width - 1;
    const bottom = n.height - 1;
    screenshot('reference-collapsed', area);
    let image = GdkPixbuf.Pixbuf.new_from_file(`${outDir}/reference-collapsed-x${s}.png`);
    check('reference screenshot is in device pixels', image.get_width() === area.width * s,
        image.get_width());

    const samples = {
        panel: pixelAt(image, left - 20 * s, n.height / 2),
        body: pixelAt(image, left + 8 * s, n.height / 2),
        topLeft: pixelAt(image, left, 0),
        topRight: pixelAt(image, right, 0),
        bottomLeft: pixelAt(image, left, bottom),
        bottomRight: pixelAt(image, right, bottom),
        // One CSS pixel of hairline is `s` device rows; the row above it is plain black.
        hairline: Array.from({length: s}, (_, i) => pixelAt(image, left + 30 * s, bottom - i)),
        aboveHairline: pixelAt(image, left + 30 * s, bottom - s),
    };
    print(`# reference pixels ${JSON.stringify(samples)}`);
    check('reference panel beside the notch is #131313', near(samples.panel, PANEL, 2), samples.panel);
    check('collapsed notch body is #000000', near(samples.body, [0, 0, 0], 2), samples.body);
    check('top corners are square (black up to the edge)',
        near(samples.topLeft, [0, 0, 0], 2) && near(samples.topRight, [0, 0, 0], 2));
    check('bottom corners are rounded (panel color in the corner)',
        near(samples.bottomLeft, PANEL, 3) && near(samples.bottomRight, PANEL, 3));
    // rgba(255, 255, 255, 0.06) over black is 15.
    check(`bottom hairline is 6% white and ${s} device row(s) thick`,
        samples.hairline.every(rgb => near(rgb, [15, 15, 15], 3)) &&
        near(samples.aboveHairline, [0, 0, 0], 2));

    setExpanded(true);
    sleep(700);
    state = info();
    const expandedLeft = state.notch.x - area.x * s;
    screenshot('reference-expanded', area);
    image = GdkPixbuf.Pixbuf.new_from_file(`${outDir}/reference-expanded-x${s}.png`);
    // The vertical gradient from stylesheet.css at this row, composited over #131313.
    const y = state.panelHeight / 2;
    const t = y / state.notch.height;
    const alpha = 0.83 + (0.82 - 0.83) * t;
    const expected = [41 + (24 - 41) * t, 41 + (24 - 41) * t, 43 + (26 - 43) * t]
        .map((c, i) => c * alpha + PANEL[i] * (1 - alpha));
    const header = pixelAt(image, expandedLeft + 30 * s, y);
    print(`# expanded header pixel ${JSON.stringify(header)}, expected ` +
        `${JSON.stringify(expected.map(Math.round))}`);
    check('pinned panel material over the reference panel matches the tokens',
        near(header, expected, 4), {header, expected});
    setExpanded(false);
    sleep(600);

    evaluate('Main.panel.set_style(null)');
}


export function run() {
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
    check('pinned panel is 420 wide, at least 220 tall, and centered', expectGeometry(state, 420, -220),
        state.notch);
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
        expectGeometry(state, 420, -220), state.notch);
    clickOutside();
    sleep(600);
    state = info();
    check('a click outside the panel closes it', state.notch?.expanded === false &&
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

    measureOpenTime(10);
    checkReferencePanel(area);
    checkCleanDisable({
        // enable() connects 14 handlers itself; pages and providers add more.
        minSignals: 14,
        setup: () => clickNotch('PRIMARY'),
    });
    sleep(500);
    check('notch is collapsed and centered at the end', expectGeometry(info(), 196, 0));
}
