/**
 * @jest-environment jsdom
 */

/**
 *   #594 SIX MORE SCREENS, AND ON TWO OF THEM THE LOUDER LIE WAS A NUMBER.
 *
 *   #588 measured this class and capped it at 35; #592 took it to 23 and found
 *   the instrument was over-counting by one. This batch takes it to 17:
 *
 *     cooperatives/fixed-savings  "No Fixed Savings Plans Yet — create your
 *                                 first fixed savings plan", over money that is
 *                                 locked up and earning. Clicking that button
 *                                 locks up a second amount.
 *
 *                                 AND THE FIX HAD ALREADY REACHED THE OTHER
 *                                 DOOR IN THIS FILE. `membershipCheckFailed`
 *                                 exists twenty lines above `fetchPlans`,
 *                                 because a 500 answering { success: false }
 *                                 read as "not a member". The plans read, in
 *                                 the same component, had no else at all.
 *
 *     cooperatives/history        "You haven't made any transactions yet" — the
 *                                 record of every contribution a member has
 *                                 paid in.
 *
 *     dashboard/notifications     "No Notifications. You're all caught up!",
 *                                 which is the one sentence on that screen that
 *                                 must never be said on a guess: a notification
 *                                 is how this platform says an order was
 *                                 disputed, a loan approved, a withdrawal
 *                                 failed.
 *
 *     dashboard/reviews           "No Reviews Yet." A toast is not a state — it
 *                                 goes after a few seconds and leaves the empty
 *                                 state behind it.
 *
 *     marketplace/buyer/dashboard    ┐ see below
 *     marketplace/seller/dashboard   ┘
 *
 * ── THE COUNTS ARE THE WORSE HALF ───────────────────────────────────────────
 *
 *   Both dashboards initialise `stats` to an object of ZEROES and gate every
 *   assignment on `if (result.success && result.data?.…)` with no else. So a
 *   seller whose analytics could not be read is shown, in the largest type on
 *   the page:
 *
 *       ₦0 Total Sales   ₦0/mo   0 Active Listings   0 Pending Orders   0.0 ★
 *
 *   A live business rendered as a dead one. An empty list at least looks like
 *   an empty list; five confident zeroes look like an answer, and a seller who
 *   believes them goes looking for what happened to their listings.
 *
 *   THE RATCHET CANNOT SEE THIS HALF, and that is worth writing down rather
 *   than leaving implied. Its predicate looks for a `.length === 0` empty
 *   state; a `stats` object of zeroes has none. Every screen it counts is a
 *   real offender, but the count is not the whole class.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   NO READ WAS MADE MORE RELIABLE. These screens fail exactly as often as they
 *   did; what changed is what they say when they do.
 *
 *   EACH READ IS TRACKED SEPARATELY — three flags on the seller's dashboard,
 *   two on the buyer's — for #592's reason: the reads fail independently, and
 *   one shared flag puts a failure panel over a list that read perfectly well.
 *   Two things are deliberately NOT tracked: the buyer's RECOMMENDATIONS, since
 *   nothing on that shelf is the buyer's own and an empty one makes no claim
 *   about anything they own, and the seller's FEATURE TOGGLES, which decide
 *   whether a button appears.
 *
 *   THE POLLING SCREEN ONLY BLANKS AN EMPTY LIST. Notifications polls every
 *   eight seconds, so `loadFailed && notifications.length === 0` is the
 *   condition — a failed tick over notifications already on screen leaves them.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

const getTransactionsAction = jest.fn() as jest.Mock<any>;
const getUserReviewsAction = jest.fn() as jest.Mock<any>;
const getMyNotifications = jest.fn() as jest.Mock<any>;
const getBuyerStatsAction = jest.fn() as jest.Mock<any>;
const getBuyerOrdersAction = jest.fn() as jest.Mock<any>;
const getRecommendedProductsAction = jest.fn() as jest.Mock<any>;
const getSellerAnalyticsAction = jest.fn() as jest.Mock<any>;
const getSellerOrdersAction = jest.fn() as jest.Mock<any>;
const getSellerProductsAction = jest.fn() as jest.Mock<any>;

jest.mock('@/app/actions/cooperative', () => ({
    getTransactionsAction: (...a: any[]) => getTransactionsAction(...a),
    withdrawMaturedFixedSavingsAction: jest.fn(),
    getMembershipAction: jest.fn(),
}));
jest.mock('@/app/actions/reviews', () => ({
    getUserReviewsAction: (...a: any[]) => getUserReviewsAction(...a),
    updateReviewAction: jest.fn(),
}));
jest.mock('@/app/actions/my-data', () => ({
    getMyNotifications: (...a: any[]) => getMyNotifications(...a),
    deleteMyNotification: jest.fn(),
    markNotificationAsReadAction: jest.fn(),
    markAllAsReadAction: jest.fn(),
}));
jest.mock('@/app/actions/marketplace', () => ({
    getBuyerStatsAction: (...a: any[]) => getBuyerStatsAction(...a),
    getBuyerOrdersAction: (...a: any[]) => getBuyerOrdersAction(...a),
    getRecommendedProductsAction: (...a: any[]) => getRecommendedProductsAction(...a),
    getSellerAnalyticsAction: (...a: any[]) => getSellerAnalyticsAction(...a),
    getSellerOrdersAction: (...a: any[]) => getSellerOrdersAction(...a),
    getSellerProductsAction: (...a: any[]) => getSellerProductsAction(...a),
}));
jest.mock('@/app/actions/health', () => ({
    getFeatureTogglesAction: jest.fn(async () => ({ success: true, error: null, data: {} })),
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({
    useSession: () => ({
        data: { user: { id: 'u1', name: 'Ada', email: 'ada@example.com', roles: [] } },
        status: 'authenticated',
    }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
    useParams: () => ({}),
}));

const FAILED = /we could not load/i;

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — the cooperative history', () => {
    async function history() {
        const { default: CooperativeHistoryClient } =
            await import('@/app/cooperatives/(member)/history/CooperativeHistoryClient');
        return render(<CooperativeHistoryClient initial={null} />);
    }

    it('A FAILED READ IS NOT "You haven\'t made any transactions yet"', async () => {
        getTransactionsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await history();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/haven't made any transactions/i);
    });

    it('AND A THROWN READ IS THE SAME', async () => {
        getTransactionsAction.mockRejectedValue(new Error('network down'));

        const { container } = await history();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
    });

    it('AND A MEMBER WITH NO HISTORY IS STILL TOLD SO', async () => {
        getTransactionsAction.mockResolvedValue({ success: true, error: null, data: { transactions: [] } });

        const { container } = await history();

        await waitFor(() => expect(container.textContent).toMatch(/no transactions found/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND A FILTER THAT MATCHES NOTHING IS STILL A FILTER, NOT A FAILURE', async () => {
        /**
         *   The guard is on `transactions`, not on the FILTERED list, and this
         *   is why: a search box that matches none of twenty rows must say "try
         *   adjusting your filters", not "we could not load your history".
         */
        getTransactionsAction.mockResolvedValue({
            success: true, error: null,
            data: { transactions: [{ id: 't1', type: 'contribution', amount: 5000, description: 'Monthly dues' }] },
        });

        const { container, getByPlaceholderText } = await history();
        await waitFor(() => expect(container.textContent).toContain('Monthly dues'));

        const search = getByPlaceholderText(/search/i) as HTMLInputElement;
        const { fireEvent } = await import('@testing-library/react');
        fireEvent.change(search, { target: { value: 'zzzz-no-such-thing' } });

        expect(container.textContent).toMatch(/no transactions found/i);
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — fixed savings, where the fix reached one of two doors', () => {
    /**
     * Both reads go through `fetch`, to two different routes. The membership
     * one has to succeed for the plans half of the screen to render at all —
     * this component shows a join-the-cooperative page otherwise — so it is
     * answered "approved" and only the PLANS read is varied.
     */
    async function fixedSavings(plansReply: any) {
        (global as any).fetch = jest.fn(async (url: string) => {
            if (String(url).includes('check-membership')) {
                return { ok: true, json: async () => ({ success: true, isMember: true, status: 'approved' }) };
            }
            if (plansReply instanceof Error) throw plansReply;
            return { ok: true, json: async () => plansReply };
        });
        const { default: FixedSavingsClient } =
            await import('@/app/cooperatives/(member)/fixed-savings/FixedSavingsClient');
        return render(<FixedSavingsClient initial={null} />);
    }

    it('A MEMBER IS NOT INVITED TO LOCK UP A SECOND AMOUNT', async () => {
        const { container } = await fixedSavings({ success: false, error: 'unavailable' });

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no fixed savings plans yet|create your first plan/i);
    });

    it('AND A THROWN READ IS THE SAME', async () => {
        const { container } = await fixedSavings(new Error('network down'));

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no fixed savings plans yet/i);
    });

    it('AND A MEMBER WITH NO PLANS IS STILL INVITED TO MAKE ONE', async () => {
        const { container } = await fixedSavings({ success: true, plans: [] });

        await waitFor(() => expect(container.textContent).toMatch(/no fixed savings plans yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — my reviews', () => {
    async function reviews() {
        const { default: MyReviewsClient } =
            await import('@/app/dashboard/reviews/MyReviewsClient');
        return render(<MyReviewsClient initial={null} />);
    }

    it('A TOAST IS NOT A STATE — THE SCREEN SAYS IT TOO', async () => {
        getUserReviewsAction.mockResolvedValue({ success: false, error: 'unavailable', data: null });

        const { container } = await reviews();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no reviews yet|haven't written any reviews/i);
    });

    it('AND A MEMBER WHO HAS WRITTEN NONE IS STILL TOLD SO', async () => {
        getUserReviewsAction.mockResolvedValue({ success: true, error: null, data: { reviews: [] } });

        const { container } = await reviews();

        await waitFor(() => expect(container.textContent).toMatch(/no reviews yet/i));
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — notifications, where "all caught up" is the dangerous sentence', () => {
    async function notifications() {
        const { default: NotificationsClient } =
            await import('@/app/dashboard/notifications/NotificationsClient');
        return render(<NotificationsClient initial={null} />);
    }

    it('A FAILED READ DOES NOT SAY "You\'re all caught up!"', async () => {
        getMyNotifications.mockRejectedValue(new Error('unavailable'));

        const { container } = await notifications();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/all caught up/i);
    });

    it('AND SOMEBODY GENUINELY CAUGHT UP IS TOLD SO', async () => {
        getMyNotifications.mockResolvedValue([]);

        const { container } = await notifications();

        await waitFor(() => expect(container.textContent).toMatch(/all caught up/i));
        expect(container.textContent).not.toMatch(FAILED);
    });

    it('AND A FAILED POLL OVER NOTIFICATIONS ALREADY ON SCREEN LEAVES THEM', async () => {
        getMyNotifications.mockResolvedValueOnce([{
            id: 'n1', userId: 'u1', type: 'order', title: 'Your order was disputed',
            message: 'Buyer opened a dispute', read: false, createdAt: new Date().toISOString(),
        }]);
        getMyNotifications.mockRejectedValue(new Error('poll failed'));

        const { container } = await notifications();

        await waitFor(() => expect(container.textContent).toContain('Your order was disputed'));
        await new Promise(r => setTimeout(r, 0));
        expect(container.textContent).toContain('Your order was disputed');
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — the buyer dashboard, where the zeroes were the lie', () => {
    async function buyerDashboard(opts: { stats?: any; orders?: any } = {}) {
        getBuyerStatsAction.mockResolvedValue(opts.stats ?? { success: false, error: 'unavailable', data: null });
        getBuyerOrdersAction.mockResolvedValue(opts.orders ?? { success: false, error: 'unavailable', data: null });
        getRecommendedProductsAction.mockResolvedValue({ success: true, error: null, data: { products: [] } });
        const { default: BuyerDashboardClient } =
            await import('@/app/marketplace/buyer/dashboard/BuyerDashboardClient');
        return render(<BuyerDashboardClient initial={null} />);
    }

    it('A BUYER IS NOT TOLD THEY HAVE SPENT ₦0 WHEN NOBODY COULD ASK', async () => {
        const { container } = await buyerDashboard();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/active orders|completed orders|total spent/i);
    });

    it('AND THE ORDER LIST SAYS SO SEPARATELY', async () => {
        const { container } = await buyerDashboard();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/no orders yet|start shopping to see your orders/i);
    });

    it('AND ONE READ FAILING DOES NOT BLAME THE OTHER', async () => {
        //   #592's certificates lesson: one shared flag would put a panel over
        //   a list that read perfectly well.
        const { container } = await buyerDashboard({
            stats: { success: true, error: null, data: { stats: { activeOrders: 2, completedOrders: 7, totalSpent: 145_000, savedSellers: 1 } } },
        });

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        //   The figures read fine and are still on screen.
        expect(container.textContent).toMatch(/active orders/i);
        expect(container.textContent).toContain('145,000');
        //   And exactly one panel — on the orders.
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(1);
    });

    it('AND A NETWORK THAT IS DOWN FAILS BOTH, BECAUSE NEITHER WAS READ', async () => {
        /**
         *   A SURVIVING MUTANT IS WHY THIS TEST EXISTS, FOR THE SECOND TIME.
         *   #592's certificates screen had exactly this gap: every test mocked
         *   the read to RESOLVE with a failure body, so emptying the SHARED
         *   `catch` around the Promise.all changed nothing. Covered from four
         *   angles on the refusal path and from none on the throw path.
         */
        getBuyerStatsAction.mockRejectedValue(new Error('network down'));
        getBuyerOrdersAction.mockRejectedValue(new Error('network down'));
        getRecommendedProductsAction.mockRejectedValue(new Error('network down'));
        const { default: BuyerDashboardClient } =
            await import('@/app/marketplace/buyer/dashboard/BuyerDashboardClient');
        const { container } = render(<BuyerDashboardClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/total spent|no orders yet/i);
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(2);
    });

    it('AND A BRAND NEW BUYER SEES ZEROES AND AN EMPTY LIST, BECAUSE THAT IS TRUE', async () => {
        //   THE vacuity guard: this screen must still be able to say "nothing
        //   yet" when nothing is what the read returned.
        const { container } = await buyerDashboard({
            stats: { success: true, error: null, data: { stats: { activeOrders: 0, completedOrders: 0, totalSpent: 0, savedSellers: 0 } } },
            orders: { success: true, error: null, data: { orders: [] } },
        });

        await waitFor(() => expect(container.textContent).toMatch(/no orders yet/i));
        expect(container.textContent).toMatch(/total spent/i);
        expect(container.textContent).not.toMatch(FAILED);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#594 — the seller dashboard, and a live business rendered as a dead one', () => {
    async function sellerDashboard(opts: { analytics?: any; orders?: any; products?: any } = {}) {
        const fail = { success: false, error: 'unavailable', data: null };
        getSellerAnalyticsAction.mockResolvedValue(opts.analytics ?? fail);
        getSellerOrdersAction.mockResolvedValue(opts.orders ?? fail);
        getSellerProductsAction.mockResolvedValue(opts.products ?? fail);
        const { default: SellerDashboardClient } =
            await import('@/app/marketplace/seller/dashboard/SellerDashboardClient');
        return render(<SellerDashboardClient initial={null} />);
    }

    it('NO ₦0 TOTAL SALES AND NO 0.0 RATING OVER A READ THAT FAILED', async () => {
        const { container } = await sellerDashboard();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/total sales|active listings|average rating/i);
    });

    it('AND ALL THREE READS SAY SO SEPARATELY', async () => {
        const { container } = await sellerDashboard();

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(3);
        expect(container.textContent).not.toMatch(/no orders yet|no products yet/i);
    });

    it('AND THE FIGURES SURVIVING A LIST FAILURE STAY ON SCREEN', async () => {
        const { container } = await sellerDashboard({
            analytics: {
                success: true, error: null,
                data: { analytics: { totalSales: 980_000, activeListings: 12, pendingOrders: 3, monthlyRevenue: 210_000, conversionRate: 4, averageRating: 4.6 } },
            },
        });

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).toContain('980,000');
        expect(container.textContent).toMatch(/active listings/i);
        //   Two panels — the orders and the products — not three.
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(2);
    });

    it('AND A NETWORK THAT IS DOWN FAILS ALL THREE', async () => {
        //   The throw path, for the same reason as the buyer's above.
        getSellerAnalyticsAction.mockRejectedValue(new Error('network down'));
        getSellerOrdersAction.mockRejectedValue(new Error('network down'));
        getSellerProductsAction.mockRejectedValue(new Error('network down'));
        const { default: SellerDashboardClient } =
            await import('@/app/marketplace/seller/dashboard/SellerDashboardClient');
        const { container } = render(<SellerDashboardClient initial={null} />);

        await waitFor(() => expect(container.textContent).toMatch(FAILED));
        expect(container.textContent).not.toMatch(/total sales|no orders yet|no products yet/i);
        expect(container.textContent.match(/we could not load/gi)).toHaveLength(3);
    });

    it('AND A SELLER WHO HAS SOLD NOTHING YET SEES ZEROES, BECAUSE THAT IS TRUE', async () => {
        const { container } = await sellerDashboard({
            analytics: {
                success: true, error: null,
                data: { analytics: { totalSales: 0, activeListings: 0, pendingOrders: 0, monthlyRevenue: 0, conversionRate: 0, averageRating: 0 } },
            },
            orders: { success: true, error: null, data: { orders: [] } },
            products: { success: true, error: null, data: { products: [] } },
        });

        await waitFor(() => expect(container.textContent).toMatch(/no orders yet/i));
        expect(container.textContent).toMatch(/no products yet/i);
        expect(container.textContent).toMatch(/total sales/i);
        expect(container.textContent).not.toMatch(FAILED);
    });
});

/**
 * ── THE MUTATION TABLE ──────────────────────────────────────────────────────
 *
 *   Against a green baseline, one anchored swap at a time, each restored and
 *   verified with `diff -q` before the next:
 *
 *     history: else branch dropped                      KILLED
 *     history: catch stops recording                    KILLED
 *     fixed-savings: else branch dropped                KILLED
 *     fixed-savings: catch stops recording              KILLED
 *     fixed-savings: empty state shown anyway           KILLED (2 tests)
 *     reviews: the else stops recording                 KILLED
 *     reviews: panel branch removed                     KILLED
 *     notifications: catch stops recording              KILLED
 *     notifications: guard drops the length check       KILLED (the poll test)
 *     notifications: the subtitle says "caught up" again KILLED
 *     buyer: stats else dropped                         KILLED
 *     buyer: orders else dropped                        KILLED (2)
 *     buyer: the zeroed stat grid shown anyway          KILLED
 *     buyer: one flag shared by both reads              KILLED
 *     buyer: the shared catch stops recording           KILLED  ← see below
 *     seller: analytics else dropped                    KILLED (2)
 *     seller: orders else dropped                       KILLED (2)
 *     seller: products else dropped                     KILLED (2)
 *     seller: the zeroed stat grid shown anyway         KILLED (2)
 *     seller: one flag shared by all three              KILLED
 *     seller: the shared catch stops recording          KILLED  ← see below
 *     reword this header                                SURVIVED, as intended
 *
 *   TWO SURVIVED THE FIRST RUN, AND THEY WERE #592's SURVIVOR AGAIN. Emptying
 *   the SHARED `catch` around each dashboard's Promise.all changed nothing,
 *   because every test mocked the actions to RESOLVE with `{ success: false }`
 *   and none made one REJECT. Four angles on the refusal path, none on the
 *   throw path — the identical gap the certificates screen had one commit
 *   earlier, which is what a recurring gap looks like when you only fix the
 *   instance. Both dashboards have a network-down test now.
 *
 *   AND ONE EQUIVALENT MUTANT, RECORDED AS SUCH AND NOT COUNTED AS COVERAGE.
 *   Changing the history screen's guard from `transactions.length === 0` to
 *   `filteredTransactions.length === 0` survives, and it survives because the
 *   two cannot differ on this screen: it reads ONCE, so whenever `loadFailed`
 *   is true `transactions` is still the `[]` it started as, filter or no
 *   filter. The unfiltered list is kept anyway — the sentence is about the
 *   history, not about the search box — but no test can tell them apart today
 *   and pretending otherwise would be the kind of coverage claim this audit
 *   exists to catch.
 */
