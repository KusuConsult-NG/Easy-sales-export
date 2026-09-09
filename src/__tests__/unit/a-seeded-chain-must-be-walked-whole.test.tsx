/**
 * @jest-environment jsdom
 */

/**
 *   #559 A CHAIN SEEDED HALFWAY IS WORSE THAN A CHAIN NOT SEEDED AT ALL.
 *
 *   Batch 13 of the hydration ledger converts five screens, and two of them are
 *   the shapes this ledger has been most careful about:
 *
 *   THE CONDITIONAL SECOND LINK. /marketplace/seller/orders/[id] reads the
 *   order, and then — only if that order carries a tracking number — its
 *   tracking updates. In the browser those were two effects, so a seller
 *   opening a dispatched order waited for the page, then for the order, and
 *   then for the tracking, each one starting only after the last came back.
 *
 *   The server walks both links under the same condition, so an UNTRACKED order
 *   still costs exactly one read. And it seeds all-or-nothing: handing down an
 *   order while the tracking was still on its way would leave a screen that
 *   looks loaded and is not, which is the exact failure #545's ledger exists to
 *   warn about.
 *
 *   THE DERIVED SEED. /cooperatives/id-card does not merely display what it
 *   read — it opens its own editor when the card is missing a field it needs.
 *   That rule has to reach the SEEDED path too, or a member whose card is
 *   incomplete would be handed a card and no way to complete it. It lives in
 *   one function, `derive`, used by the seed and by every refetch.
 *
 * ── WHAT IS NOT CLAIMED ─────────────────────────────────────────────────────
 *
 *   None of this makes a failed read succeed. Every seed here is optional: when
 *   the server's read throws or is refused, the seed is null and the client
 *   fetches exactly as it did before, spinner and all. The tests below check
 *   both directions, because a "seed" that silently replaced the fetch would
 *   turn a transient failure into a permanently empty screen.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the order seed ignored, so the client fetches anyway     KILLED (1 test)
 *     the tracking seed ignored                                KILLED (1)
 *     the tracking read made for an order with no number       KILLED (1)
 *     `derive`'s editor rule dropped from the seeded path      KILLED (1)
 *     the id-card seed not applied to state at all             KILLED (2)
 *     the village-market seed ignored                          KILLED (1)
 *     reword this header                                       SURVIVED, as intended
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const showToast = jest.fn();
const push = jest.fn();
const router = { push, replace: push, refresh: jest.fn() };

const o = {
    getOrderByIdForSellerAction: jest.fn(),
    getTrackingUpdatesAction: jest.fn(),
    updateOrderStatusAction: jest.fn(),
};
const c = {
    getCooperativeMemberIdCardAction: jest.fn(),
    updatePassportPhotoAction: jest.fn(),
    updateMemberProfileDetailsAction: jest.fn(),
};
const v = {
    getVillageMarketEventAction: jest.fn(),
    joinVillageMarketEventAction: jest.fn(),
    addFlashSaleProductAction: jest.fn(),
    getActiveVillageMarketEventsAction: jest.fn(),
};

let orderId = 'ord-1';
jest.mock('next-auth/react', () => ({
    useSession: () => ({ data: { user: { id: 'u1', roles: ['user'] } }, status: 'authenticated' }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => router,
    useParams: () => ({ id: orderId }),
    useSearchParams: () => new URLSearchParams(),
    usePathname: () => '/',
}));
jest.mock('@/contexts/ToastContext', () => ({
    useToast: () => ({ showToast }),
    ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/app/actions/order-management', () => ({
    getOrderByIdForSellerAction: (...a: any[]) => o.getOrderByIdForSellerAction(...a),
    getTrackingUpdatesAction: (...a: any[]) => o.getTrackingUpdatesAction(...a),
    updateOrderStatusAction: (...a: any[]) => o.updateOrderStatusAction(...a),
}));
jest.mock('@/app/actions/cooperative', () => ({
    getCooperativeMemberIdCardAction: (...a: any[]) => c.getCooperativeMemberIdCardAction(...a),
    updatePassportPhotoAction: (...a: any[]) => c.updatePassportPhotoAction(...a),
    updateMemberProfileDetailsAction: (...a: any[]) => c.updateMemberProfileDetailsAction(...a),
}));
jest.mock('@/app/actions/village-market', () => ({
    getVillageMarketEventAction: (...a: any[]) => v.getVillageMarketEventAction(...a),
    joinVillageMarketEventAction: (...a: any[]) => v.joinVillageMarketEventAction(...a),
    addFlashSaleProductAction: (...a: any[]) => v.addFlashSaleProductAction(...a),
    getActiveVillageMarketEventsAction: (...a: any[]) => v.getActiveVillageMarketEventsAction(...a),
}));

function order(overrides: Record<string, any> = {}) {
    return {
        id: 'ord-1',
        orderNumber: 'EX-1001',
        status: 'shipped',
        totalAmount: 25000,
        createdAt: new Date(2026, 0, 1).toISOString(),
        items: [{ productId: 'p1', title: 'Dried hibiscus', quantity: 2, price: 12500 }],
        buyerName: 'Ada',
        ...overrides,
    };
}

const CARD = {
    memberName: 'Ada Obi',
    memberId: 'CO-0001',
    validUntil: new Date(2027, 0, 1).toISOString(),
    gender: 'Female',
    stateOfOrigin: 'Enugu',
    passportPhotoUrl: null,
};

beforeEach(() => {
    jest.clearAllMocks();
    orderId = 'ord-1';
    //   jsdom has no fetch; the ID card proxies its passport photo through one.
    (global as any).fetch = jest.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }));
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#559 — the seller order chain, both links or neither', () => {
    async function renderOrder(initial: any) {
        const { default: SellerOrderDetailClient } =
            await import('@/app/marketplace/seller/orders/[id]/SellerOrderDetailClient');
        render(<SellerOrderDetailClient initial={initial} />);
    }

    it('A FULLY SEEDED ORDER MAKES NEITHER READ', async () => {
        await renderOrder({
            orderResult: { success: true, error: null, data: { order: order({ trackingNumber: 'TRK-9' }) } },
            trackingResult: {
                success: true, error: null,
                data: { updates: [{ status: 'In transit', timestamp: new Date(2026, 0, 2).toISOString() }] },
            },
        });

        expect(await screen.findByText(/EX-1001/i)).toBeInTheDocument();
        expect(o.getOrderByIdForSellerAction).not.toHaveBeenCalled();
        expect(o.getTrackingUpdatesAction).not.toHaveBeenCalled();
    });

    it('AND AN ORDER WITH NO TRACKING NUMBER NEVER ASKS FOR TRACKING', async () => {
        //   The condition that keeps the server from doing work the browser
        //   would not have done either.
        await renderOrder({
            orderResult: { success: true, error: null, data: { order: order() } },
            trackingResult: null,
        });

        expect(await screen.findByText(/EX-1001/i)).toBeInTheDocument();
        expect(o.getTrackingUpdatesAction).not.toHaveBeenCalled();
    });

    it('AND AN UNSEEDED SCREEN STILL WALKS THE CHAIN ITSELF', async () => {
        //   The direction that matters most: a failed server read must leave a
        //   working screen, not an empty one.
        o.getOrderByIdForSellerAction.mockResolvedValue({
            success: true, error: null, data: { order: order({ trackingNumber: 'TRK-9' }) },
        });
        o.getTrackingUpdatesAction.mockResolvedValue({
            success: true, error: null, data: { updates: [] },
        });

        await renderOrder(null);

        await waitFor(() => expect(o.getOrderByIdForSellerAction).toHaveBeenCalledWith('ord-1'));
        await waitFor(() => expect(o.getTrackingUpdatesAction).toHaveBeenCalledWith('TRK-9'));
        expect(await screen.findByText(/EX-1001/i)).toBeInTheDocument();
    });

    it('AND A SEEDED REFUSAL IS SHOWN AS A REFUSAL, NOT AS A MISSING ORDER', async () => {
        //   The action's OWN message, not the screen's generic heading — the
        //   first spelling of this asked for /Order not found/ and matched both
        //   the "Order Not Found" title and the message under it, which read as
        //   a failure when the seed had worked.
        await renderOrder({
            orderResult: { success: false, error: 'This order belongs to another seller', data: null },
            trackingResult: null,
        });

        expect(await screen.findByText(/belongs to another seller/i)).toBeInTheDocument();
        expect(o.getOrderByIdForSellerAction).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#559 — the ID card seed carries the rule, not just the data', () => {
    async function renderCard(initial: any) {
        const { default: IdCardClient } =
            await import('@/app/cooperatives/(member)/id-card/IdCardClient');
        render(<IdCardClient initial={initial} />);
    }

    it('A COMPLETE CARD ARRIVES SHOWN, WITH NO READ OF ITS OWN', async () => {
        await renderCard({ success: true, error: null, data: CARD });

        expect(await screen.findByText(/Active Member/i)).toBeInTheDocument();
        expect(c.getCooperativeMemberIdCardAction).not.toHaveBeenCalled();
    });

    it('AND AN INCOMPLETE ONE OPENS ITS EDITOR STRAIGHT AWAY', async () => {
        //   THE CLAIM. `derive` decides this, and it has to reach the seeded
        //   path — a member handed an incomplete card and no form would be
        //   stuck looking at a card they cannot finish.
        await renderCard({
            success: true, error: null,
            data: { ...CARD, gender: '', stateOfOrigin: '' },
        });

        expect(await screen.findByText(/Missing ID Card Details/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/State of Origin/i)).toBeInTheDocument();
        expect(c.getCooperativeMemberIdCardAction).not.toHaveBeenCalled();
    });

    it('AND A COMPLETE CARD DOES NOT OPEN IT — the vacuity guard', async () => {
        //   "Always editing" would pass the test above and put every member
        //   into a form they have already filled in.
        await renderCard({ success: true, error: null, data: CARD });

        await screen.findByText(/Active Member/i);
        expect(screen.queryByText(/Missing ID Card Details/i)).not.toBeInTheDocument();
    });

    it('AND AN UNSEEDED SCREEN STILL READS THE CARD', async () => {
        c.getCooperativeMemberIdCardAction.mockResolvedValue({
            success: true, error: null, data: CARD,
        });

        await renderCard(null);

        await waitFor(() => expect(c.getCooperativeMemberIdCardAction).toHaveBeenCalled());
        expect(await screen.findByText(/Active Member/i)).toBeInTheDocument();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#559 — the village market event arrives with its flash sale', () => {
    const EVENT = {
        id: 'vm-1',
        title: 'Enugu Harvest Market',
        status: 'live',
        startsAt: new Date(2026, 0, 1).toISOString(),
        endsAt: new Date(2027, 0, 1).toISOString(),
    };

    async function renderEvent(initial: any) {
        const { default: VillageMarketEventClient } =
            await import('@/app/marketplace/village-market/[id]/VillageMarketEventClient');
        render(<VillageMarketEventClient initial={initial} />);
    }

    it('A SEEDED EVENT IS SHOWN WITHOUT A READ', async () => {
        await renderEvent({ event: EVENT, products: [] });

        expect(await screen.findByText(/Enugu Harvest Market/i)).toBeInTheDocument();
        expect(v.getVillageMarketEventAction).not.toHaveBeenCalled();
    });

    it('AND A FAILED SERVER READ LEAVES THE CLIENT TO DO IT', async () => {
        //   getVillageMarketEventAction THROWS rather than refusing, and #492
        //   turns that into "could not be loaded" — which is not "not found".
        //   A null seed must therefore reach the client as "ask for it
        //   yourself", never as an empty event.
        v.getVillageMarketEventAction.mockResolvedValue({ event: EVENT, products: [] });

        await renderEvent(null);

        await waitFor(() => expect(v.getVillageMarketEventAction).toHaveBeenCalledWith('ord-1'));
        expect(await screen.findByText(/Enugu Harvest Market/i)).toBeInTheDocument();
    });
});
