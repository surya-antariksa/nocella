// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {PlaybackClock, parseMetadata, pickPlayer, sameTrack} from '../extension/src/util/mpris.js';
import {assertEqual, finish, test} from './assert.js';

test('metadata keys are normalized', () => {
    const track = parseMetadata({
        'mpris:trackid': '/org/mpris/MediaPlayer2/Track/1',
        'xesam:title': ' Song ',
        'xesam:artist': ['A', 'B'],
        'xesam:album': 'Album',
        'mpris:artUrl': 'file:///tmp/art.png',
        'mpris:length': 215000000,
    });
    assertEqual(track, {
        trackId: '/org/mpris/MediaPlayer2/Track/1',
        title: 'Song',
        artist: 'A, B',
        album: 'Album',
        artUrl: 'file:///tmp/art.png',
        lengthUs: 215000000,
    });
});

test('only file:// artwork is kept', () => {
    assertEqual(parseMetadata({'mpris:artUrl': 'https://example.com/a.jpg'}).artUrl, null);
});

test('missing and malformed metadata becomes empty values', () => {
    assertEqual(parseMetadata(null), {trackId: '', title: '', artist: '', album: '', artUrl: null, lengthUs: 0});
    assertEqual(parseMetadata({'xesam:title': 42, 'mpris:length': -5}).title, '');
    assertEqual(parseMetadata({'mpris:length': -5}).lengthUs, 0);
});

test('a single artist string is accepted', () => {
    assertEqual(parseMetadata({'xesam:artist': 'Solo'}).artist, 'Solo');
});

test('lengths sent as 64-bit integers are converted', () => {
    assertEqual(parseMetadata({'mpris:length': BigInt(7200000000)}).lengthUs, 7200000000);
});

test('tracks are the same by ID, or by title, artist, and album without one', () => {
    const a = parseMetadata({'mpris:trackid': '/t/1', 'xesam:title': 'x'});
    assertEqual(sameTrack(a, parseMetadata({'mpris:trackid': '/t/1', 'xesam:title': 'x'})), true);
    assertEqual(sameTrack(a, parseMetadata({'mpris:trackid': '/t/2', 'xesam:title': 'x'})), false);
    const b = parseMetadata({'xesam:title': 'x', 'xesam:artist': ['y']});
    assertEqual(sameTrack(b, parseMetadata({'xesam:title': 'x', 'xesam:artist': ['y']})), true);
    assertEqual(sameTrack(b, null), false);
});

test('a playing player wins over one that changed later', () => {
    assertEqual(pickPlayer([
        {name: 'a', status: 'Playing', changedAt: 1},
        {name: 'b', status: 'Paused', changedAt: 5},
    ]), 'a');
});

test('without a playing player the last one to change wins', () => {
    assertEqual(pickPlayer([
        {name: 'a', status: 'Paused', changedAt: 1},
        {name: 'b', status: 'Stopped', changedAt: 5},
    ]), 'b');
    assertEqual(pickPlayer([]), null);
});

test('the position advances only while playing', () => {
    const clock = new PlaybackClock();
    clock.setLength(10_000_000);
    clock.setPosition(1_000_000, 0);
    assertEqual(clock.positionAt(2000), 1_000_000, 'paused by default');
    clock.setStatus('Playing', 0);
    assertEqual(clock.positionAt(2000), 3_000_000);
    clock.setStatus('Paused', 2000);
    assertEqual(clock.positionAt(9000), 3_000_000, 'frozen when paused');
});

test('the position is clamped to the track length', () => {
    const clock = new PlaybackClock();
    clock.setLength(5_000_000);
    clock.setStatus('Playing', 0);
    assertEqual(clock.positionAt(60000), 5_000_000);
    assertEqual(clock.fractionAt(60000), 1);
});

test('tracks longer than an hour keep an exact position', () => {
    const clock = new PlaybackClock();
    const twoHours = 2 * 3600 * 1_000_000;
    clock.setLength(twoHours);
    clock.setPosition(3900 * 1_000_000, 0);
    clock.setStatus('Playing', 0);
    assertEqual(clock.positionAt(60000), 3960 * 1_000_000);
    assertEqual(clock.fractionAt(60000), 0.55);
});

test('the playback rate scales the extrapolation', () => {
    const clock = new PlaybackClock();
    clock.setStatus('Playing', 0);
    clock.setRate(2, 0);
    assertEqual(clock.positionAt(1000), 2_000_000);
});

test('stopping resets the position', () => {
    const clock = new PlaybackClock();
    clock.setPosition(4_000_000, 0);
    clock.setStatus('Stopped', 0);
    assertEqual(clock.positionAt(1000), 0);
});

test('an unknown length gives a fraction of 0', () => {
    const clock = new PlaybackClock();
    clock.setPosition(4_000_000, 0);
    assertEqual(clock.fractionAt(0), 0);
});

finish();
