// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {formatTrackTime} from '../../util/format.js';
import {TimerGroup} from '../../util/timer-group.js';
import {Artwork} from '../components/artwork.js';
import {iconButton, setButtonIcon} from '../components/icon-button.js';
import {ProgressBar} from '../components/progress.js';

/** @typedef {import('../../providers/media.js').MediaProvider} MediaProvider */
/** @typedef {import('../../providers/media.js').MediaSnapshot} MediaSnapshot */

/**
 * @param {string} styleClass
 * @returns {any} an ellipsizing `St.Label`
 */
function label(styleClass) {
    const result = new St.Label({style_class: styleClass, x_expand: true});
    result.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return result;
}

/**
 * @param {MediaSnapshot} media
 * @returns {string}
 */
function titleOf(media) {
    return media.track?.title || _('Unknown title');
}

/**
 * The one-line peek summary for media, or `null` when nothing plays.
 *
 * @param {MediaSnapshot} media
 * @returns {string | null}
 */
export function mediaPeekLine(media) {
    if (!media.available || !media.track?.title)
        return null;
    return media.track.artist ? `♪ ${media.track.title}, ${media.track.artist}` : `♪ ${media.track.title}`;
}

/**
 * Shared behavior of the media presentations: a progress timer that runs once a second,
 * only while the view is visible and the track plays (docs/05-fitur.md).
 */
class MediaViewBase {
    /** @param {MediaProvider} media */
    constructor(media) {
        this._media = media;
        this._timers = new TimerGroup();
        this._progressTimer = 0;
        this._visible = false;
        /** @type {any} */
        this.actor = null;
    }

    show() {
        this._visible = true;
        this.refresh();
    }

    hide() {
        this._visible = false;
        this._syncTimer(false);
    }

    refresh() {
        const snapshot = this._media.snapshot();
        this._update(snapshot);
        this._syncTimer(this._visible && snapshot.status === 'Playing' && snapshot.lengthUs > 0);
    }

    /** @param {boolean} running */
    _syncTimer(running) {
        if (running && !this._progressTimer) {
            this._progressTimer = this._timers.every(1000, () => this._tick(this._media.snapshot()));
        } else if (!running && this._progressTimer) {
            this._timers.remove(this._progressTimer);
            this._progressTimer = 0;
        }
    }

    /** @param {MediaSnapshot} _snapshot */
    _update(_snapshot) {}

    /** @param {MediaSnapshot} _snapshot */
    _tick(_snapshot) {}

    destroy() {
        this._timers.clear();
        this._progressTimer = 0;
        this.actor.destroy();
    }
}

/** Transient media card, 380x68: artwork, title, artist, progress, play/pause. */
export class MediaTransient extends MediaViewBase {
    /** @param {MediaProvider} media */
    constructor(media) {
        super(media);
        this.actor = new St.BoxLayout({style_class: 'nocella-transient', x_expand: true});
        this._artwork = new Artwork();
        this.actor.add_child(this._artwork.actor);

        const text = new St.BoxLayout({
            style_class: 'nocella-stack',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = label('nocella-title');
        this._artist = label('nocella-secondary');
        this._progress = new ProgressBar({height: 3});
        text.add_child(this._title);
        text.add_child(this._artist);
        text.add_child(this._progress.actor);
        this.actor.add_child(text);

        this._playButton = iconButton({
            iconName: 'media-playback-start-symbolic',
            accessibleName: _('Play or pause'),
            onClick: () => this._media.playPause(),
        });
        this._playButton.y_align = Clutter.ActorAlign.CENTER;
        this.actor.add_child(this._playButton);
    }

    /** @param {MediaSnapshot} media */
    _update(media) {
        this._artwork.setUrl(media.track?.artUrl ?? null);
        this._title.text = titleOf(media);
        this._artist.text = media.track?.artist ?? '';
        this._artist.visible = this._artist.text !== '';
        this._progress.actor.visible = media.lengthUs > 0;
        this._progress.setFraction(media.fraction);
        this._playButton.visible = media.canControl;
        setButtonIcon(this._playButton, media.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
    }

    /** @param {MediaSnapshot} media */
    _tick(media) {
        this._progress.setFraction(media.fraction);
    }
}

/** Pinned media tab: artwork, title, artist and album, progress with times, controls. */
export class MediaPage extends MediaViewBase {
    /** @param {MediaProvider} media */
    constructor(media) {
        super(media);
        this.actor = new St.BoxLayout({style_class: 'nocella-page', vertical: true, x_expand: true});

        this._empty = new St.Label({
            style_class: 'nocella-empty',
            text: _('No media playing'),
            x_expand: true,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._empty);

        this._card = new St.BoxLayout({style_class: 'nocella-card', vertical: true, x_expand: true});
        this.actor.add_child(this._card);

        const top = new St.BoxLayout({style_class: 'nocella-row', x_expand: true});
        this._artwork = new Artwork({large: true});
        top.add_child(this._artwork.actor);
        const text = new St.BoxLayout({
            style_class: 'nocella-stack',
            vertical: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._title = label('nocella-title');
        this._subtitle = label('nocella-secondary');
        text.add_child(this._title);
        text.add_child(this._subtitle);
        top.add_child(text);
        this._card.add_child(top);

        this._progress = new ProgressBar({height: 3});
        this._card.add_child(this._progress.actor);
        const times = new St.BoxLayout({x_expand: true});
        this._elapsed = new St.Label({style_class: 'nocella-caption', x_expand: true});
        this._length = new St.Label({style_class: 'nocella-caption'});
        times.add_child(this._elapsed);
        times.add_child(this._length);
        this._times = times;
        this._card.add_child(times);

        const controls = new St.BoxLayout({style_class: 'nocella-row', x_align: Clutter.ActorAlign.CENTER});
        this._previous = iconButton({
            iconName: 'media-skip-backward-symbolic',
            accessibleName: _('Previous track'),
            onClick: () => this._media.previous(),
        });
        this._play = iconButton({
            iconName: 'media-playback-start-symbolic',
            accessibleName: _('Play or pause'),
            onClick: () => this._media.playPause(),
        });
        this._next = iconButton({
            iconName: 'media-skip-forward-symbolic',
            accessibleName: _('Next track'),
            onClick: () => this._media.next(),
        });
        controls.add_child(this._previous);
        controls.add_child(this._play);
        controls.add_child(this._next);
        this._controls = controls;
        this._card.add_child(controls);
    }

    /**
     * Extra content below the player card, e.g. the volume slider (phase 5).
     *
     * @param {any} actor
     */
    addFooter(actor) {
        this.actor.add_child(actor);
    }

    /** @param {MediaSnapshot} media */
    _update(media) {
        // A player that has nothing loaded yet is shown like no player at all.
        const available = media.available && Boolean(media.track?.title);
        this._empty.visible = !available;
        this._card.visible = available;
        if (!available)
            return;
        this._artwork.setUrl(media.track?.artUrl ?? null);
        this._title.text = titleOf(media);
        this._subtitle.text = [media.track?.artist, media.track?.album].filter(Boolean).join(' · ');
        this._subtitle.visible = this._subtitle.text !== '';
        const hasLength = media.lengthUs > 0;
        this._progress.actor.visible = hasLength;
        this._times.visible = hasLength;
        this._previous.reactive = media.canGoPrevious;
        this._next.reactive = media.canGoNext;
        this._play.reactive = media.canControl;
        setButtonIcon(this._play, media.status === 'Playing'
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic');
        this._tick(media);
    }

    /** @param {MediaSnapshot} media */
    _tick(media) {
        this._progress.setFraction(media.fraction);
        this._elapsed.text = formatTrackTime(media.positionUs / 1e6);
        this._length.text = formatTrackTime(media.lengthUs / 1e6);
    }

    /** @param {boolean} light */
    setLight(light) {
        this._progress.setLight(light);
    }
}
