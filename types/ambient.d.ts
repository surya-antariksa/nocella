// SPDX-License-Identifier: GPL-2.0-or-later

// Minimal ambient types so `// @ts-check` works without generated GObject
// Introspection types. GNOME APIs are typed as `any`; ts-for-gir can replace this later
// (ADR 0002).

// Shorthand declarations: every import from these modules is `any`.
declare module 'gi://*';
declare module 'resource:///*';
declare module 'cairo';

declare module 'system' {
    const System: {exit(status: number): never};
    export default System;
}

declare const global: any;
declare const ARGV: string[];
declare function print(...args: unknown[]): void;
