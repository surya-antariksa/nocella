// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {monthGrid} from '../extension/src/util/calendar.js';
import {assertEqual, finish, test} from './assert.js';

const today = {year: 2026, month: 10, day: 25};

test('October 2026 starting on Monday has 5 weeks', () => {
    const {weekdays, weeks} = monthGrid({year: 2026, month: 10, weekStart: 1, today});
    assertEqual(weekdays, [1, 2, 3, 4, 5, 6, 0]);
    assertEqual(weeks.length, 5);
    // 1 October 2026 is a Thursday: three days of September come first.
    assertEqual(weeks[0].map(d => d.day), [28, 29, 30, 1, 2, 3, 4]);
    assertEqual(weeks[0][0].inMonth, false);
    assertEqual(weeks[4].map(d => d.day), [26, 27, 28, 29, 30, 31, 1]);
});

test('the same month starting on Sunday shifts the columns', () => {
    const {weekdays, weeks} = monthGrid({year: 2026, month: 10, weekStart: 0, today});
    assertEqual(weekdays[0], 0);
    assertEqual(weeks[0].map(d => d.day), [27, 28, 29, 30, 1, 2, 3]);
});

test('today is marked once', () => {
    const {weeks} = monthGrid({year: 2026, month: 10, weekStart: 1, today});
    const marked = weeks.flat().filter(d => d.today);
    assertEqual(marked.map(d => [d.month, d.day]), [[10, 25]]);
});

test('a February that fits exactly in 4 weeks', () => {
    // 1 February 2027 is a Monday and February 2027 has 28 days.
    const {weeks} = monthGrid({year: 2027, month: 2, weekStart: 1, today});
    assertEqual(weeks.length, 4);
    assertEqual(weeks.flat().every(d => d.inMonth), true);
});

test('a month can need 6 weeks', () => {
    // 1 August 2026 is a Saturday; with Monday first, 31 days span 6 rows.
    assertEqual(monthGrid({year: 2026, month: 8, weekStart: 1, today}).weeks.length, 6);
});

test('December rolls over into January of the next year', () => {
    const {weeks} = monthGrid({year: 2026, month: 12, weekStart: 1, today});
    const last = weeks.at(-1)?.at(-1);
    assertEqual([last?.year, last?.month], [2027, 1]);
});

finish();
