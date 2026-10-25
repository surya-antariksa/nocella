// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {
    formatBytes, formatPercent, formatRate, formatTemperature, formatTokens,
    formatTrackTime, formatUsedTotal, splitDuration,
} from '../extension/src/util/format.js';
import {assertEqual, finish, test} from './assert.js';

const KiB = 1024;
const MiB = KiB * 1024;
const GiB = MiB * 1024;

test('percent rounds to a whole number', () => {
    assertEqual(formatPercent(0.123), '12%');
    assertEqual(formatPercent(0.125), '13%');
});

test('percent is clamped to 0..100', () => {
    assertEqual(formatPercent(-0.2), '0%');
    assertEqual(formatPercent(1.7), '100%');
    assertEqual(formatPercent(NaN), '0%');
});

test('bytes below 1 KiB have no decimals', () => {
    assertEqual(formatBytes(0), '0 B');
    assertEqual(formatBytes(512), '512 B');
    assertEqual(formatBytes(1023), '1023 B');
});

test('bytes use binary units with one decimal', () => {
    assertEqual(formatBytes(1024), '1.0 KiB');
    assertEqual(formatBytes(1536), '1.5 KiB');
    assertEqual(formatBytes(4.2 * GiB), '4.2 GiB');
    assertEqual(formatBytes(3 * MiB), '3.0 MiB');
});

test('bytes cap at TiB', () => {
    assertEqual(formatBytes(2 * 1024 * GiB), '2.0 TiB');
    assertEqual(formatBytes(2048 * 1024 * GiB), '2048.0 TiB');
});

test('bytes round up across a unit boundary', () => {
    assertEqual(formatBytes(1023.6), '1.0 KiB');
    assertEqual(formatBytes(1023.98 * KiB), '1.0 MiB');
});

test('negative or invalid bytes show zero', () => {
    assertEqual(formatBytes(-5), '0 B');
    assertEqual(formatBytes(NaN), '0 B');
});

test('rate appends /s', () => {
    assertEqual(formatRate(1536), '1.5 KiB/s');
    assertEqual(formatRate(0), '0 B/s');
});

test('used/total shares the unit of the total', () => {
    assertEqual(formatUsedTotal(4.2 * GiB, 15.6 * GiB), '4.2 / 15.6 GiB');
    assertEqual(formatUsedTotal(512 * MiB, 15.6 * GiB), '0.5 / 15.6 GiB');
    assertEqual(formatUsedTotal(0, 0), '0 / 0 B');
});

test('temperature rounds to whole degrees', () => {
    assertEqual(formatTemperature(52), '52°C');
    assertEqual(formatTemperature(51.6), '52°C');
    assertEqual(formatTemperature(NaN), '--°C');
});

test('track time uses m:ss below one hour', () => {
    assertEqual(formatTrackTime(0), '0:00');
    assertEqual(formatTrackTime(65), '1:05');
    assertEqual(formatTrackTime(65.9), '1:05');
    assertEqual(formatTrackTime(3599), '59:59');
});

test('track time uses h:mm:ss from one hour', () => {
    assertEqual(formatTrackTime(3600), '1:00:00');
    assertEqual(formatTrackTime(3900), '1:05:00');
    assertEqual(formatTrackTime(36000 + 61), '10:01:01');
});

test('track time treats negative and NaN as zero', () => {
    assertEqual(formatTrackTime(-3), '0:00');
    assertEqual(formatTrackTime(NaN), '0:00');
});

test('tokens below 1000 are plain integers', () => {
    assertEqual(formatTokens(0), '0');
    assertEqual(formatTokens(950), '950');
    assertEqual(formatTokens(999), '999');
});

test('tokens use one decimal for k, M and B', () => {
    assertEqual(formatTokens(1000), '1.0k');
    assertEqual(formatTokens(18400), '18.4k');
    assertEqual(formatTokens(1_200_000), '1.2M');
    assertEqual(formatTokens(3_000_000_000), '3.0B');
});

test('tokens roll over to the next unit when rounding reaches 1000', () => {
    assertEqual(formatTokens(999_949), '999.9k');
    assertEqual(formatTokens(999_950), '1.0M');
    assertEqual(formatTokens(999_950_000), '1.0B');
    assertEqual(formatTokens(999.6), '1.0k');
});

test('tokens treat negative and NaN as zero', () => {
    assertEqual(formatTokens(-1), '0');
    assertEqual(formatTokens(NaN), '0');
});

test('splitDuration breaks seconds into whole parts', () => {
    assertEqual(splitDuration(3725.8), {hours: 1, minutes: 2, seconds: 5});
    assertEqual(splitDuration(59), {hours: 0, minutes: 0, seconds: 59});
    assertEqual(splitDuration(90061), {hours: 25, minutes: 1, seconds: 1});
});

test('splitDuration treats negative and NaN as zero', () => {
    assertEqual(splitDuration(-10), {hours: 0, minutes: 0, seconds: 0});
    assertEqual(splitDuration(NaN), {hours: 0, minutes: 0, seconds: 0});
});

finish();
