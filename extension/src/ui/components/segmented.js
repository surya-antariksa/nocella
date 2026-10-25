// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {Duration} from '../../tokens.js';
import {addPressFeedback} from './icon-button.js';

/**
 * @typedef {object} Segment
 * @property {string} id
 * @property {string} iconName
 * @property {string} label accessible name
 */

/**
 * macOS-style segmented control for the pinned tabs: a capsule, icon segments, and an
 * active indicator that slides (docs/03-desain-visual.md, "Segmented control").
 */
export class SegmentedControl {
    /**
     * @param {(id: string) => void} onSelect
     */
    constructor(onSelect) {
        this._onSelect = onSelect;
        /** @type {Map<string, {button: any, dot: any}>} */
        this._segments = new Map();
        /** @type {string | null} */
        this._selected = null;

        this.actor = new St.Widget({
            style_class: 'nocella-segmented',
            layout_manager: new Clutter.BinLayout(),
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._indicator = new St.Widget({
            style_class: 'nocella-segment-indicator',
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.actor.add_child(this._indicator);
        this._row = new St.BoxLayout({style_class: 'nocella-segment-row'});
        this.actor.add_child(this._row);
        // Allocation changes (first layout, text scaling) move the indicator instantly.
        // Both actors are watched: the offset depends on where each one was laid out,
        // and they can settle in either order after a tab switch.
        this._row.connect('notify::allocation', () => this._placeIndicator(false));
        this._indicator.connect('notify::allocation', () => this._placeIndicator(false));
    }

    /** @returns {string | null} */
    get selected() {
        return this._selected;
    }

    /** @returns {string[]} */
    get ids() {
        return [...this._segments.keys()];
    }

    /**
     * Rebuilds the segments, for example when the agent tab appears.
     *
     * @param {Segment[]} segments
     */
    setSegments(segments) {
        const ids = segments.map(s => s.id).join();
        if (ids === this.ids.join())
            return;
        this._row.destroy_all_children();
        this._segments.clear();
        for (const segment of segments) {
            const content = new St.Widget({layout_manager: new Clutter.BinLayout()});
            content.add_child(new St.Icon({
                icon_name: segment.iconName,
                icon_size: 16,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            }));
            const dot = new St.Widget({
                style_class: 'nocella-tab-dot',
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.START,
                visible: false,
            });
            content.add_child(dot);
            const button = new St.Button({
                style_class: 'nocella-segment',
                can_focus: true,
                track_hover: true,
                accessible_name: segment.label,
                accessible_role: Atk.Role.PAGE_TAB,
                child: content,
            });
            addPressFeedback(button);
            button.connect('clicked', () => this._onSelect(segment.id));
            this._row.add_child(button);
            this._segments.set(segment.id, {button, dot});
        }
        if (this._selected && !this._segments.has(this._selected))
            this._selected = null;
        this._sync(false);
    }

    /**
     * @param {string} id
     * @param {boolean} animate
     */
    select(id, animate) {
        if (!this._segments.has(id))
            return;
        this._selected = id;
        this._segments.get(id).dot.hide();
        this._sync(animate);
    }

    /**
     * Shows or hides the "new activity" dot of a segment.
     *
     * @param {string} id
     * @param {boolean} visible
     */
    setDot(id, visible) {
        const segment = this._segments.get(id);
        if (segment)
            segment.dot.visible = visible && id !== this._selected;
    }

    /** @returns {any} the button of the selected segment, for keyboard focus */
    get selectedButton() {
        return this._selected ? this._segments.get(this._selected)?.button ?? null : null;
    }

    /** @param {boolean} animate */
    _sync(animate) {
        for (const [id, {button}] of this._segments)
            button.checked = id === this._selected;
        this._indicator.visible = this._selected !== null;
        this._placeIndicator(animate);
    }

    /** @param {boolean} animate */
    _placeIndicator(animate) {
        const button = this.selectedButton;
        // Not has_allocation(): it is false while a relayout is pending, which
        // `checked` itself causes, and the box would then never be corrected. The last
        // box is fine; only actors that were never laid out are skipped.
        const buttonBox = button?.get_allocation_box();
        const indicatorBox = this._indicator.get_allocation_box();
        if (!buttonBox || buttonBox.get_width() === 0 || indicatorBox.get_width() === 0)
            return;
        // Offset from where the layout put the indicator to the button, both in the
        // capsule's coordinates; BinLayout does not keep the indicator at the start.
        const x = this._row.get_allocation_box().x1 + buttonBox.x1 - indicatorBox.x1;
        this._indicator.remove_transition('translation-x');
        if (animate) {
            this._indicator.ease({
                translation_x: x,
                duration: Duration.SEGMENT_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._indicator.translation_x = x;
        }
    }
}
