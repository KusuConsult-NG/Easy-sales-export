/**
 * @jest-environment jsdom
 */

/**
 *   THE OWNER: "when users click on the notification Icon on the general
 *   dashboard, it doesnt redirect to the notification content rather it takes
 *   them to the dashboard again."
 *
 *   THE BELL WAS NOT A LINK. On a phone, DashboardNav's top bar IS the
 *   dashboard's navigation — the sidebar is `hidden lg:flex` — and the bell in
 *   that bar was a bare <div> holding an icon and a count:
 *
 *       <div className="relative">
 *           <Bell className="w-5 h-5 text-slate-400" />
 *           <span …>{Math.min(unreadCount + unreadMessages, 9)}</span>
 *       </div>
 *
 *   No href, no onClick. Tapping it did nothing whatever; the only thing beside
 *   it that responds is the logo, which is a Link to /dashboard. The desktop
 *   sidebar has always had a working Notifications row, so the screen worked on
 *   a laptop and did nothing on the device most of these members use.
 *
 *   AND IT COUNTED TWO THINGS AT ONCE. `unreadCount + unreadMessages` on a bell
 *   means a member with three unread MESSAGES and no notifications saw a bell
 *   with a 3 on it. Had the old bell been wired to /dashboard/notifications as
 *   it stood, it would have taken them to an empty page — the same complaint in
 *   a different place. One icon per destination, each counting its own.
 *
 *   This suite MOUNTS the nav rather than reading it, because an href in the
 *   source proves nothing about which element carries it.
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockUseSession = jest.fn() as jest.Mock<any>;

jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
    signOut: jest.fn(),
}));

jest.mock('next/navigation', () => ({
    usePathname: () => '/dashboard',
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
}));

/**
 * DashboardNav imports logoutAction from a server-action module, which pulls in
 * @upstash/redis and fails to parse under jsdom.
 */
jest.mock('@/app/actions/auth', () => ({ logoutAction: jest.fn() }));

jest.mock('@/hooks/useFeatureToggle', () => ({
    useFeatureToggles: () => ({}),
    useFeatureToggle: () => true,
}));

jest.mock('@/app/actions/my-data', () => ({
    //   Kept in step with the real module's exports. A missing one is
    //   `undefined` at the call site and the component throws.
    getMyLiveRoles: jest.fn(async () => []),
    getMyDashboard: jest.fn(async () => null),
    getMyNavSummary: jest.fn(async () => null),
    getMyServiceRegistrations: jest.fn(async () => ({ success: true, data: {} })),
    getMyUnreadMessageCount: jest.fn(async () => 0),
    getMyUnreadNotificationCount: jest.fn(async () => 0),
}));

import DashboardNav from '@/components/dashboard/DashboardNav';
import { NavSummaryProvider } from '@/contexts/NavSummaryContext';

/** The nav, with the counts the server would have sent. */
function renderNav(unreadNotifications: number, unreadMessages: number) {
    return render(
        <NavSummaryProvider
            mode="full"
            userId="u1"
            initialDashboard={{
                serviceRegistrations: {},
                unreadNotifications,
                unreadMessages,
                recentNotifications: [],
                walletBalance: 0,
                activeOrders: 0,
                upcomingEvents: [],
                recentResources: [],
            } as any}
        >
            <DashboardNav />
        </NavSummaryProvider>,
    );
}

/** The phone top bar, which is the half of this component that was broken. */
function mobileBar(): HTMLElement {
    const bar = document.querySelector('header.lg\\:hidden');
    if (!bar) throw new Error('no mobile top bar rendered');
    return bar as HTMLElement;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: ['general_user'] } },
        status: 'authenticated',
    });
});

describe('the dashboard bell goes to the notifications', () => {
    it('THE BELL IS A LINK, and it points at the notifications screen', async () => {
        renderNav(4, 0);

        const bell = mobileBar().querySelector('a[aria-label="Notifications"]') as HTMLAnchorElement | null;
        expect(bell).toBeTruthy();
        expect(bell!.getAttribute('href')).toBe('/dashboard/notifications');
    });

    it('and it is there even with nothing unread', async () => {
        //   The old bell rendered ONLY when a count was non-zero, so a member
        //   with a clear inbox had no way to their notifications from a phone
        //   at all — not even a broken one.
        renderNav(0, 0);

        const bell = mobileBar().querySelector('a[aria-label="Notifications"]') as HTMLAnchorElement | null;
        expect(bell?.getAttribute('href')).toBe('/dashboard/notifications');
    });

    it('THE BADGE ON IT COUNTS NOTIFICATIONS, not messages too', async () => {
        //   Three unread messages, nothing unread in notifications. A bell
        //   showing "3" here sends somebody to an empty page.
        renderNav(0, 3);

        const bell = mobileBar().querySelector('a[aria-label="Notifications"]') as HTMLElement;
        expect(bell.textContent?.trim()).toBe('');
    });

    it('and the messages count has its own icon, going to the messages', async () => {
        //   The old bell's number included unread messages. Dropping that from
        //   the bell must not drop the signal — it moves to a link that goes
        //   where the signal is about.
        renderNav(0, 3);

        const messages = mobileBar().querySelector('a[aria-label="Messages"]') as HTMLAnchorElement | null;
        expect(messages?.getAttribute('href')).toBe('/messages');
        expect(messages?.textContent).toContain('3');
    });

    it('each badge shows its own number when both have unread', async () => {
        renderNav(4, 3);

        const bell = mobileBar().querySelector('a[aria-label="Notifications"]') as HTMLElement;
        const messages = mobileBar().querySelector('a[aria-label="Messages"]') as HTMLElement;

        expect(bell.textContent).toContain('4');
        expect(messages.textContent).toContain('3');
        //   Not the sum. That is the number that used to be on the bell.
        expect(bell.textContent).not.toContain('7');
    });

    it('the desktop sidebar still lists Notifications too (control)', async () => {
        //   Vacuity guard: the phone bar is an ADDITION, not a replacement for
        //   the row that already worked.
        renderNav(4, 3);

        await waitFor(() => {
            const rows = Array.from(document.querySelectorAll('aside a')) as HTMLAnchorElement[];
            expect(rows.some((a) => a.getAttribute('href') === '/dashboard/notifications')).toBe(true);
        });
    });
});
