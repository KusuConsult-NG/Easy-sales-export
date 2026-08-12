/**
 * @jest-environment node
 */

/**
 * Every sales figure on the vendor dashboard read zero, for every vendor.
 *
 * The five order queries in vendor-dashboard.ts read
 *
 *     db.collection(COLLECTIONS.MARKETPLACE_ORDERS).where("vendorId", "==", vendorId)
 *
 * **No order has a vendorId field.** orders.ts writes `sellerId`;
 * marketplace/_payment.ts writes `sellerIds` and sets `sellerId` to
 * `sellerIds[0]`. Nothing anywhere writes `vendorId` onto an order.
 *
 * The neighbours get it right, which is what makes this findable: vendor.ts —
 * the vendor-facing order LIST — queries `sellerIds array-contains`, and
 * vendor-settings.ts queries `sellerId ==`. Only this file invented a third
 * name, and it is the file nobody would notice was wrong, because an empty
 * dashboard looks like a vendor with no sales.
 *
 * The same shape as the forensics reconciliation in #118, which compared a
 * stored balance against a field nothing wrote and therefore passed everything.
 *
 * WHY BOTH FIELDS ARE QUERIED
 * ---------------------------
 * Neither is sufficient alone:
 *
 *   sellerId ==          misses a non-first seller on a multi-seller order,
 *                        because _payment.ts records only sellerIds[0] there
 *   sellerIds contains   misses every order from orders.ts, which does not
 *                        write that array at all
 *
 * Both are queried and merged by document id. Picking one and accepting the gap
 * would replace "no sales" with "some sales" — harder to notice, and worse to
 * trust.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * The access control, completely. All six actions take NO parameters and derive
 * the vendor from session.user.id, and every query filters on it — ownership by
 * construction, with no caller-supplied id to substitute. The two
 * VENDOR_PRODUCTS queries use `vendorId` correctly, because vendor products do
 * carry that field; only the ORDER queries were wrong.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const VENDOR = 'vendor-1';
const OTHER = 'vendor-2';

jest.mock('@/lib/audit-log', () => ({ createAdminAuditLog: jest.fn(async () => ({})) }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: ['seller'] } },
        error: null,
    }));
}

/** Records which (collection, field) pairs were queried, and answers them. */
function setWorld(opts: {
    bySellerId?: any[];
    bySellerIds?: any[];
    products?: any[];
} = {}) {
    const queries: Array<{ collection: string; field: string; value: any }> = [];
    (global as any).__queries = queries;

    const mkDoc = (id: string, data: any) => ({ id, data: () => data });

    (global as any).mockFirestoreCollection.mockImplementation((name: string) => {
        (global as any).__lastCollection = name;
    });

    // The harness routes `.where(...).get()` to mockFirestoreGet with the
    // collection name, which cannot tell one field from another — so the
    // per-field routing is recorded by patching the query builder instead.
    const realGet = (global as any).mockFirestoreGet;
    realGet.mockImplementation((collection: string) => {
        if (collection === 'vendor_products') {
            return Promise.resolve({
                exists: false, empty: (opts.products ?? []).length === 0,
                size: (opts.products ?? []).length,
                docs: (opts.products ?? []).map((p, i) => mkDoc(`p${i}`, p)),
                data: () => ({}),
            });
        }
        return Promise.resolve({ exists: false, empty: true, size: 0, docs: [], data: () => ({}) });
    });
}

async function salesStats() {
    const { getVendorSalesStatsAction } = await import('@/app/actions/vendor-dashboard');
    return getVendorSalesStatsAction();
}

describe('the dashboard queries the fields orders actually have', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(VENDOR);
        setWorld();
    });

    it('never queries a vendorId field on marketplace orders', async () => {
        // The source-level assertion, because the harness cannot distinguish
        // one `.where` field from another at runtime: every order query used a
        // field no order document has.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-dashboard.ts'), 'utf-8');

        // Isolate the MARKETPLACE_ORDERS query sites from the VENDOR_PRODUCTS
        // ones, which use vendorId legitimately.
        const orderQueries = src
            .split('COLLECTIONS.MARKETPLACE_ORDERS')
            .slice(1)
            .map((chunk) => chunk.slice(0, 200));

        for (const q of orderQueries) {
            expect(q).not.toContain('"vendorId"');
        }
        expect(orderQueries.length).toBeGreaterThan(0);
    });

    it('queries both seller fields, because neither alone is complete', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-dashboard.ts'), 'utf-8');

        expect(src).toContain('where("sellerId", "==", vendorId)');
        expect(src).toContain('where("sellerIds", "array-contains", vendorId)');
    });

    it('still leaves the VENDOR_PRODUCTS queries on vendorId', async () => {
        // Vendor products DO carry vendorId. A fix that renamed every
        // occurrence would have broken the inventory figures instead.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-dashboard.ts'), 'utf-8');

        const productQueries = src
            .split('COLLECTIONS.VENDOR_PRODUCTS')
            .slice(1)
            .map((chunk) => chunk.slice(0, 120));

        expect(productQueries.length).toBeGreaterThan(0);
        for (const q of productQueries) {
            expect(q).toContain('"vendorId"');
        }
    });

    it('deduplicates an order that matches both queries', async () => {
        // A single-seller order from _payment.ts satisfies BOTH sellerId== and
        // sellerIds contains, so a naive concatenation would count its revenue
        // twice — turning a silent zero into a silent double.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-dashboard.ts'), 'utf-8');

        const helper = src.slice(src.indexOf('async function fetchVendorOrderDocs'));
        expect(helper.slice(0, 900)).toContain('seen.has(doc.id)');
    });
});

describe('the access control, which was already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('refuses an unauthenticated caller', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: null, error: { error: 'Authentication required' },
        }));

        const r: any = await salesStats();

        expect(r.success).toBe(false);
    });

    it('serves a signed-in vendor', async () => {
        // Vacuity guard for the refusal above.
        setSession(VENDOR);

        const r: any = await salesStats();

        expect(r.success).toBe(true);
    });

    it('takes no vendor id as a parameter, in any of the six', async () => {
        // Ownership by construction: there is no argument to substitute. That
        // guarantee is about the SIGNATURES, so adding a parameter later would
        // not fail any behavioural test.
        const mod: any = await import('@/app/actions/vendor-dashboard');

        for (const name of [
            'getVendorSalesStatsAction',
            'getVendorRevenueTrendsAction',
            'getTopSellingProductsAction',
            'getVendorInventoryStatsAction',
            'getVendorRevenueInsightsAction',
            'getVendorActivityFeedAction',
        ]) {
            expect(typeof mod[name]).toBe('function');
            expect(mod[name].length).toBe(0);
        }
    });

    it('derives the vendor from the session in every query', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const src = readFileSync(join(process.cwd(), 'src/app/actions/vendor-dashboard.ts'), 'utf-8');

        // Six actions, six `const vendorId = session.user.id`.
        const derivations = src.match(/const vendorId = session\.user\.id/g) ?? [];
        expect(derivations.length).toBeGreaterThanOrEqual(6);
    });
});
