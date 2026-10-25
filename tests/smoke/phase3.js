// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Phase 3 gate (G3): notifications through notify-send, banner takeover, DND,
// fullscreen, load, and the mirror fallback.

import Gio from 'gi://Gio';

import {
    State, UUID, check, clickActor, evaluate, expectGeometry, extensionState, info, nocellaState,
    pressKeys, scale, screenshot, sleep, waitFor,
} from './lib.js';

/**
 * @param {string} expression evaluated with `n` bound to the Nocella instance
 * @returns {any}
 */
function inNocella(expression) {
    return evaluate(`(() => {
        const n = Main.extensionManager.lookup('${UUID}').stateObj._nocella;
        return ${expression};
    })()`);
}

/**
 * Sends a notification with notify-send and waits for it to exit.
 *
 * @param {string[]} args
 */
function notify(args) {
    const process = Gio.Subprocess.new(['notify-send', ...args], Gio.SubprocessFlags.NONE);
    process.wait(null);
}

/**
 * Starts notify-send with actions; it waits until an action is used and prints its name.
 *
 * @param {string[]} args
 * @returns {any} the `Gio.Subprocess`
 */
function notifyWithActions(args) {
    return Gio.Subprocess.new(['notify-send', ...args], Gio.SubprocessFlags.STDOUT_PIPE);
}

/** @returns {any} GNOME's banner state */
function tray() {
    return evaluate(`(() => ({
        blocked: Main.messageTray._bannerBlocked,
        // The tray actor is visible exactly while GNOME shows a banner.
        banner: Main.messageTray.visible,
        // 0 is MessageTray.State.HIDDEN: GNOME is not showing a banner, not even hidden.
        gnomeState: Main.messageTray._notificationState,
        held: Main.messageTray._notificationQueue?.map(n => n.title) ?? [],
        current: Main.messageTray._notification?.title ?? null,
        queue: Main.messageTray._notificationQueue?.length ?? -1,
        count: Main.messageTray.getSources().reduce((sum, s) => sum + s.notifications.length, 0),
    }))()`);
}

/** Destroys every GNOME notification so each check starts clean. */
function clearAll() {
    evaluate('Main.messageTray.getSources().forEach(source => source.destroy())');
    sleep(300);
}

/** @returns {number} resident memory of the shell under test, in KiB */
function shellRss() {
    return evaluate(`(() => {
        imports.system.gc();
        const [, bytes] = GLib.file_get_contents('/proc/self/status');
        return Number(/VmRSS:\\s+(\\d+)/.exec(new TextDecoder().decode(bytes))[1]);
    })()`);
}

/** @param {boolean} enabled */
function setDnd(enabled) {
    evaluate(`new (imports.gi.Gio.Settings)({schema_id: 'org.gnome.desktop.notifications'})
        .set_boolean('show-banners', ${!enabled})`);
    sleep(300);
}

function waitCollapsed() {
    return waitFor(() => nocellaState().state === 'collapsed', 8000);
}

export function run() {
    clearAll();
    try {
        checkBasics();
        checkGrouping();
        checkCritical();
        checkDnd();
        checkList();
        checkFullscreen();
        checkLoad();
        checkMirror();
    } finally {
        setDnd(false);
        evaluate(`delete global.display.get_monitor_in_fullscreen;
            global.display.emit('in-fullscreen-changed')`);
        clearAll();
    }
}

function checkBasics() {
    check('banners are blocked while the notch is visible', tray().blocked === true, tray());
    notify(['-a', 'Smoke', 'Hello from the smoke test', 'This is the body of the notification']);
    sleep(600);
    const n = nocellaState();
    const state = info();
    check('notify-send opens the notification transient', n.state === 'transient' &&
        n.content === 'notification', n);
    check('the notification transient is 420 wide and at least 92 tall',
        expectGeometry(state, 420, -92), state.notch);
    check('GNOME does not show its own banner, not even an invisible one', tray().gnomeState === 0, tray());
    screenshot('transient-notification', areaOf(state));
    check('the notification closes after 6 s', waitCollapsed());

    const process = notifyWithActions(['-a', 'Smoke', '-A', 'open=Open', '-A', 'later=Later',
        'Action test', 'Pick one']);
    sleep(800);
    const clicked = clickActor("n._transientPages.get('notification').actionButtons[0]");
    // Closing the notification makes notify-send exit, so a failed click cannot hang.
    if (!clicked)
        clearAll();
    const [, stdout] = process.communicate_utf8(null, null);
    check('the primary action pill invokes the notification action',
        clicked && stdout.trim() === 'open', {clicked, stdout});
    waitCollapsed();
    clearAll();
}

function checkGrouping() {
    for (const i of [1, 2, 3])
        notify(['-a', 'Burst', `Burst ${i}`, 'grouped']);
    sleep(500);
    const n = nocellaState();
    const extra = inNocella("n._state.content?.payload?.extra");
    check('three notifications of one app within 3 s share one card with +2',
        n.state === 'transient' && n.queue === 0 && extra === 2, {n, extra});
    pressKeys(['Escape']);
    waitCollapsed();
    clearAll();

    // Updating one notification (same ID) is not another notification.
    const first = Gio.Subprocess.new(['notify-send', '-p', '-a', 'Updater', 'Download', '10%'],
        Gio.SubprocessFlags.STDOUT_PIPE);
    const [, id] = first.communicate_utf8(null, null);
    for (const percent of ['40%', '70%', '100%']) {
        notify(['-r', id.trim(), '-a', 'Updater', 'Download', percent]);
        sleep(150);
    }
    sleep(400);
    const update = inNocella("n._state.content?.payload?.extra");
    const body = inNocella("n._notifications.find(n._state.content?.payload?.key)?.notification.body");
    check('updates of one notification stay one card without "+N", showing the latest text',
        update === 0 && body === '100%', {update, body});
    pressKeys(['Escape']);
    waitCollapsed();
    clearAll();

    notify(['-a', 'Smoke', '-e', 'Transient hint', 'gone after showing']);
    sleep(500);
    check('a transient-hint notification is shown', nocellaState().content === 'notification');
    check('the transient-hint notification closes after its TTL', waitCollapsed(),
        {n: nocellaState(), content: inNocella('n._state.content')});
    sleep(300);
    check('a transient-hint notification is removed once it left the notch', tray().count === 0,
        {tray: tray(), shown: inNocella('n._shownNotification'), entries: inNocella(`n._notifications.snapshot()
            .entries.map(e => [e.key, e.notification.title, e.notification.isTransient])`)});
}

function checkCritical() {
    notify(['-a', 'Smoke', '-u', 'critical', 'Critical test', 'Stays until handled']);
    sleep(500);
    const ttl = inNocella('n._state.content?.ttl');
    sleep(7000);
    const n = nocellaState();
    check('a critical notification stays longer than a normal one (TTL 60 s)',
        n.state === 'transient' && ttl === 60000, {n, ttl});
    inNocella('n._state.close()');
    sleep(400);
    const dot = inNocella("['danger', 'warning'].find(c => n._surface._dot.has_style_class_name(c)) ?? null");
    check('after closing, the badge stays red for the unread critical notification', dot === 'danger', dot);
    clearAll();
}

function checkDnd() {
    setDnd(true);
    check('do not disturb lets GNOME decide about banners (bannerBlocked off)', tray().blocked === false,
        tray());
    notify(['-a', 'Smoke', 'Quiet please', 'Sent during do not disturb']);
    sleep(700);
    const n = nocellaState();
    const dot = inNocella("['danger', 'warning'].find(c => n._surface._dot.has_style_class_name(c)) ?? null");
    check('during do not disturb the notch shows no transient, only the badge',
        n.state === 'collapsed' && dot === 'warning', {n, dot});
    setDnd(false);
    check('banners are blocked again after do not disturb', tray().blocked === true, tray());
    clearAll();
}

function checkList() {
    for (const i of [1, 2, 3, 4, 5, 6, 7])
        notify(['-a', `List ${i}`, `Listed ${i}`, 'for the today list']);
    sleep(400);
    waitCollapsed();
    const unread = inNocella("['danger', 'warning'].find(c => n._surface._dot.has_style_class_name(c)) ?? null");
    inNocella("n._state.toggle('today')");
    sleep(800);
    const list = inNocella(`(() => {
        const l = n._notificationList;
        return {cards: l._cards.get_n_children(), more: l._more.visible, empty: l._empty.visible};
    })()`);
    check('the today tab lists the newest 5 with "Show all"', list.cards === 5 && list.more && !list.empty, list);
    screenshot('pinned-notifications', areaOf(info()));
    inNocella('n._state.close()');
    sleep(400);
    const read = inNocella("['danger', 'warning'].find(c => n._surface._dot.has_style_class_name(c)) ?? null");
    check('opening the list marks notifications read: the orange badge goes away',
        unread === 'warning' && read === null, {unread, read});
    inNocella("n._state.toggle('today')");
    sleep(800);
    clickActor('n._notificationList._more');
    sleep(500);
    const scroll = inNocella('n._notificationList._cards.get_n_children()');
    check('"Show all" lists every notification in a scroll view', scroll === 7, scroll);
    clickActor('n._notificationList._clear');
    sleep(600);
    check('"Clear" removes the notifications from GNOME too', tray().count === 0, tray());
    inNocella('n._state.close()');
    sleep(400);
}

function checkFullscreen() {
    notify(['-a', 'Smoke', 'Before fullscreen', 'shown by the notch']);
    sleep(500);
    check('a notification is on screen before fullscreen', nocellaState().state === 'transient');
    evaluate(`global.display.get_monitor_in_fullscreen = () => true;
        global.display.emit('in-fullscreen-changed')`);
    sleep(100);
    const during = tray();
    check('entering fullscreen hides the notch and unblocks banners at once (D9)',
        nocellaState().state === 'suppressed' && info().notch?.visible === false && during.blocked === false,
        {n: nocellaState(), tray: during});
    check('the notification the notch showed is not queued for a GNOME banner again', during.queue === 0, during);
    notify(['-a', 'Smoke', 'During fullscreen', 'GNOME keeps this one for later']);
    sleep(600);
    // GNOME itself holds normal banners during fullscreen and shows critical ones.
    check('the next notification is kept in GNOME\'s banner queue, not lost', tray().queue === 1 &&
        tray().count === 2, tray());
    notify(['-a', 'Smoke', '-u', 'critical', 'Critical in fullscreen', 'GNOME shows this one']);
    sleep(800);
    check('a critical notification gets a GNOME banner during fullscreen', tray().banner === true, tray());
    evaluate(`delete global.display.get_monitor_in_fullscreen;
        global.display.emit('in-fullscreen-changed')`);
    sleep(600);
    const leaving = tray();
    check('after fullscreen GNOME shows the held notification itself; the block waits for it',
        nocellaState().state === 'collapsed' && leaving.banner === true && leaving.blocked === false &&
        inNocella('n._banner.waiting') === true, {n: nocellaState(), tray: leaving});
    // A critical GNOME banner stays until it is handled; close it like a user would.
    evaluate(`Main.messageTray.getSources().flatMap(s => s.notifications)
        .filter(n => n.title === 'Critical in fullscreen').forEach(n => n.destroy())`);
    check('once GNOME\'s banners are done, banners are blocked again',
        waitFor(() => tray().blocked === true && tray().gnomeState === 0, 20000), tray());
    clearAll();
}

function checkLoad() {
    const before = shellRss();
    for (let i = 1; i <= 100; i++) {
        notify(['-a', `Load ${i % 10}`, `Test ${i}`, `Notification number ${i}`]);
        sleep(100);
    }
    sleep(1500);
    clearAll();
    sleep(500);
    const after = shellRss();
    print(`# shell RSS before ${before} KiB, after 100 notifications ${after} KiB`);
    check('100 notifications raise memory by less than 10 MiB', after - before < 10 * 1024, {before, after});
    check('the arbiter queue stays bounded', nocellaState().queue <= 5, nocellaState());
    waitCollapsed();
}

function checkMirror() {
    // Simulates a GNOME version without bannerBlocked: with Nocella off (banners
    // unblocked), remove the setter, then enable again.
    evaluate(`Main.extensionManager.disableExtension('${UUID}')`);
    waitFor(() => extensionState() === State.INACTIVE, 5000);
    evaluate(`(() => {
        const proto = Object.getPrototypeOf(Main.messageTray);
        globalThis.nocellaBannerDescriptor = Object.getOwnPropertyDescriptor(proto, 'bannerBlocked');
        delete proto.bannerBlocked;
    })()`);
    evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
    waitFor(() => extensionState() === State.ACTIVE && nocellaState() !== null, 5000);
    sleep(300);
    try {
        notify(['-a', 'Smoke', 'Mirror test', 'GNOME and the notch both show this']);
        sleep(700);
        check('without bannerBlocked the notch mirrors: transient and GNOME banner both show',
            nocellaState().state === 'transient' && tray().banner === true && tray().blocked === false,
            {n: nocellaState(), tray: tray(), entries: inNocella(`n._notifications.snapshot().entries.map(e =>
                [e.notification.title, e.notification.acknowledged, e.notification.urgency,
                    e.source.policy?.showBanners, e.source.title])`),
            dnd: inNocella('n._notifications.doNotDisturb'), sources: inNocella('n._notifications._sourceSignals.size'),
            tracked: inNocella('n._notifications._tracked.size')});
    } finally {
        evaluate(`Main.extensionManager.disableExtension('${UUID}')`);
        waitFor(() => extensionState() === State.INACTIVE, 5000);
        evaluate(`(() => {
            const tray = Main.messageTray;
            // Writes made without the setter would have created an own property.
            delete tray.bannerBlocked;
            Object.defineProperty(Object.getPrototypeOf(tray), 'bannerBlocked',
                globalThis.nocellaBannerDescriptor);
            delete globalThis.nocellaBannerDescriptor;
        })()`);
        evaluate(`Main.extensionManager.enableExtension('${UUID}')`);
        waitFor(() => extensionState() === State.ACTIVE && nocellaState() !== null, 5000);
        sleep(300);
    }
    // GNOME showed its queued "unsafe mode" notice while unblocked, and that one stays
    // until handled; the block waits for it, so close it like a user would.
    clearAll();
    check('with bannerBlocked back, banners are blocked again',
        waitFor(() => tray().blocked === true, 15000), tray());
}

/**
 * @param {any} state from info()
 * @returns {{x: number, y: number, width: number, height: number}} logical pixels
 */
function areaOf(state) {
    return {
        x: (state.monitor.x + state.monitor.width / 2) / scale - 300,
        y: state.monitor.y / scale,
        width: 600,
        height: 420,
    };
}
