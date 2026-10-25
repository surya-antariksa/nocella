// SPDX-License-Identifier: GPL-2.0-or-later
// @ts-check

import {
    GroupCounter, Urgency, notificationEvent, presentation, relativeAge, unreadBadge,
} from '../extension/src/util/notification-rules.js';
import {assertEqual, finish, test} from './assert.js';

const base = {
    urgency: Urgency.NORMAL,
    acknowledged: false,
    appShowsBanners: true,
    doNotDisturb: false,
    autoExpand: true,
};

test('a normal notification becomes a transient', () => {
    assertEqual(presentation(base), 'transient');
});

test('LOW urgency is only listed, never a transient', () => {
    assertEqual(presentation({...base, urgency: Urgency.LOW}), 'badge');
});

test('do not disturb only raises the badge, even for critical ones', () => {
    assertEqual(presentation({...base, doNotDisturb: true}), 'badge');
    assertEqual(presentation({...base, doNotDisturb: true, urgency: Urgency.CRITICAL}), 'badge');
});

test('an app with banners turned off is only listed, unless critical', () => {
    assertEqual(presentation({...base, appShowsBanners: false}), 'badge');
    assertEqual(presentation({...base, appShowsBanners: false, urgency: Urgency.CRITICAL}), 'transient');
});

test('auto-expand off keeps notifications out of the notch', () => {
    assertEqual(presentation({...base, autoExpand: false}), 'badge');
});

test('acknowledged notifications are not presented again', () => {
    assertEqual(presentation({...base, acknowledged: true}), 'none');
});

test('normal events merge per app with priority 90 and 6 s', () => {
    assertEqual(notificationEvent({urgency: Urgency.NORMAL, key: 'n1', sourceKey: 's1', extra: 0}), {
        type: 'notification',
        priority: 90,
        ttl: 6000,
        coalesceKey: 'app:s1',
        payload: {key: 'n1', extra: 0, critical: false},
    });
});

test('critical events stay 60 s, win over others, and never merge', () => {
    const event = notificationEvent({urgency: Urgency.CRITICAL, key: 'n2', sourceKey: 's1', extra: 0});
    assertEqual([event.priority, event.ttl, event.coalesceKey], [100, 60000, 'notification:n2']);
});

test('notifications of one app within 3 s are grouped', () => {
    const groups = new GroupCounter();
    assertEqual(groups.add('app', 0), 0);
    assertEqual(groups.add('app', 1000), 1);
    assertEqual(groups.add('app', 2900), 2);
    assertEqual(groups.add('other', 2900), 0, 'other apps start their own group');
    assertEqual(groups.add('app', 3500), 0, 'a new group after the window');
});

test('peek reads the group without adding to it', () => {
    const groups = new GroupCounter();
    assertEqual(groups.peek('app', 0), 0);
    groups.add('app', 0);
    groups.add('app', 500);
    assertEqual(groups.peek('app', 1000), 1);
    assertEqual(groups.peek('app', 1000), 1, 'peeking twice does not count');
    assertEqual(groups.peek('app', 4000), 0, 'outside the window');
});

test('relative ages use now, minutes, hours, and days', () => {
    assertEqual(relativeAge(30), {unit: 'now', value: 0});
    assertEqual(relativeAge(150), {unit: 'minutes', value: 2});
    assertEqual(relativeAge(7200), {unit: 'hours', value: 2});
    assertEqual(relativeAge(3 * 86400 + 5), {unit: 'days', value: 3});
    assertEqual(relativeAge(-4), {unit: 'now', value: 0});
});

test('the badge is red for unread critical, orange for other unread, none when read', () => {
    assertEqual(unreadBadge([]), null);
    assertEqual(unreadBadge([{urgency: Urgency.NORMAL, acknowledged: true}]), null);
    assertEqual(unreadBadge([{urgency: Urgency.LOW, acknowledged: false}]), 'warning');
    assertEqual(unreadBadge([
        {urgency: Urgency.NORMAL, acknowledged: false},
        {urgency: Urgency.CRITICAL, acknowledged: false},
    ]), 'danger');
});

finish();
