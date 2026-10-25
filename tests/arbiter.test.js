// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {Arbiter} from '../extension/src/arbiter.js';
import {assertEqual, finish, test} from './assert.js';

/**
 * @param {string} type
 * @param {number} priority
 * @param {string} [coalesceKey]
 * @param {any} [payload]
 */
function event(type, priority, coalesceKey, payload) {
    return {type, priority, ttl: 1000, coalesceKey, payload};
}

function makeArbiter() {
    let now = 0;
    const arbiter = new Arbiter({now: () => now});
    return {arbiter, advance: (/** @type {number} */ ms) => (now += ms)};
}

test('the first event is shown', () => {
    const {arbiter} = makeArbiter();
    assertEqual(arbiter.push(event('volume', 70)), 'show');
    assertEqual(arbiter.current?.type, 'volume');
});

test('a higher priority replaces the current content', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('volume', 70, 'volume'));
    assertEqual(arbiter.push(event('notification', 90, 'app')), 'show');
    assertEqual(arbiter.current?.type, 'notification');
});

test('a lower priority waits in the queue', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('notification', 90, 'app'));
    assertEqual(arbiter.push(event('volume', 70, 'volume')), 'queued');
    assertEqual(arbiter.current?.type, 'notification');
    assertEqual(arbiter.queue.map(e => e.type), ['volume']);
});

test('equal priority: the newest event replaces the old one', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('notification', 90, 'a', 'first'));
    assertEqual(arbiter.push(event('notification', 90, 'b', 'second')), 'show');
    assertEqual(arbiter.current?.payload, 'second');
});

test('the same coalesce key updates the current content in place', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('volume-changed', 70, 'volume', 10));
    for (let i = 2; i <= 10; i++)
        assertEqual(arbiter.push(event('volume-changed', 70, 'volume', i * 10)), 'update');
    assertEqual(arbiter.current?.payload, 100);
    assertEqual(arbiter.queue.length, 0);
});

test('a lower-priority update with the current key still coalesces', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('media-changed', 80, 'media', 'track'));
    assertEqual(arbiter.push(event('media-status', 60, 'media', 'paused')), 'update');
    assertEqual(arbiter.current?.payload, 'paused');
});

test('the same coalesce key updates a queued item instead of adding one', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('notification', 90, 'app'));
    arbiter.push(event('volume-changed', 70, 'volume', 1));
    assertEqual(arbiter.push(event('volume-changed', 70, 'volume', 2)), 'queued');
    assertEqual(arbiter.queue.length, 1);
    assertEqual(arbiter.queue[0].payload, 2);
});

test('the queue holds at most 5 items and drops the lowest priority first', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('critical', 100, 'c'));
    for (const [i, priority] of [40, 50, 60, 70, 75].entries())
        arbiter.push(event(`e${i}`, priority, `k${i}`));
    assertEqual(arbiter.queue.length, 5);
    assertEqual(arbiter.push(event('better', 80, 'better')), 'queued');
    assertEqual(arbiter.queue.length, 5);
    assertEqual(arbiter.queue.some(e => e.priority === 40), false, 'lowest priority dropped');
    assertEqual(arbiter.push(event('worst', 10, 'worst')), 'dropped');
});

test('a full queue with equal priorities drops the oldest, not the newcomer', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('critical', 100, 'c'));
    for (let i = 0; i < 5; i++)
        arbiter.push(event(`old${i}`, 50, `k${i}`));
    assertEqual(arbiter.push(event('new', 50, 'new')), 'queued');
    assertEqual(arbiter.queue.map(e => e.type), ['old1', 'old2', 'old3', 'old4', 'new']);
});

test('next() promotes the highest queued priority, oldest first among equals', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('critical', 100, 'c'));
    arbiter.push(event('workspace', 40, 'workspace'));
    arbiter.push(event('first-70', 70, 'a'));
    arbiter.push(event('second-70', 70, 'b'));
    assertEqual(arbiter.next()?.type, 'first-70');
    assertEqual(arbiter.next()?.type, 'second-70');
    assertEqual(arbiter.next()?.type, 'workspace');
    assertEqual(arbiter.next(), null);
    assertEqual(arbiter.current, null);
});

test('queued events expire after 5 seconds', () => {
    const {arbiter, advance} = makeArbiter();
    arbiter.push(event('notification', 90, 'app'));
    arbiter.push(event('volume', 70, 'volume'));
    advance(5001);
    assertEqual(arbiter.queue.length, 0);
    assertEqual(arbiter.next(), null);
});

test('clear() forgets the current content and the queue', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('notification', 90, 'app'));
    arbiter.push(event('volume', 70, 'volume'));
    arbiter.clear();
    assertEqual(arbiter.current, null);
    assertEqual(arbiter.queue.length, 0);
    assertEqual(arbiter.push(event('volume', 70, 'volume')), 'show');
});

test('events without a coalesce key never coalesce', () => {
    const {arbiter} = makeArbiter();
    arbiter.push(event('a', 50));
    assertEqual(arbiter.push(event('b', 40)), 'queued');
    assertEqual(arbiter.push(event('c', 40)), 'queued');
    assertEqual(arbiter.queue.length, 2);
});

finish();
