/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createDisputeAction } from '@/app/actions/disputes';

describe('createDisputeAction Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Mock requireSession to resolve successfully with buyer session
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "buyer-id",
                    roles: ["general_user"],
                    email: "buyer@example.com",
                    name: "Buyer User",
                }
            },
            error: null
        }));

        // Mock Firestore get calls for orders, disputes, and transactions
        (global as any).mockFirestoreGet.mockImplementation((id: string) => {
            if (id === "order-id") {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        buyerId: "buyer-id",
                        sellerId: "seller-id",
                        status: "shipped",
                    })
                });
            }
            if (id === "disputes") {
                return Promise.resolve({
                    empty: true,
                    docs: []
                });
            }
            return Promise.resolve({ exists: false });
        });

        // Mock Transaction get
        (global as any).mockFirestoreTxGet.mockImplementation(() => {
            return Promise.resolve({
                exists: true,
                data: () => ({
                    buyerId: "buyer-id",
                    sellerId: "seller-id",
                    status: "shipped",
                })
            });
        });
    });

    it('should fail if evidenceUrls array is missing or empty', async () => {
        const result = await createDisputeAction({
            orderId: "order-id",
            reason: "wrong_item",
            description: "a".repeat(60), // satisfy 50 char min
            evidenceUrls: []
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("At least one image or document is required as evidence");
    });

    it('should succeed/progress to transaction if evidenceUrls is provided', async () => {
        const result = await createDisputeAction({
            orderId: "order-id",
            reason: "wrong_item",
            description: "a".repeat(60),
            evidenceUrls: ["https://example.com/evidence1.jpg"]
        });

        expect(result.success).toBe(true);
    });
});
