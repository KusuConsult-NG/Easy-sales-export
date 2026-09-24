/**
 * @jest-environment node
 */

/**
 *   THE OWNER: "when users edit product it never appears on hot deal why?"
 *
 * ── THE WRITE WAS FINE. EVERY SCREEN BUT ONE WAS NOT ────────────────────────
 *
 *   #867 wired a seller's price cut into a hot deal, and the suite that came
 *   with it asserted the wiring by READING THE SOURCE — `expect(src).toContain`
 *   at every end of the chain. Every one of those assertions passed, and not
 *   one of them ran the chain. So this file starts by EXECUTING it: create,
 *   publish, edit the price down, read it back the way a buyer's browse screen
 *   reads it. It survives — which is how the real answer got found, because it
 *   meant the defect was not in the write at all.
 *
 *   IT APPEARED IN EXACTLY ONE PLACE: the "Flash Sales ⚡" category tab on the
 *   buyer's Browse Products page. Three screens that should have shown it did
 *   not, and the seller could reach none of them:
 *
 *     THE PRODUCT PAGE      knew only `isFlashSale`, the Village Market flag.
 *                           A buyer tapping a card that says "20% OFF · Hot
 *                           Deal" landed on one green number with no
 *                           strike-through and a badge reading "In Stock". A
 *                           discount the product page will not corroborate
 *                           reads as a card that lied.
 *
 *     THE SELLER'S OWN LIST printed one price and no offer, so the person who
 *                           made the cut had no screen that confirmed it.
 *
 *     THE SELLER DASHBOARD  linked to Village Market under the words "Flash
 *                           sales hub". It lists timed EVENTS. A seller who cut
 *                           a price and came here to check saw "No Active
 *                           Events" — and concluded, correctly from where they
 *                           were standing, that nothing had happened.
 *
 *   AND A SECOND UPDATE DOOR RECORDED NOTHING. /api/marketplace/update-product
 *   carries `pricingTiers` on its editable list, so it can lower a price, and
 *   it wrote no reduction while the server action wrote one. Two writers
 *   disagreeing about a product field is a shape this codebase has repaired
 *   before; what makes this one hard to see is that the loser writes NOTHING
 *   rather than something wrong.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { isOnOffer, retailPriceOf, discountPercent, MIN_DISCOUNT_PERCENT } from '@/lib/price-reduction';

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

jest.mock('@/lib/storage-admin', () => ({
    uploadFileToStorage: async (_f: unknown, dest: string) => `https://cdn.test/${dest}`,
}));

const code = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const SELLER = 'seller-1';
let store: FakeDbHandle;

function actAs(id: string, roles: string[] = ['seller']) {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: 'bola@example.com', name: 'Bola Ade' } },
        error: null,
    }));
}

/** The fields the seller's edit screen appends, at the price given. */
function editForm(productId: string, retailPrice: string): FormData {
    const fd = new FormData();
    const fields: Record<string, string> = {
        productId,
        title: 'Premium Cocoa',
        description: 'Sun-dried cocoa beans from Ondo, graded and bagged for export.',
        category: 'grains',
        unit: 'kg',
        retailPrice,
        availableQuantity: '100',
        minimumOrderQuantity: '10',
        state: 'Ondo',
        lga: 'Akure',
        nearestMarket: 'Akure Main',
        deliveryMethod: 'pickup',
        bulkAvailable: 'false',
        exportReady: 'false',
        videoUrl: '',
    };
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return fd;
}

/** A published listing at ₦5,000 retail, as an approved product actually sits. */
function seedLiveProduct(id = 'product-1', price = 5_000) {
    store.seed(COLLECTIONS.PRODUCTS, id, {
        id,
        sellerId: SELLER,
        title: 'Premium Cocoa',
        description: 'Sun-dried cocoa beans from Ondo, graded and bagged for export.',
        category: 'grains',
        status: 'active',
        images: ['https://cdn.test/cocoa.jpg'],
        pricingTiers: [{ type: 'retail', price, minQuantity: 1 }],
        availableQuantity: 100,
        minimumOrderQuantity: 10,
        unit: 'kg',
        location: { state: 'Ondo', lga: 'Akure', nearestMarket: 'Akure Main' },
        deliveryMethod: 'pickup',
    });
    return id;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(SELLER);
    store.seed(COLLECTIONS.USERS, SELLER, {
        roles: ['seller'], sellerVerificationStatus: 'approved', email: 'bola@example.com',
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the cut itself, EXECUTED rather than read off the source', () => {
    it('A PRICE CUT THROUGH THE EDIT SCREEN IS RECORDED against the stored row', async () => {
        const id = seedLiveProduct();
        const { updateProductAction } = await import('@/app/actions/marketplace/_mp_products');

        expect(await updateProductAction(null, editForm(id, '4000'))).toMatchObject({ success: true });

        const row = store.get(COLLECTIONS.PRODUCTS, id) as any;
        expect(row.previousPrice).toBe(5_000);
        expect(typeof row.priceReducedAt).toBe('string');
    });

    it('AND IT SURVIVES ALL THE WAY TO A BUYER\'S BROWSE LIST', async () => {
        //   The half the source-reading assertions could not reach. Every
        //   product a buyer sees goes through serializeProduct → ProductSchema,
        //   and z.object strips what it does not declare.
        const id = seedLiveProduct();
        const { updateProductAction } = await import('@/app/actions/marketplace/_mp_products');
        await updateProductAction(null, editForm(id, '4000'));

        const { getProductsAction } = await import('@/app/actions/marketplace/_buyer');
        const listed: any = await getProductsAction({});
        const product = listed.data.products.find((p: any) => p.id === id);

        expect(product.previousPrice).toBe(5_000);
        //   The buyer screen's own verdict, computed from what it was handed.
        expect(isOnOffer(product, retailPriceOf(product.pricingTiers))).toBe(true);
        expect(discountPercent(product, retailPriceOf(product.pricingTiers))).toBe(20);
    });

    it('AND TO THE PRODUCT PAGE, which is where a buyer acts on it', async () => {
        const id = seedLiveProduct();
        const { updateProductAction } = await import('@/app/actions/marketplace/_mp_products');
        await updateProductAction(null, editForm(id, '4000'));

        const { getProductByIdAction } = await import('@/app/actions/marketplace/_mp_catalog');
        const one: any = await getProductByIdAction(id);

        expect(one.data.previousPrice).toBe(5_000);
        expect(isOnOffer(one.data, retailPriceOf(one.data.pricingTiers))).toBe(true);
    });

    it('AND A TRIVIAL CUT STILL IS NOT AN OFFER', async () => {
        //   ₦5,000 → ₦4,900 is 2%, under the shared floor. Run rather than
        //   argued, because the floor is what keeps the section meaningful.
        const id = seedLiveProduct();
        const { updateProductAction } = await import('@/app/actions/marketplace/_mp_products');
        await updateProductAction(null, editForm(id, '4900'));

        const row = store.get(COLLECTIONS.PRODUCTS, id) as any;
        expect(100 - (4900 / 5000) * 100).toBeLessThan(MIN_DISCOUNT_PERCENT);
        expect(row.previousPrice).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the screens that have to agree with it', () => {
    it('THE PRODUCT PAGE SHOWS THE OFFER, not just a Village Market flash price', () => {
        const src = code('src/app/marketplace/products/[id]/ProductDetailClient.tsx');

        expect(src).toContain('isOnOffer(');
        //   A hot deal and a Village Market flash sale are different things and
        //   must stay different: the flash row carries its own `flashPrice`.
        expect(src).toContain('!isFS && isOnOffer(');
        expect(src).toMatch(/line-through/);
        expect(src).toMatch(/% OFF/);
    });

    it('AND THE SELLER\'S OWN LIST SAYS THE CUT TOOK EFFECT', () => {
        //   The person who made the reduction is the one who most needs to see
        //   it, and had no screen that showed it anywhere.
        const src = code('src/app/marketplace/seller/products/SellerProductsClient.tsx');

        expect(src).toContain('isOnOffer(');
        expect(src).toMatch(/HOT DEAL/);
        //   Both render sites — the table and the card grid — or a seller on a
        //   phone sees something different from a seller on a laptop.
        expect(src.match(/offer\.onOffer &&/g)?.length).toBe(2);
    });

    it('AND THE DASHBOARD NO LONGER CALLS VILLAGE MARKET THE FLASH SALES HUB', () => {
        /*
         *   The link opens an EVENTS page. Calling it the flash sales hub is
         *   what sent the owner there to look for a price cut, and "No Active
         *   Events" is what they were shown.
         */
        const src = code('src/app/marketplace/seller/dashboard/SellerDashboardClient.tsx');

        expect(src).not.toContain('>Flash sales hub<');
    });

    it('AND THE BUYER TAB IS UNCHANGED — it was the one that always worked', () => {
        const src = code('src/app/marketplace/buyer/products/BuyerProductsClient.tsx');

        expect(src).toMatch(/isFlashSale === true \|\| \(p as any\)\.isHotDeal === true/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('and the second update door, which recorded nothing', () => {
    it('THE ROUTE RECORDS A CUT IT MAKES, against the stored row', () => {
        const src = code('src/app/api/marketplace/update-product/route.ts');
        const at = src.indexOf('priceReductionPatch(');

        expect(at).toBeGreaterThan(-1);
        //   The previous price comes from the DOCUMENT. `originalPrice` is on
        //   this route's deny-list precisely so it cannot come from the request.
        expect(src.slice(at, at + 200)).toContain('productDoc.data()?.pricingTiers');
    });

    it('AND ONLY WHEN THE PATCH CARRIES A PRICE', () => {
        //   A partial update that never mentions pricingTiers must not clear an
        //   existing offer against a price it did not set.
        const src = code('src/app/api/marketplace/update-product/route.ts');

        expect(src).toContain('Array.isArray(patch.pricingTiers)');
    });

    it('AND IT STILL REFUSES A CLIENT-CLAIMED DISCOUNT', () => {
        //   The whole reason the reduction is derived server-side. If these ever
        //   join the editable list, a seller can invent both halves of a deal.
        const src = code('src/app/api/marketplace/update-product/route.ts');
        const at = src.indexOf('const SELLER_EDITABLE_FIELDS');
        const list = src.slice(at, src.indexOf('] as const', at));

        for (const forbidden of ['"originalPrice"', '"flashPrice"', '"isFlashSale"', '"previousPrice"', '"priceReducedAt"', '"status"']) {
            expect({ forbidden, listed: list.includes(forbidden) }).toEqual({ forbidden, listed: false });
        }
    });
});
