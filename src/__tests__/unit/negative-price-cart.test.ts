/**
 * @jest-environment node
 */

/**
 * A cart line could subtract from the order total.
 *
 * `validateCartItems` in marketplace/_payment.ts is the function every purchase
 * passes through. It carefully takes the price from the database — "Force DB
 * price for security" — and then did this:
 *
 *     const itemTotal = effectivePrice * item.quantity;
 *
 * Neither factor was checked.
 *
 * QUANTITY, straight from the client. A negative one subtracts from the order.
 * Mixed with a real item it keeps the total above minOrderAmount while charging
 * the buyer far less than the goods are worth. It does not end in theft:
 * decrementManyOrFail refuses a non-positive amount, so verification throws at
 * the stock step — AFTER claimPaymentOnce has claimed the reference. The buyer
 * is charged, no escrow is written, no order exists, and a retry is a no-op
 * because the reference is spent. A charge with no order and no automatic refund
 * is still a defect.
 *
 * PRICE, from the database, which is not the same as being trustworthy. Nothing
 * that writes a price requires it to be positive: PricingTierSchema is
 * `price: z.number().default(0)`, and addFlashSaleProductAction wrote
 * `data.price` straight through, so any seller who joined a Village Market event
 * could list at a negative price.
 *
 * That one is worse, because nothing downstream refuses it. The quantity stays
 * positive, so the stock decrement succeeds and the order completes. Per-seller
 * escrows are built as `sellerTotals[sellerId] += itemTotal`, so the attacker's
 * escrow is negative while a co-seller's is whole — the buyer pays the reduced
 * total and the platform still owes the second seller in full.
 *
 * WHERE THE FIX GOES
 * ------------------
 * Both places. The source, addFlashSaleProductAction, because that is where an
 * impossible price was accepted. And the boundary, validateCartItems, because
 * flash sales are not the only way a price is written — the tier schema defaults
 * to zero and validates nothing, and every purchase in the system goes through
 * this one function.
 *
 * Zero is refused alongside negative: an order line worth nothing is either a
 * mistake or a way to move stock without paying for it.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const EVENT = 'event-1';
const PRODUCT = 'prod-1';

const mockInitPaystack = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/paystack-server', () => ({
    initializePaystackPayment: (...a: any[]) => mockInitPaystack(...a),
    verifyPaystackPayment: jest.fn(),
    verifyPaystackWebhook: jest.fn(),
}));
jest.mock('@/lib/wallet-ledger', () => ({
    claimPaymentOnce: jest.fn(async () => ({ claimed: true })),
    decrementManyOrFail: jest.fn(async () => ({ ok: true })),
    creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(), debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(async () => ({ minOrderAmount: 1000, escrowFeePercent: 0, deliveryBaseFee: 2000 })),
}));
jest.mock('@/lib/rate-limiter', () => ({
    rateLimit: () => ({ check: jest.fn(async () => ({ success: true, limit: 100, remaining: 99, reset: 0 })) }),
    getClientIp: jest.fn(() => '127.0.0.1'),
    createRateLimitResponse: jest.fn(),
}));
jest.mock('@/lib/server-utils', () => ({ getBaseUrl: jest.fn(async () => 'https://test.local') }));
/**
 * These must return promises, not undefined.
 *
 * The action calls `notifyOrderPlaced(...).catch(...)` as a post-commit side
 * effect, so a bare jest.fn() makes it throw "Cannot read properties of
 * undefined (reading 'catch')" — AFTER the charge, which the action then
 * reports as a plain failure.
 *
 * Every refusal test above would still have passed, because they assert the
 * charge did not happen and it genuinely did not. Only the success case caught
 * it. That is the entire reason for having one.
 */
jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderPlaced: jest.fn(async () => ({})),
    notifyPaymentReceived: jest.fn(async () => ({})),
    notifyVillageMarketCreated: jest.fn(async () => ({})),
}));
jest.mock('@/infrastructure/notifications/service', () => ({ createNotification: jest.fn(async () => ({})) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

function setSession(id: string, roles: string[] = []) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/** One product in the database, at whatever price the test needs. */
function setProduct(data: Record<string, any>) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: PRODUCT, ref: { id: PRODUCT }, data: () => data }],
        ref: { id: PRODUCT },
        data: () => data,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

const location = { state: 'Lagos', city: 'Ikeja', street: '1 Road', isWithinCityCenter: true };

/**
 * The real signature is (cartItems, buyerEmail, buyerPhone, deliveryFee,
 * location) — five arguments. The first version of this helper passed two and
 * the tests still went green, because the missing ones only affect the delivery
 * fee and the Paystack customer fields, not the line-total arithmetic under
 * test. tsc caught it; the suite would not have.
 *
 * deliveryFee is passed as 0 deliberately: the action recomputes it server-side
 * and ignores the argument, which the success case below asserts.
 */
async function checkout(items: any[]) {
    const { initializeOrderPaymentAction } = await import('@/app/actions/marketplace/_payment');
    return initializeOrderPaymentAction(items as any, 'buyer@e.com', '08030000000', 0, location as any);
}

describe('validateCartItems — neither factor of the line total is trusted', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct({ title: 'Cocoa', sellerId: SELLER, price: 50_000, availableQuantity: 100 });
        mockInitPaystack.mockResolvedValue({ status: true, data: { authorization_url: 'https://pay', reference: 'ref-1' } });
    });

    it('refuses a negative quantity, and charges nothing', async () => {
        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: -5, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a zero quantity', async () => {
        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 0, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a fractional quantity', async () => {
        // Stock is decremented by this number, and a fractional decrement of a
        // whole-unit product is not a thing the rest of the system models.
        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 1.5, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a negative quantity even when the order total stays positive', async () => {
        // THE quantity test. A wholly negative order is already stopped by the
        // minOrderAmount floor; this is the version that gets past it, and it is
        // the one that was exploitable.
        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 10, unit: 'kg', sellerId: SELLER },
            { id: PRODUCT, title: 'Cocoa', quantity: -9, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a product stored at a negative price', async () => {
        // THE price test. Unlike a bad quantity this one completes: the stock
        // decrement succeeds and the order is created with a negative escrow for
        // that seller.
        setProduct({ title: 'Cocoa', sellerId: SELLER, price: -95_000, availableQuantity: 100 });

        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 1, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a flash-sale item stored at a negative flash price', async () => {
        setProduct({ title: 'Cocoa', sellerId: SELLER, price: 50_000, flashPrice: -40_000 });

        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 1, unit: 'kg', sellerId: SELLER, isFlashSale: true },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('refuses a product with no price at all', async () => {
        // dbPrice falls back to 0 through a chain of `||`, so a product missing
        // every price field was previously free.
        setProduct({ title: 'Cocoa', sellerId: SELLER, availableQuantity: 100 });

        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 1, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(false);
        expect(mockInitPaystack).not.toHaveBeenCalled();
    });

    it('still charges a normal order the database price', async () => {
        // Vacuity guard. Every refusal above is satisfied by a checkout that
        // charges nobody, which would take the marketplace offline.
        const r: any = await checkout([
            { id: PRODUCT, title: 'Cocoa', quantity: 2, unit: 'kg', sellerId: SELLER },
        ]);

        expect(r.success).toBe(true);
        expect(mockInitPaystack).toHaveBeenCalled();

        // 2 × ₦50,000 = ₦100,000 of goods, plus a ₦2,000 delivery fee the
        // ACTION computes itself — `deliveryFee: 0` was passed in and ignored,
        // which is the right behaviour and worth pinning: a caller-supplied
        // delivery fee would be another way to reduce what is charged.
        const koboCharged = (mockInitPaystack.mock.calls[0] as any[])[1];
        expect(koboCharged).toBe((100_000 + 2_000) * 100);
    });
});

describe('addFlashSaleProductAction — an impossible price is refused at the source', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(SELLER, ['seller']);
        // The seller has joined the event, which is the pre-existing guard.
        setProduct({ participantSellerIds: [SELLER], title: 'Event' });
    });

    async function addProduct(overrides: Record<string, any> = {}) {
        const { addFlashSaleProductAction } = await import('@/app/actions/village-market');
        return addFlashSaleProductAction({
            eventId: EVENT, title: 'Cocoa', price: 50_000, ...overrides,
        } as any);
    }

    function writtenProduct(): Record<string, any> | undefined {
        return (global as any).mockFirestoreAdd.mock.calls
            .map((c: any[]) => c[c.length - 1])
            .find((d: any) => d && 'sellerId' in d);
    }

    it('refuses a negative price', async () => {
        const r: any = await addProduct({ price: -95_000 });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/greater than zero/i);
        expect(writtenProduct()).toBeUndefined();
    });

    it('refuses a zero price', async () => {
        const r: any = await addProduct({ price: 0 });

        expect(r.success).toBe(false);
        expect(writtenProduct()).toBeUndefined();
    });

    it('refuses a negative flash price', async () => {
        const r: any = await addProduct({ price: 50_000, flashPrice: -1 });

        expect(r.success).toBe(false);
        expect(writtenProduct()).toBeUndefined();
    });

    it('refuses a flash price above the normal price', async () => {
        // Not a money defect — just not a sale. Cheap to refuse where the other
        // price checks already are.
        const r: any = await addProduct({ price: 50_000, flashPrice: 60_000 });

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/higher than/i);
    });

    it('still records the seller from the session, not the caller', async () => {
        // Pre-existing and correct: sellerId comes from the session, so a seller
        // cannot list on somebody else's behalf. Must survive the change.
        const r: any = await addProduct({ price: 50_000, flashPrice: 40_000 });

        expect(r.success).toBe(true);
        expect(writtenProduct()?.sellerId).toBe(SELLER);
        expect(writtenProduct()?.price).toBe(50_000);
        expect(writtenProduct()?.flashPrice).toBe(40_000);
    });

    it('still refuses a seller who has not joined the event', async () => {
        // The other pre-existing guard.
        setProduct({ participantSellerIds: ['somebody-else'], title: 'Event' });

        const r: any = await addProduct();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/join the event/i);
    });
});
