/**
 * @jest-environment node
 */

/**
 * The marketplace seller dashboard, EXECUTED — products, orders and the
 * analytics summary.
 *
 * At 7.3%. These three are queries and arithmetic, which is exactly what a call
 * recorder cannot check: `where()` was a no-op, so a query filtering on the
 * wrong field looked identical to one filtering correctly, and the analytics
 * totals were computed over whatever the test stubbed.
 *
 * THE NUMBER A SELLER JUDGES THEIR BUSINESS BY
 * --------------------------------------------
 * `pending_payment` is the status an order is CREATED in, before the buyer is
 * charged anything. It used to count as revenue, so an abandoned checkout
 * appeared in the seller's monthly figure. `disputed` is deliberately excluded
 * in the other direction — that money is in escrow, not the seller's — while
 * the buyer dashboard counts it as spent, because they did pay it. The two
 * questions differ on exactly that status, which is why lib/order-status.ts
 * names both sets rather than either screen keeping its own list.
 *
 * Both halves are asserted below, status by status.
 *
 * A NOTE ON THE ORDERING ASSERTIONS
 * ---------------------------------
 * Ordering is TEXTUAL and a DESCENDING order puts documents MISSING the key
 * FIRST — Postgres NULLS FIRST, which is finding #49. The fake reproduces both.
 * So the seeds here carry ISO `createdAt` on every row: a test that omitted it
 * would be asserting on the null-placement rule rather than on the action.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

let store: FakeDbHandle;

const SELLER = 'seller-1';
const PRODUCTS = COLLECTIONS.PRODUCTS;
const ORDERS = COLLECTIONS.MARKETPLACE_ORDERS;

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, roles: ['user'], email: 'ada@example.com' } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(SELLER);
});

async function actions() {
    return import('@/app/actions/marketplace/_mp_seller_dashboard');
}

function seedProduct(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(PRODUCTS, id, {
        sellerId: SELLER,
        title: 'Rice, 50kg',
        description: 'Long grain',
        category: 'grains',
        status: 'active',
        availableQuantity: 100,
        views: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedOrder(id: string, extra: Record<string, unknown> = {}): void {
    store.seed(ORDERS, id, {
        buyerId: 'buyer-1',
        sellerId: SELLER,
        sellerIds: [SELLER],
        buyerName: 'Chidi Okafor',
        buyerEmail: 'chidi@example.com',
        items: [{ productId: 'p1', title: 'Rice, 50kg', quantity: 1, price: 50000 }],
        totalAmount: 50000,
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

/** An ISO date `daysAgo` days before now, so month-boundary tests stay honest. */
function isoDaysAgo(daysAgo: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d.toISOString();
}

/** The first instant of the current month, which the action computes locally. */
function thisMonth(offsetDays = 0): string {
    const d = new Date();
    d.setDate(1);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
}

const titles = (res: any) => (res.data.products as any[]).map((p) => p.title);
const orderIds = (res: any) => (res.data.orders as any[]).map((o) => o.id);

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerProductsAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getSellerProductsAction } = await actions();
        expect(await getSellerProductsAction()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('returns only the caller\'s own products', async () => {
        seedProduct('mine', { title: 'Mine' });
        seedProduct('theirs', { title: 'Theirs', sellerId: 'other-seller' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction())).toEqual(['Mine']);
    });

    it('orders newest first by default', async () => {
        seedProduct('a', { title: 'Older', createdAt: '2026-01-01T00:00:00.000Z' });
        seedProduct('b', { title: 'Newer', createdAt: '2026-06-01T00:00:00.000Z' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction())).toEqual(['Newer', 'Older']);
    });

    it('honours an ascending sort', async () => {
        seedProduct('a', { title: 'Older', createdAt: '2026-01-01T00:00:00.000Z' });
        seedProduct('b', { title: 'Newer', createdAt: '2026-06-01T00:00:00.000Z' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ sortDir: 'asc' })))
            .toEqual(['Older', 'Newer']);
    });

    it('filters by status, and "all" means no filter', async () => {
        seedProduct('a', { title: 'Active', status: 'active' });
        seedProduct('b', { title: 'Draft', status: 'draft' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ status: 'draft' }))).toEqual(['Draft']);
        expect(titles(await getSellerProductsAction({ status: 'all' })).sort())
            .toEqual(['Active', 'Draft']);
    });

    it('"low_stock" means some left, but under fifty', async () => {
        seedProduct('a', { title: 'Plenty', availableQuantity: 500 });
        seedProduct('b', { title: 'Low', availableQuantity: 10 });
        seedProduct('c', { title: 'Out', availableQuantity: 0 });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ status: 'low_stock' }))).toEqual(['Low']);
    });

    it('searches title and category, case-insensitively', async () => {
        seedProduct('a', { title: 'Rice, 50kg', category: 'grains' });
        seedProduct('b', { title: 'Cassava flour', category: 'tubers' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ search: 'RICE' }))).toEqual(['Rice, 50kg']);
        expect(titles(await getSellerProductsAction({ search: 'tubers' }))).toEqual(['Cassava flour']);
    });

    it('reports hasMore and a cursor only when the page is full', async () => {
        seedProduct('a', { title: 'A', createdAt: '2026-01-03T00:00:00.000Z' });
        seedProduct('b', { title: 'B', createdAt: '2026-01-02T00:00:00.000Z' });
        seedProduct('c', { title: 'C', createdAt: '2026-01-01T00:00:00.000Z' });

        const { getSellerProductsAction } = await actions();

        const full: any = await getSellerProductsAction({ limit: 2 });
        expect(titles(full)).toEqual(['A', 'B']);
        expect(full.data).toMatchObject({ hasMore: true, lastId: 'b' });

        const short: any = await getSellerProductsAction({ limit: 50 });
        expect(short.data).toMatchObject({ hasMore: false, lastId: undefined });
    });

    it('continues from a cursor', async () => {
        seedProduct('a', { title: 'A', createdAt: '2026-01-03T00:00:00.000Z' });
        seedProduct('b', { title: 'B', createdAt: '2026-01-02T00:00:00.000Z' });
        seedProduct('c', { title: 'C', createdAt: '2026-01-01T00:00:00.000Z' });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ limit: 2, lastId: 'b' }))).toEqual(['C']);
    });

    it('ignores a cursor pointing at nothing', async () => {
        seedProduct('a', { title: 'A' });
        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction({ lastId: 'gone' }))).toEqual(['A']);
    });

    it('keeps a product the schema cannot parse rather than dropping it', async () => {
        // The graceful fallback. A product whose shape has drifted still belongs
        // on its owner's dashboard — losing it there is how a seller concludes
        // the platform deleted their listing.
        seedProduct('good', { title: 'Good' });
        store.seed(PRODUCTS, 'broken', {
            sellerId: SELLER, title: 'Broken', availableQuantity: 'not-a-number',
            createdAt: '2026-06-01T00:00:00.000Z',
        });

        const { getSellerProductsAction } = await actions();
        expect(titles(await getSellerProductsAction()).sort()).toEqual(['Broken', 'Good']);
    });

    it('applies the schema defaults to a sparse product', async () => {
        store.seed(PRODUCTS, 'sparse', { sellerId: SELLER, createdAt: '2026-01-01T00:00:00.000Z' });

        const { getSellerProductsAction } = await actions();
        const [product] = ((await getSellerProductsAction()) as any).data.products;

        expect(product).toMatchObject({
            title: 'Untitled Product', category: 'other', availableQuantity: 0, unit: 'units',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerOrdersAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getSellerOrdersAction } = await actions();
        expect(await getSellerOrdersAction()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('matches on sellerIds, so one seller sees a multi-seller order', async () => {
        seedOrder('shared', { sellerIds: ['other-seller', SELLER], sellerId: 'other-seller' });
        seedOrder('theirs', { sellerIds: ['other-seller'], sellerId: 'other-seller' });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction())).toEqual(['shared']);
    });

    it('orders newest first', async () => {
        seedOrder('a', { createdAt: '2026-01-01T00:00:00.000Z' });
        seedOrder('b', { createdAt: '2026-06-01T00:00:00.000Z' });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction())).toEqual(['b', 'a']);
    });

    it('filters by status, and "all" means no filter', async () => {
        seedOrder('done', { status: 'completed' });
        seedOrder('waiting', { status: 'pending_payment' });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction({ status: 'pending_payment' })))
            .toEqual(['waiting']);
        expect(orderIds(await getSellerOrdersAction({ status: 'all' })).sort())
            .toEqual(['done', 'waiting']);
    });

    it('searches the id, the buyer and the item titles', async () => {
        seedOrder('order-aaa', { buyerName: 'Chidi Okafor', buyerEmail: 'chidi@example.com' });
        seedOrder('order-bbb', {
            buyerName: 'Ngozi Eze', buyerEmail: 'ngozi@example.com',
            items: [{ productId: 'p2', title: 'Cassava flour', quantity: 2, price: 1000 }],
        });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction({ search: 'ngozi' }))).toEqual(['order-bbb']);
        expect(orderIds(await getSellerOrdersAction({ search: 'cassava' }))).toEqual(['order-bbb']);
        expect(orderIds(await getSellerOrdersAction({ search: 'aaa' }))).toEqual(['order-aaa']);
        expect(orderIds(await getSellerOrdersAction({ search: 'Okafor' }))).toEqual(['order-aaa']);
    });

    it('a search still honours the caller\'s limit, and reports no cursor', async () => {
        // Search fetches wide (5,000) and trims to `limit` in memory, so
        // pagination is meaningless for a search and must not be offered.
        for (const n of [1, 2, 3]) {
            seedOrder(`order-${n}`, { createdAt: `2026-0${n}-01T00:00:00.000Z` });
        }

        const { getSellerOrdersAction } = await actions();
        const res: any = await getSellerOrdersAction({ search: 'chidi', limit: 2 });

        expect(res.data.orders).toHaveLength(2);
        expect(res.data).toMatchObject({ hasMore: false, lastId: undefined });
    });

    it('reports hasMore and a cursor when the page is full', async () => {
        seedOrder('a', { createdAt: '2026-01-03T00:00:00.000Z' });
        seedOrder('b', { createdAt: '2026-01-02T00:00:00.000Z' });
        seedOrder('c', { createdAt: '2026-01-01T00:00:00.000Z' });

        const { getSellerOrdersAction } = await actions();
        const res: any = await getSellerOrdersAction({ limit: 2 });

        expect(orderIds(res)).toEqual(['a', 'b']);
        expect(res.data).toMatchObject({ hasMore: true, lastId: 'b' });
    });

    it('continues from a cursor', async () => {
        seedOrder('a', { createdAt: '2026-01-03T00:00:00.000Z' });
        seedOrder('b', { createdAt: '2026-01-02T00:00:00.000Z' });
        seedOrder('c', { createdAt: '2026-01-01T00:00:00.000Z' });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction({ limit: 2, lastId: 'b' }))).toEqual(['c']);
    });

    it('keeps an order the schema cannot parse', async () => {
        store.seed(ORDERS, 'broken', {
            sellerIds: [SELLER], totalAmount: 'lots', createdAt: '2026-01-01T00:00:00.000Z',
        });

        const { getSellerOrdersAction } = await actions();
        expect(orderIds(await getSellerOrdersAction())).toEqual(['broken']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getSellerAnalyticsAction', () => {
    const analytics = async () =>
        ((await (await actions()).getSellerAnalyticsAction()) as any).data.analytics;

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getSellerAnalyticsAction } = await actions();
        expect(await getSellerAnalyticsAction()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('is all zeroes for a seller with nothing', async () => {
        expect(await analytics()).toMatchObject({
            totalSales: 0, activeListings: 0, pendingOrders: 0,
            monthlyRevenue: 0, conversionRate: 0, averageRating: 0,
        });
    });

    it.each(['payment_received', 'processing', 'shipped', 'delivered', 'completed'])(
        'counts a %s order as revenue', async (status) => {
            seedOrder('o1', { status, totalAmount: 50000 });
            expect(await analytics()).toMatchObject({ totalSales: 50000 });
        });

    it.each(['pending_payment', 'cancelled', 'disputed'])(
        'does NOT count a %s order as revenue', async (status) => {
            // pending_payment is the status an order is CREATED in, before the
            // buyer is charged anything — an abandoned checkout used to appear
            // in the monthly figure. disputed is money in escrow, not the
            // seller's, which is why the buyer dashboard counts it and this
            // does not.
            seedOrder('o1', { status, totalAmount: 50000 });
            expect(await analytics()).toMatchObject({ totalSales: 0 });
        });

    it('counts pending_payment and processing as PENDING orders, though', async () => {
        seedOrder('a', { status: 'pending_payment' });
        seedOrder('b', { status: 'processing' });
        seedOrder('c', { status: 'completed' });

        expect(await analytics()).toMatchObject({ pendingOrders: 2 });
    });

    it('treats a missing or unreadable amount as zero rather than NaN', async () => {
        // A NaN here poisons every later comparison and shows the seller a blank
        // dashboard rather than a wrong number, which is harder to notice.
        seedOrder('a', { status: 'completed', totalAmount: undefined });
        seedOrder('b', { status: 'completed', totalAmount: 'lots' });
        seedOrder('c', { status: 'completed', totalAmount: 1000 });

        expect(await analytics()).toMatchObject({ totalSales: 1000 });
    });

    it('splits this month from last month', async () => {
        seedOrder('this-month', { status: 'completed', totalAmount: 30000, createdAt: thisMonth(1) });
        seedOrder('last-month', { status: 'completed', totalAmount: 20000, createdAt: thisMonth(-10) });

        const a = await analytics();
        expect(a.totalSales).toBe(50000);
        expect(a.monthlyRevenue).toBe(30000);
        expect(a.prevMonthRevenue).toBe(20000);
        expect(a.prevTotalSales).toBe(20000);
    });

    it('counts only ACTIVE products as listings', async () => {
        seedProduct('a', { status: 'active' });
        seedProduct('b', { status: 'draft' });
        seedProduct('c', { status: 'sold_out' });

        expect(await analytics()).toMatchObject({ activeListings: 1 });
    });

    it('averages the rating over rated products only', async () => {
        seedProduct('a', { rating: 5 });
        seedProduct('b', { rating: 3 });
        seedProduct('c', { rating: undefined });

        expect(await analytics()).toMatchObject({ averageRating: 4 });
    });

    it('counts a zero rating as a rating, not as an absence', async () => {
        seedProduct('a', { rating: 4 });
        seedProduct('b', { rating: 0 });

        expect(await analytics()).toMatchObject({ averageRating: 2 });
    });

    it('computes the conversion rate from views, to one decimal', async () => {
        seedProduct('a', { views: 200 });
        seedOrder('o1', { status: 'completed' });
        seedOrder('o2', { status: 'completed', createdAt: '2026-02-01T00:00:00.000Z' });
        seedOrder('o3', { status: 'completed', createdAt: '2026-03-01T00:00:00.000Z' });

        expect(await analytics()).toMatchObject({ conversionRate: 1.5 });
    });

    it('reports zero rather than dividing by zero views', async () => {
        seedProduct('a', { views: 0 });
        seedOrder('o1', { status: 'completed' });

        expect(await analytics()).toMatchObject({ conversionRate: 0 });
    });

    it('reads only the caller\'s own orders and products', async () => {
        store.seed(ORDERS, 'theirs', {
            sellerIds: ['other-seller'], status: 'completed', totalAmount: 999999,
            createdAt: '2026-01-01T00:00:00.000Z',
        });
        seedProduct('theirs', { sellerId: 'other-seller', status: 'active', views: 5000 });

        expect(await analytics()).toMatchObject({
            totalSales: 0, activeListings: 0, conversionRate: 0,
        });
    });

    it('ignores an order whose date cannot be read, for the monthly split only', async () => {
        seedOrder('undated', { status: 'completed', totalAmount: 7000, createdAt: undefined });

        const a = await analytics();
        expect(a.totalSales).toBe(7000);
        expect(a.monthlyRevenue).toBe(0);
        expect(a.prevMonthRevenue).toBe(0);
    });

    it('is bounded — it does not read a seller\'s whole history for a handful of totals', async () => {
        // Both queries were unbounded. The cap is 2,000; asserting the cap
        // itself needs 2,001 rows, so this asserts the query CARRIES a limit,
        // which is the property that stops the page timing out.
        const { readFileSync } = require('fs') as typeof import('fs');
        const source = readFileSync(
            `${process.cwd()}/src/app/actions/marketplace/_mp_seller_dashboard.ts`, 'utf8');

        expect(source).toContain('SELLER_ANALYTICS_CAP = 2000');
        expect(source.match(/\.limit\(SELLER_ANALYTICS_CAP\)/g)).toHaveLength(2);
    });

    it('and the recent-order figures survive a seller with many orders', async () => {
        const rows: Record<string, Record<string, unknown>> = {};
        for (let n = 0; n < 120; n++) {
            rows[`o${n}`] = {
                sellerIds: [SELLER], status: 'completed', totalAmount: 1000,
                createdAt: isoDaysAgo(n),
            };
        }
        store.seedAll(ORDERS, rows);

        expect((await analytics()).totalSales).toBe(120000);
    });
});
