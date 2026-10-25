// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// Pure helpers for MPRIS data (docs/05-fitur.md, "Media"). Input is the already
// unpacked JavaScript form of the D-Bus values (`Variant.recursiveUnpack()`).

export const MPRIS_PREFIX = 'org.mpris.MediaPlayer2.';

/**
 * @typedef {object} Track
 * @property {string} trackId
 * @property {string} title
 * @property {string} artist artists joined with ", "
 * @property {string} album
 * @property {string | null} artUrl only `file://` URLs; others are not loaded in v1
 * @property {number} lengthUs 0 when unknown
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
    return typeof value === 'string' ? value : '';
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function asNumber(value) {
    // Some players send the length as a double or a 64-bit integer.
    const number = typeof value === 'bigint' ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number > 0 ? number : 0;
}

/**
 * Normalizes MPRIS `Metadata`. Missing or malformed keys become empty values.
 *
 * @param {Record<string, unknown> | null | undefined} metadata
 * @returns {Track}
 */
export function parseMetadata(metadata) {
    const data = metadata && typeof metadata === 'object' ? metadata : {};
    const artists = data['xesam:artist'];
    const artist = Array.isArray(artists)
        ? artists.filter(a => typeof a === 'string' && a !== '').join(', ')
        : asString(artists);
    const artUrl = asString(data['mpris:artUrl']);
    return {
        trackId: asString(data['mpris:trackid']),
        title: asString(data['xesam:title']).trim(),
        artist: artist.trim(),
        album: asString(data['xesam:album']).trim(),
        artUrl: artUrl.startsWith('file://') ? artUrl : null,
        lengthUs: asNumber(data['mpris:length']),
    };
}

/**
 * True when two tracks are the same song. Players that do not send a track ID are
 * compared by title, artist, and album.
 *
 * @param {Track | null} a
 * @param {Track | null} b
 * @returns {boolean}
 */
export function sameTrack(a, b) {
    if (!a || !b)
        return a === b;
    if (a.trackId && b.trackId)
        return a.trackId === b.trackId && a.title === b.title;
    return a.title === b.title && a.artist === b.artist && a.album === b.album;
}

/**
 * Picks the player to show: a playing one wins, then the one that changed last
 * (docs/05-fitur.md, "Pemilihan player aktif").
 *
 * @param {Array<{name: string, status: string, changedAt: number}>} players
 * @returns {string | null} the bus name
 */
export function pickPlayer(players) {
    const playing = players.filter(p => p.status === 'Playing');
    const candidates = playing.length > 0 ? playing : players;
    let best = null;
    for (const player of candidates) {
        if (!best || player.changedAt > best.changedAt)
            best = player;
    }
    return best?.name ?? null;
}

/**
 * MPRIS does not send the position in PropertiesChanged. This clock keeps the last
 * known position and extrapolates it while playing.
 */
export class PlaybackClock {
    constructor() {
        this._positionUs = 0;
        this._at = 0;
        this._playing = false;
        this._rate = 1;
        this._lengthUs = 0;
    }

    /**
     * @param {number} positionUs
     * @param {number} nowMs monotonic milliseconds
     */
    setPosition(positionUs, nowMs) {
        this._positionUs = Math.max(0, positionUs);
        this._at = nowMs;
    }

    /**
     * @param {string} status `Playing`, `Paused`, or `Stopped`
     * @param {number} nowMs
     */
    setStatus(status, nowMs) {
        // Freeze the extrapolated position before the status changes.
        this.setPosition(this.positionAt(nowMs), nowMs);
        this._playing = status === 'Playing';
        if (status === 'Stopped')
            this.setPosition(0, nowMs);
    }

    /**
     * @param {number} rate
     * @param {number} nowMs
     */
    setRate(rate, nowMs) {
        this.setPosition(this.positionAt(nowMs), nowMs);
        this._rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    }

    /** @param {number} lengthUs 0 when unknown */
    setLength(lengthUs) {
        this._lengthUs = lengthUs;
    }

    /** @param {number} nowMs */
    reset(nowMs) {
        this.setPosition(0, nowMs);
    }

    /**
     * @param {number} nowMs
     * @returns {number} microseconds, clamped to the length when known
     */
    positionAt(nowMs) {
        let position = this._positionUs;
        if (this._playing)
            position += (nowMs - this._at) * 1000 * this._rate;
        if (this._lengthUs > 0)
            position = Math.min(position, this._lengthUs);
        return Math.max(0, position);
    }

    /**
     * @param {number} nowMs
     * @returns {number} 0..1, or 0 when the length is unknown
     */
    fractionAt(nowMs) {
        return this._lengthUs > 0 ? this.positionAt(nowMs) / this._lengthUs : 0;
    }
}
