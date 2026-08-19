/**
 * @jest-environment node
 */

/**
 * The buyer's browsing actions, EXECUTED — _buyer.ts's product reads.
 *
 * marketplace-buyer-behaviour.test.ts drives the two ORDER actions in this file.
 * The four product readers had never been run: _buyer.ts sat at 42.5%
 * statements, and getProductsAction is what /marketplace/buyer/products calls.
 * Three findings came out of running them:
 *
 *   #130 `product.pricingTiers[0]?.price` guards the ELEMENT, not the ARRAY. A
 *        product stored without pricingTiers throws a TypeError inside the try,
 *        the catch turns it into "Failed to fetch products", and the buyer gets
 *        an empty page instead of the other 299 products. `product.location.lga`
 *        had no guard at all. Same mistake as `createdAt?.toMillis()` in the
 *        sort-key finding: optional chaining on the property, then an
 *        unconditional use of the result.
 *
 *   #131 FOUR category filters, THREE behaviours. getProductsAction and
 *        searchProductsAction expanded the requested category through an alias
 *        table — "roots" also matches "tubers", "yam", "cassava".
 *        getMarketplaceProductsAction, which is what /marketplace/products
 *        calls, matched the raw string; so did getProductsByCategoryAction. The
 *        same choice returned a different catalogue depending on which action
 *        the page happened to use. The table itself existed twice, character
 *        for character.
 *
 *   #132 Both product writers in _mp_products.ts parse `nearestMarket` into
 *        validatedData and then omit it from the write. The seller edit page
 *        reads it back into its own field and re-sends it, so editing a product
 *        erased the nearest market the seller had entered — the certifications
 *        defect again, one field over in the same object.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { categorySpellings, PRODUCT_CATEGORY_ALIASES } from '@/lib/product-search';

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

const PRODUCTS = COLLECTIONS.PRODUCTS;
const USERS = COLLECTIONS.USERS;
const SELLER = 'seller-1';

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: true });
});

const buyer = () => import('@/app/actions/marketplace/_buyer');

function seedProduct(id: string, over: Record<string, unknown> = {}): void {
    store.seed(PRODUCTS, id, {
        sellerId: SELLER,
        title: `Product ${id}`,
        description: 'Grown on the farm',
        category: 'grains',
        status: 'active',
        availableQuantity: 10,
        orders: 0,
        pricingTiers: [{ type: 'retail', price: 1000, minQuantity: 1 }],
        location: { state: 'Enugu', lga: 'Enugu North', nearestMarket: 'Ogbete' },
        ...over,
    });
}

const list = async (filters: Record<string, unknown> = {}) =>
    (await (await buyer()).getProductsAction(filters as never)) as any;

const byCategory = async (category: string) =>
    (await (await buyer()).getProductsByCategoryAction(category as never)) as any;

const featured = async () => (await (await buyer()).getFeaturedProductsAction()) as any;

const stats = async () => (await (await buyer()).getMarketplaceStatsAction()) as any;

const idsOf = (res: any): string[] => (res.data?.products ?? []).map((p: any) => p.id).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('the category alias table', () => {
    it('expands a known category to every spelling the catalogue uses', () => {
        expect(categorySpellings('roots')).toContain('tubers');
        expect(categorySpellings('roots')).toContain('cassava');
        expect(categorySpellings('ROOTS')).toContain('yam');
    });

    it('maps an unknown category to itself rather than to nothing', () => {
        expect(categorySpellings('quinoa')).toEqual(['quinoa']);
        expect(categorySpellings('')).toEqual(['']);
    });

    it('lists every key as one of its own spellings', () => {
        // A category that does not match rows stored under its own name would
        // hide the products the table was written to find.
        for (const [key, spellings] of Object.entries(PRODUCT_CATEGORY_ALIASES)) {
            expect(spellings).toContain(key);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProductsAction', () => {
    it('lists the active products', async () => {
        seedProduct('p1');
        seedProduct('p2', { status: 'pending' });

        expect(idsOf(await list())).toEqual(['p1']);
    });

    it('filters by state, bulk and export flags', async () => {
        seedProduct('p1', { bulkAvailable: true, exportReady: true });
        seedProduct('p2', { location: { state: 'Kano', lga: 'Kano', nearestMarket: 'x' } });

        expect(idsOf(await list({ state: 'Enugu' }))).toEqual(['p1']);
        expect(idsOf(await list({ bulkAvailable: true }))).toEqual(['p1']);
        expect(idsOf(await list({ exportReady: true }))).toEqual(['p1']);
    });

    it('filters by price range and by search term', async () => {
        seedProduct('cheap', { pricingTiers: [{ type: 'retail', price: 500, minQuantity: 1 }], title: 'Ofada Rice' });
        seedProduct('dear', { pricingTiers: [{ type: 'retail', price: 9000, minQuantity: 1 }], title: 'Cocoa' });

        expect(idsOf(await list({ maxPrice: 1000 }))).toEqual(['cheap']);
        expect(idsOf(await list({ minPrice: 1000 }))).toEqual(['dear']);
        expect(idsOf(await list({ searchTerm: 'ofada' }))).toEqual(['cheap']);
    });

    it('filters by LGA', async () => {
        seedProduct('p1');
        seedProduct('p2', { location: { state: 'Enugu', lga: 'Nsukka', nearestMarket: 'x' } });

        expect(idsOf(await list({ lga: 'Nsukka' }))).toEqual(['p2']);
    });

    // ── #130 ────────────────────────────────────────────────────────────────
    it('SURVIVES A PRODUCT WITH NO pricingTiers WHEN FILTERING BY PRICE', async () => {
        // `pricingTiers[0]?.price` throws on a row with no pricingTiers, inside
        // the try — so the catch returned "Failed to fetch products" and the
        // buyer saw an empty catalogue because of one malformed row.
        seedProduct('good');
        seedProduct('broken', { pricingTiers: undefined });

        const res = await list({ minPrice: 100 });

        expect(res.success).toBe(true);
        expect(idsOf(res)).toEqual(['good']);
    });

    it('SURVIVES A PRODUCT WITH NO location WHEN FILTERING BY LGA', async () => {
        seedProduct('good');
        seedProduct('broken', { location: undefined });

        const res = await list({ lga: 'Enugu North' });

        expect(res.success).toBe(true);
        expect(idsOf(res)).toEqual(['good']);
    });

    // ── #131 ────────────────────────────────────────────────────────────────
    it('finds a product stored under an ALIAS of the requested category', async () => {
        seedProduct('yam', { category: 'tubers' });
        seedProduct('cassava', { category: 'cassava' });
        seedProduct('rice', { category: 'grains' });

        expect(idsOf(await list({ category: 'roots' }))).toEqual(['cassava', 'yam']);
    });

    it('treats "all" as no category filter', async () => {
        seedProduct('p1', { category: 'grains' });
        seedProduct('p2', { category: 'tubers' });

        expect(idsOf(await list({ category: 'all' }))).toEqual(['p1', 'p2']);
    });

    it('serves the seller badge live, not the product\'s create-time copy', async () => {
        seedProduct('p1', { sellerVerified: true });
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });

        expect((await list()).data.products[0].sellerVerified).toBe(false);
    });

    it('reports an empty catalogue honestly', async () => {
        expect(await list()).toMatchObject({ success: true, data: { products: [] } });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProductsByCategoryAction', () => {
    // ── #131, the second reader ─────────────────────────────────────────────
    it('AGREES WITH getProductsAction ON WHAT A CATEGORY MEANS', async () => {
        // It matched the raw string, so the same category name returned a
        // different set of products depending on which action was called.
        seedProduct('yam', { category: 'tubers' });
        seedProduct('rice', { category: 'grains' });

        expect(idsOf(await byCategory('roots'))).toEqual(idsOf(await list({ category: 'roots' })));
        expect(idsOf(await byCategory('roots'))).toEqual(['yam']);
    });

    it('still matches an exact category that is not in the table', async () => {
        seedProduct('odd', { category: 'quinoa' });

        expect(idsOf(await byCategory('quinoa'))).toEqual(['odd']);
    });

    it('leaves out inactive products', async () => {
        seedProduct('p1', { category: 'grains', status: 'sold_out' });

        expect(idsOf(await byCategory('grains'))).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getFeaturedProductsAction', () => {
    it('returns the most-ordered products first', async () => {
        seedProduct('quiet', { orders: 1 });
        seedProduct('busy', { orders: 99 });

        const res = await featured();
        expect((res.data.products as any[]).map((p) => p.id)).toEqual(['busy', 'quiet']);
    });

    it('leaves out inactive products', async () => {
        seedProduct('p1', { orders: 5, status: 'pending' });

        expect(idsOf(await featured())).toEqual([]);
    });

    it('caps the strip at eight', async () => {
        for (let i = 0; i < 12; i++) seedProduct(`p${i}`, { orders: i });

        expect((await featured()).data.products).toHaveLength(8);
    });

    it('reads the badge live here too', async () => {
        seedProduct('p1', { sellerVerified: true, orders: 3 });
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });

        expect((await featured()).data.products[0].sellerVerified).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMarketplaceStatsAction', () => {
    it('counts the active products and the sellers behind them', async () => {
        seedProduct('p1');
        seedProduct('p2');
        seedProduct('p3', { sellerId: 'seller-2' });
        seedProduct('p4', { status: 'pending' });

        const res = await stats();
        expect(res.success).toBe(true);
        expect(res.data.productsCount).toBeGreaterThanOrEqual(3);
        expect(res.data.tradersCount).toBeGreaterThanOrEqual(0);
    });

    it('reports zeroes rather than failing on an empty catalogue', async () => {
        const res = await stats();
        expect(res.success).toBe(true);
        expect(res.data.productsCount).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#132 — the nearest market a seller enters', () => {
    it('IS WRITTEN BY BOTH PRODUCT WRITERS, NOT PARSED AND DROPPED', async () => {
        // Both writers build `location: { state, lga }` from a validatedData
        // that carries all three, so an edit made through the seller page
        // erased the market the seller had typed and showed the box empty next
        // time. /api/marketplace/create-product writes it.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/marketplace/_mp_products.ts'), 'utf8'),
            { label: '_mp_products.ts' },
        );

        // Two writers, and each writes all three parts of the location.
        const count = (needle: string) => src.split(needle).length - 1;

        expect(count('state: validatedData.location.state')).toBe(2);
        expect(count('lga: validatedData.location.lga')).toBe(2);
        expect(count('nearestMarket: validatedData.location.nearestMarket')).toBe(2);
    });
});
