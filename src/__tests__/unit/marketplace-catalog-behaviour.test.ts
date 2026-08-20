/**
 * @jest-environment node
 */

/**
 * The public marketplace catalogue, EXECUTED.
 *
 * At 7.4%, and it is the most-visited code in the platform: every product page,
 * every search, every category browse. Two recorded defects live in the
 * flash-sale mapping and both were things a shopper SAW:
 *
 *   - the seller-name fallback was the string "Verified Seller", so a flash-sale
 *     seller with no name recorded was labelled verified in the name itself — and
 *     `sellerVerified` was the literal `true`, so the shield was drawn as well.
 *     Neither had anything to do with the seller's actual badge;
 *   - `rating: 5` with `reviewCount: 0`. The card renders a rating only when it
 *     is above zero, so every flash-sale product showed a perfect score with
 *     nothing behind it, and "Highest Rated" sorted all of them above real
 *     products with genuine ratings below five.
 *
 * Both are claims about the object the page receives, which is what a store lets
 * a test read and a call recorder does not.
 *
 * The catalogue also has a branch nothing else in this codebase has: when the
 * composite index is missing, the query FALLS BACK to an unordered one rather
 * than showing an empty shop. That branch is worth executing, because a fallback
 * nobody has run is a fallback nobody knows works.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

async function actions() {
    return import('@/app/actions/marketplace/_mp_catalog');
}

/** A product complete enough to satisfy ProductSchema. */
function product(extra: Record<string, unknown> = {}) {
    return {
        sellerId: 'seller-1',
        title: 'Yellow Maize',
        description: 'Dried, graded',
        category: 'grains',
        images: ['https://cdn.test/maize.jpg'],
        pricingTiers: [{ type: 'retail', price: 5000, minQuantity: 1 }],
        availableQuantity: 100,
        minimumOrderQuantity: 1,
        unit: 'bag',
        location: { state: 'Kano', lga: 'Dala', nearestMarket: 'Dawanau' },
        deliveryMethod: 'delivery',
        status: 'active',
        bulkAvailable: true,
        exportReady: false,
        views: 0,
        orders: 0,
        rating: 0,
        reviewCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    };
}

// ─── the catalogue listing ───────────────────────────────────────────────────

describe('the product listing', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.PRODUCTS, {
            live: product({ title: 'Live', createdAt: '2026-03-01T00:00:00.000Z' }),
            older: product({ title: 'Older', createdAt: '2026-01-01T00:00:00.000Z' }),
            pending: product({ title: 'Pending', status: 'pending' }),
            rejected: product({ title: 'Rejected', status: 'rejected' }),
            suspended: product({ title: 'Suspended', status: 'suspended' }),
        });
    });

    it('shows ONLY active products', async () => {
        // The moderation queue means nothing if the catalogue ignores it. A
        // pending or rejected product on the public shop is a product nobody
        // approved.
        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({});

        expect(result.success).toBe(true);
        const titles = result.data!.products.map((p) => p.title).sort();
        expect(titles).toEqual(['Live', 'Older']);
    });

    it('newest first by default', async () => {
        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({});
        expect(result.data!.products.map((p) => p.title)).toEqual(['Live', 'Older']);
    });

    it('filters by category, and "all" is not a category', async () => {
        store.seed(COLLECTIONS.PRODUCTS, 'tubers', product({ title: 'Yam', category: 'tubers' }));

        const { getMarketplaceProductsAction } = await actions();

        const grains = await getMarketplaceProductsAction({ category: 'grains' });
        expect(grains.data!.products.map((p) => p.title).sort()).toEqual(['Live', 'Older']);

        const all = await getMarketplaceProductsAction({ category: 'all' });
        expect(all.data!.products).toHaveLength(3);
    });

    it('and by location, on the NESTED state field', async () => {
        // location.state, not a top-level `state`. A filter on the wrong path
        // matches nothing and the shop looks empty in every region.
        store.seed(COLLECTIONS.PRODUCTS, 'lagos',
            product({ title: 'Lagos Rice', location: { state: 'Lagos', lga: 'Ikeja', nearestMarket: 'Mile 12' } }));

        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({ location: 'Lagos' });

        expect(result.data!.products.map((p) => p.title)).toEqual(['Lagos Rice']);
    });

    it('sorting by popularity when asked', async () => {
        store.seed(COLLECTIONS.PRODUCTS, 'popular', product({ title: 'Popular', views: 9 }));

        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({ sortBy: 'popular' });

        expect(result.data!.products[0].title).toBe('Popular');
    });

    it('and honouring a limit', async () => {
        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({ limit: 1 });
        expect(result.data!.products).toHaveLength(1);
    });

    it('returning an empty shop rather than an error when nothing is live', async () => {
        store.clear();
        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({});

        expect(result.success).toBe(true);
        expect(result.data!.products).toEqual([]);
    });

    it('and a product whose shape fails the schema is still shown', async () => {
        // Deliberate: the catalogue serialises what it has rather than dropping a
        // row. A schema-strict catalogue would hide a seller's listing because one
        // optional field was written oddly years ago.
        store.seed(COLLECTIONS.PRODUCTS, 'odd', {
            status: 'active', title: 'Odd One', createdAt: '2026-06-01T00:00:00.000Z',
        });

        const { getMarketplaceProductsAction } = await actions();
        const result = await getMarketplaceProductsAction({});

        expect(result.data!.products.map((p) => p.title)).toContain('Odd One');
    });
});

// ─── one product ─────────────────────────────────────────────────────────────

describe('a single product page', () => {
    it('reads the product', async () => {
        store.seed(COLLECTIONS.PRODUCTS, 'p1', product({ title: 'Yellow Maize' }));

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('p1');

        expect(result.success).toBe(true);
        expect(result.data!.title).toBe('Yellow Maize');
    });

    it('reports a missing product rather than an empty page', async () => {
        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('no-such-product');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
    });

    it('and falls back to the flash-sale collection', async () => {
        // Two collections, one product page. A reader of the first alone gives a
        // 404 for every flash-sale link the platform sends out.
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'flash-1', {
            sellerId: 'seller-1',
            title: 'Flash Maize',
            flashPrice: 3500,
            availableQuantity: 10,
            unit: 'bag',
        });

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-1');

        expect(result.success).toBe(true);
        expect(result.data!.title).toBe('Flash Maize');
        expect(result.data!.pricingTiers[0].price).toBe(3500);
    });
});

describe('the flash-sale mapping', () => {
    beforeEach(() => {
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'flash-1', {
            sellerId: 'seller-1',
            title: 'Flash Maize',
            flashPrice: 3500,
            availableQuantity: 10,
        });
    });

    it('shows a rating of ZERO, not a perfect five nobody earned', async () => {
        // THE defect. `rating: 5` with `reviewCount: 0` drew a full five stars on
        // every flash-sale card, and "Highest Rated" put all of them above real
        // products with genuine ratings below five.
        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-1');

        expect(result.data!.rating).toBe(0);
        expect(result.data!.reviewCount).toBe(0);
    });

    it('and does not label an unnamed seller "Verified Seller"', async () => {
        // The other one. The fallback NAME was the words "Verified Seller", so a
        // seller with no name recorded was described as verified in the name
        // field, and sellerVerified was the literal true beside it.
        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-1');

        expect(result.data!.sellerName).not.toMatch(/verified/i);
        expect(result.data!.sellerVerified).toBe(false);
    });

    it('taking the seller name and badge from the live user record', async () => {
        // businessName, not fullName. resolveSellerTrust reads
        // businessName -> displayName -> name, and the storefront shows the
        // BUSINESS. Seeded with fullName first, which fell through to the
        // fallback — a useful reminder that the field the shop displays is not
        // the field the profile form is named after.
        store.seed(COLLECTIONS.USERS, 'seller-1', {
            businessName: 'Ada Farms', isVerifiedBadge: true, roles: ['seller'],
        });

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-1');

        expect(result.data!.sellerName).toBe('Ada Farms');
        expect(result.data!.sellerVerified).toBe(true);
    });

    it('and a seller WITHOUT the badge gets no shield', async () => {
        // The pair. Asserting only the positive would pass for a mapping that
        // returned true for everyone.
        store.seed(COLLECTIONS.USERS, 'seller-1', { businessName: 'Plain Farms', roles: ['seller'] });

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-1');

        expect(result.data!.sellerName).toBe('Plain Farms');
        expect(result.data!.sellerVerified).toBe(false);
    });

    it('preferring flashPrice to the ordinary price', async () => {
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'flash-2', {
            sellerId: 'seller-1', title: 'Both Prices',
            price: 9000, flashPrice: 4500, availableQuantity: 5,
        });

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-2');

        expect(result.data!.pricingTiers[0].price).toBe(4500);
    });

    it('and using imageUrl when there is no images array', async () => {
        store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'flash-3', {
            sellerId: 'seller-1', title: 'One Image',
            flashPrice: 100, imageUrl: 'https://cdn.test/one.jpg',
        });

        const { getProductByIdAction } = await actions();
        const result = await getProductByIdAction('flash-3');

        expect(result.data!.images).toEqual(['https://cdn.test/one.jpg']);
    });
});

// ─── search ──────────────────────────────────────────────────────────────────

describe('search', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.PRODUCTS, {
            maize: product({ title: 'Yellow Maize', category: 'grains' }),
            rice: product({ title: 'Ofada Rice', category: 'grains' }),
            yam: product({ title: 'Puna Yam', category: 'tubers' }),
            outOfStock: product({ title: 'Sold Out', availableQuantity: 0 }),
            notLive: product({ title: 'Draft', status: 'draft' }),
        });
    });

    it('shows only active products that are IN STOCK', async () => {
        // Both conditions. A search that ignored the quantity puts sold-out
        // products in front of a buyer who then cannot check out.
        const { searchProductsAction } = await actions();
        const result = await searchProductsAction({});

        const titles = result.data!.products.map((p) => p.title).sort();
        expect(titles).toEqual(['Ofada Rice', 'Puna Yam', 'Yellow Maize']);
        expect(titles).not.toContain('Sold Out');
        expect(titles).not.toContain('Draft');
    });

    it('mapping a category alias to every spelling stored under it', async () => {
        // The vocabulary drifted over the years — "dairy", "dairy & eggs",
        // "dairy_eggs" are one category to a shopper. A search matching one
        // spelling shows a third of the shelf.
        store.seedAll(COLLECTIONS.PRODUCTS, {
            d1: product({ title: 'Milk', category: 'dairy' }),
            d2: product({ title: 'Eggs', category: 'dairy_eggs' }),
        });

        const { searchProductsAction } = await actions();
        const result = await searchProductsAction({ category: 'dairy' });

        expect(result.data!.products.map((p) => p.title).sort()).toEqual(['Eggs', 'Milk']);
    });

    it('and "All Categories" is not a category', async () => {
        const { searchProductsAction } = await actions();
        const result = await searchProductsAction({ category: 'All Categories' });
        expect(result.data!.products.length).toBeGreaterThan(1);
    });

    it('filtering by state, with "All Locations" meaning no filter', async () => {
        store.seed(COLLECTIONS.PRODUCTS, 'lagos',
            product({ title: 'Lagos Rice', location: { state: 'Lagos', lga: 'Ikeja', nearestMarket: 'Mile 12' } }));

        const { searchProductsAction } = await actions();

        const lagos = await searchProductsAction({ state: 'Lagos' });
        expect(lagos.data!.products.map((p) => p.title)).toEqual(['Lagos Rice']);

        const everywhere = await searchProductsAction({ state: 'All Locations' });
        expect(everywhere.data!.products.length).toBeGreaterThan(1);
    });

    it('and returns an empty result rather than an error for a category nobody sells', async () => {
        const { searchProductsAction } = await actions();
        const result = await searchProductsAction({ category: 'spacecraft' });

        expect(result.success).toBe(true);
        expect(result.data!.products).toEqual([]);
    });
});

// ─── recommendations and related ─────────────────────────────────────────────

describe('recommendations', () => {
    it('return active products only, capped at the requested count', async () => {
        store.seedAll(COLLECTIONS.PRODUCTS, {
            a: product({ title: 'A' }), b: product({ title: 'B' }),
            c: product({ title: 'C' }), d: product({ title: 'D' }),
            hidden: product({ title: 'Hidden', status: 'pending' }),
        });

        const { getRecommendedProductsAction } = await actions();
        const result = await getRecommendedProductsAction(3);

        expect(result.success).toBe(true);
        expect(result.data!.products).toHaveLength(3);
        expect(result.data!.products.map((p) => p.title)).not.toContain('Hidden');
    });

    it('and an empty catalogue gives an empty list, not a failure', async () => {
        const { getRecommendedProductsAction } = await actions();
        const result = await getRecommendedProductsAction(3);

        expect(result.success).toBe(true);
        expect(result.data!.products).toEqual([]);
    });
});

describe('related products', () => {
    it('share the category and exclude the product itself', async () => {
        // Showing a shopper the item they are already looking at, in the "you may
        // also like" row, is the failure this excludes.
        store.seedAll(COLLECTIONS.PRODUCTS, {
            self: product({ title: 'Self', category: 'grains' }),
            sibling: product({ title: 'Sibling', category: 'grains' }),
            other: product({ title: 'Other', category: 'tubers' }),
        });

        const { getRelatedProductsAction } = await actions();
        const result = await getRelatedProductsAction('self', 4);

        const titles = result.data!.products.map((p) => p.title);
        expect(titles).toContain('Sibling');
        expect(titles).not.toContain('Self');
        expect(titles).not.toContain('Other');
    });

    it('and a product that does not exist is reported as not found', async () => {
        // Not an empty list — asserted the other way first. "Related to nothing"
        // and "this product does not exist" are different answers, and the page
        // renders them differently.
        const { getRelatedProductsAction } = await actions();
        const result = await getRelatedProductsAction('missing', 4);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
    });

    it('and the badge on a related product comes from its own seller', async () => {
        // hydrateSellerTrust runs over the whole row set, so a card in the
        // "you may also like" strip shows that seller's badge rather than
        // inheriting the one from the page it is on.
        store.seedAll(COLLECTIONS.PRODUCTS, {
            self: product({ title: 'Self', category: 'grains', sellerId: 'seller-1' }),
            sibling: product({ title: 'Sibling', category: 'grains', sellerId: 'seller-2' }),
        });
        store.seed(COLLECTIONS.USERS, 'seller-2', { businessName: 'Badged', isVerifiedBadge: true });

        const { getRelatedProductsAction } = await actions();
        const result = await getRelatedProductsAction('self', 4);

        const [related] = result.data!.products;
        expect(related.sellerName).toBe('Badged');
        expect(related.sellerVerified).toBe(true);
    });
});
