// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Language-neutral formatters: numbers and unit symbols only. Localized text
// is assembled by the UI through gettext.

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
const TOKEN_UNITS = ['k', 'M', 'B'];

/**
 * @param {number} value
 * @param {number} unit index into BYTE_UNITS
 * @returns {number} value rounded the way it will be displayed
 */
function displayRound(value, unit) {
    return unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * @param {number} bytes
 * @returns {number} index into BYTE_UNITS that keeps the displayed value below 1024
 */
function byteUnit(bytes) {
    let unit = 0;
    let value = bytes;
    while (unit < BYTE_UNITS.length - 1 && displayRound(value, unit) >= 1024) {
        value /= 1024;
        unit++;
    }
    return unit;
}

/**
 * @param {number} value already divided into its unit
 * @param {number} unit index into BYTE_UNITS
 * @returns {string}
 */
function byteNumber(value, unit) {
    return unit === 0 ? String(Math.round(value)) : value.toFixed(1);
}

/**
 * @param {number} fraction 0..1
 * @returns {string} for example '12%'
 */
export function formatPercent(fraction) {
    if (!Number.isFinite(fraction))
        return '0%';
    return `${Math.round(Math.min(100, Math.max(0, fraction * 100)))}%`;
}

/**
 * @param {number} bytes
 * @returns {string} binary units, for example '4.2 GiB', '512 B'
 */
export function formatBytes(bytes) {
    const safe = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    const unit = byteUnit(safe);
    return `${byteNumber(safe / 1024 ** unit, unit)} ${BYTE_UNITS[unit]}`;
}

/**
 * @param {number} bytesPerSecond
 * @returns {string} for example '1.5 MiB/s'
 */
export function formatRate(bytesPerSecond) {
    return `${formatBytes(bytesPerSecond)}/s`;
}

/**
 * @param {number} used bytes
 * @param {number} total bytes; its magnitude picks the shared unit
 * @returns {string} for example '4.2 / 15.6 GiB'
 */
export function formatUsedTotal(used, total) {
    const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
    const safeUsed = Number.isFinite(used) && used > 0 ? used : 0;
    const unit = byteUnit(safeTotal);
    const scale = 1024 ** unit;
    return `${byteNumber(safeUsed / scale, unit)} / ${byteNumber(safeTotal / scale, unit)} ${BYTE_UNITS[unit]}`;
}

/**
 * @param {number} celsius
 * @returns {string} for example '52°C'
 */
export function formatTemperature(celsius) {
    if (!Number.isFinite(celsius))
        return '--°C';
    return `${Math.round(celsius)}°C`;
}

/**
 * @param {number} seconds
 * @returns {string} 'm:ss' below one hour, 'h:mm:ss' from one hour on
 */
export function formatTrackTime(seconds) {
    const {hours, minutes, seconds: secs} = splitDuration(seconds);
    const ss = String(secs).padStart(2, '0');
    if (hours > 0)
        return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
    return `${minutes}:${ss}`;
}

/**
 * @param {number} n token count
 * @returns {string} for example '950', '18.4k', '1.2M', '3.0B'
 */
export function formatTokens(n) {
    if (!Number.isFinite(n) || n <= 0)
        return '0';
    const whole = Math.round(n);
    if (whole < 1000)
        return String(whole);
    let unit = 0;
    // Tenths of the unit, in integer math so 999950 lands on '1.0M'.
    let tenths = Math.round(n / 100);
    while (tenths >= 10000 && unit < TOKEN_UNITS.length - 1) {
        unit++;
        tenths = Math.round(n / (100 * 1000 ** unit));
    }
    return `${Math.floor(tenths / 10)}.${tenths % 10}${TOKEN_UNITS[unit]}`;
}

/**
 * @param {number} seconds
 * @returns {{hours: number, minutes: number, seconds: number}} whole numbers;
 *   negative or NaN input counts as zero
 */
export function splitDuration(seconds) {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    return {
        hours: Math.floor(total / 3600),
        minutes: Math.floor((total % 3600) / 60),
        seconds: total % 60,
    };
}
