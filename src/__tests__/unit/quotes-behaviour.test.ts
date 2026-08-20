/**
 * @jest-environment node
 */

/**
 * The RFQ path, EXECUTED — submit a quote request, read your own quotes.
 *
 * _quotes.ts was at 74.1% statements, and what had never run was the half that
 * matters: the EXPORT WINDOW branch. QuoteRequestModal is mounted twice, and the
 * second caller passes an export window id with the literal seller
 * "admin_export" — the case two earlier findings were about. This suite runs
 * both branches against a store that remembers what was written.
 *
 * One finding came out of doing that:
 *
 *   #125 A buyer's own name and email are copied onto the quote and rendered on
 *        the seller's screen, but `getMyQuotesAction("seller")` matches on
 *        `sellerId` alone. Nothing stopped a buyer raising a quote against a
 *        product whose seller is THEMSELVES — buyerId and sellerId equal — and
 *        more usefully, nothing bounded how many quote requests one buyer could
 *        file against one seller. Each writes a notification. The seller's
 *        queue and notification centre are floodable by any authenticated
 *        account at one write per call, with attacker-supplied `notes` in the
 *        row.
 *
 * The rest executes rules earlier findings asserted structurally: the seller and
 * the product name coming from the RECORD rather than the request (the phishing
 * primitive), the export window's real counterparty being `createdBy`, the
 * seven-field write rather than a spread, and the notification link pointing at
 * a page that exists.
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

jest.mock('@/lib/auth', () => ({
    auth: async () => null,
    signIn: async () => undefined,
    signOut: async () => undefined,
    handlers: {},
}));

let store: FakeDbHandle;

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const EXPORT_ADMIN = 'export-admin-1';

const QUOTES = COLLECTIONS.MARKETPLACE_QUOTES;
const NOTIFICATIONS = COLLECTIONS.NOTIFICATIONS;
const PRODUCTS = COLLECTIONS.PRODUCTS;
const WINDOWS = COLLECTIONS.EXPORT_WINDOWS;

function actAs(id: string | null, over: Record<string, unknown> = {}): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : {
                session: {
                    user: { id, roles: ['general_user'], name: 'Ada Obi', email: `${id}@e.com`, ...over },
                },
                error: null,
            },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(BUYER);
});

const quotes = () => import('@/app/actions/marketplace/_quotes');

const submit = async (over: Record<string, unknown> = {}) =>
    (await (await quotes()).submitQuoteRequestAction({
        productId: 'p1',
        // Deliberately forged: the action must take both from the record.
        productName: 'Something Else Entirely',
        sellerId: 'a-victim',
        quantity: 50,
        unit: 'kg',
        notes: 'Can you deliver to Enugu?',
        ...over,
    } as never)) as any;

const mine = async (role: string) =>
    (await (await quotes()).getMyQuotesAction(role as never)) as any;

const seedProduct = (over: Record<string, unknown> = {}) =>
    store.seed(PRODUCTS, 'p1', { sellerId: SELLER, title: 'Premium Cocoa', ...over });

const seedWindow = (over: Record<string, unknown> = {}) =>
    store.seed(WINDOWS, 'w1', {
        title: 'Q3 Cocoa to Rotterdam', createdBy: EXPORT_ADMIN, status: 'open', ...over,
    });

const theQuote = () => store.all(QUOTES)[0]?.[1] as Record<string, any> | undefined;
const theNotification = () => store.all(NOTIFICATIONS)[0]?.[1] as Record<string, any> | undefined;

// ─────────────────────────────────────────────────────────────────────────────
describe('submitQuoteRequestAction — a marketplace product', () => {
    beforeEach(() => { seedProduct(); });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await submit()).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(store.size(QUOTES)).toBe(0);
    });

    it('refuses a productId that is neither a product nor an export window', async () => {
        // A quote could be raised against an id that was never anything.
        expect(await submit({ productId: 'nothing' })).toMatchObject({
            success: false, error: 'Product not found',
        });
        expect(store.size(NOTIFICATIONS)).toBe(0);
    });

    it('TAKES THE SELLER AND THE NAME FROM THE RECORD, NEVER THE REQUEST', async () => {
        // Both went straight into a notification, so this was an endpoint for
        // sending a branded platform message to ANY user with an
        // attacker-chosen product name in the body.
        expect(await submit()).toMatchObject({ success: true });

        expect(theQuote()).toMatchObject({ sellerId: SELLER, productName: 'Premium Cocoa' });
        expect(theNotification()).toMatchObject({ userId: SELLER });
        expect(theNotification()!.message).toContain('Premium Cocoa');
        expect(theNotification()!.message).not.toContain('Something Else Entirely');
    });

    it('refuses a product with no seller recorded', async () => {
        seedProduct({ sellerId: '' });
        expect(await submit()).toMatchObject({
            success: false, error: 'This product has no seller to contact',
        });
    });

    it('falls back to `name` when the product has no title', async () => {
        seedProduct({ title: undefined, name: 'Legacy Named Product' });
        await submit();
        expect(theQuote()?.productName).toBe('Legacy Named Product');
    });

    it.each([0, -1, NaN, Infinity, '' as unknown as number, 'ten' as unknown as number])(
        'refuses the quantity %p', async (quantity) => {
            // The interface says number; that is a TypeScript claim, erased
            // before the request arrives.
            expect(await submit({ quantity })).toMatchObject({
                success: false, error: 'Quantity must be a positive number',
            });
            expect(store.size(QUOTES)).toBe(0);
        });

    it('coerces a numeric string quantity rather than storing it as text', async () => {
        await submit({ quantity: '25' });
        expect(theQuote()?.quantity).toBe(25);
    });

    it('writes the listed fields and nothing the caller invented', async () => {
        // `...data` came first, so any field the caller made up landed on the
        // row — including the ones a future seller-response flow would add.
        await submit({
            status: 'accepted', quotedPrice: 1, sellerResponse: 'yes',
            acceptedAt: '2020-01-01', buyerId: 'somebody-else', _version: 99,
        });

        const q = theQuote()!;
        expect(q).toMatchObject({
            productId: 'p1', sellerId: SELLER, buyerId: BUYER,
            status: 'pending', _version: 0, subjectType: 'product',
            quantity: 50, unit: 'kg', notes: 'Can you deliver to Enugu?',
        });
        expect(q.quotedPrice).toBeUndefined();
        expect(q.sellerResponse).toBeUndefined();
        expect(q.acceptedAt).toBeUndefined();
    });

    it('omits the optional fields it was not given, rather than writing undefined', async () => {
        await submit({ unit: undefined, notes: undefined, preferredDeliveryDate: undefined });

        const q = theQuote()!;
        expect('unit' in q).toBe(false);
        expect('notes' in q).toBe(false);
        expect('preferredDeliveryDate' in q).toBe(false);
    });

    it('records the buyer from the session, with a fallback name', async () => {
        actAs(BUYER, { name: undefined });
        await submit();

        expect(theQuote()).toMatchObject({
            buyerId: BUYER, buyerName: 'Unknown Buyer', buyerEmail: `${BUYER}@e.com`,
        });
    });

    it('links the notification to a page that exists', async () => {
        // It linked to /marketplace/seller/quotes/{id}, which is not a route.
        await submit();
        expect(theNotification()?.link).toBe('/marketplace/seller/quotes');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitQuoteRequestAction — an export window', () => {
    beforeEach(() => { seedWindow(); });

    it('RAISES A QUOTE AGAINST AN EXPORT WINDOW AT ALL', async () => {
        // The products lookup that closed the phishing hole looked up an export
        // window id in the products collection, found nothing, and returned
        // "Product not found" — so every RFQ from the export opportunities page
        // failed from that commit onward.
        expect(await submit({ productId: 'w1', sellerId: 'admin_export' })).toMatchObject({ success: true });

        expect(theQuote()).toMatchObject({
            productId: 'w1', subjectType: 'export_window',
            sellerId: EXPORT_ADMIN, productName: 'Q3 Cocoa to Rotterdam',
        });
    });

    it('addresses the window\'s real counterparty, not "admin_export"', async () => {
        // The notification used to go to the literal string the modal passes,
        // which no account has — written, delivered to nobody.
        await submit({ productId: 'w1', sellerId: 'admin_export' });

        expect(theNotification()?.userId).toBe(EXPORT_ADMIN);
        expect(theNotification()?.userId).not.toBe('admin_export');
    });

    it('refuses a window with no contact recorded, rather than filing it against nobody', async () => {
        seedWindow({ createdBy: undefined });

        const res = await submit({ productId: 'w1' });
        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/no contact recorded/i);
        expect(store.size(QUOTES)).toBe(0);
    });

    it('prefers the product when an id somehow exists in both collections', async () => {
        store.seed(PRODUCTS, 'w1', { sellerId: SELLER, title: 'A Product' });

        await submit({ productId: 'w1' });
        expect(theQuote()).toMatchObject({ subjectType: 'product', sellerId: SELLER });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#125 — one buyer, one seller, an unbounded queue', () => {
    beforeEach(() => { seedProduct(); });

    it('REFUSES A SECOND OPEN REQUEST FOR THE SAME PRODUCT', async () => {
        // Every call wrote a quote AND a notification, with caller-supplied
        // `notes` in the row, and nothing bounded the repetition. The seller's
        // queue and notification centre were floodable by any authenticated
        // account at one write per call.
        expect((await submit()).success).toBe(true);

        const second = await submit();
        expect(second.success).toBe(false);
        expect(String(second.error)).toMatch(/already have an open quote request/i);

        expect(store.size(QUOTES)).toBe(1);
        expect(store.size(NOTIFICATIONS)).toBe(1);
    });

    it('lets a different buyer ask about the same product', async () => {
        await submit();

        actAs('buyer-2');
        expect((await submit()).success).toBe(true);
        expect(store.size(QUOTES)).toBe(2);
    });

    it('lets the same buyer ask about a different product', async () => {
        store.seed(PRODUCTS, 'p2', { sellerId: SELLER, title: 'Yam' });

        await submit();
        expect((await submit({ productId: 'p2' })).success).toBe(true);
        expect(store.size(QUOTES)).toBe(2);
    });

    it('lets them ask again once the first request is no longer open', async () => {
        await submit();

        const [id, row] = store.all(QUOTES)[0];
        store.seed(QUOTES, id, { ...row, status: 'closed' });

        expect((await submit()).success).toBe(true);
        expect(store.size(QUOTES)).toBe(2);
    });

    it('refuses a buyer quoting their own listing', async () => {
        seedProduct({ sellerId: BUYER });

        const res = await submit();
        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/your own/i);
        expect(store.size(NOTIFICATIONS)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMyQuotesAction', () => {
    beforeEach(() => {
        store.seedAll(QUOTES, {
            'q-mine-buyer': {
                buyerId: BUYER, sellerId: SELLER, productId: 'p1', status: 'pending',
                createdAt: '2026-05-01T00:00:00.000Z',
            },
            'q-mine-buyer-2': {
                buyerId: BUYER, sellerId: 'seller-2', productId: 'p2', status: 'pending',
                createdAt: '2026-06-01T00:00:00.000Z',
            },
            'q-theirs': {
                buyerId: 'buyer-2', sellerId: SELLER, productId: 'p1', status: 'pending',
                createdAt: '2026-04-01T00:00:00.000Z',
            },
        });
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await mine('buyer')).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('returns the quotes I raised, newest first', async () => {
        const res = await mine('buyer');
        expect(res.data.quotes.map((q: any) => q.id)).toEqual(['q-mine-buyer-2', 'q-mine-buyer']);
    });

    it('returns the quotes raised WITH me, as the seller', async () => {
        actAs(SELLER);
        const res = await mine('seller');
        expect(res.data.quotes.map((q: any) => q.id).sort()).toEqual(['q-mine-buyer', 'q-theirs']);
    });

    it('never returns somebody else\'s quotes on either side', async () => {
        actAs('a-stranger');
        expect((await mine('buyer')).data.quotes).toEqual([]);
        expect((await mine('seller')).data.quotes).toEqual([]);
    });

    it('shows the export-window counterparty their quotes too', async () => {
        seedWindow();
        actAs(BUYER);
        await submit({ productId: 'w1' });

        actAs(EXPORT_ADMIN);
        const res = await mine('seller');
        expect(res.data.quotes.map((q: any) => q.subjectType)).toContain('export_window');
    });

    it('reports an empty list rather than failing', async () => {
        store.clear();
        expect(await mine('buyer')).toMatchObject({ success: true, data: { quotes: [] } });
    });
});
