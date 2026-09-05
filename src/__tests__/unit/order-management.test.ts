/**
 * @jest-environment node
 */

// `jest` is deliberately NOT imported from @jest/globals here — see #392.
// jest.mock is hoisted above the imports only when `jest` is the GLOBAL; taking
// it from @jest/globals defeats the hoist, the module under test is loaded
// first, and the mock below silently does nothing. Measured, not assumed.
import { describe, it, expect, beforeEach } from '@jest/globals';
import { updateOrderStatusAction } from '@/app/actions/order-management';
import { getLogisticsProvider } from '@/lib/logistics';

/**
 * #391. Mocked so the assertions below can ask whether the action ANNOUNCED
 * the status change, which is the thing that was missing. Every export the
 * action reaches for is listed: a partial module mock hands the caller
 * `undefined`, and calling it throws.
 */
jest.mock('@/lib/marketplace-notifications', () => ({
    notifyOrderShipped: jest.fn(async () => undefined),
    notifyOrderDelivered: jest.fn(async () => undefined),
}));

describe('updateOrderStatusAction Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should successfully update status when user is the seller (sellerId matching)', async () => {
        // Mock requireSession to resolve as the authorized seller
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "seller-1",
                    roles: ["seller"],
                }
            },
            error: null
        }));

        // Mock Firestore transactions
        const mockOrderData = {
            id: "order-1",
            sellerId: "seller-1",
            buyerId: "buyer-1",
            status: "processing",
        };

        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        const result = await updateOrderStatusAction("order-1", "shipped");

        expect(result.success).toBe(true);
        expect(result.data?.message).toContain("Order status updated successfully");
    });

    it('should successfully update status when user is in sellerIds list', async () => {
        // Mock requireSession to resolve as the authorized seller in list
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "seller-2",
                    roles: ["seller"],
                }
            },
            error: null
        }));

        // Mock Firestore transactions
        const mockOrderData = {
            id: "order-2",
            sellerIds: ["seller-1", "seller-2"],
            buyerId: "buyer-1",
            status: "processing",
        };

        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        const result = await updateOrderStatusAction("order-2", "shipped");

        expect(result.success).toBe(true);
        expect(result.data?.message).toContain("Order status updated successfully");
    });

    it('should fail when user is not authorized', async () => {
        // Mock requireSession to resolve as an unauthorized seller
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "seller-unauthorized",
                    roles: ["seller"],
                }
            },
            error: null
        }));

        // Mock Firestore transactions
        const mockOrderData = {
            id: "order-3",
            sellerId: "seller-1",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "processing",
        };

        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        const result = await updateOrderStatusAction("order-3", "shipped");

        expect(result.success).toBe(false);
        expect(result.error).toContain("Not authorized to update this order");
    });

    it('should successfully update status when user is an admin', async () => {
        // Mock requireSession to resolve as an admin
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "admin-1",
                    roles: ["admin"],
                }
            },
            error: null
        }));

        // Mock Firestore transactions
        const mockOrderData = {
            id: "order-4",
            sellerId: "seller-1",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "processing",
        };

        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        const result = await updateOrderStatusAction("order-4", "shipped");

        expect(result.success).toBe(true);
        expect(result.data?.message).toContain("Order status updated successfully");
    });

    it('should self-heal missing sellerId by setting it to the first item in sellerIds', async () => {
        // Mock requireSession to resolve as the authorized seller
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "seller-1",
                    roles: ["seller"],
                }
            },
            error: null
        }));

        // Mock Firestore transactions where sellerId is missing but sellerIds has elements
        const mockOrderData = {
            id: "order-5",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "processing",
        };

        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true,
            data: () => mockOrderData,
        }));

        // Reset the mock call counts
        (global as any).mockFirestoreUpdate.mockClear();

        const result = await updateOrderStatusAction("order-5", "shipped");

        expect(result.success).toBe(true);
        // Asserted on the direct-write spy rather than the transaction one:
        // the runTransaction wrapper is gone (it never provided atomicity), so
        // the write lands through orderRef.update(). The behaviour under test —
        // self-healing sellerId from sellerIds — is unchanged.
        expect((global as any).mockFirestoreUpdate).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                sellerId: "seller-1",
                status: "shipped"
            })
        );
    });

    /**
     * #389. "delivered" is not a label — it is the start of a payout.
     *
     * The branch above it writes "delivered" onto the order's escrow rows, and
     * api/cron/release-escrow pays the seller 24 hours after an escrow row
     * reaches that status. Delivery is confirmed by the BUYER, through
     * confirmOrderReceiptAction; this action used to accept it from the seller
     * as well, so a seller could start the clock on their own money.
     *
     * These two run through the ACTION rather than through canSetOrderStatus,
     * which controls-that-persist-nothing.test.ts covers directly. The rule
     * being right and the rule being APPLIED are different claims, and this
     * audit has repeatedly found the second one missing where the first held.
     */
    /**
     *   #391 A BUYER WAS NEVER TOLD THEIR ORDER HAD SHIPPED.
     *
     *   notifyOrderShipped has existed in lib/marketplace-notifications.ts
     *   since it was written and nothing called it. This is the only door that
     *   sets "shipped", and it sent nothing at all — while the logistics
     *   provider minted a tracking number for the order a few lines earlier in
     *   the same function.
     */
    it('#391 ANNOUNCES A SHIPMENT to the buyer, with the tracking number', async () => {
        const { notifyOrderShipped } = jest.requireMock('@/lib/marketplace-notifications') as any;
        notifyOrderShipped.mockClear();

        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: "seller-1", roles: ["seller"] } },
            error: null
        }));
        const mockOrderData = {
            id: "order-391",
            sellerId: "seller-1",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "processing",
        };
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData,
        }));
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData, docs: [], empty: true,
        }));

        const result = await updateOrderStatusAction("order-391", "shipped", "TRK-999");

        expect(result.success).toBe(true);
        expect(notifyOrderShipped).toHaveBeenCalledWith(
            expect.objectContaining({ buyerId: "buyer-1", orderId: "order-391", trackingNumber: "TRK-999" }),
        );
    });

    it('#391 and a notification that throws does NOT undo a status already written', async () => {
        // A .catch handles a rejected promise and does nothing about a
        // synchronous throw, which would reach this action's outer catch and
        // report a committed status change as a failure.
        const { notifyOrderShipped } = jest.requireMock('@/lib/marketplace-notifications') as any;
        notifyOrderShipped.mockImplementationOnce(() => { throw new Error('notifier is down'); });

        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: "seller-1", roles: ["seller"] } },
            error: null
        }));
        const mockOrderData = {
            id: "order-391b", sellerId: "seller-1", sellerIds: ["seller-1"],
            buyerId: "buyer-1", status: "processing",
        };
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData,
        }));
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData, docs: [], empty: true,
        }));

        const result = await updateOrderStatusAction("order-391b", "shipped", "TRK-1");
        expect(result.success).toBe(true);
    });

    it('#389 SECURITY: refuses a SELLER marking their own order delivered', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: "seller-1", roles: ["seller"] } },
            error: null
        }));

        const mockOrderData = {
            id: "order-389",
            sellerId: "seller-1",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "shipped",
        };
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData,
        }));
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData,
        }));
        (global as any).mockFirestoreUpdate.mockClear();

        const result = await updateOrderStatusAction("order-389", "delivered");

        expect(result.success).toBe(false);
        // The refusal names the buyer's door — #322: a bare "no" reads as a
        // broken button to the person looking at the screen.
        expect(result.error).toMatch(/buyer/i);
        // And nothing was written. A refusal that still wrote would leave the
        // escrow armed for the cron, which is the whole harm.
        expect((global as any).mockFirestoreUpdate).not.toHaveBeenCalled();
    });

    it('#389: an ADMIN may still confirm delivery on the buyer\'s behalf', async () => {
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: { user: { id: "admin-1", roles: ["admin"] } },
            error: null
        }));

        const mockOrderData = {
            id: "order-389-admin",
            sellerId: "seller-1",
            sellerIds: ["seller-1"],
            buyerId: "buyer-1",
            status: "shipped",
        };
        (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData,
        }));
        // `docs`/`empty` as well as the document shape: the "delivered" branch
        // reads this handle BOTH as a document (the order) and as a query
        // result (the order's escrow rows). Without them escrowDocs is
        // undefined and the action fails on "escrowDocs is not iterable" —
        // which would have looked like the refusal this test is checking is
        // absent, rather than like a gap in the harness.
        (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve({
            exists: true, data: () => mockOrderData, docs: [], empty: true,
        }));

        const result = await updateOrderStatusAction("order-389-admin", "delivered");

        // Nothing was removed by the fix — support still needs this when a
        // buyer will not confirm a delivery that plainly happened.
        expect(result.success).toBe(true);
    });
});
