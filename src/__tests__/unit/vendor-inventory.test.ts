/**
 * @jest-environment node
 */

/**
 * vendor.ts — mostly already hardened, with one thing left in the arithmetic.
 *
 * All four writers verify ownership, and their comments record when that was
 * added: `productId` used to arrive from the caller unchecked, so any signed-in
 * user could set any vendor's stock or flip their listings. The order-status
 * updater validates against a runtime whitelist, with a comment noting that
 * `status: VendorOrder["status"]` is a TypeScript annotation and nothing more.
 * Those properties are asserted here so they cannot quietly regress.
 *
 * WHAT WAS LEFT
 * -------------
 * `stockChange` was not validated, and the three operations disagreed about
 * what to do with the result:
 *
 *     case "add":      newStock = currentStock + stockChange;      // no clamp
 *     case "subtract": newStock = Math.max(0, currentStock - stockChange);
 *     case "set":      newStock = stockChange;                     // no clamp
 *
 * So `set` with -5, or `add` with -100, drove stock below zero — and a
 * non-numeric value turned the addition into string concatenation.
 *
 * Then:
 *
 *     const status = newStock === 0 ? "out_of_stock" : "active";
 *
 * which labels NEGATIVE stock as **active**. A product nobody can buy stays
 * listed as available.
 *
 * WHY THAT IS MORE THAN A VENDOR'S OWN MISTAKE
 * --------------------------------------------
 * It is the vendor's own product, so the obvious framing is self-harm. The
 * buyer is the one who pays for it: a listing marked active is reachable at
 * checkout, and the stock decrement does not run until verification — AFTER
 * claimPaymentOnce has claimed the payment reference. decrementManyOrFail then
 * refuses, the order is never created, and the buyer is left with a charge, no
 * order, and a spent reference that makes a retry a no-op.
 *
 * That is the same failure #113 and #123 describe from the other direction.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const VENDOR = 'vendor-1';
const OTHER_VENDOR = 'vendor-2';
const PRODUCT = 'product-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles: ['seller'] } },
        error: null,
    }));
}

function setProduct(stock: number, vendorId = VENDOR) {
    const data = { vendorId, stock, status: 'active', title: 'Cocoa', _version: 1 };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => data,
    }));
}

function stockWrite(): Record<string, any> | undefined {
    const g = global as any;
    return [...g.mockFirestoreUpdate.mock.calls, ...g.mockFirestoreTxUpdate.mock.calls]
        .map((c: any[]) => c[c.length - 1])
        .find((p: any) => p && 'stock' in p);
}

async function setInventory(change: any, operation: 'add' | 'subtract' | 'set') {
    const { updateVendorProductInventoryAction } = await import('@/app/actions/vendor');
    return updateVendorProductInventoryAction(PRODUCT, change, operation);
}

describe('stock is a quantity, so it never goes below zero', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(VENDOR);
        setProduct(100);
    });

    it('refuses a negative value on "set"', async () => {
        // `set` had no clamp at all, unlike `subtract`.
        const r: any = await setInventory(-5, 'set');

        expect(r.success).toBe(false);
        expect(stockWrite()).toBeUndefined();
    });

    it('refuses a negative value on "add"', async () => {
        // "add -100" is a subtraction wearing the wrong name, and it bypassed
        // the clamp that subtract has.
        const r: any = await setInventory(-100, 'add');

        expect(r.success).toBe(false);
        expect(stockWrite()).toBeUndefined();
    });

    it('coerces a numeric string rather than concatenating it', async () => {
        // `currentStock + stockChange` with a string is concatenation: 100 + "5"
        // is "1005".
        const r: any = await setInventory('5' as any, 'add');

        expect(r.success).toBe(true);
        expect(stockWrite()?.stock).toBe(105);
        expect(stockWrite()?.stock).not.toBe('1005');
    });

    it('refuses a non-finite value', async () => {
        const r: any = await setInventory(Number.NaN, 'set');

        expect(r.success).toBe(false);
        expect(stockWrite()).toBeUndefined();
    });

    it('still sets a legitimate figure', async () => {
        // Vacuity guard. Refusing everything would leave vendors unable to
        // manage stock at all.
        const r: any = await setInventory(250, 'set');

        expect(r.success).toBe(true);
        expect(stockWrite()?.stock).toBe(250);
    });

    it('still clamps a subtraction at zero rather than failing', async () => {
        // Pre-existing behaviour, and the sensible one: selling the last unit
        // twice should floor the stock, not error.
        const r: any = await setInventory(500, 'subtract');

        expect(r.success).toBe(true);
        expect(stockWrite()?.stock).toBe(0);
    });
});

describe('a product with no stock is not listed as available', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(VENDOR);
        setProduct(100);
    });

    it('marks zero stock out_of_stock', async () => {
        const r: any = await setInventory(0, 'set');

        expect(r.success).toBe(true);
        expect(stockWrite()?.status).toBe('out_of_stock');
    });

    it('marks a stock that reaches zero by subtraction out_of_stock', async () => {
        await setInventory(100, 'subtract');

        expect(stockWrite()?.status).toBe('out_of_stock');
    });

    it('marks a positive stock active', async () => {
        await setInventory(10, 'set');

        expect(stockWrite()?.status).toBe('active');
    });
});

describe('ownership, which was already right', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(VENDOR);
    });

    it('refuses inventory changes to another vendor\'s product', async () => {
        // The comment in this function records when that check was added:
        // productId arrived from the caller and was used unchecked, so anyone
        // could zero a competitor's stock.
        setProduct(100, OTHER_VENDOR);

        const r: any = await setInventory(0, 'set');

        expect(r.success).toBe(false);
        expect(stockWrite()).toBeUndefined();
    });

    it('refuses toggling another vendor\'s product', async () => {
        setProduct(100, OTHER_VENDOR);
        const { toggleVendorProductStatusAction } = await import('@/app/actions/vendor');

        const r: any = await toggleVendorProductStatusAction(PRODUCT);

        expect(r.success).toBe(false);
    });

    it('refuses deleting another vendor\'s product', async () => {
        setProduct(100, OTHER_VENDOR);
        const { deleteVendorProductAction } = await import('@/app/actions/vendor');

        const r: any = await deleteVendorProductAction(PRODUCT);

        expect(r.success).toBe(false);
    });

    it('lets a vendor manage their own product, so the refusals are not vacuous', async () => {
        setProduct(100, VENDOR);
        const { toggleVendorProductStatusAction } = await import('@/app/actions/vendor');

        const r: any = await toggleVendorProductStatusAction(PRODUCT);

        expect(r.success).toBe(true);
    });
});
