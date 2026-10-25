// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {centeredX, collapsedSize, pinnedSize} from '../extension/src/geometry.js';
import {assertEqual, finish, test} from './assert.js';

const monitor = {x: 0, y: 0, width: 1920, height: 1080};

test('collapsed notch is centered on the monitor', () => {
    assertEqual(centeredX(monitor, 196), 862);
});

test('centering accounts for the monitor offset', () => {
    assertEqual(centeredX({...monitor, x: 1920}, 196), 2782);
});

test('odd remainders round to whole pixels', () => {
    assertEqual(centeredX({...monitor, width: 1366}, 196), 585);
});

test('collapsed size follows the panel height', () => {
    assertEqual(collapsedSize({scaleFactor: 1, panelHeight: 32, use12h: false}),
        {width: 196, height: 32});
});

test('collapsed size falls back to 32 px before the panel is allocated', () => {
    assertEqual(collapsedSize({scaleFactor: 2, panelHeight: 0, use12h: false}),
        {width: 392, height: 64});
});

test('12-hour clock widens the notch', () => {
    assertEqual(collapsedSize({scaleFactor: 1, panelHeight: 32, use12h: true}).width, 206);
});

test('panel height is already in device pixels and is not scaled again', () => {
    assertEqual(collapsedSize({scaleFactor: 2, panelHeight: 64, use12h: false}),
        {width: 392, height: 64});
});

test('pinned size scales with the scale factor', () => {
    assertEqual(pinnedSize({scaleFactor: 2}), {width: 840, height: 480});
});

finish();
