/**
 * @jest-environment node
 */

/**
 * "Product not found" about a listing that was there the whole time.
 *
 *   THE OWNER: "when checking out a product on marketplace, it throws an error
 *   of product not found why?"
 *
 *   Because the checkout told the server to look in the wrong table.
 *
 *   A village-market line is a row in FLASH_SALE_PRODUCTS, not PRODUCTS, and
 *   `validateCartItems` picks which one to read from `item.isFlashSale` alone:
 *
 *       const col = item.isFlashSale === true
 *           ? COLLECTIONS.FLASH_SALE_PRODUCTS
 *           : COLLECTIONS.PRODUCTS;
 *       const productDoc = await db.collection(col).doc(item.id).get();
 *       if (!productDoc.exists) throw new Error(`Product not found: ${item.title}`);
 *
 *   Add-to-cart writes the flag — BuyerProductsClient and
 *   VillageMarketEventClient both set `isFlashSale: true` — and the checkout
 *   page then built its `CartItem[]` twice, once to price delivery and once to
 *   take payment, and BOTH literals dropped it.
 *
 *   NOTHING COULD HAVE CAUGHT THAT. `Product` does not declare `isFlashSale`,
 *   so inside the checkout the value was invisible to TypeScript even though it
 *   was sitting in the object; and `CartItem.isFlashSale` is optional, so
 *   omitting it is legal. A type that is optional on the receiving end and
 *   absent on the sending end type-checks perfectly and loses the field.
 *
 *   So the id went to PRODUCTS, where a flash-sale id does not exist, and the
 *   buyer was refused — for a listing in the next table over.
 *
 * WHY THIS TEST RUNS THE MAPPING INSTEAD OF READING IT.
 *
 *   The defect was two object literals disagreeing with a third file. Asserting
 *   on their source would have to be rewritten every time the literals move,
 *   and would still pass if a THIRD mapping appeared. `toCartItems` is now the
 *   one mapping both doors call, so this feeds its real output into the real
 *   validator and asks the question the buyer asks: does the checkout go
 *   through?
 *
 *   Verified by mutation: dropping `isFlashSale` from toCartItems restores
 *   "Product not found: Yam Tubers (Village Market)".
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { toCartItems, type CheckoutCartLine } from '@/lib/marketplace-checkout-cart';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));
jest.mock('@/lib/auth', () => ({
    auth: async () => null, signIn: async () => undefined,
    signOut: async () => undefined, handlers: {},
}));

let store: FakeDbHandle;

const VILLAGE_LINE: CheckoutCartLine = {
    id: 'flash-1',
    title: 'Yam Tubers (Village Market)',
    sellerId: 'seller-1',
    unit: 'tuber',
    quantity: 2,
    pricingTiers: [{ type: 'retail', price: 1500 }],
    isFlashSale: true,
    eventId: 'event-9',
};

const ORDINARY_LINE: CheckoutCartLine = {
    id: 'prod-1',
    title: 'Sorghum',
    sellerId: 'seller-1',
    unit: 'bag',
    quantity: 1,
    pricingTiers: [{ type: 'retail', price: 9000 }],
};

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();

    //   The village-market row lives HERE, which is the whole point.
    //   A flash-sale row prices itself with `flashPrice`, not pricingTiers —
    //   marketplace-cart reads `flashPrice || price` for this collection.
    store.seed(COLLECTIONS.FLASH_SALE_PRODUCTS, 'flash-1', {
        title: 'Yam Tubers (Village Market)', sellerId: 'seller-1', status: 'active',
        availableQuantity: 50, flashPrice: 1500,
    });
    store.seed(COLLECTIONS.PRODUCTS, 'prod-1', {
        title: 'Sorghum', sellerId: 'seller-1', status: 'active',
        availableQuantity: 10, pricingTiers: [{ type: 'retail', price: 9000 }],
    });
});

describe('the listing was in the other table', () => {
    it('A VILLAGE-MARKET LINE CHECKS OUT — it is not "Product not found"', async () => {
        const { validateCartItems } = await import('@/lib/marketplace-cart');

        const result = await validateCartItems(toCartItems([VILLAGE_LINE]), 'buyer-1');

        expect(result.validatedItems).toHaveLength(1);
        expect(result.subtotal).toBe(3000);
    });

    it('THE FLAG SURVIVES THE MAPPING — the server is told which table to read', () => {
        const [line] = toCartItems([VILLAGE_LINE]);

        expect(line.isFlashSale).toBe(true);
        expect(line.eventId).toBe('event-9');
    });

    it('AN ORDINARY LINE IS NOT MARKED, so it still reads PRODUCTS', async () => {
        const [line] = toCartItems([ORDINARY_LINE]);
        expect(line.isFlashSale).toBeUndefined();

        const { validateCartItems } = await import('@/lib/marketplace-cart');
        const result = await validateCartItems(toCartItems([ORDINARY_LINE]), 'buyer-1');

        expect(result.subtotal).toBe(9000);
    });

    it('A MIXED CART GOES THROUGH — both tables, one checkout', async () => {
        const { validateCartItems } = await import('@/lib/marketplace-cart');

        const result = await validateCartItems(
            toCartItems([VILLAGE_LINE, ORDINARY_LINE]), 'buyer-1');

        expect(result.validatedItems).toHaveLength(2);
        expect(result.subtotal).toBe(12000);
    });

    it('AN ID THAT IS GENUINELY ABSENT IS STILL REFUSED — the guard is not weakened', async () => {
        const { validateCartItems } = await import('@/lib/marketplace-cart');

        await expect(
            validateCartItems(toCartItems([{ ...ORDINARY_LINE, id: 'no-such-row' }]), 'buyer-1'),
        ).rejects.toThrow(/Product not found/);
    });
});
