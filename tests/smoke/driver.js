// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Drives a headless GNOME Shell and checks the phase 1 gate (G1). Run through
// tests/smoke/run.sh, which isolates the session; never point this at a real session.
//
// Usage: gjs -m driver.js <output-dir> <scale>

import GdkPixbuf from 'gi://GdkPixbuf';
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

/**
 * Reads one pixel of a screenshot.
 *
 * @param {any} pixbuf a `GdkPixbuf.Pixbuf`
 * @param {number} x
 * @param {number} y
 * @returns {number[]} `[r, g, b]`
 */
function pixelAt(pixbuf, x, y) {
    const pixels = pixbuf.get_pixels();
    const offset = Math.round(y) * pixbuf.get_rowstride() + Math.round(x) * pixbuf.get_n_channels();
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

/**
 * @param {number[]} rgb
 * @param {number[]} expected
 * @param {number} tolerance per channel
 */
function near(rgb, expected, tolerance) {
    return rgb.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
}

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
            if (!this._expanded) {
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
            clickNotch('PRIMARY');
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

// Installed in the shell under test while the extension is enabled and disabled once.
// Records every signal handler, binding, and main-loop source whose caller frame is in
// Nocella's files. Frame 0 of the stack is calledFromNocella, 1 the wrapper, 2 the caller.
const INSTRUMENT = `(() => {
    const GLib = imports.gi.GLib;
    const calledFromNocella = () =>
        (new Error().stack ?? '').split('\\n')[2]?.includes('/${UUID}/') ?? false;
    const record = globalThis.nocellaTestRecord =
        {signals: [], sources: [], bindings: [], restore: [], unpatched: [], sameGLib: null};
    // Extensions import gi://GLib; the timer patches only reach them if it is this object.
    import('gi://GLib').then(module => { record.sameGLib = module.default === GLib; },
        () => { record.sameGLib = false; });
    const ownerOf = (object, name) => {
        let owner = object;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, name))
            owner = Object.getPrototypeOf(owner);
        return owner;
    };
    const patch = (owner, name, wrap) => {
        const original = owner[name];
        const wrapper = wrap(original);
        owner[name] = wrapper;
        // Eval code is sloppy mode, so a read-only property would ignore the assignment.
        if (owner[name] !== wrapper)
            record.unpatched.push(name);
        record.restore.push(() => { owner[name] = original; });
    };
    const signalMethods = [
        [Main.panel, 'connect', 'gobject'], [Main.panel, 'connect_after', 'gobject'],
        [Main.overview, 'connect', 'emitter'], [Main.overview, 'connectAfter', 'emitter'],
    ];
    for (const [sample, name, kind] of signalMethods) {
        const owner = ownerOf(sample, name);
        if (!owner)
            continue;
        patch(owner, name, original => function (...args) {
            const id = original.apply(this, args);
            if (calledFromNocella())
                record.signals.push({object: this, id, kind, signal: args[0]});
            return id;
        });
    }
    patch(ownerOf(Main.panel, 'bind_property'), 'bind_property', original => function (...args) {
        const binding = original.apply(this, args);
        if (calledFromNocella())
            record.bindings.push(binding);
        return binding;
    });
    for (const name of ['timeout_add', 'timeout_add_seconds', 'idle_add']) {
        patch(GLib, name, original => function (...args) {
            const id = original.apply(this, args);
            if (calledFromNocella())
                record.sources.push({name, id});
            return id;
        });
    }
    for (const name of ['setTimeout', 'setInterval']) {
        patch(globalThis, name, original => function (...args) {
            const source = original.apply(this, args);
            if (calledFromNocella())
                record.sources.push({name, source});
            return source;
        });
    }
})()`;

// Removes the instrumentation and reports what is still connected or scheduled.
const VERIFY = `(() => {
    const {GLib, GObject} = imports.gi;
    const record = globalThis.nocellaTestRecord;
    delete globalThis.nocellaTestRecord;
    if (!record)
        return null;
    record.restore.reverse().forEach(restore => restore());
    const isConnected = s => s.kind === 'gobject'
        ? GObject.signal_handler_is_connected(s.object, s.id)
        : s.object.signalHandlerIsConnected(s.id);
    return {
        unpatched: record.unpatched,
        sameGLib: record.sameGLib,
        signals: record.signals.map(s => s.signal),
        leakedSignals: record.signals.filter(isConnected)
            .map(s => \`\${s.object.constructor?.name}::\${s.signal}\`),
        sources: record.sources.length,
        leakedSources: record.sources.filter(s => s.source
            ? !s.source.is_destroyed()
            : GLib.MainContext.default().find_source_by_id(s.id) !== null).map(s => s.name),
        bindings: record.bindings.length,
        leakedBindings: record.bindings.filter(b => b.dup_source() !== null).length,
    };
})()`;

/**
 * Verifies directly that disable() leaves no signal handler, binding, or timer behind,
 * including the wall clock's own timer, which lives in C and is checked by its ticks.
 * Disables while the panel is pinned, the harder case.
 */
function checkCleanDisable() {
    evaluate(`Main.extensionManager.disableExtension('${UUID}')`);
    waitFor(() => extensionState() === State.INACTIVE, 5000);
    // With seconds shown the wall clock ticks every second instead of every minute.
    const showSeconds = evaluate(`(() => {
        const settings = new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'});
        const original = settings.get_boolean('clock-show-seconds');
        settings.set_boolean('clock-show-seconds', true);
        return original;
    })()`);

    let result = null;
    let pinned = false;
    let ticksBefore = 0;
    let ticksAfter = -1;
    try {
        evaluate(INSTRUMENT);
        evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
        waitFor(() => extensionState() === State.ACTIVE, 5000);
        clickNotch('PRIMARY');
        evaluate(`(() => {
            const clock = Main.extensionManager.lookup('${UUID}').stateObj._nocella._wallClock;
            const watch = globalThis.nocellaTestClock = {clock, ticks: 0};
            watch.id = clock.connect('notify::clock', () => watch.ticks++);
        })()`);
        sleep(2500);
        pinned = info().notch?.expanded === true;
        ticksBefore = evaluate('globalThis.nocellaTestClock.ticks');
        evaluate(`Main.extensionManager.disableExtension('${UUID}')`);
        waitFor(() => extensionState() === State.INACTIVE, 5000);
        evaluate('globalThis.nocellaTestClock.ticks = 0');
        sleep(2500);
        ticksAfter = evaluate('globalThis.nocellaTestClock.ticks');
    } finally {
        try {
            result = evaluate(VERIFY);
        } finally {
            evaluate(`(() => {
                const watch = globalThis.nocellaTestClock;
                delete globalThis.nocellaTestClock;
                try {
                    watch?.clock.disconnect(watch.id);
                } catch {}
                new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.interface'})
                    .set_boolean('clock-show-seconds', ${showSeconds});
            })()`);
        }
    }

    print(`# connections made by nocella: ${JSON.stringify(result)}`);
    check('instrumentation patched every method and reaches gi://GLib',
        result?.unpatched.length === 0 && result.sameGLib === true,
        {unpatched: result?.unpatched, sameGLib: result?.sameGLib});
    check('the panel was pinned when disable() ran', pinned);
    // Phase 1 connects 8 handlers in enable(); fewer means the instrumentation missed some.
    check('instrumentation saw every signal connected in enable()', result?.signals.length >= 8,
        result?.signals);
    check('no signal handler is left connected after disable', result?.leakedSignals.length === 0,
        result?.leakedSignals);
    // unbind() and disposing the wall clock both end the binding; this checks the outcome.
    check('no property binding outlives disable', result?.bindings >= 1 &&
        result.leakedBindings === 0, result);
    // Phase 1 schedules no JS timers, so this only guards against new ones in later phases.
    check('no timer or idle source is left after disable', result?.leakedSources.length === 0,
        result?.leakedSources);
    check('the wall clock stops ticking after disable', ticksBefore >= 2 && ticksAfter === 0,
        {before: ticksBefore, after: ticksAfter});

    evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
    check('nocella is active again after the clean-disable check',
        waitFor(() => extensionState() === State.ACTIVE, 5000));
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

    measureOpenTime(10);
    checkReferencePanel(area);
    checkCleanDisable();
    sleep(500);
    check('notch is collapsed and centered at the end', expectGeometry(info(), 196, 0));
}

try {
    run();
} catch (e) {
    check('driver ran without exceptions', false, `${e}`);
}

if (failures > 0)
    System.exit(1);
