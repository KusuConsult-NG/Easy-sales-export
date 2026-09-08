/**
 * @jest-environment node
 */

/**
 *   #515 THE SEARCH BOX PROMISED THREE THINGS AND SEARCHED ONE.
 *
 *   /marketplace/buyer/products renders
 *
 *       placeholder="Search products, sellers, or categories..."
 *
 *   and getProductsAction — the action that page calls — filtered on
 *
 *       product.title?.includes(term) || product.description?.includes(term)
 *
 *   So a buyer who typed the seller name printed on every card, or the category
 *   shown beside it, was told there were no products. Two of the three things
 *   the box offers returned nothing, and an empty result reads as "this does not
 *   exist" rather than "I did not look there".
 *
 * ── AND THE SHARED RULE ALREADY EXISTED ─────────────────────────────────────
 *
 *   This is the finding, not the placeholder. lib/product-search.ts was written
 *   by an earlier sweep for exactly this family of defect, and its header says
 *   what it was for: both catalogue actions "took a PAGE from the database and
 *   only then filtered it by the query", so "a seller's product at position 13
 *   by age was unfindable by name" and "a search commonly returned ZERO products
 *   with hasMore: true".
 *
 *   THAT SWEEP REACHED ONE READER OF THREE.
 *
 *     _mp_catalog.ts   scans PRODUCT_SEARCH_SCAN_LIMIT, matches, pages the
 *                      matches. Correct, and the model for the other two.
 *     _buyer.ts        imports categorySpellings from the shared module and
 *                      then hand-writes matchesProductQuery immediately below
 *                      it, character for character. One import short.
 *     the public API   uses none of it. Its own search over four different
 *                      fields, applied to a page of `limit + 1` rows — so
 *                      ?search=cocoa only ever saw the newest 21 products.
 *                      The bug the module was built to remove, still live, on
 *                      the endpoint anyone can call.
 *
 *   The rule is stated once now and all three read it.
 *
 * ── THREE MORE IN THE PUBLIC ROUTE ──────────────────────────────────────────
 *
 *   THE INDEX-ERROR FALLBACK ASKED FOR A CURSOR IT COULD NOT HONOUR. It built
 *   `baseQuery.limit(n)` with no orderBy — ordering is what had just failed —
 *   then called `.startAfter(cursorDate)`. supabase-db applies a cursor only
 *   `if ((startAfterDoc || startAfterValues) && _orderBy.length > 0)`, so the
 *   cursor was silently dropped and `query.order('id')` applied instead. Every
 *   "next page" in that branch returned PAGE ONE, for ever. supabase-db's own
 *   comment records fixing this same failure for a different cause; this is the
 *   other door — a caller that does not order at all.
 *
 *   THE SELLER NAME IT SEARCHED WAS NOT THE ONE IT RETURNED. The filter ran
 *   before hydrateSellerTrust, which replaces the create-time `sellerName`
 *   snapshot with the seller's live name. Search one value, display another.
 *   Both readers hydrate first now; the cost is bounded by the query cap and
 *   batched by unique seller, so it is a handful of reads, not one a row.
 *
 *   `rating` AND `reviewCount` WERE ALWAYS ZERO, SERVED AS MEASUREMENTS. All
 *   three product creators write 0 and nothing updates them —
 *   submitProductReviewAction writes the review row and the order, never the
 *   product. `null` says "not maintained", which is #514's rule: an absence is
 *   not a zero. (The marketplace landing page already renders
 *   `product.rating || "N/A"`, which is the honest reading of the same data.)
 *
 * ── A MISTAKE WORTH RECORDING ───────────────────────────────────────────────
 *
 *   I wrote lib/product-search.ts from scratch, with Write, on a path I had
 *   never read — destroying the existing module and the two suites that import
 *   it. tsc caught it and git restored it, and the finding got SHARPER for it:
 *   "there is no shared rule" was wrong, and "there is one and two of three
 *   readers ignore it" is both true and worse. Reading before writing is the
 *   rule; this is what skipping it costs.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the seller name dropped from the rule           KILLED
 *     the category dropped from the rule              KILLED
 *     _buyer.ts back to its own title/description     KILLED
 *     the API search back to one page                 KILLED
 *     the degraded branch handing back a cursor       KILLED
 *     rating served as 0 again                        KILLED
 *     reword this header                              SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { matchesProductQuery, PRODUCT_SEARCH_SCAN_LIMIT } from '@/lib/product-search';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const PRODUCTS = COLLECTIONS.PRODUCTS;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, 'seller-1', {
        fullName: 'Ada Obi', businessName: 'Obi Agro Ltd',
        sellerVerificationStatus: 'approved',
    });
});

function seedProduct(id: string, over: Record<string, unknown> = {}): void {
    store.seed(PRODUCTS, id, {
        title: `Product ${id}`,
        description: 'A crop',
        category: 'grains',
        status: 'active',
        price: 5000,
        quantity: 10,
        sellerId: 'seller-1',
        sellerName: 'Stale Snapshot Ltd',
        createdAt: new Date(Date.now() - Number(id.replace(/\D/g, '') || 0) * 1000).toISOString(),
        ...over,
    });
}

const api = async (qs: string) => {
    const { GET } = await import('@/app/api/marketplace/products/route');
    const res = await GET(new Request(`https://example.com/api/marketplace/products?${qs}`) as never);
    return (await res.json()) as any;
};

const action = async (filters: Record<string, unknown>) =>
    (await (await import('@/app/actions/marketplace/_buyer')).getProductsAction(filters as any)) as any;

const titles = (rows: any[]) => rows.map((r) => r.title ?? r.name).sort();

// ─────────────────────────────────────────────────────────────────────────────
describe('#515 — the rule matches the label', () => {
    it('A CATEGORY IS SEARCHABLE', () => {
        //   THE test. The box says "products, sellers, or categories".
        expect(matchesProductQuery({ title: 'Bag', category: 'grains' }, 'grains')).toBe(true);
    });

    it('AND SO IS A SELLER NAME', () => {
        expect(matchesProductQuery({ title: 'Bag', sellerName: 'Obi Agro Ltd' }, 'obi agro')).toBe(true);
    });

    it('AND THE TITLE AND DESCRIPTION STILL ARE', () => {
        //   The vacuity guard: widening the rule must not drop what it had.
        expect(matchesProductQuery({ title: 'Sesame seeds' }, 'sesame')).toBe(true);
        expect(matchesProductQuery({ description: 'Grade A hibiscus' }, 'hibiscus')).toBe(true);
    });

    it('and a term matching nothing on the card still does not match', () => {
        //   The rule is still a substring test over visible fields, not a
        //   catch-all that makes every search succeed.
        expect(matchesProductQuery(
            { title: 'Bag', description: 'A crop', sellerName: 'Obi Agro', category: 'grains' },
            'motorcycle',
        )).toBe(false);
    });

    it('and an empty term is not a filter', () => {
        expect(matchesProductQuery({ title: 'Bag' }, '   ')).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#515 — the buyer page reads the shared rule', () => {
    it('SEARCHING A SELLER NAME FINDS THAT SELLER\'S PRODUCTS', async () => {
        //   THE live test. getProductsAction is what /marketplace/buyer/products
        //   calls, and it searched title and description only.
        seedProduct('p1', { title: 'Sesame seeds' });
        seedProduct('p2', { title: 'Hibiscus', sellerId: 'seller-2', sellerName: 'Someone Else' });

        const res = await action({ searchTerm: 'Obi Agro' });

        expect(res.success).toBe(true);
        expect(titles(res.data.products)).toEqual(['Sesame seeds']);
    });

    it('AND IT MATCHES THE LIVE SELLER NAME, NOT THE STORED SNAPSHOT', async () => {
        //   The mismatch: hydrateSellerTrust replaces `sellerName` with the
        //   seller's live name, and the filter used to run BEFORE it — so the
        //   value searched was the one the response then overwrote.
        seedProduct('p1', { title: 'Sesame seeds', sellerName: 'Stale Snapshot Ltd' });

        const res = await action({ searchTerm: 'Obi Agro' });

        expect(titles(res.data.products)).toEqual(['Sesame seeds']);
        expect(res.data.products[0].sellerName).toBe('Obi Agro Ltd');
    });

    it('and searching a title still works', async () => {
        seedProduct('p1', { title: 'Sesame seeds' });
        seedProduct('p2', { title: 'Hibiscus' });

        expect(titles((await action({ searchTerm: 'hibiscus' })).data.products)).toEqual(['Hibiscus']);
    });

    it('and the file states no rule of its own', () => {
        //   Comments stripped: this header quotes the removed expression.
        const body = stripComments(
            readFileSync('src/app/actions/marketplace/_buyer.ts', 'utf-8'),
            { label: '_buyer.ts' },
        );

        expect(body).toContain('filterProductsByQuery');
        expect(body).not.toMatch(/product\.title\?\.toLowerCase\(\)\?\.includes/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#515 — the public API searches the catalogue, not one page', () => {
    it('A PRODUCT PAST THE FIRST PAGE IS STILL FOUND BY NAME', async () => {
        //   THE test for the endpoint the sweep never reached. It read
        //   `limit + 1` rows and filtered THOSE, so with limit=5 a match at
        //   position 20 by age did not exist.
        for (let i = 0; i < 20; i++) seedProduct(`p${i}`);
        seedProduct('p99', { title: 'Rare cocoa', createdAt: new Date(0).toISOString() });

        const res = await api('search=cocoa&limit=5');

        expect(titles(res.data.products)).toEqual(['Rare cocoa']);
    });

    it('AND AN EMPTY SEARCH NO LONGER COMES BACK BESIDE hasMore: true', async () => {
        //   The contradiction the shared module's header names: zero products
        //   under a "Load More" button.
        for (let i = 0; i < 20; i++) seedProduct(`p${i}`);

        const res = await api('search=motorcycle&limit=5');

        expect(res.data.products).toEqual([]);
        expect(res.meta.hasMore).toBe(false);
    });

    it('AND THE SEARCH MATCHES THE LIVE SELLER NAME', async () => {
        seedProduct('p1', { title: 'Sesame seeds', sellerName: 'Stale Snapshot Ltd' });

        const res = await api('search=Obi%20Agro');

        expect(titles(res.data.products)).toEqual(['Sesame seeds']);
        expect(res.data.products[0].sellerName).toBe('Obi Agro Ltd');
    });

    it('and an unsearched page still pages the database', async () => {
        //   The control: the fix must not turn every request into a 300-row scan.
        for (let i = 0; i < 10; i++) seedProduct(`p${i}`);

        const res = await api('limit=5');

        expect(res.data.products).toHaveLength(5);
        expect(res.meta.hasMore).toBe(true);
        expect(res.meta.cursor).toBeTruthy();
    });

    it('and the response says how many it returned against how many it read', async () => {
        //   A caller asking for 20 and receiving 3 could not tell whether the
        //   catalogue ended or rows were filtered out after the read.
        seedProduct('p1');
        seedProduct('p2', { quantity: 0 });

        const res = await api('limit=20');

        expect(res.meta.returned).toBe(1);
        expect(res.meta.scanned).toBe(2);
    });

    it('and the scan cap is reported rather than presented as completeness', () => {
        const body = stripComments(
            readFileSync('src/app/api/marketplace/products/route.ts', 'utf-8'),
            { label: 'marketplace/products route.ts' },
        );

        expect(body).toContain('PRODUCT_SEARCH_SCAN_LIMIT');
        expect(body).toContain('searchTruncated');
        expect(PRODUCT_SEARCH_SCAN_LIMIT).toBe(300);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#515 — a degraded read does not pretend to paginate', () => {
    it('THE FALLBACK HANDS BACK NO CURSOR', () => {
        //   supabase-db applies a cursor only when _orderBy is non-empty, and
        //   the fallback has no orderBy — ordering is what failed. So the cursor
        //   was dropped and every "next page" replayed page one, for ever.
        //   Pinned on source: reaching this branch needs the adapter to raise a
        //   missing-index error, which the fake db has no way to raise, and a
        //   test that mocked the error would be asserting on its own mock.
        const body = stripComments(
            readFileSync('src/app/api/marketplace/products/route.ts', 'utf-8'),
            { label: 'marketplace/products route.ts' },
        );

        expect(body).not.toMatch(/fallbackQuery\s*=\s*fallbackQuery\.startAfter/);
        expect(body).toContain('cursor: indexError ? null');
        expect(body).toContain('hasMore: indexError ? false');
        expect(body).toContain('degraded: indexError');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#515 — a field nobody maintains is not a measurement', () => {
    it('rating AND reviewCount ARE null, NOT 0', async () => {
        //   All three creators write 0 and nothing updates them, so 0 was not a
        //   rating of zero — it was "never recorded", served as a number.
        seedProduct('p1');

        const res = await api('limit=5');

        expect(res.data.products[0].rating).toBeNull();
        expect(res.data.products[0].reviewCount).toBeNull();
    });

    it('and the price and stock, which ARE maintained, are still numbers', async () => {
        //   The vacuity guard: nulling everything would satisfy the test above.
        seedProduct('p1', { price: 7500, quantity: 4 });

        const row = (await api('limit=5')).data.products[0];
        expect(row.price).toBe(7500);
        expect(row.quantity).toBe(4);
        expect(row.inStock).toBe(true);
    });
});
