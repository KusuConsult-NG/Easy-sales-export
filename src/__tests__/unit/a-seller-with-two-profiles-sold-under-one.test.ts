/**
 * @jest-environment node
 */

/**
 *   #904 (SELLER SIDE, THE REST) — THE HALF BOTH EARLIER PASSES DEFERRED.
 *
 *   The land half shipped first, the buyer half after it, and BOTH named this
 *   list as left behind — "its cursor paging and inequality filters make it a
 *   separate piece of work rather than a line". So a seller's products, their
 *   orders, their disputes and their WAVE earnings still counted one profile
 *   while everything around them counted all of them.
 *
 *   The disputes one was the sharpest: `_getBuyerDisputesAction` was widened a
 *   commit ago and `_getSellerDisputesAction` — twenty lines below it, in the
 *   same file — was not. One person's two lists disagreed about which of their
 *   profiles counted, which is the count-versus-list contradiction the buyer
 *   commit cited as its own reason for widening a surface whole.
 *
 * ── AND THE OTHER SHAPE A SELLER IS STORED IN ───────────────────────────────
 *
 *   A marketplace order can span several sellers, so it names them in
 *   `sellerIds` — an ARRAY — and those reads ask `array-contains` rather than
 *   `==`. Same question, different operator; `filterByOwnerInArray` is the
 *   sibling helper, and the order-authority gates ask both fields at once.
 *
 *   EXECUTED, NOT SCANNED, and every list is also shown in its BEFORE state
 *   with the pointer removed, so nothing here can pass on a harness that
 *   ignores the owner filter.
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
    invalidateServiceCache: async () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => {
    const actual = jest.requireActual('@/lib/session-guard') as any;
    return { ...actual, requireSession: (...a: any[]) => mockRequireSession(...a) };
});

let store: FakeDbHandle;

const LIVE = 'seller-live';
const OLD = 'seller-superseded';
const STRANGER = 'other-seller';

const seedProfiles = () => {
    store.seed(COLLECTIONS.USERS, LIVE, {
        id: LIVE, email: 's@e.com', supabaseAuthId: LIVE, roles: ['seller'],
    });
    store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 's@e.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, {
        id: STRANGER, email: 'x@e.com', supabaseAuthId: STRANGER, roles: ['seller'],
    });
};

const signedInAs = (id: string) =>
    mockRequireSession.mockResolvedValue({
        session: { user: { id, roles: ['seller'], email: 's@e.com', name: 'S' } }, error: null,
    });

const seedProduct = (id: string, sellerId: string) =>
    store.seed(COLLECTIONS.PRODUCTS, id, {
        id, sellerId, title: `Product ${id}`, name: `Product ${id}`,
        status: 'active', price: 5_000, availableQuantity: 10,
        createdAt: '2026-09-12T10:32:43.735Z', updatedAt: '2026-09-12T10:32:43.735Z',
    });

/** An order names its sellers in an ARRAY — the other shape. */
const seedOrder = (id: string, sellerId: string) =>
    store.seed(COLLECTIONS.MARKETPLACE_ORDERS, id, {
        id, buyerId: 'a-buyer', sellerId, sellerIds: [sellerId],
        status: 'processing', totalAmount: 5_000,
        items: [{ productId: 'p1', quantity: 1, price: 5_000, sellerId }],
        createdAt: '2026-09-12T10:32:43.735Z', updatedAt: '2026-09-12T10:32:43.735Z',
    });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    seedProfiles();
    signedInAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (seller) — the products they listed before the merge', () => {
    const products = async () => {
        const { getSellerProductsAction } = await import('@/app/actions/marketplace/_mp_seller_dashboard');
        return await getSellerProductsAction({}) as any;
    };

    it('THE DEFERRED CASE: a product filed under the superseded profile is there', async () => {
        seedProduct('before-the-merge', OLD);

        const res = await products();

        expect(res.success).toBe(true);
        expect(res.data.products.map((p: any) => p.id)).toEqual(['before-the-merge']);
    });

    it('AND BEFORE THIS, IT WAS NOT — the defect, run rather than described', async () => {
        store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 's@e.com' });
        seedProduct('before-the-merge', OLD);

        expect((await products()).data.products).toHaveLength(0);
    });

    it('AND THE LIVE PROFILE\'S OWN PRODUCTS ARE STILL THERE', async () => {
        seedProduct('before-the-merge', OLD);
        seedProduct('after-the-merge', LIVE);

        expect((await products()).data.products.map((p: any) => p.id).sort())
            .toEqual(['after-the-merge', 'before-the-merge']);
    });

    it('THE CONTROL: ANOTHER SELLER\'S STOCK IS NOT HANDED OVER', async () => {
        seedProduct('theirs', STRANGER);
        seedProduct('ours', OLD);

        expect((await products()).data.products.map((p: any) => p.id)).toEqual(['ours']);
    });

    it('AND THE OTHER DOOR ONTO THE SAME LIST AGREES', async () => {
        //   api/marketplace/my-products is a second implementation of this
        //   screen. One widened and not the other is the same list answering
        //   two ways depending on the route in.
        seedProduct('before-the-merge', OLD);

        const { GET } = await import('@/app/api/marketplace/my-products/route');
        const body = await (await GET({} as any)).json();

        expect(body.data.products.map((p: any) => p.id)).toEqual(['before-the-merge']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (seller) — and the array shape an order is stored in', () => {
    it('THE ORDERS NAME THEIR SELLERS IN AN ARRAY, and it widens too', async () => {
        seedOrder('o-old', OLD);
        seedOrder('o-live', LIVE);

        const { getSellerOrdersAction } = await import('@/app/actions/marketplace/_mp_seller_dashboard');
        const res = await getSellerOrdersAction({}) as any;

        expect(res.success).toBe(true);
        expect(res.data.orders.map((o: any) => o.id).sort()).toEqual(['o-live', 'o-old']);
    });

    it('AND BEFORE THIS, THE OLD ONE WAS NOT THERE', async () => {
        store.seed(COLLECTIONS.USERS, OLD, { id: OLD, email: 's@e.com' });
        seedOrder('o-old', OLD);

        const { getSellerOrdersAction } = await import('@/app/actions/marketplace/_mp_seller_dashboard');

        expect(((await getSellerOrdersAction({}) as any)).data.orders).toHaveLength(0);
    });

    it('AND ANOTHER SELLER\'S ORDERS ARE NOT — the control', async () => {
        seedOrder('theirs', STRANGER);
        seedOrder('ours', OLD);

        const { getSellerOrdersAction } = await import('@/app/actions/marketplace/_mp_seller_dashboard');

        expect(((await getSellerOrdersAction({}) as any)).data.orders.map((o: any) => o.id))
            .toEqual(['ours']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (seller) — the disputes half left behind in its own file', () => {
    it('THE ASYMMETRY: the seller\'s disputes now follow the pointer too', async () => {
        store.seed(COLLECTIONS.DISPUTES, 'd-old', {
            id: 'd-old', buyerId: 'a-buyer', sellerId: OLD, orderId: 'o1',
            status: 'open', createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getSellerDisputesAction } = await import('@/app/actions/disputes');
        const res = await getSellerDisputesAction() as any;

        expect(res.success).toBe(true);
        expect(res.data.map((d: any) => d.id)).toEqual(['d-old']);
    });

    it('AND THE BUYER HALF STILL DOES — neither regressed', async () => {
        //   Both halves of one file, asserted together, because the defect this
        //   closes was exactly that they disagreed.
        store.seed(COLLECTIONS.DISPUTES, 'd-buyer', {
            id: 'd-buyer', buyerId: OLD, sellerId: STRANGER, orderId: 'o2',
            status: 'open', createdAt: '2026-09-12T10:00:00.000Z',
        });

        const { getBuyerDisputesAction } = await import('@/app/actions/disputes');

        expect(((await getBuyerDisputesAction() as any)).data.map((d: any) => d.id))
            .toEqual(['d-buyer']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (seller) — and what appears can be changed', () => {
    /*
     *   deleteProductAction, not updateProductAction, and that is worth a line.
     *   The update door is a FORM action — `(prevState, formData)` — so calling
     *   it with an id and an object throws, the catch returns the generic
     *   "Failed to update product", and an assertion that the answer is merely
     *   NOT "Unauthorized" passes without the gate ever running. The first
     *   draft of this block did exactly that and looked green.
     *
     *   The delete door takes a plain id, reaches the same `isOwnedBySession`
     *   gate, and names its refusal — so both directions here are answered by
     *   the gate rather than by a thrown error.
     */
    const del = async (id: string) => {
        const { deleteProductAction } = await import('@/app/actions/marketplace/_mp_products');
        return await deleteProductAction(id) as any;
    };

    it('THE PRODUCT ANSWERS TO ITS SELLER', async () => {
        seedProduct('p-old', OLD);

        const res = await del('p-old');

        expect(res.error).not.toBe('Unauthorized: You do not own this product');
        expect(res.success).toBe(true);
    });

    it('AND ANOTHER SELLER STILL CANNOT TOUCH IT', async () => {
        seedProduct('p-old', OLD);
        signedInAs(STRANGER);

        expect(await del('p-old')).toMatchObject({
            success: false, error: 'Unauthorized: You do not own this product',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#904 (seller) — the array helper, asked directly', () => {
    const spy = () => {
        const calls: { field: string; op: string; value: unknown }[] = [];
        const q: any = { calls, where(field: string, op: string, value: unknown) {
            calls.push({ field, op, value }); return q;
        } };
        return q;
    };

    it('ONE ID STAYS `array-contains` — the common case, byte-identical', async () => {
        const { filterByOwnerInArray } = await import('@/lib/owned-profile-ids');
        const q = spy();
        filterByOwnerInArray(q, 'sellerIds', ['live']);

        expect(q.calls).toEqual([{ field: 'sellerIds', op: 'array-contains', value: 'live' }]);
    });

    it('AND SEVERAL BECOME ONE `array-contains-any`', async () => {
        //   Not two chained `array-contains`, which would demand an order
        //   naming BOTH profiles and return nothing at all.
        const { filterByOwnerInArray } = await import('@/lib/owned-profile-ids');
        const q = spy();
        filterByOwnerInArray(q, 'sellerIds', ['live', 'old']);

        expect(q.calls).toEqual([
            { field: 'sellerIds', op: 'array-contains-any', value: ['live', 'old'] },
        ]);
    });
});
