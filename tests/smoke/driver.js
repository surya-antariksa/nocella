// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Drives a headless GNOME Shell and checks the phase gates. Run through
// tests/smoke/run.sh, which isolates the session; never point this at a real session.
//
// Usage: gjs -m driver.js <output-dir> <scale>
// Env:   NOCELLA_SMOKE_PHASES  comma-separated phases to run (default: all)

import GLib from 'gi://GLib';
import System from 'system';

import {check, failureCount, prepareShell} from './lib.js';
import * as phase1 from './phase1.js';
import * as phase2 from './phase2.js';
import * as phase3 from './phase3.js';

const PHASES = {1: phase1, 2: phase2, 3: phase3};
const selected = (GLib.getenv('NOCELLA_SMOKE_PHASES') ?? Object.keys(PHASES).join(','))
    .split(',').map(s => s.trim()).filter(Boolean);

try {
    if (prepareShell()) {
        for (const id of selected) {
            print(`# phase ${id}`);
            PHASES[id].run();
        }
    }
} catch (e) {
    check('driver ran without exceptions', false, `${e}\n${e?.stack ?? ''}`);
}

if (failureCount() > 0)
    System.exit(1);
