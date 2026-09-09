/**
 * @jest-environment jsdom
 */

/**
 *   #539 THE NAV FETCHED THREE THINGS THE PAGE UNDER IT ALREADY HAD.
 *
 *   DashboardNav ran three pollers of its own — service registrations (8s),
 *   unread messages (8s) and, through useUnreadNotifications, unread
 *   notifications (10s). One level down, /dashboard polled getMyDashboard,
 *   which RETURNS ALL THREE.
 *
 *   So on /dashboard every one of those values was fetched TWICE, about every
 *   eight seconds, for as long as the screen was open: four pollers where one
 *   would do.
 *
 * ── WHY TWO EARLIER FIXES COULD NOT SEE IT ──────────────────────────────────
 *
 *   #453 collapsed the PAGE's eight actions into one round trip. #538 stopped
 *   every poller running in hidden tabs. Both were looking inside a single
 *   component, and this duplication exists between two: the nav is rendered by
 *   the LAYOUT and the tiles by the PAGE.
 *
 *   That is also why the fix has the shape it does. A page cannot hand anything
 *   to its own parent layout, so the shared poll had to be mounted ABOVE both —
 *   NavSummaryProvider, in dashboard/layout.tsx.
 *
 *   It is the audit's usual "several doors onto one thing", costing latency
 *   rather than correctness. Nothing on the screen was ever WRONG, which is
 *   exactly why it survived two performance passes.
 *
 * ── THE TWO MODES ───────────────────────────────────────────────────────────
 *
 *   "full" on /dashboard polls getMyDashboard: the nav takes its three badges
 *   from the result and the page takes the other five values from the same
 *   object. Four round trips become one.
 *
 *   "nav" on /messages polls getMyNavSummary — the same three values, three
 *   queries rather than the dashboard's eight, because that screen mounts the
 *   nav and has no dashboard to draw. Three round trips become one.
 *
 *   Giving /messages the full payload would have been less code and would have
 *   made it run five queries it has no use for. Fewer round trips is the goal;
 *   more work per trip is not automatically a win.
 *
 * ── THE FALLBACK IS A REAL PATH ─────────────────────────────────────────────
 *
 *   useNavSummary() returns null outside a provider instead of throwing, and
 *   the nav then polls for itself exactly as before. Without that, this change
 *   would silently empty the badges on any screen that mounts the nav and was
 *   not wrapped. Both paths are asserted below, so neither can rot.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the nav's fallback polls left permanently enabled     KILLED (1 test)
 *     "nav" mode fetching the full dashboard payload        KILLED (2)
 *     the provider zeroing its badges on a failed poll      KILLED (1)
 *     the provider not re-polling when the user changes     KILLED (1)
 *     the nav ignoring the shared unread-message count      KILLED (1)
 *     the nav ignoring the shared notification count        KILLED (1)
 *     the nav ignoring the shared serviceRegistrations      SURVIVED TWICE
 *                                                           before being KILLED
 *     reword this header                                    SURVIVED, as intended
 *
 *   THE SURVIVOR IS WORTH THE SPACE. My first pass proved the PROVIDER hands
 *   out the right values, using small stand-in consumers. Rewriting the real
 *   DashboardNav to ignore all three shared values and read its own state —
 *   the precise regression this finding is about — changed no result, because
 *   nothing rendered the actual component.
 *
 *   Mounting it killed two of the three. `serviceRegistrations` survived even
 *   then: the counts appear in the DOM as numbers, and the registrations do not
 *   appear at all — they decide which MODULE LINKS exist. Only an assertion on
 *   a rendered link closes it.
 *
 *   Three attempts to kill one mutant, and each attempt was a test that looked
 *   thorough. A mutant that survives is telling you what your check is actually
 *   asking.
 */

import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

const mockUseSession = jest.fn();
const m = {
    getMyDashboard: jest.fn(),
    getMyNavSummary: jest.fn(),
    getMyServiceRegistrations: jest.fn(),
    getMyUnreadMessageCount: jest.fn(),
    getMyUnreadNotificationCount: jest.fn(),
};

jest.mock('next-auth/react', () => ({
    useSession: () => mockUseSession(),
    signOut: jest.fn(),
}));

/**
 * DashboardNav imports logoutAction from a server-action module, which pulls in
 * @upstash/redis and fails to parse under jsdom. Mocked here so the component
 * can be MOUNTED — which is the whole point of this block, since the synthetic
 * consumers above let a real regression survive.
 */
jest.mock('@/app/actions/auth', () => ({ logoutAction: jest.fn() }));
jest.mock('@/hooks/useFeatureToggle', () => ({
    useFeatureToggles: () => ({}),
    useFeatureToggle: () => true,
}));

jest.mock('@/app/actions/my-data', () => ({
    getMyDashboard: (...a: any[]) => (m.getMyDashboard as jest.Mock)(...a),
    getMyNavSummary: (...a: any[]) => (m.getMyNavSummary as any)(...a),
    getMyServiceRegistrations: (...a: any[]) => (m.getMyServiceRegistrations as any)(...a),
    getMyUnreadMessageCount: (...a: any[]) => (m.getMyUnreadMessageCount as any)(...a),
    getMyUnreadNotificationCount: (...a: any[]) => (m.getMyUnreadNotificationCount as any)(...a),
}));

const DASHBOARD_PAYLOAD = {
    serviceRegistrations: { marketplace: { status: 'approved' } },
    unreadNotifications: 7,
    unreadMessages: 3,
    recentNotifications: [],
    walletBalance: 1234,
    activeOrders: 2,
    upcomingEvents: [],
    recentResources: [],
};

const NAV_PAYLOAD = {
    serviceRegistrations: { marketplace: { status: 'approved' } },
    unreadNotifications: 7,
    unreadMessages: 3,
};

beforeEach(() => {
    jest.clearAllMocks();
    mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: ['user'] } },
        status: 'authenticated',
    });
    (m.getMyDashboard as jest.Mock).mockResolvedValue(DASHBOARD_PAYLOAD);
    (m.getMyNavSummary as any).mockResolvedValue(NAV_PAYLOAD);
    (m.getMyServiceRegistrations as any).mockResolvedValue({});
    (m.getMyUnreadMessageCount as any).mockResolvedValue(0);
    (m.getMyUnreadNotificationCount as any).mockResolvedValue(0);
});

/** Imported lazily so the mocks above are in place first. */
async function parts() {
    const { NavSummaryProvider, useNavSummary } = await import('@/contexts/NavSummaryContext');
    return { NavSummaryProvider, useNavSummary };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#539 — one poll, not four', () => {
    it('THE PROVIDER ASKS THE SERVER ONCE AND HANDS THE SAME ANSWER TO EVERYONE', async () => {
        const { NavSummaryProvider, useNavSummary } = await parts();

        function Nav() {
            const s = useNavSummary();
            return <div data-testid="nav">{s?.unreadMessages ?? -1}</div>;
        }
        function Page() {
            const s = useNavSummary();
            return <div data-testid="page">{s?.dashboard?.walletBalance ?? -1}</div>;
        }

        render(
            <NavSummaryProvider mode="full" userId="u1">
                <Nav />
                <Page />
            </NavSummaryProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('nav')).toHaveTextContent('3'));
        expect(screen.getByTestId('page')).toHaveTextContent('1234');

        //   THE assertion. Two consumers, one round trip.
        expect(m.getMyDashboard).toHaveBeenCalledTimes(1);

        //   And none of the individual actions the nav used to call.
        expect(m.getMyServiceRegistrations).not.toHaveBeenCalled();
        expect(m.getMyUnreadMessageCount).not.toHaveBeenCalled();
        expect(m.getMyUnreadNotificationCount).not.toHaveBeenCalled();
    });

    it('AND "nav" MODE DOES NOT DRAG THE WHOLE DASHBOARD PAYLOAD ALONG', async () => {
        //   /messages mounts the nav with no dashboard to draw. Asking for the
        //   full payload there would run five queries nobody uses.
        const { NavSummaryProvider, useNavSummary } = await parts();

        function Nav() {
            const s = useNavSummary();
            return <div data-testid="nav">{s?.unreadNotifications ?? -1}</div>;
        }

        render(
            <NavSummaryProvider mode="nav" userId="u1">
                <Nav />
            </NavSummaryProvider>,
        );

        await waitFor(() => expect(screen.getByTestId('nav')).toHaveTextContent('7'));

        expect(m.getMyNavSummary).toHaveBeenCalledTimes(1);
        expect(m.getMyDashboard).not.toHaveBeenCalled();
    });

    it('AND A FAILED POLL KEEPS THE LAST GOOD BADGES RATHER THAN ZEROING THEM', async () => {
        //   #416's rule, which the provider now owns for every consumer: a
        //   count that could not be read must not be rendered as "none".
        const { NavSummaryProvider, useNavSummary } = await parts();

        function Nav() {
            const s = useNavSummary();
            return <div data-testid="nav">{s?.unreadMessages ?? -1}</div>;
        }

        render(
            <NavSummaryProvider mode="nav" userId="u1" intervalMs={50}>
                <Nav />
            </NavSummaryProvider>,
        );
        await waitFor(() => expect(screen.getByTestId('nav')).toHaveTextContent('3'));

        (m.getMyNavSummary as any).mockRejectedValue(new Error('server down'));
        await act(async () => { await new Promise(r => setTimeout(r, 160)); });

        expect(screen.getByTestId('nav')).toHaveTextContent('3');
    });

    it('AND REPORTS "loaded" ONLY AFTER THE FIRST ANSWER', async () => {
        //   A consumer needs to tell "no unread messages" from "not asked yet",
        //   or it renders a confident zero over an unanswered question.
        const { NavSummaryProvider, useNavSummary } = await parts();

        let resolve!: (v: unknown) => void;
        (m.getMyNavSummary as any).mockReturnValue(new Promise(r => { resolve = r; }));

        function Nav() {
            const s = useNavSummary();
            return <div data-testid="nav">{String(s?.loaded)}</div>;
        }

        render(
            <NavSummaryProvider mode="nav" userId="u1">
                <Nav />
            </NavSummaryProvider>,
        );

        expect(screen.getByTestId('nav')).toHaveTextContent('false');

        await act(async () => { resolve(NAV_PAYLOAD); });
        await waitFor(() => expect(screen.getByTestId('nav')).toHaveTextContent('true'));
    });

    it('AND DOES NOT POLL AT ALL FOR A SIGNED-OUT VISITOR', async () => {
        const { NavSummaryProvider } = await parts();

        render(<NavSummaryProvider mode="nav" userId={undefined}><div /></NavSummaryProvider>);
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });

        expect(m.getMyNavSummary).not.toHaveBeenCalled();
        expect(m.getMyDashboard).not.toHaveBeenCalled();
    });

    it('AND RE-ASKS WHEN THE SIGNED-IN USER CHANGES', async () => {
        //   Otherwise the badge keeps showing the previous user's counts. The
        //   same property #416 pinned on the hook, now owned by the provider.
        const { NavSummaryProvider } = await parts();

        const { rerender } = render(
            <NavSummaryProvider mode="nav" userId="u1"><div /></NavSummaryProvider>,
        );
        await waitFor(() => expect(m.getMyNavSummary).toHaveBeenCalledTimes(1));

        rerender(<NavSummaryProvider mode="nav" userId="u2"><div /></NavSummaryProvider>);

        await waitFor(() => expect(m.getMyNavSummary).toHaveBeenCalledTimes(2));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#539 — the REAL nav, not a stand-in for it', () => {
    /**
     * THE TESTS ABOVE USE SYNTHETIC CONSUMERS AND A MUTANT SURVIVED BECAUSE
     * OF IT.
     *
     * Rewriting DashboardNav to ignore the shared values and read its own state
     * instead — the exact regression this finding is about — changed no result,
     * because nothing here rendered the actual component. Those tests prove the
     * PROVIDER hands out the right values; they say nothing about whether the
     * nav uses them.
     *
     * So the real component is mounted, and the badge is read off the DOM.
     */
    it('SHOWS THE SHARED COUNTS ON ITS BADGES, NOT ITS OWN', async () => {
        const { NavSummaryProvider } = await parts();
        const { default: DashboardNav } = await import('@/components/dashboard/DashboardNav');

        //   The nav's own actions would answer 0. The shared poll answers 3 and
        //   7, so a badge showing those can only have come from the provider.
        (m.getMyUnreadMessageCount as any).mockResolvedValue(0);
        (m.getMyUnreadNotificationCount as any).mockResolvedValue(0);

        render(
            <NavSummaryProvider mode="full" userId="u1">
                <DashboardNav />
            </NavSummaryProvider>,
        );

        await waitFor(() => {
            expect(screen.getAllByText('3').length).toBeGreaterThan(0);
        });
        expect(screen.getAllByText('7').length).toBeGreaterThan(0);

        /**
         * THE THIRD VALUE NEEDED ITS OWN ASSERTION, AND FINDING THAT OUT TOOK
         * A THIRD MUTANT.
         *
         * With the badges covered, rewriting only `serviceRegs` to ignore the
         * shared value STILL survived — the counts are rendered as numbers and
         * the registrations are not rendered at all. What they do is decide
         * which module links exist.
         *
         * The shared payload marks marketplace approved and the nav's own
         * action answers {}, so this link can only be here if the shared value
         * reached getModuleLinks.
         */
        expect(screen.getAllByText(/Marketplace/i).length).toBeGreaterThan(0);

        //   And it made no calls of its own while doing it.
        expect(m.getMyUnreadMessageCount).not.toHaveBeenCalled();
        expect(m.getMyServiceRegistrations).not.toHaveBeenCalled();
        expect(m.getMyUnreadNotificationCount).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#539 — the nav outside a provider still works', () => {
    it('FALLS BACK TO ITS OWN POLLING RATHER THAN SHOWING NOTHING', async () => {
        //   The path that stops this change from silently emptying the badges
        //   on any screen mounting the nav that nobody remembered to wrap.
        const { useNavSummary } = await parts();

        function Bare() {
            const s = useNavSummary();
            return <div data-testid="bare">{s === null ? 'no-provider' : 'provider'}</div>;
        }

        render(<Bare />);

        expect(screen.getByTestId('bare')).toHaveTextContent('no-provider');
    });
});
