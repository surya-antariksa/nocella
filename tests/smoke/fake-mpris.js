// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

// A scriptable MPRIS player for the smoke test. It owns
// org.mpris.MediaPlayer2.nocellatest on the session bus and adds a control interface,
// id.antariksa.Nocella.TestPlayer, so the driver can change tracks and status and read
// back which methods the notch called.
//
// Usage: gjs -m fake-mpris.js   (runs until Quit is called or it is killed)

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.mpris.MediaPlayer2.nocellatest';
const PATH = '/org/mpris/MediaPlayer2';

const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/><method name="Quit"/>
  <property name="Identity" type="s" access="read"/>
  <property name="CanQuit" type="b" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/>
</interface></node>`;

const PLAYER_XML = `<node><interface name="org.mpris.MediaPlayer2.Player">
  <method name="PlayPause"/><method name="Play"/><method name="Pause"/><method name="Stop"/>
  <method name="Next"/><method name="Previous"/>
  <method name="Seek"><arg type="x" direction="in"/></method>
  <method name="SetPosition"><arg type="o" direction="in"/><arg type="x" direction="in"/></method>
  <signal name="Seeked"><arg type="x"/></signal>
  <property name="PlaybackStatus" type="s" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="Position" type="x" access="read"/>
  <property name="Rate" type="d" access="read"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/>
  <property name="CanSeek" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
</interface></node>`;

const CONTROL_XML = `<node><interface name="id.antariksa.Nocella.TestPlayer">
  <method name="SetTrack">
    <arg name="id" type="s" direction="in"/><arg name="title" type="s" direction="in"/>
    <arg name="artist" type="s" direction="in"/><arg name="length" type="x" direction="in"/>
  </method>
  <method name="SetStatus"><arg name="status" type="s" direction="in"/></method>
  <method name="SeekTo"><arg name="position" type="x" direction="in"/></method>
  <method name="GetCalls"><arg type="a{su}" direction="out"/></method>
  <method name="Quit"/>
</interface></node>`;

const loop = new GLib.MainLoop(null, false);

const state = {
    status: 'Stopped',
    track: {id: '/org/mpris/MediaPlayer2/Track/0', title: '', artist: '', length: 0},
    position: 0,
    positionAt: GLib.get_monotonic_time(),
    /** @type {Record<string, number>} */
    calls: {},
};

function position() {
    const elapsed = state.status === 'Playing' ? GLib.get_monotonic_time() - state.positionAt : 0;
    return state.position + elapsed;
}

function metadata() {
    return {
        'mpris:trackid': new GLib.Variant('o', state.track.id),
        'xesam:title': new GLib.Variant('s', state.track.title),
        'xesam:artist': new GLib.Variant('as', [state.track.artist]),
        'xesam:album': new GLib.Variant('s', 'Nocella Test Album'),
        'mpris:length': new GLib.Variant('x', state.track.length),
    };
}

/** @param {string} name */
function count(name) {
    state.calls[name] = (state.calls[name] ?? 0) + 1;
}

/** @param {string} status */
function setStatus(status) {
    state.position = position();
    state.positionAt = GLib.get_monotonic_time();
    state.status = status;
    player.emit_property_changed('PlaybackStatus', new GLib.Variant('s', status));
    player.flush();
}

const root = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, {
    Identity: 'Nocella Test Player',
    CanQuit: true,
    CanRaise: false,
    HasTrackList: false,
    Raise() {},
    Quit() {
        loop.quit();
    },
});

const player = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, {
    get PlaybackStatus() {
        return state.status;
    },
    get Metadata() {
        return metadata();
    },
    get Position() {
        return position();
    },
    Rate: 1.0,
    CanGoNext: true,
    CanGoPrevious: true,
    CanPlay: true,
    CanPause: true,
    CanSeek: true,
    CanControl: true,
    PlayPause() {
        count('PlayPause');
        setStatus(state.status === 'Playing' ? 'Paused' : 'Playing');
    },
    Play() {
        count('Play');
        setStatus('Playing');
    },
    Pause() {
        count('Pause');
        setStatus('Paused');
    },
    Stop() {
        count('Stop');
        setStatus('Stopped');
    },
    Next() {
        count('Next');
    },
    Previous() {
        count('Previous');
    },
    Seek() {
        count('Seek');
    },
    SetPosition() {
        count('SetPosition');
    },
});

const control = Gio.DBusExportedObject.wrapJSObject(CONTROL_XML, {
    SetTrack(id, title, artist, length) {
        state.track = {id, title, artist, length};
        state.position = 0;
        state.positionAt = GLib.get_monotonic_time();
        player.emit_property_changed('Metadata', new GLib.Variant('a{sv}', metadata()));
        player.flush();
    },
    SetStatus(status) {
        setStatus(status);
    },
    SeekTo(value) {
        state.position = value;
        state.positionAt = GLib.get_monotonic_time();
        player.emit_signal('Seeked', new GLib.Variant('(x)', [value]));
    },
    GetCalls() {
        return state.calls;
    },
    Quit() {
        loop.quit();
    },
});

Gio.bus_own_name(Gio.BusType.SESSION, BUS_NAME, Gio.BusNameOwnerFlags.NONE,
    connection => {
        root.export(connection, PATH);
        player.export(connection, PATH);
        control.export(connection, PATH);
    },
    () => print('# fake MPRIS player is on the bus'),
    () => loop.quit());

loop.run();
