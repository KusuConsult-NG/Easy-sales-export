/**
 * @jest-environment node
 */

/**
 * _createOrderAction could oversell.
 *
 * WHAT WAS WRONG
 * --------------
 *     if (product.availableQuantity < item.quantity) throw "OUT OF STOCK";
 *     ...
 *     transaction.update(ref, {
 *         availableQuantity: product.availableQuantity - item.quantity,
 *     });
 *
 * `runTransaction` in this codebase takes no lock — it replays queued writes
 * after the callback returns. So two buyers ordering the last unit both read
 * `availableQuantity: 1`, both pass the check, and both write `0`.
 *
 * **Two orders, one unit.**
 *
 * THE PRIMITIVE ALREADY EXISTED
 * -----------------------------
 * `decrementManyOrFail` (migration 015) applies the check and the decrement in
 * a single statement, and is all-or-nothing across items — the per-item
 * alternative leaves the first products decremented when the third turns out to
 * be short.
 *
 * `marketplace/_payment.ts` was converted to it earlier in this work. This path
 * was not. One copy of a path fixed and its sibling left, which is the shape
 * this codebase keeps producing — and the reason a scanner found this rather
 * than a person reading the file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const BUYER = 'buyer-1';

const mockDecrement = jest.fn() as jest.Mock<any>;

jest.mock('@/lib/wallet-ledger', () => ({
    decrementManyOrFail: (...a: any[]) => mockDecrement(...a),
    claimPaymentOnce: jest.fn(), creditWalletOnce: jest.fn(), debitWalletOnce: jest.fn(),
    debitWalletLocked: jest.fn(), debitJsonbBalance: jest.fn(), debitJsonbBalanceWithFloor: jest.fn(),
    claimVersionedUpdate: jest.fn(), claimIdempotencyKey: jest.fn(),
    incrementWithinCeiling: jest.fn(), claimSingleOpenLoanApplication: jest.fn(),
}));
jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({ createNotificationAction: jest.fn(async () => ({})) }));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, roles: [] } },
        error: null,
    }));
}

/** One product, `stock` units, one pricing tier. */
function setProduct(stock: number) {
    const doc = {
        exists: true, empty: false, docs: [],
        data: () => ({
            title: 'Yams', sellerId: 'seller-1', availableQuantity: stock,
            pricingTiers: [{ type: 'retail', price: 1000 }],
        }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(doc));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(doc));
}

async function order(quantity = 1) {
    const { createOrderAction } = await import('@/app/actions/orders');
    return createOrderAction(
        [{ productId: 'prod-1', quantity, tierType: 'retail' }] as any,
        { street: 's', city: 'c', state: 'st', lga: 'l', phone: '0800' }
    );
}

/** Every product patch written inside the transaction. */
function productPatches(): Record<string, any>[] {
    return [
        ...(global as any).mockFirestoreTxUpdate.mock.calls,
        ...(global as any).mockFirestoreUpdate.mock.calls,
    ].map((c: any[]) => c[1]).filter(Boolean);
}

describe('_createOrderAction stock handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(BUYER);
        setProduct(5);
        mockDecrement.mockResolvedValue({ ok: true, failedId: null, reason: null });
    });

    it('reserves stock through the atomic primitive', async () => {
        // THE test. Without this the decrement is a read-modify-write and two
        // concurrent orders both succeed against one unit.
        await order(2);

        expect(mockDecrement).toHaveBeenCalledTimes(1);
        const [items] = mockDecrement.mock.calls[0] as [any[]];
        expect(items).toEqual([
            expect.objectContaining({ id: 'prod-1', field: 'availableQuantity', amount: 2 }),
        ]);
    });

    it('never writes availableQuantity itself', async () => {
        // The lost update, precisely. Writing a computed total here would undo
        // the reservation whatever the primitive did.
        await order(2);

        for (const patch of productPatches()) {
            expect(patch).not.toHaveProperty('availableQuantity');
        }
    });

    it('refuses the order when the reservation fails', async () => {
        mockDecrement.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'insufficient' });

        const r: any = await order(99);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/out of stock|enough units/i);
    });

    it('creates nothing when the reservation fails', async () => {
        // Reserved BEFORE the order rows are written, so a failure leaves no
        // half-made order behind.
        mockDecrement.mockResolvedValue({ ok: false, failedId: 'prod-1', reason: 'insufficient' });

        await order(99);

        expect((global as any).mockFirestoreTxSet).not.toHaveBeenCalled();
    });

    it('still creates the order when stock is available', async () => {
        // Vacuity guard: every assertion above is satisfied by an action that
        // refuses everything, which would stop the marketplace working.
        const r: any = await order(1);

        expect(r.success).toBe(true);
        expect(mockDecrement).toHaveBeenCalledTimes(1);
    });

    it('reserves before writing the order rows', async () => {
        // Order matters: reserving after the rows exist means an out-of-stock
        // order has already been created by the time anyone finds out.
        await order(1);

        const reserveAt = mockDecrement.mock.invocationCallOrder[0];
        const writeAt = (global as any).mockFirestoreTxSet.mock.invocationCallOrder[0];

        expect(reserveAt).toBeLessThan(writeAt);
    });
});
