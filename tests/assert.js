// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// GJS has no Node `assert` module; these helpers are enough for pure-logic tests.

import System from 'system';

let failures = 0;

/**
 * @param {string} name
 * @param {() => void} body
 */
export function test(name, body) {
    try {
        body();
        print(`ok - ${name}`);
    } catch (e) {
        failures++;
        print(`not ok - ${name}\n  ${e instanceof Error ? e.message : e}`);
    }
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
export function assertEqual(actual, expected, message = 'values differ') {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`${message}: ${a} !== ${b}`);
}

/** Exits with status 1 if any test failed. Call once at the end of a test file. */
export function finish() {
    if (failures > 0)
        System.exit(1);
}
