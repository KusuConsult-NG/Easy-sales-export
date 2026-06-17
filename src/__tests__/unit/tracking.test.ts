/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { getTrackingUpdatesAction } from '@/app/actions/order-management';

describe('getTrackingUpdatesAction Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Mock requireSession to resolve successfully
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "user-id",
                    roles: ["general_user"],
                    email: "user@example.com",
                    name: "Test User",
                }
            },
            error: null
        }));
    });

    it('should fail if trackingNumber is missing', async () => {
        const result = await getTrackingUpdatesAction("");

        expect(result.success).toBe(false);
        expect(result.error).toContain("Tracking number is required");
    });

    it('should return simulated tracking updates for a valid tracking number', async () => {
        const result = await getTrackingUpdatesAction("TRK-12345");

        expect(result.success).toBe(true);
        expect(result.data?.updates).toBeDefined();
        expect(result.data?.updates.length).toBeGreaterThan(0);
        expect(result.data?.providerName).toBe("MockLogistics");
        
        const firstUpdate = result.data?.updates[0];
        expect(firstUpdate.location).toBeDefined();
        expect(firstUpdate.status).toBeDefined();
        expect(firstUpdate.timestamp).toBeDefined();
    });
});
