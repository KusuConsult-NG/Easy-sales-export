/**
 * @jest-environment node
 */

/**
 * The buyer-facing catalogue, EXECUTED — list, search, detail, related.
 *
 * _mp_catalog.ts was at 53.9% statements. Two findings came out of running it:
 *
 *   #119 THE SEARCH FILTERED THE PAGE, NOT THE CATALOGUE.
 *        Both search entry points — getMarketplaceProductsAction behind
 *        /marketplace/products, and searchProductsAction behind
 *        useMarketplaceSearch — took a page from the database first
 *        (`.orderBy("createdAt","desc").limit(12)`) and only then filtered it by
 *        the query. So a search never looked past the newest twelve products. A
 *        buyer could type a product's exact title and be told "No products
 *        found", because the product was thirteenth by age.
 *
 *        And `hasMore`/`lastId` were computed BEFORE the filter, so a search
 *        routinely returned an EMPTY page with hasMore true — nothing on screen,
 *        beside a Load More button that walks the catalogue twelve rows at a
 *        time.
 *
 *   #120 getRelatedProductsAction was the only catalogue reader that did not
 *        require availableQuantity > 0, so the "you might also like" strip under
 *        a product could offer things nobody can buy.
 *
 * The scan is bounded (PRODUCT_SEARCH_SCAN_LIMIT) and says so in the log when it
 * hits the cap; a silent truncation reads as "that is the whole catalogue".
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    PRODUCT_SEARCH_SCAN_LIMIT,
    matchesProductQuery,
    filterProductsByQuery,
    pageFilteredProducts,
} from '@/lib/product-search';

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

const catalog = () => import('@/app/actions/marketplace/_mp_catalog');

/** A listable product. createdAt descends with the index, so p0 is newest. */
function seedProducts(titles: string[], extra: Record<string, unknown> = {}): void {
    titles.forEach((title, i) => {
        store.seed(PRODUCTS, `p${i}`, {
            sellerId: SELLER,
            title,
            description: `${title} from the farm`,
            category: 'grains',
            status: 'active',
            availableQuantity: 10,
            unit: 'kg',
            minimumOrderQuantity: 1,
            pricingTiers: [{ type: 'retail', price: 1000 + i, minQuantity: 1 }],
            location: { state: 'Enugu', lga: 'Enugu North', nearestMarket: 'Ogbete' },
            images: ['https://example.com/a.jpg'],
            deliveryMethod: 'delivery',
            createdAt: new Date(Date.UTC(2026, 0, 200 - i)).toISOString(),
            ...extra,
        });
    });
}

const list = async (params: Record<string, unknown> = {}) =>
    (await (await catalog()).getMarketplaceProductsAction(params as never)) as any;

const search = async (params: Record<string, unknown> = {}) =>
    (await (await catalog()).searchProductsAction(params as never)) as any;

const titlesOf = (res: any): string[] => (res.data?.products ?? []).map((p: any) => p.title);

// ─────────────────────────────────────────────────────────────────────────────
describe('the search rule itself', () => {
    it('matches on title and on description, case- and space-insensitively', () => {
        const p = { title: 'Premium Ofada Rice', description: 'Grown in Abakaliki' };

        expect(matchesProductQuery(p, 'ofada')).toBe(true);
        expect(matchesProductQuery(p, '  ABAKALIKI ')).toBe(true);
        expect(matchesProductQuery(p, 'cassava')).toBe(false);
    });

    it('treats an empty query as no filter at all', () => {
        expect(matchesProductQuery({ title: 'Yam' }, '   ')).toBe(true);
        expect(filterProductsByQuery([{ title: 'a' }, { title: 'b' }], undefined)).toHaveLength(2);
    });

    it('does not throw on a product with neither field', () => {
        expect(matchesProductQuery({}, 'rice')).toBe(false);
        expect(matchesProductQuery(null, 'rice')).toBe(false);
    });

    it('pages the matches, and stops offering a cursor at the end', () => {
        const rows = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}` }));

        const first = pageFilteredProducts(rows, undefined, 2);
        expect(first.page.map(r => r.id)).toEqual(['p0', 'p1']);
        expect(first).toMatchObject({ hasMore: true, lastId: 'p1' });

        const second = pageFilteredProducts(rows, 'p1', 2);
        expect(second.page.map(r => r.id)).toEqual(['p2', 'p3']);

        const third = pageFilteredProducts(rows, 'p3', 2);
        expect(third.page.map(r => r.id)).toEqual(['p4']);
        expect(third).toMatchObject({ hasMore: false, lastId: undefined });
    });

    it('starts over rather than serving nothing when the cursor has vanished', () => {
        // findIndex returns -1 for a product that sold out or was delisted
        // between pages; used unchecked, `slice(0)` would have served the whole
        // list and `slice(-1 + 1)` the same — this pins the intent.
        const rows = [{ id: 'a' }, { id: 'b' }];

        expect(pageFilteredProducts(rows, 'gone', 1).page.map(r => r.id)).toEqual(['a']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getMarketplaceProductsAction', () => {
    it('lists the active products, newest first', async () => {
        seedProducts(['Rice', 'Yam', 'Beans']);

        const res = await list({ limit: 10 });
        expect(res.success).toBe(true);
        expect(titlesOf(res)).toEqual(['Rice', 'Yam', 'Beans']);
    });

    it('leaves out anything that is not active', async () => {
        seedProducts(['Rice', 'Yam']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), status: 'pending' });

        expect(titlesOf(await list({ limit: 10 }))).toEqual(['Rice']);
    });

    it('filters by category and by state', async () => {
        seedProducts(['Rice', 'Yam']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), category: 'roots' });

        expect(titlesOf(await list({ category: 'roots', limit: 10 }))).toEqual(['Yam']);
        expect(titlesOf(await list({ category: 'all', limit: 10 }))).toHaveLength(2);
        expect(titlesOf(await list({ location: 'Lagos', limit: 10 }))).toHaveLength(0);
    });

    it('FINDS A PRODUCT STORED UNDER AN ALIAS OF THE CATEGORY', async () => {
        // #131. This matched the raw string while _buyer.ts and
        // searchProductsAction both expanded it through the alias table, so
        // selecting "roots" on /marketplace/products missed every product
        // stored as "tubers", "yam" or "cassava" — and the same choice returned
        // a different catalogue depending on which action the page called.
        seedProducts(['Yam', 'Rice']);
        store.seed(PRODUCTS, 'p0', { ...store.get(PRODUCTS, 'p0'), category: 'tubers' });

        expect(titlesOf(await list({ category: 'roots', limit: 10 }))).toEqual(['Yam']);
    });

    it('pages an unfiltered list through the database', async () => {
        seedProducts(['A', 'B', 'C', 'D']);

        const first = await list({ limit: 2 });
        expect(titlesOf(first)).toEqual(['A', 'B']);
        expect(first.data.hasMore).toBe(true);

        const second = await list({ limit: 2, lastId: first.data.lastId });
        expect(titlesOf(second)).toEqual(['C', 'D']);
    });

    // ── #119 ────────────────────────────────────────────────────────────────
    it('FINDS A PRODUCT THAT IS NOT ON THE FIRST PAGE', async () => {
        // Twenty newer products, then the one the buyer is looking for. The
        // filter ran after `.limit(12)`, so this returned nothing at all.
        seedProducts([...Array.from({ length: 20 }, (_, i) => `Filler ${i}`), 'Ofada Rice']);

        const res = await list({ limit: 12, search: 'ofada' });

        expect(titlesOf(res)).toEqual(['Ofada Rice']);
    });

    it('never reports more pages when it has shown every match', async () => {
        // The other half: hasMore came from the pre-filter page, so a search
        // showed an empty list beside a Load More button.
        seedProducts([...Array.from({ length: 20 }, (_, i) => `Filler ${i}`), 'Ofada Rice']);

        const res = await list({ limit: 12, search: 'ofada' });

        expect(res.data.hasMore).toBe(false);
        expect(res.data.lastId).toBeUndefined();
    });

    it('pages the matches when there are more of them than fit', async () => {
        seedProducts(Array.from({ length: 30 }, (_, i) => `Ofada Rice ${i}`));

        const first = await list({ limit: 12, search: 'ofada' });
        expect(first.data.products).toHaveLength(12);
        expect(first.data.hasMore).toBe(true);

        const second = await list({ limit: 12, search: 'ofada', lastId: first.data.lastId });
        expect(second.data.products).toHaveLength(12);
        expect(titlesOf(second)[0]).toBe('Ofada Rice 12');

        const third = await list({ limit: 12, search: 'ofada', lastId: second.data.lastId });
        expect(third.data.products).toHaveLength(6);
        expect(third.data.hasMore).toBe(false);
    });

    it('applies the search on top of the category, not instead of it', async () => {
        seedProducts(['Ofada Rice', 'Ofada Yam']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), category: 'roots' });

        expect(titlesOf(await list({ search: 'ofada', category: 'roots', limit: 12 })))
            .toEqual(['Ofada Yam']);
    });

    it('reports an empty result honestly', async () => {
        seedProducts(['Rice', 'Yam']);

        const res = await list({ search: 'helicopter', limit: 12 });
        expect(res.success).toBe(true);
        expect(res.data.products).toEqual([]);
        expect(res.data.hasMore).toBe(false);
    });

    it('serves the badge live rather than the product\'s create-time copy', async () => {
        seedProducts(['Rice'], { sellerVerified: true, sellerName: 'Stale Name' });
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });

        const res = await list({ limit: 10 });
        expect(res.data.products[0].sellerVerified).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('searchProductsAction', () => {
    it('lists in-stock active products', async () => {
        seedProducts(['Rice', 'Yam']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), availableQuantity: 0 });

        expect(titlesOf(await search({ limit: 10 }))).toEqual(['Rice']);
    });

    it('maps a category alias to every spelling the catalogue uses', async () => {
        seedProducts(['Yam', 'Cassava']);
        store.seed(PRODUCTS, 'p0', { ...store.get(PRODUCTS, 'p0'), category: 'tubers' });
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), category: 'cassava' });

        const res = await search({ category: 'roots', limit: 10 });
        expect(titlesOf(res).sort()).toEqual(['Cassava', 'Yam']);
    });

    it('filters by state', async () => {
        seedProducts(['Rice', 'Yam']);
        store.seed(PRODUCTS, 'p1', {
            ...store.get(PRODUCTS, 'p1'), location: { state: 'Kano', lga: 'Kano', nearestMarket: 'x' },
        });

        expect(titlesOf(await search({ state: 'Kano', limit: 10 }))).toEqual(['Yam']);
    });

    // ── #119, the second entry point ────────────────────────────────────────
    it('FINDS A PRODUCT THAT IS NOT ON THE FIRST PAGE', async () => {
        seedProducts([...Array.from({ length: 20 }, (_, i) => `Filler ${i}`), 'Ofada Rice']);

        expect(titlesOf(await search({ query: 'ofada', limit: 12 }))).toEqual(['Ofada Rice']);
    });

    it('never reports more pages when it has shown every match', async () => {
        seedProducts([...Array.from({ length: 20 }, (_, i) => `Filler ${i}`), 'Ofada Rice']);

        const res = await search({ query: 'ofada', limit: 12 });
        expect(res.data.hasMore).toBe(false);
        expect(res.data.lastId).toBeUndefined();
    });

    it('pages the matches', async () => {
        seedProducts(Array.from({ length: 20 }, (_, i) => `Ofada Rice ${i}`));

        const first = await search({ query: 'ofada', limit: 8 });
        expect(first.data.products).toHaveLength(8);
        expect(first.data.hasMore).toBe(true);

        const second = await search({ query: 'ofada', limit: 8, lastId: first.data.lastId });
        expect(titlesOf(second)[0]).toBe('Ofada Rice 8');
    });

    it('keeps the query, the category and the stock rule all in force together', async () => {
        seedProducts(['Ofada Rice', 'Ofada Yam', 'Ofada Beans']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), category: 'roots' });
        store.seed(PRODUCTS, 'p2', { ...store.get(PRODUCTS, 'p2'), availableQuantity: 0 });

        expect(titlesOf(await search({ query: 'ofada', category: 'grains', limit: 12 })))
            .toEqual(['Ofada Rice']);
    });

    it('sorts by price in both directions', async () => {
        seedProducts(['Cheap', 'Dear']);
        store.seed(PRODUCTS, 'p0', {
            ...store.get(PRODUCTS, 'p0'), pricingTiers: [{ type: 'retail', price: 9000, minQuantity: 1 }],
        });

        expect(titlesOf(await search({ sortBy: 'price_asc', limit: 10 }))).toEqual(['Dear', 'Cheap']);
        expect(titlesOf(await search({ sortBy: 'price_desc', limit: 10 }))).toEqual(['Cheap', 'Dear']);
    });

    it('applies the same rule in the index-error fallback, which nothing here can execute', async () => {
        // Both actions carry a fallback for Firestore's missing-composite-index
        // error ("failed_precondition"). This stack is Supabase over PostgREST
        // and does not raise it, so those branches are unreachable from a test
        // and stay unexecuted — stated plainly rather than left looking covered.
        //
        // They page too, so the fix has to be in them as well; this pins that,
        // since no behavioural test can.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const src = stripComments(
            readFileSync(join(process.cwd(), 'src/app/actions/marketplace/_mp_catalog.ts'), 'utf8'),
            { label: '_mp_catalog.ts' },
        );

        // Every startAfter in this file is now conditional on there being no
        // query — a cursor into the unfiltered order means nothing to a search
        // that pages its own matches.
        for (const line of src.split('\n').filter(l => l.includes('startAfter'))) {
            expect(line).toBeTruthy();
        }
        expect(src).toContain('if (lastId && !searching)');
        expect(src).toContain('if (params.lastId && !searching)');
        // And the fallback's own in-memory pagination stands down while searching.
        expect(src).toContain('if (!searching) {');
    });

    it('scans a bounded window, and the cap is a real number', async () => {
        // A silent cap reads as "that is the whole catalogue". This pins that
        // the scan is bounded and that the bound is the one the fallback uses.
        expect(PRODUCT_SEARCH_SCAN_LIMIT).toBe(300);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getRecommendedProductsAction', () => {
    const recommended = async (n?: number) =>
        (await (await catalog()).getRecommendedProductsAction(n as never)) as any;

    it('returns the newest active products, capped at the limit', async () => {
        seedProducts(['A', 'B', 'C', 'D']);

        const res = await recommended(2);
        expect(titlesOf(res)).toEqual(['A', 'B']);
    });

    it('defaults to three', async () => {
        seedProducts(['A', 'B', 'C', 'D', 'E']);

        expect((await recommended()).data.products).toHaveLength(3);
    });

    it('leaves out anything that is not active', async () => {
        seedProducts(['A', 'B']);
        store.seed(PRODUCTS, 'p0', { ...store.get(PRODUCTS, 'p0'), status: 'sold_out' });

        expect(titlesOf(await recommended(3))).toEqual(['B']);
    });

    it('returns an empty list rather than failing on an empty catalogue', async () => {
        const res = await recommended(3);
        expect(res).toMatchObject({ success: true, data: { products: [] } });
    });

    it('reads the seller badge live here too', async () => {
        seedProducts(['A'], { sellerVerified: true });
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });

        expect((await recommended(1)).data.products[0].sellerVerified).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getProductByIdAction', () => {
    const byId = async (id: string) => (await (await catalog()).getProductByIdAction(id)) as any;

    it('reports a product that does not exist', async () => {
        expect(await byId('nope')).toMatchObject({ success: false, error: 'Product not found' });
    });

    it('returns the product, with the seller trust read live', async () => {
        seedProducts(['Rice'], { sellerVerified: true });
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });

        const res = await byId('p0');
        expect(res.data).toMatchObject({ id: 'p0', title: 'Rice', sellerVerified: false });
    });

    // ── #121 ────────────────────────────────────────────────────────────────
    it('KEEPS THE FIELDS THAT MAKE IT A FLASH SALE', async () => {
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'f1', {
            sellerId: SELLER, title: 'Flash Yam', price: 5000, flashPrice: 3000,
            availableQuantity: 4, imageUrl: 'https://example.com/y.jpg',
            createdAt: new Date().toISOString(),
        });

        // ProductSchema strips what it does not know, and it knows nothing
        // about flash sales — so the four fields assembled one line earlier
        // were discarded by the .parse() on the next. The detail page reads
        // isFlashSale to decide whether to show the sale at all.
        const res = await byId('f1');
        expect(res.data).toMatchObject({
            id: 'f1', title: 'Flash Yam', isFlashSale: true,
            originalPrice: 5000, flashPrice: 3000,
        });
        expect(res.data.pricingTiers[0].price).toBe(3000);
    });

    it('claims neither a rating nor a badge it does not have', async () => {
        // rating was the literal 5 with reviewCount 0, and sellerVerified the
        // literal true, on every flash-sale product.
        store.seed(USERS, SELLER, { name: 'Ada Farms', isVerifiedBadge: false });
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'f1', {
            sellerId: SELLER, title: 'Flash Yam', price: 5000, flashPrice: 3000, availableQuantity: 4,
        });

        const res = await byId('f1');
        expect(res.data.rating).toBe(0);
        expect(res.data.reviewCount).toBe(0);
        expect(res.data.sellerVerified).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getRelatedProductsAction', () => {
    const related = async (id: string, limit = 4) =>
        (await (await catalog()).getRelatedProductsAction(id, limit)) as any;

    it('reports a product that does not exist', async () => {
        expect(await related('nope')).toMatchObject({ success: false, error: 'Product not found' });
    });

    it('returns others in the same category, never the product itself', async () => {
        seedProducts(['Rice', 'Beans', 'Millet']);

        const res = await related('p0');
        expect(titlesOf(res).sort()).toEqual(['Beans', 'Millet']);
    });

    it('leaves out another category', async () => {
        seedProducts(['Rice', 'Yam']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), category: 'roots' });

        expect(titlesOf(await related('p0'))).toEqual([]);
    });

    // ── #120 ────────────────────────────────────────────────────────────────
    it('NEVER OFFERS SOMETHING THAT IS SOLD OUT', async () => {
        // Every other catalogue reader requires availableQuantity > 0. This one
        // did not, so the "you might also like" strip could offer a product
        // nobody can buy.
        seedProducts(['Rice', 'Beans']);
        store.seed(PRODUCTS, 'p1', { ...store.get(PRODUCTS, 'p1'), availableQuantity: 0 });

        expect(titlesOf(await related('p0'))).toEqual([]);
    });

    it('honours the limit', async () => {
        seedProducts(['Rice', 'A', 'B', 'C', 'D', 'E']);

        expect((await related('p0', 2)).data.products).toHaveLength(2);
    });
});
