/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { updateOrderStatusAction } from '@/app/actions/order-management';
import { getLogisticsProvider } from '@/lib/logistics';

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
        (global as any).mockFirestoreTxUpdate.mockClear();

        const result = await updateOrderStatusAction("order-5", "shipped");

        expect(result.success).toBe(true);
        expect((global as any).mockFirestoreTxUpdate).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                sellerId: "seller-1",
                status: "shipped"
            })
        );
    });
});
