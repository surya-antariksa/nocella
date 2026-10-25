// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {Delay, State, StateMachine} from '../extension/src/state.js';
import {assertEqual, finish, test} from './assert.js';
import {FakeTimers} from './fake-timers.js';

/**
 * @param {object} [options]
 * @param {Array<any>} [options.queue] events handed out when a transient expires
 * @param {number} [options.idleMs]
 * @param {() => boolean} [options.canIdleCollapse]
 */
function makeMachine({queue = [], idleMs = 0, canIdleCollapse = () => true} = {}) {
    const timers = new FakeTimers();
    /** @type {import('../extension/src/state.js').StateChange[]} */
    const changes = [];
    const machine = new StateMachine({
        timers,
        onChange: change => changes.push(change),
        nextTransient: () => queue.shift() ?? null,
        idleCollapseMs: () => idleMs,
        canIdleCollapse,
    });
    return {machine, timers, changes};
}

/**
 * @param {string} type
 * @param {number} [ttl]
 */
function event(type, ttl = 4000) {
    return {type, priority: 80, ttl, coalesceKey: type};
}

test('starts collapsed with no timers', () => {
    const {machine, timers} = makeMachine();
    assertEqual(machine.state, State.COLLAPSED);
    assertEqual(timers.size, 0);
});

test('hovering 140 ms opens the peek', () => {
    const {machine, timers} = makeMachine();
    machine.hoverEnter();
    timers.advance(Delay.PEEK - 1);
    assertEqual(machine.state, State.COLLAPSED);
    timers.advance(1);
    assertEqual(machine.state, State.PEEK);
});

test('a quick pass over the notch does not peek', () => {
    const {machine, timers} = makeMachine();
    machine.hoverEnter();
    timers.advance(100);
    machine.hoverLeave();
    timers.advance(1000);
    assertEqual(machine.state, State.COLLAPSED);
    assertEqual(timers.size, 0);
});

test('the peek closes 320 ms after the pointer leaves, unless it comes back', () => {
    const {machine, timers} = makeMachine();
    machine.hoverEnter();
    timers.advance(Delay.PEEK);
    machine.hoverLeave();
    timers.advance(200);
    machine.hoverEnter();
    timers.advance(1000);
    assertEqual(machine.state, State.PEEK, 'coming back cancels the leave timer');
    machine.hoverLeave();
    timers.advance(Delay.PEEK_LEAVE);
    assertEqual(machine.state, State.COLLAPSED);
});

test('a transient closes after its TTL', () => {
    const {machine, timers} = makeMachine();
    machine.showTransient(event('media-changed', 4000));
    assertEqual(machine.state, State.TRANSIENT);
    assertEqual(machine.content?.type, 'media-changed');
    timers.advance(3999);
    assertEqual(machine.state, State.TRANSIENT);
    timers.advance(1);
    assertEqual(machine.state, State.COLLAPSED);
    assertEqual(machine.content, null);
});

test('hovering holds a transient; leaving restarts its TTL', () => {
    const {machine, timers} = makeMachine();
    machine.showTransient(event('notification', 6000));
    timers.advance(5000);
    machine.hoverEnter();
    timers.advance(60000);
    assertEqual(machine.state, State.TRANSIENT);
    machine.hoverLeave();
    timers.advance(5999);
    assertEqual(machine.state, State.TRANSIENT);
    timers.advance(1);
    assertEqual(machine.state, State.COLLAPSED);
});

test('an expired transient hands over to the next queued content', () => {
    const {machine, timers} = makeMachine({queue: [event('volume-changed', 1500)]});
    machine.showTransient(event('notification', 6000));
    timers.advance(6000);
    assertEqual(machine.state, State.TRANSIENT);
    assertEqual(machine.content?.type, 'volume-changed');
    timers.advance(1500);
    assertEqual(machine.state, State.COLLAPSED);
});

test('updating a transient replaces the content and resets the TTL', () => {
    const {machine, timers, changes} = makeMachine();
    machine.showTransient(event('volume-changed', 1500));
    timers.advance(1000);
    machine.updateTransient({...event('volume-changed', 1500), payload: 42});
    timers.advance(1000);
    assertEqual(machine.state, State.TRANSIENT);
    assertEqual(machine.content?.payload, 42);
    assertEqual(changes.at(-1)?.previous, State.TRANSIENT, 'no new transition');
    timers.advance(500);
    assertEqual(machine.state, State.COLLAPSED);
});

test('a click opens the pinned view chosen by the caller', () => {
    const {machine} = makeMachine();
    machine.showTransient(event('media-changed'));
    machine.click('media');
    assertEqual(machine.state, State.PINNED);
    assertEqual(machine.view, 'media');
    assertEqual(machine.content, null);
});

test('transients are ignored while pinned', () => {
    const {machine} = makeMachine();
    machine.click('today');
    machine.showTransient(event('notification'));
    assertEqual(machine.state, State.PINNED);
    assertEqual(machine.view, 'today');
});

test('close() returns to collapsed from pinned, peek, and transient', () => {
    const {machine, timers} = makeMachine();
    machine.click('today');
    machine.close();
    assertEqual(machine.state, State.COLLAPSED);
    machine.hoverEnter();
    timers.advance(Delay.PEEK);
    machine.close();
    assertEqual(machine.state, State.COLLAPSED);
    machine.showTransient(event('media-changed'));
    machine.close();
    assertEqual(machine.state, State.COLLAPSED);
    assertEqual(timers.size, 0);
});

test('suppression hides any state and comes back collapsed, not pinned', () => {
    const {machine, timers} = makeMachine();
    machine.click('media');
    machine.suppress('overview');
    assertEqual(machine.state, State.SUPPRESSED);
    machine.showTransient(event('notification'));
    assertEqual(machine.state, State.SUPPRESSED);
    machine.release('overview');
    assertEqual(machine.state, State.COLLAPSED);
    assertEqual(timers.size, 0);
});

test('overlapping reasons: the notch returns only when all are gone', () => {
    const {machine} = makeMachine();
    machine.suppress('fullscreen');
    machine.suppress('overview');
    machine.release('fullscreen');
    assertEqual(machine.state, State.SUPPRESSED);
    machine.release('overview');
    assertEqual(machine.state, State.COLLAPSED);
});

test('the hotkey opens the panel over fullscreen, and closing goes back to suppressed', () => {
    const {machine} = makeMachine();
    machine.suppress('fullscreen');
    machine.toggle('today');
    assertEqual(machine.state, State.PINNED);
    assertEqual(machine.pinnedOverSuppression, true);
    machine.toggle('today');
    assertEqual(machine.state, State.SUPPRESSED);
    assertEqual(machine.pinnedOverSuppression, false);
});

test('the hotkey does not open the panel over the overview or a disabled notch', () => {
    const {machine} = makeMachine();
    machine.suppress('overview');
    machine.toggle('today');
    assertEqual(machine.state, State.SUPPRESSED);
    machine.release('overview');
    machine.suppress('disabled');
    machine.toggle('today');
    assertEqual(machine.state, State.SUPPRESSED);
});

test('leaving fullscreen while pinned over it keeps the panel open', () => {
    const {machine} = makeMachine();
    machine.suppress('fullscreen');
    machine.toggle('today');
    machine.release('fullscreen');
    assertEqual(machine.state, State.PINNED);
    assertEqual(machine.pinnedOverSuppression, false);
    machine.close();
    assertEqual(machine.state, State.COLLAPSED);
});

test('opening the overview while pinned over fullscreen suppresses', () => {
    const {machine} = makeMachine();
    machine.suppress('fullscreen');
    machine.toggle('today');
    machine.suppress('overview');
    assertEqual(machine.state, State.SUPPRESSED);
});

test('the pinned panel closes after the idle timeout', () => {
    const {machine, timers} = makeMachine({idleMs: 180000});
    machine.click('today');
    timers.advance(100000);
    machine.interaction();
    timers.advance(179999);
    assertEqual(machine.state, State.PINNED);
    timers.advance(1);
    assertEqual(machine.state, State.COLLAPSED);
});

test('the idle timeout keeps the panel open while media plays', () => {
    let playing = true;
    const {machine, timers} = makeMachine({idleMs: 180000, canIdleCollapse: () => !playing});
    machine.click('media');
    timers.advance(180000 * 3);
    assertEqual(machine.state, State.PINNED);
    playing = false;
    timers.advance(180000);
    assertEqual(machine.state, State.COLLAPSED);
});

test('an idle timeout of 0 never closes the panel', () => {
    const {machine, timers} = makeMachine({idleMs: 0});
    machine.click('today');
    timers.advance(3600000);
    assertEqual(machine.state, State.PINNED);
    assertEqual(timers.size, 0);
});

test('selectView switches tabs only while pinned', () => {
    const {machine, changes} = makeMachine();
    machine.selectView('media');
    assertEqual(changes.length, 0);
    machine.click('today');
    machine.selectView('system');
    assertEqual(machine.view, 'system');
    assertEqual(changes.at(-1)?.previous, State.PINNED);
});

test('destroy() cancels every timer', () => {
    const {machine, timers} = makeMachine({idleMs: 1000});
    machine.hoverEnter();
    machine.showTransient(event('media-changed'));
    machine.destroy();
    assertEqual(timers.size, 0);
});

finish();
