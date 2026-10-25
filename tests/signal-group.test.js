// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {SignalGroup} from '../extension/src/util/signal-group.js';
import {assertEqual, finish, test} from './assert.js';

class FakeEmitter {
    constructor() {
        /** @type {number[]} */
        this.disconnected = [];
    }

    /** @param {number} id */
    disconnect(id) {
        this.disconnected.push(id);
    }
}

test('clear disconnects every handler', () => {
    const a = new FakeEmitter();
    const b = new FakeEmitter();
    const group = new SignalGroup();
    group.add(a, 1);
    group.add(a, 2);
    group.add(b, 3);
    group.clear();
    assertEqual(a.disconnected, [1, 2]);
    assertEqual(b.disconnected, [3]);
});

test('clear is idempotent', () => {
    const a = new FakeEmitter();
    const group = new SignalGroup();
    group.add(a, 1);
    group.clear();
    group.clear();
    assertEqual(a.disconnected, [1]);
});

test('a disposed object does not stop the others from disconnecting', () => {
    const disposed = {
        disconnect() {
            throw new Error('Object already disposed');
        },
    };
    const a = new FakeEmitter();
    const group = new SignalGroup();
    group.add(disposed, 1);
    group.add(a, 2);
    group.clear();
    assertEqual(a.disconnected, [2]);
});

finish();
