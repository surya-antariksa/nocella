// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {monthGrid} from '../../util/calendar.js';
import {addPressFeedback} from '../components/icon-button.js';

const CALENDAR_APP = 'org.gnome.Calendar.desktop';

/**
 * The "Today" tab: a large clock, the date (opens GNOME Calendar), the month grid, and
 * a slot for the notification list (phase 3).
 */
export class TodayPage {
    /**
     * @param {object} params
     * @param {any} params.wallClock the shared `GnomeDesktop.WallClock`
     * @param {() => void} [params.onLaunch] called after an app was launched
     */
    constructor({wallClock, onLaunch = () => {}}) {
        this._wallClock = wallClock;
        this._onLaunch = onLaunch;
        this._visible = false;
        this._renderedDay = '';

        this.actor = new St.BoxLayout({style_class: 'nocella-page', vertical: true, x_expand: true});

        const top = new St.BoxLayout({style_class: 'nocella-row', x_expand: true});
        const left = new St.BoxLayout({vertical: true, x_expand: true, y_align: Clutter.ActorAlign.START});
        this._bigClock = new St.Label({style_class: 'nocella-big-clock'});
        this._binding = wallClock.bind_property('clock', this._bigClock, 'text',
            GObject.BindingFlags.SYNC_CREATE);
        left.add_child(this._bigClock);

        this._dateButton = new St.Button({
            style_class: 'nocella-pill',
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.START,
            accessible_name: _('Open Calendar'),
        });
        this._dateLabel = new St.Label({style_class: 'nocella-text'});
        this._dateButton.set_child(this._dateLabel);
        addPressFeedback(this._dateButton);
        this._dateButton.connect('clicked', () => this._openCalendar());
        // Without GNOME Calendar the date is plain text; clicking it does nothing.
        this._dateButton.reactive = Gio.DesktopAppInfo.new(CALENDAR_APP) !== null;
        this._dateButton.can_focus = this._dateButton.reactive;
        left.add_child(this._dateButton);
        top.add_child(left);

        this._grid = new St.Widget({
            style_class: 'nocella-calendar',
            layout_manager: new Clutter.GridLayout(),
            y_align: Clutter.ActorAlign.START,
        });
        top.add_child(this._grid);
        this.actor.add_child(top);

        // Filled by the notifications view in phase 3.
        this.slot = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'nocella-stack'});
        this.actor.add_child(this.slot);

        // The date can change while the panel is open (midnight).
        this._clockId = wallClock.connect('notify::clock', () => {
            if (this._visible)
                this._renderDate();
        });
    }

    show() {
        this._visible = true;
        this._renderDate();
    }

    hide() {
        this._visible = false;
    }

    refresh() {
        this._renderDate();
    }

    _renderDate() {
        const now = GLib.DateTime.new_now_local();
        this._dateLabel.text = now.format('%A, %e %B').replace(/\s+/g, ' ');
        const key = now.format('%F');
        if (key === this._renderedDay)
            return;
        this._renderedDay = key;
        this._renderGrid(now);
    }

    /** @param {any} now a `GLib.DateTime` */
    _renderGrid(now) {
        this._grid.destroy_all_children();
        const layout = this._grid.layout_manager;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        layout.row_spacing = 2 * scale;
        layout.column_spacing = 2 * scale;

        const {weekdays, weeks} = monthGrid({
            year: now.get_year(),
            month: now.get_month(),
            weekStart: Shell.util_get_week_start(),
            today: {year: now.get_year(), month: now.get_month(), day: now.get_day_of_month()},
        });
        // 2026-10-04 is a Sunday; add the weekday index to get a localized name.
        const sunday = GLib.DateTime.new_local(2026, 10, 4, 12, 0, 0);
        weekdays.forEach((weekday, column) => {
            const name = sunday.add_days(weekday).format('%a');
            layout.attach(this._cell(name, 'weekday'), column, 0, 1, 1);
        });
        weeks.forEach((week, row) => {
            week.forEach((day, column) => {
                const classes = [day.inMonth ? '' : 'other-month', day.today ? 'today' : ''].join(' ');
                layout.attach(this._cell(String(day.day), classes), column, row + 1, 1, 1);
            });
        });
    }

    /**
     * @param {string} text
     * @param {string} extraClass
     * @returns {any}
     */
    _cell(text, extraClass) {
        const cell = new St.Label({
            style_class: `nocella-calendar-day ${extraClass}`.trim(),
            text,
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Center the digits inside the round "today" highlight.
        cell.clutter_text.y_align = Clutter.ActorAlign.CENTER;
        return cell;
    }

    _openCalendar() {
        const app = Gio.DesktopAppInfo.new(CALENDAR_APP);
        if (!app)
            return;
        try {
            app.launch([], global.create_app_launch_context(0, -1));
            this._onLaunch();
        } catch (e) {
            console.warn(`[nocella] Could not launch the calendar: ${e}`);
        }
    }

    destroy() {
        this._wallClock.disconnect(this._clockId);
        this._binding.unbind();
        this.actor.destroy();
    }
}
