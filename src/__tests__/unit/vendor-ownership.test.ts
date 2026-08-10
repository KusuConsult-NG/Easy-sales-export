/**
 * @jest-environment node
 */

/**
 * Vendor actions acted on records they did not own.
 *
 * WHAT WAS WRONG
 * --------------
 * Four functions in vendor.ts take an id from the caller and write to that
 * record. Exactly one checked that the record belonged to the caller:
 *
 *   _updateVendorOrderStatusAction(orderId)        no check
 *   _updateVendorProductInventoryAction(productId) no check
 *   _toggleVendorProductStatusAction(productId)    no check
 *   _deleteVendorProductAction(productId)          CHECKED
 *
 * The least damaging of the four was the only guarded one. Any authenticated
 * user could set any vendor's stock — zero it to take a competitor's listing
 * offline, or inflate it to force overselling — deactivate any product, and set
 * the status of any marketplace order.
 *
 * `session.user.id` appears in all four. In three of them it is only written
 * into the audit row, which records who did it without ever deciding whether
 * they may. That is why a sweep for "does this function reference the session"
 * finds nothing: the reference is there, it just is not a check.
 *
 * TWO MORE THINGS THE SAME READING FOUND
 * --------------------------------------
 * The order writer took `status: VendorOrder["status"]`, which is a TypeScript
 * annotation and nothing else — this is a server action, the argument crosses
 * the wire, and the type is erased. Any string reached transaction.update on a
 * collection whose status drives fulfilment and escrow.
 *
 * And `_getVendorOrdersAction` queried `.where("vendorId", ...)` on marketplace
 * orders. Nothing writes vendorId to an order; they carry sellerId/sellerIds.
 * The vendor order list has therefore always been empty.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const OWNER = 'vendor-owner';
const ATTACKER = 'vendor-attacker';

/** Records the callback withOptimisticLock is given, and whether it threw. */
const lockCallbacks: Array<(tx: any, data: any) => void> = [];
let lockedDoc: Record<string, any> = {};

jest.mock('@/lib/data-integrity', () => ({
    withOptimisticLock: async (_ref: any, _v: any, cb: any) => {
        lockCallbacks.push(cb);
        return cb({ update: jest.fn() }, lockedDoc);
    },
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, name: id, email: `${id}@example.com`, roles: ['seller'] } },
        error: null,
    }));
}

describe('vendor.ts ownership', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        lockCallbacks.length = 0;
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, empty: false, docs: [], data: () => lockedDoc,
        }));
    });

    describe('_updateVendorProductInventoryAction', () => {
        beforeEach(() => { lockedDoc = { vendorId: OWNER, stock: 100, status: 'active' }; });

        it('refuses a caller who does not own the product', async () => {
            // THE test. productId came from the caller and was used unchecked.
            setSession(ATTACKER);
            const { updateVendorProductInventoryAction } = await import('@/app/actions/vendor');
            const r: any = await updateVendorProductInventoryAction('prod-1', 0, 'set');

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/unauthori[sz]ed/i);
        });

        it('allows the owner', async () => {
            // Vacuity guard: without this the refusal above would pass even if
            // the action rejected everyone.
            setSession(OWNER);
            const { updateVendorProductInventoryAction } = await import('@/app/actions/vendor');
            const r: any = await updateVendorProductInventoryAction('prod-1', 5, 'add');

            expect(r.success).toBe(true);
        });
    });

    describe('_toggleVendorProductStatusAction', () => {
        beforeEach(() => { lockedDoc = { vendorId: OWNER, status: 'active' }; });

        it('refuses a caller who does not own the product', async () => {
            setSession(ATTACKER);
            const { toggleVendorProductStatusAction } = await import('@/app/actions/vendor');
            const r: any = await toggleVendorProductStatusAction('prod-1');

            expect(r.success).toBe(false);
        });

        it('allows the owner', async () => {
            setSession(OWNER);
            const { toggleVendorProductStatusAction } = await import('@/app/actions/vendor');
            const r: any = await toggleVendorProductStatusAction('prod-1');

            expect(r.success).toBe(true);
        });
    });

    describe('_updateVendorOrderStatusAction', () => {
        beforeEach(() => { lockedDoc = { sellerIds: [OWNER], sellerId: OWNER, status: 'processing' }; });

        it('refuses a caller who is not a seller on the order', async () => {
            setSession(ATTACKER);
            const { updateVendorOrderStatusAction } = await import('@/app/actions/vendor');
            const r: any = await updateVendorOrderStatusAction('ord-1', 'delivered');

            expect(r.success).toBe(false);
        });

        it('allows a seller on the order', async () => {
            setSession(OWNER);
            const { updateVendorOrderStatusAction } = await import('@/app/actions/vendor');
            const r: any = await updateVendorOrderStatusAction('ord-1', 'shipped');

            expect(r.success).toBe(true);
        });

        it('refuses a status outside the vendor-settable set', async () => {
            // The type annotation is erased at the wire. MARKETPLACE_ORDERS
            // status drives fulfilment and escrow, and the integrity work made
            // every transition a claim — this path wrote it directly.
            setSession(OWNER);
            const { updateVendorOrderStatusAction } = await import('@/app/actions/vendor');
            const r: any = await updateVendorOrderStatusAction('ord-1', 'completed' as any);

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/invalid order status/i);
        });
    });
});
