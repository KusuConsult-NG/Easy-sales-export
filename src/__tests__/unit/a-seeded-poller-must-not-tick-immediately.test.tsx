/**
 * @jest-environment jsdom
 */

/**
 *   #558 A SEEDED POLLER THAT STILL TICKS IMMEDIATELY HAS SAVED NOTHING.
 *
 *   /dashboard/notifications is the one screen in the hydration ledger whose
 *   mount read is a POLL rather than a one-off fetch, and that changes what a
 *   server seed is worth.
 *
 *   On every other converted screen the seed removes a round trip: the effect
 *   would have fetched once, and now it does not. A poller fetches anyway —
 *   startVisibilityAwareInterval runs its task immediately by default, so the
 *   browser would re-ask, 0ms after hydrating, for exactly what the server had
 *   just sent with the page. The seed would have removed the empty first paint
 *   and nothing else.
 *
 *   So the seed IS the tick that would have happened, and the interval starts
 *   at 8s rather than now.
 *
 * ── AND IT HAS TO STOP BEING THE ANSWER THE MOMENT THE QUESTION CHANGES ─────
 *
 *   The effect re-runs when `pageSize` grows — "Show older notifications" — and
 *   that run is asking for a WIDER window than the server read. Handing it the
 *   seed again, or leaving the tick suppressed, would leave the button visibly
 *   doing nothing. The seed is taken once, so the second run polls immediately,
 *   as it always did.
 *
 *   The other two claims in this batch are checked here for the same reason:
 *   they are the ones where a seed could be present and the fetch could happen
 *   anyway, which is the failure the ledger exists to warn about.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     `immediate: !seeded` back to an unconditional immediate tick   KILLED (1)
 *     the seed not taken, so Show more stays suppressed              KILLED (1)
 *     the notifications window seeded but the rows not rendered      KILLED (1)
 *     the wallet's three seeds ignored                               KILLED (3)
 *     the seller-products seed handed to a FILTERED reset            SURVIVED
 *     Load More handed the seeded first page                         SURVIVED
 *     the seller screen's default filter changed away from "all"     KILLED (1)
 *     reword this header                                             SURVIVED, as intended
 *
 * ── TWO SURVIVORS, AND WHAT THEY TOLD ME ────────────────────────────────────
 *
 *   Both survivors are on the seller-products screen and both say the same
 *   thing: TAKE-ONCE IS THE WHOLE MECHANISM, and the conditions wrapped around
 *   it are ordering commentary that no test can distinguish.
 *
 *   The fetch was guarded three ways — take-once, `isReset`, and
 *   `filterStatus === "all" && !debouncedSearch`. But this screen renders
 *   nothing until the mount's own reset has run, so by the time a filter can
 *   differ or Load More can be pressed, the seed is already spent. Neither
 *   extra condition can change an outcome.
 *
 *   A surviving mutant tells you what your check is actually asking. Acted on
 *   differently for the two, and the difference is the point:
 *
 *     THE FILTER CONDITION IS GONE. It asserted something about the CONTENT of
 *     the request that could never be false, which is a check claiming a
 *     protection the code is not getting — #557, three commits earlier, was
 *     exactly that shape. What it was standing in for is now asserted where it
 *     CAN fail: this screen starts unfiltered, and the mutant that changes the
 *     default filter is killed by that test.
 *
 *     `isReset` STAYS. It is not a redundant copy of a rule; it names which
 *     call the seed belongs to, costs nothing, and stops being decoration the
 *     moment anyone seeds this screen's useState instead of its effect. Its
 *     survival is recorded here rather than hidden, so nobody reads the test
 *     below as proof of something it does not prove.
 */

import React from 'react';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const push = jest.fn();
const showToast = jest.fn();
const mockUseSession = jest.fn();

const n = { getMyNotifications: jest.fn(), deleteMyNotification: jest.fn() };
const w = {
    getWalletAction: jest.fn(),
    getWalletTransactionsAction: jest.fn(),
    fundWalletViaPaystackAction: jest.fn(),
    withdrawFromWalletAction: jest.fn(),
    getFeatureTogglesAction: jest.fn(),
};
const m = { getSellerProductsAction: jest.fn(), deleteProductAction: jest.fn() };

//   One router object, not a fresh one per render — see #557's note on why.
const router = { push, replace: push, refresh: jest.fn() };
jest.mock('next-auth/react', () => ({ useSession: () => mockUseSession() }));
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/dashboard/notifications',
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/app/actions/my-data', () => ({
    getMyNotifications: (...a: any[]) => n.getMyNotifications(...a),
    deleteMyNotification: (...a: any[]) => n.deleteMyNotification(...a),
}));
jest.mock('@/app/actions/notifications', () => ({ markAllAsReadAction: jest.fn(async () => ({ success: true })) }));
jest.mock('@/app/actions/wallet', () => ({
    getWalletAction: (...a: any[]) => w.getWalletAction(...a),
    getWalletTransactionsAction: (...a: any[]) => w.getWalletTransactionsAction(...a),
    fundWalletViaPaystackAction: (...a: any[]) => w.fundWalletViaPaystackAction(...a),
    withdrawFromWalletAction: (...a: any[]) => w.withdrawFromWalletAction(...a),
}));
jest.mock('@/app/actions/health', () => ({
    getFeatureTogglesAction: (...a: any[]) => w.getFeatureTogglesAction(...a),
}));
jest.mock('@/app/actions/marketplace', () => ({
    getSellerProductsAction: (...a: any[]) => m.getSellerProductsAction(...a),
    deleteProductAction: (...a: any[]) => m.deleteProductAction(...a),
}));

/** `count` notification rows, all read so the auto-mark path stays quiet. */
function rows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        userId: 'u1',
        type: 'system',
        title: `Notice ${i}`,
        message: 'Body',
        read: true,
        createdAt: new Date(2026, 0, 1).toISOString(),
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    mockUseSession.mockReturnValue({
        data: { user: { id: 'u1', name: 'Ada', roles: ['user'], serviceRegistrations: {} } },
        status: 'authenticated',
    });
    n.getMyNotifications.mockResolvedValue(rows(3));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#558 — the seeded poller starts at the interval, not at zero', () => {
    beforeEach(() => { jest.useFakeTimers(); });
    afterEach(() => { jest.useRealTimers(); });

    async function renderNotifications(initial: any) {
        const { default: NotificationsClient } =
            await import('@/app/dashboard/notifications/NotificationsClient');
        render(<NotificationsClient initial={initial} />);
    }

    it('A SEEDED SCREEN SHOWS ITS ROWS AND ASKS FOR NOTHING', async () => {
        await renderNotifications(rows(3));

        expect(screen.getByText('Notice 0')).toBeInTheDocument();
        //   THE CLAIM. Before the fix this was one call, immediately.
        expect(n.getMyNotifications).not.toHaveBeenCalled();
    });

    it('AND IT IS STILL POLLING — one tick later, it asks', async () => {
        //   The vacuity guard. "Never polls again" would pass the test above and
        //   turn a live notification list into a static one.
        await renderNotifications(rows(3));

        await act(async () => { jest.advanceTimersByTime(8000); await Promise.resolve(); });

        await waitFor(() => expect(n.getMyNotifications).toHaveBeenCalledTimes(1));
    });

    it('AND AN UNSEEDED SCREEN ASKS STRAIGHT AWAY, AS IT ALWAYS DID', async () => {
        await renderNotifications(null);

        await waitFor(() => expect(n.getMyNotifications).toHaveBeenCalled());
        expect(n.getMyNotifications.mock.calls[0][0]).toBe(26); // one over the window
    });

    it('AND "SHOW OLDER" ASKS IMMEDIATELY EVEN THOUGH THE PAGE WAS SEEDED', async () => {
        //   The seed answered a 25-row question. Widening it to 50 must not be
        //   answered by the same seed, and must not wait out the interval
        //   either — the button would look broken.
        //
        //   26 rows: one over the window, so `reachedEnd` is false and the
        //   button renders.
        await renderNotifications(rows(26));
        expect(n.getMyNotifications).not.toHaveBeenCalled();

        n.getMyNotifications.mockResolvedValue(rows(30));
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /Show older notifications/i }));
        });

        await waitFor(() => expect(n.getMyNotifications).toHaveBeenCalled());
        expect(n.getMyNotifications.mock.calls[0][0]).toBe(51); // 50 + 1
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#558 — the wallet arrives with all three of its answers', () => {
    it('A SEEDED WALLET MAKES NO CALLS OF ITS OWN', async () => {
        const { default: WalletClient } = await import('@/app/dashboard/wallet/WalletClient');

        render(<WalletClient initial={{
            toggles: { success: true, error: null, data: { wallet_funding: true } },
            wallet: {
                success: true, error: null,
                data: { balance: 12500, currency: 'NGN', bankDetails: null },
            },
            transactions: { success: true, error: null, data: { transactions: [], hasMore: false } },
        } as any} />);

        await waitFor(() => expect(screen.getByText(/12,500/)).toBeInTheDocument());
        expect(w.getFeatureTogglesAction).not.toHaveBeenCalled();
        expect(w.getWalletAction).not.toHaveBeenCalled();
        expect(w.getWalletTransactionsAction).not.toHaveBeenCalled();
    });

    it('AND AN UNSEEDED WALLET STILL MAKES ALL THREE', async () => {
        w.getFeatureTogglesAction.mockResolvedValue({ success: true, error: null, data: {} });
        w.getWalletAction.mockResolvedValue({
            success: true, error: null, data: { balance: 0, currency: 'NGN' },
        });
        w.getWalletTransactionsAction.mockResolvedValue({
            success: true, error: null, data: { transactions: [], hasMore: false },
        });

        const { default: WalletClient } = await import('@/app/dashboard/wallet/WalletClient');
        render(<WalletClient initial={null} />);

        await waitFor(() => expect(w.getWalletAction).toHaveBeenCalled());
        expect(w.getFeatureTogglesAction).toHaveBeenCalled();
        expect(w.getWalletTransactionsAction).toHaveBeenCalled();
    });

    it('AND A SEEDED-BUT-REFUSED WALLET STILL SAYS SO', async () => {
        //   A refusal is a real answer and the seed carries it. The screen must
        //   report it rather than sitting on a spinner forever.
        const { default: WalletClient } = await import('@/app/dashboard/wallet/WalletClient');

        render(<WalletClient initial={{
            toggles: { success: true, error: null, data: {} },
            wallet: { success: false, error: 'Wallet unavailable', data: null },
            transactions: { success: true, error: null, data: { transactions: [], hasMore: false } },
        } as any} />);

        await waitFor(() => expect(showToast).toHaveBeenCalledWith('Wallet unavailable', 'error'));
        expect(w.getWalletAction).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#558 — the seller-products seed answers only the question it was asked', () => {
    const PRODUCTS = {
        success: true, error: null,
        data: { products: [{ id: 'p1', title: 'Dried hibiscus', price: 4200, status: 'active' }], hasMore: false },
    };

    it('AN UNFILTERED FIRST PAGE COMES FROM THE SEED', async () => {
        const { default: SellerProductsClient } =
            await import('@/app/marketplace/seller/products/SellerProductsClient');
        render(<SellerProductsClient initial={PRODUCTS as any} />);

        //   findAllByText, not findByText: this screen renders the list TWICE —
        //   a table at desktop widths and cards below them — and jsdom has both
        //   in the document at once. The first spelling reported "found multiple
        //   elements" and read as the seed failing when it had worked.
        expect((await screen.findAllByText(/Dried hibiscus/i)).length).toBeGreaterThan(0);
        expect(m.getSellerProductsAction).not.toHaveBeenCalled();
    });

    it('AND THE SCREEN STARTS UNFILTERED — the question the seed answers', async () => {
        //   What the removed guard was standing in for, asserted where it can
        //   actually fail. The server reads "all products, no search"; if this
        //   screen ever opens on a different filter, the seed is answering a
        //   question nobody asked and this test is the one that says so.
        const { default: SellerProductsClient } =
            await import('@/app/marketplace/seller/products/SellerProductsClient');
        render(<SellerProductsClient initial={PRODUCTS as any} />);

        //   The active tab is the one painted green.
        const all = screen.getByRole('button', { name: /^All$/i });
        expect(all.className).toMatch(/bg-green-600/);
    });

    it('AND LOAD MORE ASKS FOR THE NEXT PAGE, FROM THE SEEDED CURSOR', async () => {
        //   NOT a proof that `isReset` guards anything — see the header: that
        //   mutant survived, because the mount has already spent the seed. What
        //   this does check is that paging still works off a SEEDED first page,
        //   which is the part a conversion can plausibly break: the cursor now
        //   comes from data the client never fetched.
        m.getSellerProductsAction.mockResolvedValue({
            success: true, error: null,
            data: { products: [{ id: 'p2', title: 'Shea butter', price: 900, status: 'active' }], hasMore: false },
        });

        const { default: SellerProductsClient } =
            await import('@/app/marketplace/seller/products/SellerProductsClient');
        render(<SellerProductsClient initial={{
            success: true, error: null,
            data: {
                products: [{ id: 'p1', title: 'Dried hibiscus', price: 4200, status: 'active' }],
                hasMore: true, lastId: 'p1',
            },
        } as any} />);

        await screen.findAllByText(/Dried hibiscus/i);
        expect(m.getSellerProductsAction).not.toHaveBeenCalled();

        await act(async () => {
            fireEvent.click(screen.getAllByRole('button', { name: /load more/i })[0]);
        });

        await waitFor(() => expect(m.getSellerProductsAction).toHaveBeenCalled());
        expect(m.getSellerProductsAction.mock.calls[0][0]).toMatchObject({ lastId: 'p1' });
        expect((await screen.findAllByText(/Shea butter/i)).length).toBeGreaterThan(0);
    });

    it('AND A FILTERED RESET ASKS THE SERVER THE NEW QUESTION', async () => {
        //   THE TRAP THIS GUARDS. The filter and the search reuse the same reset
        //   path, and the seed was read with neither. Reusing it there would
        //   show the unfiltered list under a filter nobody chose.
        m.getSellerProductsAction.mockResolvedValue({
            success: true, error: null, data: { products: [], hasMore: false },
        });

        const { default: SellerProductsClient } =
            await import('@/app/marketplace/seller/products/SellerProductsClient');
        render(<SellerProductsClient initial={PRODUCTS as any} />);
        await screen.findAllByText(/Dried hibiscus/i);

        //   The status filter is a row of buttons, not a <select> — the first
        //   version of this test fired `change` at an element that does not
        //   exist on the screen.
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: /^draft$/i }));
        });

        await waitFor(() => expect(m.getSellerProductsAction).toHaveBeenCalled());
        expect(m.getSellerProductsAction.mock.calls[0][0]).toMatchObject({ status: 'draft' });
    });
});
