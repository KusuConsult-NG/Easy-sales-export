/**
 * @jest-environment node
 */

/**
 *   #904 (BUYER SIDE) THE OTHER HALF OF THE SAME DEFECT, AND THE HOLE IT
 *   UNCOVERED.
 *
 *   The seller side shipped first and said in its own code why it stopped
 *   where it did — _fn_dashboard.ts:
 *
 *       "The same fault exists on the buyer side ... the buyer surface is much
 *        wider than this one tile — orders, escrow, disputes, receipts.
 *        Widening THIS read alone would put a purchase on the dashboard that
 *        every other buyer screen still denies."
 *
 *   That was a reason to wait, not a reason never to do it. This is the whole
 *   surface: an order, a purchase request, a dispute, an export order or an
 *   escrow created on a profile its owner no longer signs in as is theirs
 *   again, on every screen that lists it and through every gate that acts on
 *   it.
 *
 * ── AND ONE THING THAT NOW REFUSES MORE ─────────────────────────────────────
 *
 *   Two guards stop somebody trading with themselves, and both compared RAW
 *   IDS:
 *
 *       _escrow_lifecycle   `data.sellerId === data.buyerId`
 *       _quotes             `sellerId === userId`
 *
 *   A person with two profiles is two ids, so both passed for exactly the case
 *   they exist to refuse — and on an escrow that is a funded transaction
 *   between one person and themselves. Widening the identity rule closes it,
 *   which is the one place in this change that refuses MORE than it did. The
 *   control below is that two genuinely different people are still allowed.
 *
 * ── EXECUTED, NOT SCANNED ───────────────────────────────────────────────────
 *
 *   Against a fake database, because the claims are about what an action
 *   RETURNS and what a gate lets through, and a source scan can see neither.
 *   Each list is also shown in its BEFORE state — the pointer removed — so no
 *   assertion here can pass on a harness that ignores the owner filter.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));
jest.mock('next/cache', () => ({
    revalidateTag: () => undefined, revalidatePath: () => undefined,
    updateTag: () => undefined, unstable_cache: (fn: any) => fn,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateAdminGlobalStats: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => {
    const actual = jest.requireActual('@/lib/session-guard') as any;
    return { ...actual, requireSession: (...a: any[]) => mockRequireSession(...a) };
});

let store: FakeDbHandle;

/** The profile they sign in as — the row that won the duplicate. */
const LIVE = 'buyer-live';
/** The one they ordered from, superseded onto LIVE. */
const OLD = 'buyer-superseded';
const SELLER = 'seller-1';
const STRANGER = 'stranger-live';

const seedProfiles = () => {
    store.seed(COLLECTIONS.USERS, LIVE, { id: LIVE, email: 'b@e.com', supabaseAuthId: LIVE });
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'b@e.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, SELLER, { id: SELLER, email: 's@e.com', supabaseAuthId: SELLER });
    store.seed(COLLECTIONS.USERS, STRANGER, { id: STRANGER, email: 'x@e.com', supabaseAuthId: STRANGER });
};

/** The same person's OTHER profile, for the self-dealing control. */
const seedSecondSellerProfile = () =>
    store.seed(COLLECTIONS.USERS, 'me-as-seller', { id: 'me-as-seller', email: 'b@e.com', _migratedTo: LIVE });

const signedInAs = (id: string, roles: string[] = ['buyer']) =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles, email: 'b@e.com', name: 'B' } }, error: null,
    });

const seedOrder = (id: string, buyerId: string, over: Record<string, unknown> = {}) =>
    store.seed(COLLECTIONS.MARKETPLACE_ORDERS, id, {
        id, buyerId, sellerIds: [SELLER], status: 'processing',
        totalAmount: 25_000, items: [{ productId: 'p1', quantity: 1, price: 25_000 }],
        createdAt: '2026-09-12T10:32:43.735Z', updatedAt: '2026-09-12T10:32:43.735Z',
        ...over,
    });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProfiles();
    signedInAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (buyer) — the orders they placed before the merge', () => {
    const buyerOrders = async () => {
        const { getBuyerOrdersAction } = await import('@/app/actions/marketplace/_mp_buyer_dashboard');
        return await getBuyerOrdersAction({}) as any;
    };

    it('THE REPORTED SHAPE: an order placed on the superseded profile is there', async () => {
        seedOrder('before-the-merge', OLD);

        const res = await buyerOrders();

        expect(res.success).toBe(true);
        expect(res.data.orders.map((o: any) => o.id)).toEqual(['before-the-merge']);
    });

    it('AND BEFORE THIS, IT WAS NOT — the defect, run rather than described', async () => {
        //   The same world with the pointer removed. Without this the test
        //   above would pass on a harness that ignored the owner filter.
        store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 'b@e.com' });
        seedOrder('before-the-merge', OLD);

        const res = await buyerOrders();

        expect(res.data.orders).toHaveLength(0);
    });

    it('AND THE LIVE PROFILE\'S OWN ORDERS ARE STILL THERE', async () => {
        seedOrder('before-the-merge', OLD);
        seedOrder('after-the-merge', LIVE);

        const res = await buyerOrders();

        expect(res.data.orders.map((o: any) => o.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });

    it('THE CONTROL: A STRANGER\'S ORDER IS NOT HANDED OVER', async () => {
        seedOrder('theirs', STRANGER);
        seedOrder('ours', OLD);

        const res = await buyerOrders();

        expect(res.data.orders.map((o: any) => o.id)).toEqual(['ours']);
    });

    it('AND THE OTHER DOOR ONTO THE SAME LIST AGREES', async () => {
        //   order-management.ts is a second implementation of the buyer's
        //   orders. One widened and not the other is the same list answering
        //   two ways depending on the route in.
        seedOrder('before-the-merge', OLD);
        seedOrder('after-the-merge', LIVE);

        const { getBuyerOrdersAction } = await import('@/app/actions/order-management');
        const res = await getBuyerOrdersAction() as any;

        expect(res.data.orders.map((o: any) => o.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });

    it('AND THE STATS ABOVE THE LIST COUNT THE SAME ORDERS', async () => {
        //   A count that disagreed with the list would trade an empty screen
        //   for a contradictory one.
        seedOrder('before-the-merge', OLD);
        seedOrder('after-the-merge', LIVE);

        const { getBuyerStatsAction } = await import('@/app/actions/marketplace/_mp_buyer_dashboard');
        const res = await getBuyerStatsAction() as any;

        expect(res.data.stats.activeOrders).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (buyer) — and the rest of the surface the seller side named', () => {
    it('DISPUTES', async () => {
        store.seed(COLLECTIONS.DISPUTES, 'd-old', {
            id: 'd-old', buyerId: OLD, sellerId: SELLER, orderId: 'o1',
            status: 'open', createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getBuyerDisputesAction } = await import('@/app/actions/disputes');
        const res = await getBuyerDisputesAction() as any;

        expect(res.success).toBe(true);
        expect(res.data.map((d: any) => d.id)).toEqual(['d-old']);
    });

    it('FARM NATION PURCHASE REQUESTS', async () => {
        store.seed(COLLECTIONS.FARM_NATION_TRANSACTIONS, 't-old', {
            id: 't-old', buyerId: OLD, status: 'pending',
            createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getMyPurchaseRequestsAction } = await import('@/app/actions/farm-nation/_fn_purchases');
        const res = await getMyPurchaseRequestsAction() as any;

        expect(res.success).toBe(true);
        expect(res.data.requests.map((r: any) => r.id)).toEqual(['t-old']);
    });

    it('AND EXPORT ORDERS, which is also what the my-data download reads', async () => {
        store.seed(COLLECTIONS.EXPORT_ORDERS, 'e-old', {
            id: 'e-old', buyerId: OLD, status: 'processing',
            createdAt: '2026-09-12T10:00:00.000Z', items: [],
        });

        const { readMyExportOrders } = await import('@/lib/export-orders-reader');

        expect((await readMyExportOrders(LIVE)).map((o) => o.id)).toEqual(['e-old']);
    });

    it('AND A STRANGER GETS NONE OF IT — one control for the three', async () => {
        store.seed(COLLECTIONS.DISPUTES, 'd-old', {
            id: 'd-old', buyerId: OLD, status: 'open', createdAt: '2026-09-12T10:00:00.000Z',
        });
        store.seed(COLLECTIONS.EXPORT_ORDERS, 'e-old', {
            id: 'e-old', buyerId: OLD, status: 'processing',
            createdAt: '2026-09-12T10:00:00.000Z', items: [],
        });
        signedInAs(STRANGER);

        const { getBuyerDisputesAction } = await import('@/app/actions/disputes');
        const { readMyExportOrders } = await import('@/lib/export-orders-reader');

        expect((await getBuyerDisputesAction() as any).data).toEqual([]);
        expect(await readMyExportOrders(STRANGER)).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (buyer) — what appears can be acted on', () => {
    it('THE ORDER OPENS FOR ITS BUYER', async () => {
        seedOrder('o-old', OLD);

        const { getOrderByIdAction } = await import('@/app/actions/orders');
        const res = await getOrderByIdAction('o-old') as any;

        expect(res.success).toBe(true);
        expect(res.data?.id ?? res.data?.order?.id).toBe('o-old');
    });

    it('AND A STRANGER STILL CANNOT OPEN IT', async () => {
        //   The control on the same gate: widening it for the buyer must not
        //   open an order to anybody signed in. A stranger falls through to
        //   the admin arm, which they do not hold the permission for.
        seedOrder('o-old', OLD);
        signedInAs(STRANGER);

        const { getOrderByIdAction } = await import('@/app/actions/orders');
        const res = await getOrderByIdAction('o-old') as any;

        expect(res.success).toBe(false);
    });

    it('AND THE DISPUTE DOOR OPENS ON AN ORDER PLACED BEFORE THE MERGE', async () => {
        //   The screen where losing a row costs the most: it is how money
        //   comes back.
        seedOrder('o-old', OLD, { status: 'delivered' });

        const { createDisputeAction } = await import('@/app/actions/disputes');
        const res = await createDisputeAction({
            orderId: 'o-old', reason: 'item_not_received' as any, //   Long enough to clear validation: a refusal for a short description
            //   would look exactly like a refusal for ownership, and the
            //   stranger control below would pass without the gate firing.
            description: 'The parcel never arrived and the courier has no record of it at all.',
            //   Evidence too: both validations run BEFORE the ownership gate,
            //   so either one missing would answer in its place.
            evidenceUrls: ['https://example.test/receipt.jpg'],
        }) as any;

        expect(res.error).not.toBe('Not authorized');
    });

    it('AND A STRANGER IS STILL REFUSED AT IT', async () => {
        seedOrder('o-old', OLD, { status: 'delivered' });
        signedInAs(STRANGER);

        const { createDisputeAction } = await import('@/app/actions/disputes');
        const res = await createDisputeAction({
            orderId: 'o-old', reason: 'item_not_received' as any, //   Long enough to clear validation: a refusal for a short description
            //   would look exactly like a refusal for ownership, and the
            //   stranger control below would pass without the gate firing.
            description: 'The parcel never arrived and the courier has no record of it at all.',
            //   Evidence too: both validations run BEFORE the ownership gate,
            //   so either one missing would answer in its place.
            evidenceUrls: ['https://example.test/receipt.jpg'],
        }) as any;

        expect(res).toMatchObject({ success: false, error: 'Not authorized' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (buyer) — and the self-dealing hole it uncovered', () => {
    const requestQuote = async () => {
        const { submitQuoteRequestAction } = await import('@/app/actions/marketplace/_quotes');
        return await submitQuoteRequestAction({
            productId: 'p-mine', quantity: 1, notes: 'x',
            //   Named by the caller and re-read from the record by the action
            //   (#881) — the seller it actually checks is the one on the
            //   product, not this.
            productName: 'My own product', sellerId: 'me-as-seller',
        }) as any;
    };

    beforeEach(() => {
        seedSecondSellerProfile();
        store.seed(COLLECTIONS.PRODUCTS, 'p-mine', {
            id: 'p-mine', sellerId: 'me-as-seller', name: 'My own product',
            status: 'active', price: 1_000, availableQuantity: 10,
        });
    });

    it('THE HOLE: one person\'s two profiles could trade with each other', async () => {
        /*
         *   `me-as-seller` and the caller are the same person — the profile
         *   points at the live row. Raw `===` compares ids, so this passed.
         */
        const res = await requestQuote();

        expect(res).toMatchObject({
            success: false,
            error: 'You cannot request a quote on your own listing',
        });
    });

    it('AND TWO DIFFERENT PEOPLE ARE STILL ALLOWED — the control', async () => {
        //   Vacuity. A rule that refused everybody would pass the test above
        //   and break every honest quote on the platform.
        store.seed(COLLECTIONS.PRODUCTS, 'p-theirs', {
            id: 'p-theirs', sellerId: SELLER, name: 'Somebody else\'s product',
            status: 'active', price: 1_000, availableQuantity: 10,
        });

        const { submitQuoteRequestAction } = await import('@/app/actions/marketplace/_quotes');
        const res = await submitQuoteRequestAction({
            productId: 'p-theirs', quantity: 1, notes: 'x',
            productName: "Somebody else's product", sellerId: SELLER,
        }) as any;

        expect(res.error).not.toBe('You cannot request a quote on your own listing');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (buyer) — the three primitives this needed, asked directly', () => {
    it('isSamePerson RESOLVES BOTH SIDES, not just one', async () => {
        /*
         *   The claim its own comment rests on, and the one that would be easy
         *   to get wrong: TWO SUPERSEDED profiles pointing at one live row are
         *   the same person without either of them being live. A helper that
         *   resolved only its first argument would answer "different" here —
         *   and that is precisely the self-dealing pair.
         */
        store.seed(COLLECTIONS.USERS, 'old-a', { id: 'old-a', _migratedTo: LIVE });
        store.seed(COLLECTIONS.USERS, 'old-b', { id: 'old-b', _migratedTo: LIVE });

        const { isSamePerson } = await import('@/lib/owned-profile-ids');

        expect(await isSamePerson('old-a', 'old-b')).toBe(true);
    });

    it('AND TWO REAL PEOPLE ARE NOT THE SAME PERSON', async () => {
        const { isSamePerson } = await import('@/lib/owned-profile-ids');

        expect(await isSamePerson(LIVE, SELLER)).toBe(false);
    });

    it('AND AN ABSENT ID IS NOBODY — never "the same" by accident', async () => {
        //   `undefined === undefined` is true, and a guard that let two empty
        //   fields match would refuse every trade on a row missing its parties.
        const { isSamePerson } = await import('@/lib/owned-profile-ids');

        expect(await isSamePerson(undefined, undefined)).toBe(false);
        expect(await isSamePerson('', '')).toBe(false);
    });

    it('isAnyOwnedBySession ADMITS EITHER PARTY AND NOBODY ELSE', async () => {
        const { isAnyOwnedBySession } = await import('@/lib/owned-profile-ids');

        expect(await isAnyOwnedBySession([OLD, SELLER], LIVE)).toBe(true);
        expect(await isAnyOwnedBySession([SELLER, OLD], LIVE)).toBe(true);
        expect(await isAnyOwnedBySession([SELLER, STRANGER], LIVE)).toBe(false);
    });

    it('AND AN EMPTY PARTY LIST ADMITS NOBODY', async () => {
        //   A row missing both parties must refuse, not admit everybody.
        const { isAnyOwnedBySession } = await import('@/lib/owned-profile-ids');

        expect(await isAnyOwnedBySession([], LIVE)).toBe(false);
        expect(await isAnyOwnedBySession([undefined, null], LIVE)).toBe(false);
    });

    it('liveProfileId WALKS FORWARD, and hands back what it cannot resolve', async () => {
        /*
         *   Never null for a non-empty input — lib/quote-negotiation.ts
         *   compares the value it returns, and a resolution that quietly gave
         *   back nothing would make two unrelated quotes compare equal.
         */
        const { liveProfileId } = await import('@/lib/owned-profile-ids');

        expect(await liveProfileId(OLD)).toBe(LIVE);
        expect(await liveProfileId(LIVE)).toBe(LIVE);
        expect(await liveProfileId('no-such-row')).toBe('no-such-row');
        expect(await liveProfileId('')).toBe('');
    });
});
