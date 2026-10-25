// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Shared helpers for the smoke test phases. Everything runs against the isolated shell
// started by tests/smoke/run.sh; never point this at a real session.

import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

export const UUID = 'nocella@antariksa';
export const State = {ACTIVE: 1, INACTIVE: 2};
export const [outDir, scaleArg = '1'] = ARGV;
export const scale = Number(scaleArg);

let failures = 0;

/** @returns {number} */
export function failureCount() {
    return failures;
}

/**
 * @param {string} name
 * @param {boolean} passed
 * @param {unknown} [detail]
 */
export function check(name, passed, detail) {
    if (passed) {
        print(`ok - ${name}`);
    } else {
        failures++;
        print(`not ok - ${name}${detail === undefined ? '' : `\n  ${JSON.stringify(detail)}`}`);
    }
}

/** @param {number} ms */
export function sleep(ms) {
    GLib.usleep(ms * 1000);
}

/**
 * Evaluates JavaScript inside the shell under test and returns the JSON result.
 *
 * @param {string} code
 * @returns {any}
 */
export function evaluate(code) {
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
export function waitFor(predicate, timeoutMs) {
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
export function screenshot(name, area) {
    const path = `${outDir}/${name}-x${scale}.png`;
    Gio.DBus.session.call_sync('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'ScreenshotArea',
        new GLib.Variant('(iiiibs)', [area.x, area.y, area.width, area.height, false, path]),
        new GLib.VariantType('(bs)'), Gio.DBusCallFlags.NONE, 10000, null);
    print(`# screenshot ${path}`);
}

export const INFO = `(() => {
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
export function info() {
    return evaluate(INFO);
}

/** @param {boolean} expanded */
export function setExpanded(expanded) {
    evaluate(`(() => {
        const state = Main.extensionManager.lookup('${UUID}').stateObj._nocella._state;
        if (${expanded} && state.state !== 'pinned')
            state.toggle('today');
        else if (!${expanded})
            state.close();
    })()`);
}

/** @returns {any} the state machine, arbiter, and page of the extension under test */
export function nocellaState() {
    return evaluate(`(() => {
        const n = Main.extensionManager.lookup('${UUID}')?.stateObj?._nocella;
        if (!n?._state)
            return null;
        return {
            state: n._state.state,
            view: n._state.view,
            content: n._state.content?.type ?? null,
            queue: n._arbiter.queue.length,
            mode: n._surface.mode,
            bodyChildren: n._surface._body.get_n_children(),
            grab: n._grab !== null,
        };
    })()`);
}

/**
 * Moves the virtual pointer to stage coordinates (device pixels).
 *
 * @param {number} x
 * @param {number} y
 */
export function pointerTo(x, y) {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        globalThis.nocellaTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        globalThis.nocellaTestPointer.notify_absolute_motion(GLib.get_monotonic_time(), ${x}, ${y});
    })()`);
}

/** Moves the pointer far below the notch, onto the empty desktop. */
export function pointerAway() {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        const monitor = Main.layoutManager.primaryMonitor;
        globalThis.nocellaTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        globalThis.nocellaTestPointer.notify_absolute_motion(GLib.get_monotonic_time(),
            monitor.x + monitor.width / 4, monitor.y + monitor.height * 0.75);
    })()`);
}

/** Puts the pointer on the center of the notch without clicking. */
export function hoverNotch() {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        const actor = Main.layoutManager.uiGroup.get_children().find(c => c.name === 'nocella');
        const [x, y] = actor.get_transformed_position();
        globalThis.nocellaTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        globalThis.nocellaTestPointer.notify_absolute_motion(GLib.get_monotonic_time(),
            x + actor.width / 2, y + actor.height / 2);
    })()`);
}

/**
 * Clicks at stage coordinates (device pixels) and moves the pointer away again.
 *
 * @param {number} x
 * @param {number} y
 * @param {'PRIMARY' | 'SECONDARY'} [button]
 */
export function clickAt(x, y, button = 'PRIMARY') {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        globalThis.nocellaTestPointer ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const pointer = globalThis.nocellaTestPointer;
        const now = GLib.get_monotonic_time();
        pointer.notify_absolute_motion(now, ${x}, ${y});
        pointer.notify_button(now + 1000, Clutter.BUTTON_${button}, Clutter.ButtonState.PRESSED);
        pointer.notify_button(now + 2000, Clutter.BUTTON_${button}, Clutter.ButtonState.RELEASED);
    })()`);
}

/** Clicks on the empty desktop below the notch. */
export function clickOutside() {
    const monitor = info().monitor;
    clickAt(monitor.x + monitor.width / 4, monitor.y + monitor.height * 0.75);
}

/**
 * Clicks the center of an actor found by an expression evaluated in the shell, e.g.
 * `n._transientPages.get('media')._playButton` where `n` is the Nocella instance.
 *
 * @param {string} expression
 * @returns {boolean} false when the actor is missing or not mapped
 */
export function clickActor(expression) {
    const center = evaluate(`(() => {
        const n = Main.extensionManager.lookup('${UUID}').stateObj._nocella;
        const actor = ${expression};
        if (!actor?.mapped)
            return null;
        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return [x + width / 2, y + height / 2];
    })()`);
    if (!center)
        return false;
    clickAt(center[0], center[1]);
    return true;
}

/**
 * Presses and releases keys through a virtual keyboard, modifiers first.
 *
 * @param {string[]} keys Clutter key constant names, e.g. ['Super_L', 'i']
 */
export function pressKeys(keys) {
    evaluate(`(() => {
        const Clutter = imports.gi.Clutter;
        globalThis.nocellaTestKeyboard ??= Clutter.get_default_backend().get_default_seat()
            .create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const keyboard = globalThis.nocellaTestKeyboard;
        const keys = ${JSON.stringify(keys)}.map(name => Clutter[\`KEY_\${name}\`]);
        let time = GLib.get_monotonic_time();
        for (const key of keys)
            keyboard.notify_keyval(time += 1000, key, Clutter.KeyState.PRESSED);
        for (const key of [...keys].reverse())
            keyboard.notify_keyval(time += 1000, key, Clutter.KeyState.RELEASED);
    })()`);
}

/**
 * Waits for the shell, checks that Nocella is active, and clears the overview and the
 * "unsafe mode" banner so they do not get in the way of the checks.
 *
 * @returns {boolean} false when the shell did not come up
 */
export function prepareShell() {
    if (!waitFor(() => evaluate('true') === true, 60000)) {
        check('shell starts with unsafe mode on', false);
        return false;
    }
    check('nocella is active', waitFor(() => extensionState() === State.ACTIVE, 20000),
        extensionState());
    evaluate('Main.overview.hide()');
    waitFor(() => info().overview === false, 5000);
    evaluate('Main.messageTray.getSources().forEach(source => source.destroy())');
    pointerAway();
    sleep(800);
    return true;
}

/**
 * Clicks the center of the notch through a virtual pointer, so the real event path
 * (button-press-event, button check) is exercised. The device is kept on globalThis so
 * it outlives the Eval call until its events are processed.
 *
 * @param {'PRIMARY' | 'SECONDARY'} button
 */
export function clickNotch(button) {
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
    // Leave the notch, so the pointer resting on it does not open the peek.
    sleep(50);
    pointerAway();
}

/** @returns {number} */
export function extensionState() {
    return evaluate(`Main.extensionManager.lookup('${UUID}')?.state ?? 0`);
}

/**
 * @param {any} state
 * @param {number} width logical pixels at scale 1
 * @param {number} height logical pixels at scale 1, 0 for the panel height, or negative
 *   for a minimum height
 */
export function expectGeometry(state, width, height) {
    const n = state.notch;
    const w = width * state.scale;
    const h = height === 0 ? state.panelHeight : Math.abs(height) * state.scale;
    const x = Math.round(state.monitor.x + (state.monitor.width - w) / 2);
    const heightOk = height < 0 ? n?.height >= h : n?.height === h;
    return n !== null && n.width === w && heightOk && n.x === x && n.y === state.monitor.y;
}

/**
 * Reads one pixel of a screenshot.
 *
 * @param {any} pixbuf a `GdkPixbuf.Pixbuf`
 * @param {number} x
 * @param {number} y
 * @returns {number[]} `[r, g, b]`
 */
export function pixelAt(pixbuf, x, y) {
    const pixels = pixbuf.get_pixels();
    const offset = Math.round(y) * pixbuf.get_rowstride() + Math.round(x) * pixbuf.get_n_channels();
    return [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
}

/**
 * @param {number[]} rgb
 * @param {number[]} expected
 * @param {number} tolerance per channel
 */
export function near(rgb, expected, tolerance) {
    return rgb.every((value, i) => Math.abs(value - expected[i]) <= tolerance);
}

// Installed in the shell under test while the extension is enabled and disabled once.
// Records every signal handler, binding, and main-loop source whose caller frame is in
// Nocella's files. Frame 0 of the stack is calledFromNocella, 1 the wrapper, 2 the caller.
export const INSTRUMENT = `(() => {
    const {Clutter, Gio, GLib} = imports.gi;
    const calledFromNocella = () =>
        (new Error().stack ?? '').split('\\n')[2]?.includes('/${UUID}/') ?? false;
    const record = globalThis.nocellaTestRecord =
        {signals: [], sources: [], bindings: [], subscriptions: [], restore: [], unpatched: [],
            sameGLib: null};
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
            if (calledFromNocella()) {
                const entry = {object: this, id, kind, signal: args[0], destroyed: false};
                record.signals.push(entry);
                // A destroyed actor can never emit again, so its handlers are not a leak.
                if (this instanceof Clutter.Actor)
                    original.call(this, 'destroy', () => { entry.destroyed = true; });
            }
            return id;
        });
    }
    const bus = Gio.DBus.session;
    patch(ownerOf(bus, 'signal_subscribe'), 'signal_subscribe', original => function (...args) {
        const id = original.apply(this, args);
        if (calledFromNocella())
            record.subscriptions.push({connection: this, id, member: args[3], active: true});
        return id;
    });
    patch(ownerOf(bus, 'signal_unsubscribe'), 'signal_unsubscribe', original => function (id) {
        for (const entry of record.subscriptions) {
            if (entry.connection === this && entry.id === id)
                entry.active = false;
        }
        return original.call(this, id);
    });
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
                record.sources.push({name, id, interval: name === 'idle_add' ? 0 : args[1]});
            return id;
        });
    }
    for (const name of ['setTimeout', 'setInterval']) {
        patch(globalThis, name, original => function (...args) {
            const source = original.apply(this, args);
            if (calledFromNocella())
                record.sources.push({name, source, interval: args[1] ?? 0});
            return source;
        });
    }
})()`;

// Timers recorded by INSTRUMENT that are still pending, without removing it.
export const ACTIVE_SOURCES = `(() => {
    const GLib = imports.gi.GLib;
    const record = globalThis.nocellaTestRecord;
    return (record?.sources ?? []).filter(s => s.source
        ? !s.source.is_destroyed()
        : GLib.MainContext.default().find_source_by_id(s.id) !== null)
        .map(s => ({name: s.name, interval: s.interval}));
})()`;

// Removes the instrumentation and reports what is still connected or scheduled.
export const VERIFY = `(() => {
    const {GLib, GObject} = imports.gi;
    const record = globalThis.nocellaTestRecord;
    delete globalThis.nocellaTestRecord;
    if (!record)
        return null;
    record.restore.reverse().forEach(restore => restore());
    const isConnected = s => !s.destroyed && (s.kind === 'gobject'
        ? GObject.signal_handler_is_connected(s.object, s.id)
        : s.object.signalHandlerIsConnected(s.id));
    return {
        subscriptions: record.subscriptions.length,
        leakedSubscriptions: record.subscriptions.filter(s => s.active).map(s => s.member),
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
 * Verifies directly that disable() leaves no signal handler, binding, D-Bus
 * subscription, timer, or modal grab behind, including the wall clock's own timer, which
 * lives in C and is checked by its ticks. `setup` runs after the instrumented enable,
 * e.g. to pin the panel, so disable() runs in that state.
 *
 * @param {object} params
 * @param {number} params.minSignals handlers the instrumentation must at least see
 * @param {() => void} params.setup
 * @param {string} [params.label] prefix for the check names
 */
export function checkCleanDisable({minSignals, setup, label = ''}) {
    const name = (/** @type {string} */ text) => label ? `${label}: ${text}` : text;
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
    let modalCount = -1;
    let ticksBefore = 0;
    let ticksAfter = -1;
    try {
        evaluate(INSTRUMENT);
        evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
        waitFor(() => extensionState() === State.ACTIVE, 5000);
        setup();
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
        modalCount = evaluate('Main.modalCount');
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
    check(name('instrumentation patched every method and reaches gi://GLib'),
        result?.unpatched.length === 0 && result.sameGLib === true,
        {unpatched: result?.unpatched, sameGLib: result?.sameGLib});
    check(name('the panel was pinned when disable() ran'), pinned);
    check(name('disable() leaves no modal grab behind'), modalCount === 0, modalCount);
    // Fewer handlers than expected means the instrumentation missed some.
    check(name('instrumentation saw every signal connected in enable()'), result?.signals.length >= minSignals,
        result?.signals);
    check(name('no signal handler is left connected after disable'), result?.leakedSignals.length === 0,
        result?.leakedSignals);
    // unbind() and disposing the wall clock both end the binding; this checks the outcome.
    check(name('no property binding outlives disable'), result?.bindings >= 1 &&
        result.leakedBindings === 0, result);
    // The media provider watches NameOwnerChanged on the session bus.
    check(name('no D-Bus signal subscription is left after disable'), result?.subscriptions >= 1 &&
        result.leakedSubscriptions.length === 0, {subscriptions: result?.subscriptions,
        leaked: result?.leakedSubscriptions});
    // Timers made while enabled (state machine, providers) must all be gone.
    check(name('no timer or idle source is left after disable'), result?.leakedSources.length === 0,
        result?.leakedSources);
    check(name('the wall clock stops ticking after disable'), ticksBefore >= 2 && ticksAfter === 0,
        {before: ticksBefore, after: ticksAfter});

    evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
    check(name('nocella is active again after the clean-disable check'),
        waitFor(() => extensionState() === State.ACTIVE, 5000));
}
