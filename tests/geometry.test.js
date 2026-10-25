// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {centeredX, collapsedSize, pinnedSize, surfaceSize} from '../extension/src/geometry.js';
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

const collapsed = {width: 196, height: 32};

test('peek is 300x64, or taller when the panel leaves no room for its line', () => {
    assertEqual(surfaceSize({mode: 'peek', scaleFactor: 1, collapsed, monitor}), {width: 300, height: 64});
    assertEqual(surfaceSize({mode: 'peek', scaleFactor: 1, collapsed: {width: 196, height: 48}, monitor}),
        {width: 300, height: 72});
});

test('transient sizes follow the content kind', () => {
    assertEqual(surfaceSize({mode: 'transient', kind: 'media', scaleFactor: 1, collapsed, monitor}),
        {width: 380, height: 68});
    assertEqual(surfaceSize({mode: 'transient', kind: 'notification', scaleFactor: 2,
        collapsed: {width: 392, height: 64}, monitor}), {width: 840, height: 184});
});

test('content taller than the design grows the surface downwards', () => {
    assertEqual(surfaceSize({mode: 'pinned', scaleFactor: 1, collapsed, naturalHeight: 300.4, monitor}),
        {width: 420, height: 301});
    assertEqual(surfaceSize({mode: 'pinned', scaleFactor: 1, collapsed, naturalHeight: 100, monitor}),
        {width: 420, height: 220});
});

test('the width is clamped to the monitor minus a margin', () => {
    assertEqual(surfaceSize({mode: 'pinned', scaleFactor: 1, collapsed,
        monitor: {x: 0, y: 0, width: 400, height: 800}}).width, 368);
});

test('collapsed mode returns the collapsed size', () => {
    assertEqual(surfaceSize({mode: 'collapsed', scaleFactor: 1, collapsed, monitor}), collapsed);
});

finish();
