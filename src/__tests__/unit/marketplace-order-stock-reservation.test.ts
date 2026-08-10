/**
 * @jest-environment node
 */

/**
 * Marketplace order creation — the two doors that still oversold stock.
 *
 * WHAT WAS WRONG
 * --------------
 * Three paths in marketplace/_payment.ts decrement product stock. The Paystack
 * one was converted during the atomic-money migration and carries a long
 * comment explaining why (decrementManyOrFail, all-or-nothing, migration 015).
 * Its two siblings kept the pre-fix shape verbatim:
 *
 *     if (currentQty < item.quantity) { throw new Error(`Insufficient stock...`); }
 *     ...
 *     transaction.update(productRef, {
 *         availableQuantity: FieldValue.increment(-item.quantity), ...
 *     });
 *
 * inside runTransaction, which takes no lock. Two DIFFERENT orders for the last
 * unit both passed and stock went negative. atomic-money-migration.md lists the
 * file as "payment claim and stock reservation converted; 3 order-creation
 * transitions remain" — classifying the remainder as status-only. Two of the
 * three move real inventory.
 *
 * The per-item loop was also not all-or-nothing: a three-item order short on the
 * third item left the first two decremented. That is the specific reason
 * decrement_many_or_fail takes the whole order and locks every row in id order.
 *
 * Lower severity than the Paystack path, and worth being straight about why: no
 * money is taken at order time on either of these, so an oversell produces an
 * order that cannot ship rather than a payment with nothing behind it. It still
 * corrupts availableQuantity, which is shared with the Paystack path.
 *
 * See docs/audit/integrity-sweep-2026-08-10.md (F5).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockDecrementMany = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    decrementManyOrFail: (...args: any[]) => mockDecrementMany(...args),
    claimPaymentOnce: jest.fn(),
    creditWalletOnce: jest.fn(),
    debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(),
    debitJsonbBalance: jest.fn(),
    incrementWithinCeiling: jest.fn(),
}));

jest.mock('next/cache', () => ({
    unstable_cache: (fn: any) => fn,
    revalidatePath: jest.fn(),
}));

jest.mock('@/lib/system-settings', () => ({
    getPlatformFees: jest.fn(() => Promise.resolve({
        baseDeliveryFee: 1500,
        additionalItemFee: 200,
        minOrderAmount: 1000,
        maxOrderAmount: 500000,
    })),
}));

jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderPlaced: jest.fn(() => Promise.resolve()),
    notifyPaymentReceived: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/infrastructure/notifications/service', () => ({
    createNotification: jest.fn(() => Promise.resolve()),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['user'] } },
        error: null,
    }));
}

/**
 * Every .get() returns a doc that satisfies both shapes the order paths read:
 * a product (price, stock, seller) and a seller who allows payment on delivery.
 */
function setDocs(overrides: Record<string, any> = {}) {
    const snap = {
        exists: true,
        docs: [],
        empty: false,
        data: () => ({
            title: 'Yam Tubers',
            sellerId: 'seller-1',
            price: 1000,
            pricingTiers: [{ type: 'retail', price: 1000 }],
            availableQuantity: 40,
            allowsPaymentOnDelivery: true,
            ...overrides,
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

const cart = [{
    id: 'prod-1',
    title: 'Yam Tubers',
    sellerId: 'seller-1',
    price: 1000,
    quantity: 3,
    unit: 'kg',
    selectedTier: 'retail' as const,
    addedAt: new Date(),
}];

/** Any surviving write of the stock field, on either spy. */
function stockWrites() {
    const direct = ((global as any).mockFirestoreUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'availableQuantity' in f);
    const inTx = ((global as any).mockFirestoreTxUpdate.mock.calls as any[])
        .filter(([, f]) => f && 'availableQuantity' in f);
    return [...direct, ...inTx];
}

function orderWrites() {
    return ((global as any).mockFirestoreTxSet.mock.calls as any[]);
}

describe('createBankTransferOrderAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('buyer-1');
        setDocs();
        mockDecrementMany.mockResolvedValue({ ok: true, failedId: null, reason: null });
    });

    async function order() {
        const { createBankTransferOrderAction } = await import('@/app/actions/marketplace/_payment');
        return createBankTransferOrderAction(cart as any, 'buyer@example.com', '08000000000', 0);
    }

    it('reserves the whole order through the all-or-nothing primitive', async () => {
        await order();

        expect(mockDecrementMany).toHaveBeenCalledTimes(1);
        expect(mockDecrementMany).toHaveBeenCalledWith([
            expect.objectContaining({
                collection: 'products',
                id: 'prod-1',
                field: 'availableQuantity',
                amount: 3,
            }),
        ]);
    });

    it('never decrements availableQuantity itself', async () => {
        // The in-transaction decrement had to be REMOVED, not left alongside the
        // reservation — keeping both would take stock twice.
        await order();

        expect(stockWrites()).toHaveLength(0);
    });

    it('creates no order when stock is short', async () => {
        mockDecrementMany.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'insufficient' });

        const result: any = await order();

        expect(result.success).toBe(false);
        expect(result.error).toContain('Yam Tubers');
        expect(orderWrites()).toHaveLength(0);
    });

    it('reports a withdrawn product differently from a sold-out one', async () => {
        mockDecrementMany.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'not_found' });

        const result: any = await order();

        expect(result.success).toBe(false);
        expect(result.error).toContain('no longer available');
    });

    it('reserves before the order row is written', async () => {
        const order_: string[] = [];
        mockDecrementMany.mockImplementation(() => {
            order_.push('reserve');
            return Promise.resolve({ ok: true, failedId: null, reason: null });
        });
        (global as any).mockFirestoreTxSet.mockImplementation(() => {
            order_.push('order');
            return Promise.resolve();
        });

        await order();

        // Assert both happened before asserting order: without this the pre-fix
        // code passes trivially, since it never reserves and indexOf returns -1.
        expect(order_).toContain('reserve');
        expect(order_).toContain('order');
        expect(order_.indexOf('reserve')).toBeLessThan(order_.indexOf('order'));
    });
});

describe('createPaymentOnDeliveryOrderAction', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession('buyer-1');
        setDocs();
        mockDecrementMany.mockResolvedValue({ ok: true, failedId: null, reason: null });
    });

    async function order() {
        const { createPaymentOnDeliveryOrderAction } = await import('@/app/actions/marketplace/_payment');
        return createPaymentOnDeliveryOrderAction(cart as any, '08000000000', {
            recipientName: 'Ada Obi',
            recipientPhone: '08000000000',
            street: '1 Market Rd',
            city: 'Enugu',
            state: 'Enugu',
            lga: 'Enugu North',
        });
    }

    it('reserves the whole order through the all-or-nothing primitive', async () => {
        await order();

        expect(mockDecrementMany).toHaveBeenCalledWith([
            expect.objectContaining({
                collection: 'products',
                id: 'prod-1',
                field: 'availableQuantity',
                amount: 3,
            }),
        ]);
    });

    it('never decrements availableQuantity itself', async () => {
        await order();

        expect(stockWrites()).toHaveLength(0);
    });

    it('creates no order when stock is short', async () => {
        mockDecrementMany.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'insufficient' });

        const result: any = await order();

        expect(result.success).toBe(false);
        expect(orderWrites()).toHaveLength(0);
    });

    it('still refuses a seller who does not offer payment on delivery', async () => {
        // The authorisation check must keep running before anything is reserved.
        setDocs({ allowsPaymentOnDelivery: false });

        const result: any = await order();

        expect(result.success).toBe(false);
        expect(mockDecrementMany).not.toHaveBeenCalled();
    });
});
