// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MPRIS_PREFIX, PlaybackClock, parseMetadata, pickPlayer, sameTrack} from '../util/mpris.js';
import {TimerGroup} from '../util/timer-group.js';

/** @typedef {import('../arbiter.js').NotchEvent} NotchEvent */
/** @typedef {import('../util/mpris.js').Track} Track */

const PLAYER_INTERFACE = 'org.mpris.MediaPlayer2.Player';
const OBJECT_PATH = '/org/mpris/MediaPlayer2';
// Players often send several properties in a row (docs/07-performa.md, koalesensi).
const DEBOUNCE_MS = 100;
// A player that disappears while shown is kept for a moment (docs/05-fitur.md).
const VANISH_HOLD_MS = 2000;

/** Event templates from docs/04-interaksi.md, "Prioritas konten". */
export const MediaEvents = Object.freeze({
    TRACK: Object.freeze({type: 'media-changed', priority: 80, ttl: 4000, coalesceKey: 'media'}),
    STATUS: Object.freeze({type: 'media-status', priority: 60, ttl: 2000, coalesceKey: 'media'}),
});

/**
 * @typedef {object} MediaSnapshot
 * @property {boolean} available a player is known
 * @property {string} busName
 * @property {Track | null} track
 * @property {string} status `Playing`, `Paused`, or `Stopped`
 * @property {boolean} canGoNext
 * @property {boolean} canGoPrevious
 * @property {boolean} canControl
 * @property {number} positionUs
 * @property {number} lengthUs
 * @property {number} fraction 0..1
 */

class Player {
    /** @param {string} busName */
    constructor(busName) {
        this.busName = busName;
        /** @type {any} */
        this.proxy = null;
        /** @type {number[]} */
        this.proxySignals = [];
        /** @type {Track | null} */
        this.track = null;
        this.status = 'Stopped';
        this.canGoNext = false;
        this.canGoPrevious = false;
        this.canControl = false;
        this.clock = new PlaybackClock();
        this.changedAt = 0;
        this.ready = false;
        this.gone = false;
        this.debounceId = 0;
    }
}

/**
 * MPRIS players on the session bus: discovery, metadata, controls, and a computed
 * position. Emits `media-changed` when the track of the shown player changes and
 * `media-status` when it starts or stops playing. No timers run while nothing
 * changes; the progress timer belongs to the view and only runs while it is visible.
 */
export class MediaProvider {
    /**
     * @param {object} params
     * @param {(event: NotchEvent) => void} params.emit sends content to the arbiter
     * @param {() => void} params.changed tells views to refresh
     * @param {() => boolean} [params.autoExpand] `auto-expand-media`
     * @param {any} [params.bus] a `Gio.DBusConnection`, for tests
     */
    constructor({emit, changed, autoExpand = () => true, bus = null}) {
        this._emit = emit;
        this._changed = changed;
        this._autoExpand = autoExpand;
        this._bus = bus;
        this._timers = new TimerGroup();
        /** @type {Map<string, Player>} */
        this._players = new Map();
        /** @type {string | null} */
        this._active = null;
        this._nameWatchId = 0;
        /** @type {any} */
        this._cancellable = null;
        /** @type {Set<string>} */
        this._warned = new Set();
    }

    start() {
        const bus = this._bus ?? Gio.DBus.session;
        this._connection = bus;
        this._cancellable = new Gio.Cancellable();
        this._nameWatchId = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (!name.startsWith(MPRIS_PREFIX))
                    return;
                if (newOwner === '')
                    this._removePlayer(name);
                else if (oldOwner === '')
                    this._addPlayer(name);
            });

        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1,
            this._cancellable, (conn, result) => {
                try {
                    const [names] = conn.call_finish(result).deepUnpack();
                    for (const name of names) {
                        if (name.startsWith(MPRIS_PREFIX))
                            this._addPlayer(name);
                    }
                } catch (e) {
                    this._warnOnce('list', e);
                }
            });
    }

    stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._nameWatchId) {
            this._connection.signal_unsubscribe(this._nameWatchId);
            this._nameWatchId = 0;
        }
        for (const player of this._players.values())
            this._disconnectPlayer(player);
        this._players.clear();
        this._active = null;
        this._timers.clear();
    }

    /** @returns {boolean} */
    get playing() {
        return this._activePlayer()?.status === 'Playing';
    }

    /**
     * @returns {MediaSnapshot}
     */
    snapshot() {
        const player = this._activePlayer();
        const now = this._timers.now();
        return {
            available: player !== null,
            busName: player?.busName ?? '',
            track: player?.track ?? null,
            status: player?.status ?? 'Stopped',
            canGoNext: player?.canGoNext ?? false,
            canGoPrevious: player?.canGoPrevious ?? false,
            canControl: player?.canControl ?? false,
            positionUs: player?.clock.positionAt(now) ?? 0,
            lengthUs: player?.track?.lengthUs ?? 0,
            fraction: player?.clock.fractionAt(now) ?? 0,
        };
    }

    playPause() {
        this._callPlayer('PlayPause');
    }

    next() {
        this._callPlayer('Next');
    }

    previous() {
        this._callPlayer('Previous');
    }

    /** @param {string} method */
    _callPlayer(method) {
        const player = this._activePlayer();
        if (!player?.proxy || player.gone)
            return;
        player.proxy.call(method, null, Gio.DBusCallFlags.NONE, 2000, this._cancellable,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                } catch (e) {
                    this._warnOnce(`call-${method}`, e);
                }
            });
    }

    /** @returns {Player | null} */
    _activePlayer() {
        return this._active ? this._players.get(this._active) ?? null : null;
    }

    /** @param {string} busName */
    _addPlayer(busName) {
        const existing = this._players.get(busName);
        if (existing && !existing.gone)
            return;
        if (existing)
            this._disconnectPlayer(existing);

        const player = new Player(busName);
        this._players.set(busName, player);
        Gio.DBusProxy.new(this._connection, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null, busName,
            OBJECT_PATH, PLAYER_INTERFACE, this._cancellable, (_source, result) => {
                try {
                    player.proxy = Gio.DBusProxy.new_finish(result);
                } catch (e) {
                    this._warnOnce('proxy', e);
                    return;
                }
                if (this._players.get(busName) !== player)
                    return;
                player.proxySignals.push(
                    player.proxy.connect('g-properties-changed', () => this._scheduleRefresh(player)),
                    player.proxy.connect('g-signal', (_proxy, _sender, signal, params) => {
                        if (signal === 'Seeked') {
                            const [position] = params.deepUnpack();
                            player.clock.setPosition(Number(position), this._timers.now());
                            this._changed();
                        }
                    }));
                this._refresh(player);
                this._queryPosition(player);
            });
    }

    /** @param {string} busName */
    _removePlayer(busName) {
        const player = this._players.get(busName);
        if (!player || player.gone)
            return;
        player.gone = true;
        player.status = 'Stopped';
        player.canControl = false;
        player.clock.setStatus('Paused', this._timers.now());
        this._changed();
        this._timers.timeout(VANISH_HOLD_MS, () => {
            if (this._players.get(busName) !== player)
                return;
            this._disconnectPlayer(player);
            this._players.delete(busName);
            this._pickActive();
            this._changed();
        });
    }

    /** @param {Player} player */
    _disconnectPlayer(player) {
        if (player.debounceId)
            this._timers.remove(player.debounceId);
        player.debounceId = 0;
        for (const id of player.proxySignals)
            player.proxy?.disconnect(id);
        player.proxySignals = [];
        player.proxy = null;
    }

    /** @param {Player} player */
    _scheduleRefresh(player) {
        if (player.debounceId)
            return;
        player.debounceId = this._timers.timeout(DEBOUNCE_MS, () => {
            player.debounceId = 0;
            this._refresh(player);
        });
    }

    /** @param {Player} player */
    _refresh(player) {
        if (!player.proxy || player.gone)
            return;
        const proxy = player.proxy;
        const now = this._timers.now();
        const get = (/** @type {string} */ name) => proxy.get_cached_property(name)?.recursiveUnpack();

        const track = parseMetadata(get('Metadata'));
        const status = typeof get('PlaybackStatus') === 'string' ? get('PlaybackStatus') : 'Stopped';
        player.canGoNext = get('CanGoNext') === true;
        player.canGoPrevious = get('CanGoPrevious') === true;
        player.canControl = get('CanControl') !== false && (get('CanPlay') === true || get('CanPause') === true);
        const rate = get('Rate');
        if (typeof rate === 'number')
            player.clock.setRate(rate, now);

        const trackChanged = !sameTrack(player.track, track);
        const statusChanged = player.status !== status;
        const wasReady = player.ready;
        player.track = track;
        player.clock.setLength(track.lengthUs);
        if (trackChanged) {
            player.clock.reset(now);
            this._queryPosition(player);
        }
        if (statusChanged || trackChanged || !wasReady) {
            player.clock.setStatus(status, now);
            player.status = status;
            player.changedAt = now;
        }
        player.ready = true;

        this._pickActive();
        this._changed();

        // The first read of a player is its current state, not news.
        if (!wasReady || this._active !== player.busName || !this._autoExpand())
            return;
        if (trackChanged && track.title !== '')
            this._emit({...MediaEvents.TRACK, payload: {busName: player.busName}});
        else if (statusChanged && (status === 'Playing' || status === 'Paused'))
            this._emit({...MediaEvents.STATUS, payload: {busName: player.busName}});
    }

    /** @param {Player} player */
    _queryPosition(player) {
        player.proxy?.call('org.freedesktop.DBus.Properties.Get',
            new GLib.Variant('(ss)', [PLAYER_INTERFACE, 'Position']), Gio.DBusCallFlags.NONE, 1000,
            this._cancellable, (proxy, result) => {
                try {
                    const [value] = proxy.call_finish(result).deepUnpack();
                    player.clock.setPosition(Number(value.deepUnpack()), this._timers.now());
                    this._changed();
                } catch {
                    // Position is optional in MPRIS; the clock keeps counting from 0.
                }
            });
    }

    _pickActive() {
        const players = [...this._players.values()]
            .filter(p => p.ready)
            .map(p => ({name: p.busName, status: p.gone ? 'Stopped' : p.status, changedAt: p.changedAt}));
        this._active = pickPlayer(players);
    }

    /**
     * @param {string} key
     * @param {unknown} error
     */
    _warnOnce(key, error) {
        /** @type {any} */
        const e = error;
        if (e instanceof GLib.Error && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return;
        if (this._warned.has(key))
            return;
        this._warned.add(key);
        console.warn(`[nocella] media: ${key} failed: ${error}`);
    }
}
