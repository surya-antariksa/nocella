// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Phase 2 gate (G2): state machine, arbiter, and media, driven by a fake MPRIS player.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    ACTIVE_SOURCES, INSTRUMENT, State, UUID, VERIFY, check, checkCleanDisable, clickActor, clickOutside, evaluate,
    expectGeometry, extensionState, hoverNotch, info, nocellaState, pointerAway, pressKeys,
    scale, screenshot, sleep, waitFor,
} from './lib.js';

const PLAYER_BUS = 'org.mpris.MediaPlayer2.nocellatest';
const PLAYER_PATH = '/org/mpris/MediaPlayer2';
const CONTROL = 'id.antariksa.Nocella.TestPlayer';
const SECOND = 1_000_000;

/**
 * @param {string} method
 * @param {any} [args] a `GLib.Variant` tuple
 * @returns {any}
 */
function player(method, args = null) {
    const reply = Gio.DBus.session.call_sync(PLAYER_BUS, PLAYER_PATH, CONTROL, method, args, null,
        Gio.DBusCallFlags.NONE, 5000, null);
    return reply?.deepUnpack();
}

/**
 * @param {string} id
 * @param {string} title
 * @param {number} lengthUs
 */
function setTrack(id, title, lengthUs = 200 * SECOND) {
    player('SetTrack', new GLib.Variant('(sssx)', [`/org/mpris/MediaPlayer2/Track/${id}`, title,
        'Nocella Tester', lengthUs]));
}

/** @param {string} status */
function setStatus(status) {
    player('SetStatus', new GLib.Variant('(s)', [status]));
}

/** @returns {Record<string, number>} */
function calls() {
    return player('GetCalls')[0];
}

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

/** @returns {any} the media snapshot of the provider */
function media() {
    return inNocella('n._media.snapshot()');
}

/** @returns {number} resident memory of the shell under test, in KiB */
function shellRss() {
    return evaluate(`(() => {
        imports.system.gc();
        const [, bytes] = GLib.file_get_contents('/proc/self/status');
        const text = new TextDecoder().decode(bytes);
        return Number(/VmRSS:\\s+(\\d+)/.exec(text)[1]);
    })()`);
}

/** @returns {any} a `Gio.Subprocess` running the fake player */
function startPlayer() {
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const process = Gio.Subprocess.new(['gjs', '-m', `${here}/fake-mpris.js`], Gio.SubprocessFlags.NONE);
    const ready = waitFor(() => {
        player('GetCalls');
        return true;
    }, 10000);
    check('the fake MPRIS player is on the bus', ready);
    return process;
}

export function run() {
    const fake = startPlayer();
    evaluate(INSTRUMENT);
    try {
        checkMedia();
        checkInput();
        checkStress();
    } finally {
        evaluate(VERIFY);
    }
    try {
        // Disable with a live player, its proxy, and the progress timer running.
        setStatus('Playing');
        checkCleanDisable({
            label: 'media playing',
            minSignals: 15,
            setup: () => {
                waitFor(() => media().available, 5000);
                inNocella("n._state.toggle('media')");
                sleep(1200);
            },
        });
        checkVanish(fake);
    } finally {
        try {
            player('Quit');
        } catch {}
        fake.force_exit();
        fake.wait(null);
    }
}

function checkMedia() {
    // The player is seen with an empty track first; that is its state, not news.
    check('the notch sees the fake player', waitFor(() => media().available, 5000));
    check('a player appearing does not open a transient', nocellaState().state === 'collapsed',
        nocellaState());

    setTrack('1', 'Track 1');
    setStatus('Playing');
    sleep(700);
    let n = nocellaState();
    check('a new track opens the media transient', n.state === 'transient' && n.content === 'media-changed',
        n);
    let state = info();
    check('the media transient is 380 wide and at least 68 tall, centered',
        expectGeometry(state, 380, -68), state.notch);
    check('the transient hides the clock and shows one page', n.bodyChildren === 1 && n.mode === 'transient',
        n);
    screenshot('transient-media', screenshotArea(state));

    for (const i of [2, 3, 4]) {
        setTrack(String(i), `Track ${i}`);
        sleep(90);
    }
    sleep(500);
    n = nocellaState();
    const title = inNocella("n._transientPages.get('media')._title.text");
    check('three quick track changes give one card with the last track',
        n.state === 'transient' && n.queue === 0 && n.bodyChildren === 1 && title === 'Track 4',
        {n, title});

    check('the transient closes after its 4 s TTL', waitFor(() => nocellaState().state === 'collapsed', 5500));

    setStatus('Paused');
    sleep(600);
    n = nocellaState();
    check('pausing shows the play/pause transient', n.state === 'transient' && n.content === 'media-status', n);
    check('the status transient closes after 2 s', waitFor(() => nocellaState().state === 'collapsed', 3000));

    setStatus('Playing');
    sleep(600);
    const before = calls().PlayPause ?? 0;
    const clicked = clickActor("n._transientPages.get('media')._playButton");
    sleep(500);
    check('the transient play/pause button controls the player',
        clicked && (calls().PlayPause ?? 0) === before + 1 && media().status === 'Paused',
        {clicked, calls: calls(), status: media().status});
    check('a click on the button does not open the panel', nocellaState().state !== 'pinned');
    waitFor(() => nocellaState().state === 'collapsed', 3000);

    // A two-hour track, one hour and five minutes in.
    setTrack('long', 'Long Track', 7200 * SECOND);
    player('SeekTo', new GLib.Variant('(x)', [3900 * SECOND]));
    setStatus('Playing');
    sleep(500);
    inNocella("n._state.toggle('media')");
    sleep(1300);
    n = nocellaState();
    const times = inNocella("[n._pinnedPages.get('media')._elapsed.text, n._pinnedPages.get('media')._length.text]");
    const fraction = media().fraction;
    check('the pinned media tab opens', n.state === 'pinned' && n.view === 'media' && n.grab, n);
    check('progress is right for a track over an hour', /^1:05:0\d$/.test(times[0]) && times[1] === '2:00:00' &&
        fraction > 0.54 && fraction < 0.55, {times, fraction});
    const pinnedTimers = evaluate(ACTIVE_SOURCES);
    check('the progress timer runs while the media tab is visible',
        pinnedTimers.filter(s => s.interval === 1000).length === 1, pinnedTimers);
    screenshot('pinned-media', screenshotArea(info()));

    pressKeys(['Escape']);
    sleep(600);
    n = nocellaState();
    check('Escape closes the panel and drops the grab', n.state === 'collapsed' && !n.grab, n);
    const collapsedTimers = evaluate(ACTIVE_SOURCES);
    check('collapsed has no progress timer, and no timers at all, while media plays',
        media().status === 'Playing' && collapsedTimers.length === 0, collapsedTimers);
}

function checkInput() {
    pressKeys(['Super_L', 'i']);
    sleep(600);
    let n = nocellaState();
    check('the hotkey opens the panel on the last view', n.state === 'pinned' && n.view === 'media', n);
    const clicked = clickActor("n._tabs._segments.get('today').button");
    sleep(500);
    n = nocellaState();
    check('a tab switches the pinned view', clicked && n.view === 'today', n);
    const tabs = inNocella(`(() => {
        const x = a => a.get_transformed_position()[0];
        return {indicator: x(n._tabs._indicator), selected: x(n._tabs.selectedButton),
            id: n._tabs.selected, translation: n._tabs._indicator.translation_x,
            moving: n._tabs._indicator.get_transition('translation-x') !== null};
    })()`);
    check('the tab indicator sits under the selected segment', Math.abs(tabs.indicator - tabs.selected) <= 1,
        tabs);
    screenshot('pinned-today', screenshotArea(info()));
    pressKeys(['Super_L', 'i']);
    sleep(600);
    check('the hotkey closes the open panel', nocellaState().state === 'collapsed', nocellaState());

    const dot = inNocella(`(() => {
        const right = a => a.get_transformed_position()[0] + a.get_transformed_size()[0];
        return {dot: right(n._surface._dot), notch: right(n._surface.actor), visible: n._surface._dot.mapped};
    })()`);
    check('the status dot sits at the right edge of the collapsed notch',
        dot.visible && Math.abs(dot.notch - 16 * scale - dot.dot) <= 1, dot);

    inNocella("n._state.toggle('today')");
    sleep(500);
    evaluate('Main.overview.show()');
    sleep(800);
    n = nocellaState();
    check('the overview over the open panel suppresses it and drops the grab',
        n.state === 'suppressed' && !n.grab, n);
    evaluate('Main.overview.hide()');
    sleep(800);
    const returned = info();
    check('after the overview the notch returns collapsed at its collapsed size',
        nocellaState().state === 'collapsed' && expectGeometry(returned, 196, 0), returned.notch);

    inNocella("n._state.toggle('today')");
    sleep(500);
    const close = inNocella(`(() => {
        const right = a => a.get_transformed_position()[0] + a.get_transformed_size()[0];
        return {button: right(n._surface.closeButton), panel: right(n._surface.actor)};
    })()`);
    check('the close button sits at the right edge of the header',
        Math.abs(close.panel - 16 * scale - close.button) <= 1, close);
    clickActor('n._surface.closeButton');
    sleep(500);
    check('the close button closes the panel', nocellaState().state === 'collapsed', nocellaState());

    hoverNotch();
    sleep(60);
    pointerAway();
    sleep(500);
    check('passing over the notch quickly does not peek', nocellaState().state === 'collapsed');

    hoverNotch();
    sleep(450);
    n = nocellaState();
    const peekText = inNocella('n._peekLabel.text');
    const state = info();
    check('resting on the notch opens the peek with the media line',
        n.state === 'peek' && peekText.includes('Long Track') && expectGeometry(state, 300, -64),
        {n, peekText, notch: state.notch});
    screenshot('peek', screenshotArea(state));
    pointerAway();
    sleep(700);
    check('the peek closes after the pointer leaves', nocellaState().state === 'collapsed', nocellaState());

    inNocella("n.debugEmit({type: 'media-changed', priority: 80, ttl: 800, coalesceKey: 'media'})");
    sleep(300);
    check('debugEmit opens a transient without a real event', nocellaState().state === 'transient');
    check('the debug transient follows its TTL', waitFor(() => nocellaState().state === 'collapsed', 2000));
}

function checkStress() {
    const before = shellRss();
    for (let i = 1; i <= 50; i++) {
        setTrack(`stress_${i}`, `Stress ${i}`);
        sleep(200);
    }
    sleep(800);
    const after = shellRss();
    const snapshot = media();
    print(`# shell RSS before ${before} KiB, after 50 track changes ${after} KiB`);
    check('50 track changes keep memory stable (< 8 MiB growth)', after - before < 8 * 1024,
        {before, after});
    check('50 track changes end on the last track with one player and one card',
        snapshot.track?.title === 'Stress 50' && inNocella('n._media._players.size') === 1 &&
        nocellaState().queue === 0, {title: snapshot.track?.title, n: nocellaState()});
    waitFor(() => nocellaState().state === 'collapsed', 5000);
}

/** @param {any} fake */
function checkVanish(fake) {
    setStatus('Playing');
    sleep(300);
    player('Quit');
    fake.wait(null);
    sleep(600);
    check('a vanished player is held for a moment', media().available === true, media());
    check('then the media is cleared after about 2 s', waitFor(() => media().available === false, 3000));
    check('nocella is still active after the player vanished', extensionState() === 1);
    inNocella("n._state.toggle('media')");
    sleep(500);
    const empty = inNocella("n._pinnedPages.get('media')._empty.visible");
    check('the media tab shows its empty state', empty === true);
    clickOutside();
    sleep(500);
}

/**
 * @param {any} state from info()
 * @returns {{x: number, y: number, width: number, height: number}} logical pixels
 */
function screenshotArea(state) {
    return {
        x: (state.monitor.x + state.monitor.width / 2) / scale - 300,
        y: state.monitor.y / scale,
        width: 600,
        height: 420,
    };
}
