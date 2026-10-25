// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

/**
 * @typedef {object} CalendarDay
 * @property {number} year
 * @property {number} month 1..12
 * @property {number} day
 * @property {boolean} inMonth
 * @property {boolean} today
 */

/**
 * Builds the month grid for the "Today" view: whole weeks that cover the month,
 * starting on the locale's first weekday.
 *
 * @param {object} params
 * @param {number} params.year
 * @param {number} params.month 1..12
 * @param {number} params.weekStart 0 = Sunday, 1 = Monday, ...
 * @param {{year: number, month: number, day: number}} params.today
 * @returns {{weekdays: number[], weeks: CalendarDay[][]}} weekdays are 0..6 (0 = Sunday)
 */
export function monthGrid({year, month, weekStart, today}) {
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() - weekStart + 7) % 7;
    const daysInMonth = new Date(year, month, 0).getDate();
    const cells = Math.ceil((offset + daysInMonth) / 7) * 7;

    /** @type {CalendarDay[][]} */
    const weeks = [];
    for (let i = 0; i < cells; i++) {
        const date = new Date(year, month - 1, 1 - offset + i);
        const day = {
            year: date.getFullYear(),
            month: date.getMonth() + 1,
            day: date.getDate(),
            inMonth: date.getMonth() === month - 1,
            today: date.getFullYear() === today.year && date.getMonth() + 1 === today.month &&
                date.getDate() === today.day,
        };
        if (i % 7 === 0)
            weeks.push([]);
        weeks[weeks.length - 1].push(day);
    }
    const weekdays = Array.from({length: 7}, (_, i) => (weekStart + i) % 7);
    return {weekdays, weeks};
}
