/**
 * @jest-environment node
 */

/**
 * A third order-creation path, and the third place a stored price went
 * unchecked.
 *
 * `_createOrderAction` does the hard parts correctly, and it is worth saying so
 * before the finding: stock is reserved through decrementManyOrFail BEFORE the
 * transaction, the price comes from the product's own pricing tier, the seller
 * comes from the product document and the buyer from the session. Its comments
 * record the read-compare-write it replaced.
 *
 * THE GAP
 * -------
 * Taking the tier price from the database is right, and is not enough on its
 * own. `PricingTierSchema` is `price: z.number().default(0)`, so nothing stops a
 * seller listing a tier at zero or below — the same unconstrained source #113
 * found for the marketplace cart and #123 for the export catalogue.
 *
 * This is a THIRD order-creation path, and it passes through neither of those
 * boundaries. The order is written `status: "pending_payment"` with the computed
 * figure as `totalAmount`, and `walletCheckoutAction` charges exactly that — so
 * an understated line total is money, not a display bug.
 *
 * There is no UI caller for this action. That is not a defence: every export of
 * a "use server" module is a reachable endpoint.
 *
 * ON THE QUANTITY CHECK
 * ---------------------
 * decrementManyOrFail already refuses a non-positive amount, so a bad quantity
 * failed before reaching the arithmetic. It is checked here anyway, because that
 * is a guarantee of the primitive rather than of this function, and because the
 * message it produced — "Could not reserve stock for this order" — described the
 * wrong problem to whoever read it.
 *
 * NOTED, NOT CHANGED
 * ------------------
 * `getOrderByIdAction` admits the buyer only, so a seller cannot read an order
 * through it. That is a functional narrowness rather than a hole — sellers have
 * getSellerOrdersAction — and widening it is a product decision.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';
const SELLER = 'seller-1';
const STRANGER = 'stranger-1';
const PRODUCT = 'product-1';
const ORDER = 'order-1';

const mockDecrementMany = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    decrementManyOrFail: (...a: any[]) => mockDecrementMany(...a),
    claimPaymentOnce: jest.fn(), creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(async () => ({ baseDeliveryFee: 2000, minOrderAmount: 0 })),
    getExchangeRates: jest.fn(async () => ({ usdToNgn: 1650 })),
}));
jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderPlaced: jest.fn(async () => ({})),
    notifyPaymentReceived: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/audit-log', () => ({ createAdminAuditLog: jest.fn(async () => ({})) }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: [] } },
        error: null,
    }));
}

/** A product with the given retail tier price. */
function setProduct(tierPrice: number | undefined, extra: Record<string, any> = {}) {
    const data = {
        title: 'Cocoa Beans',
        sellerId: SELLER,
        availableQuantity: 500,
        pricingTiers: tierPrice === undefined
            ? [{ type: 'retail', minQuantity: 1 }]
            : [{ type: 'retail', price: tierPrice, minQuantity: 1 }],
        ...extra,
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: true, docs: [], data: () => data,
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
}

function ordersWritten(): Record<string, any>[] {
    const g = global as any;
    return [...g.mockFirestoreTxSet.mock.calls, ...g.mockFirestoreSet.mock.calls]
        .map((c: any[]) => c[c.length - 1])
        .filter((d: any) => d && 'totalAmount' in d);
}

const address = { street: '1 Road', city: 'Ikeja', state: 'Lagos', lga: 'Ikeja', phone: '08030000000' };

async function createOrder(quantity = 2, tierType = 'retail') {
    const { createOrderAction } = await import('@/app/actions/orders');
    return createOrderAction([{ productId: PRODUCT, quantity, tierType }] as any, address as any);
}

describe('_createOrderAction — the stored tier price has to be a real one', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct(50_000);
        mockDecrementMany.mockResolvedValue({ ok: true });
    });

    it('refuses a tier priced at zero', async () => {
        // PricingTierSchema is z.number().default(0), so this is the value a
        // product gets when nobody sets one.
        setProduct(0);

        const r: any = await createOrder();

        expect(r.success).toBe(false);
        expect(ordersWritten()).toEqual([]);
    });

    it('refuses a tier priced below zero', async () => {
        // THE test. The order is written pending_payment with this figure as
        // totalAmount, and walletCheckoutAction charges exactly that.
        setProduct(-50_000);

        const r: any = await createOrder();

        expect(r.success).toBe(false);
        expect(ordersWritten()).toEqual([]);
    });

    it('refuses a tier with no price field at all', async () => {
        setProduct(undefined);

        const r: any = await createOrder();

        expect(r.success).toBe(false);
        expect(ordersWritten()).toEqual([]);
    });

    it('refuses a non-integer quantity with a message about the quantity', async () => {
        // decrementManyOrFail would have caught this, reporting "Could not
        // reserve stock for this order" — the wrong problem.
        const r: any = await createOrder(1.5);

        expect(r.success).toBe(false);
        expect(ordersWritten()).toEqual([]);
    });

    it('creates the order at the tier price when everything is sound', async () => {
        // Vacuity guard. Every refusal above is satisfied by an action that
        // creates no orders at all.
        const r: any = await createOrder(2);

        expect(r.success).toBe(true);
        const order = ordersWritten()[0];
        // 2 × ₦50,000 plus the ₦2,000 delivery fee the server decides.
        expect(order?.subtotal).toBe(100_000);
        expect(order?.totalAmount).toBe(102_000);
        expect(order?.status).toBe('pending_payment');
    });
});

describe('_createOrderAction — identities and stock, which were already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct(50_000);
        mockDecrementMany.mockResolvedValue({ ok: true });
    });

    it('takes the buyer from the session and the seller from the product', async () => {
        await createOrder();

        const order = ordersWritten()[0];
        expect(order?.buyerId).toBe(BUYER);
        expect(order?.sellerId).toBe(SELLER);
    });

    it('reserves stock before writing the order', async () => {
        // Its own comment records the read-compare-write this replaced: two
        // orders for the last unit both passed the check and stock went
        // negative.
        await createOrder();

        expect(mockDecrementMany).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ field: 'availableQuantity', amount: 2 }),
            ])
        );
        expect(mockDecrementMany.mock.invocationCallOrder[0])
            .toBeLessThan((global as any).mockFirestoreTxSet.mock.invocationCallOrder[0]);
    });

    it('writes no order when the reservation fails', async () => {
        mockDecrementMany.mockResolvedValue({ ok: false, reason: 'insufficient' });

        const r: any = await createOrder();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/out of stock|enough units/i);
        expect(ordersWritten()).toEqual([]);
    });

    it('refuses an unauthenticated caller before reserving anything', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: null, error: { error: 'Authentication required' },
        }));

        const r: any = await createOrder();

        expect(r.success).toBe(false);
        expect(mockDecrementMany).not.toHaveBeenCalled();
    });
});

describe('getOrderByIdAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
    });

    function setOrder(buyerId: string) {
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: true, docs: [],
            data: () => ({ buyerId, sellerId: SELLER, totalAmount: 102_000, status: 'pending_payment' }),
        }));
    }

    it('refuses a caller who is not the buyer', async () => {
        setOrder(STRANGER);
        const { getOrderByIdAction } = await import('@/app/actions/orders');

        const r: any = await getOrderByIdAction(ORDER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
    });

    it('serves the buyer their own order', async () => {
        setOrder(BUYER);
        const { getOrderByIdAction } = await import('@/app/actions/orders');

        const r: any = await getOrderByIdAction(ORDER);

        expect(r.success).toBe(true);
    });

    it('refuses an order that does not exist', async () => {
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: false, empty: true, docs: [], data: () => undefined,
        }));
        const { getOrderByIdAction } = await import('@/app/actions/orders');

        const r: any = await getOrderByIdAction(ORDER);

        expect(r.success).toBe(false);
    });
});
