/**
 * @jest-environment node
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createWaveShipmentAction, getWaveShipmentsAction } from '@/app/actions/wave';

describe('WAVE Shipments Action Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();

        // Setup session mock for Admin by default
        (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
            session: {
                user: {
                    id: "admin-id",
                    roles: ["admin"],
                    email: "admin@example.com",
                    name: "Admin User",
                }
            },
            error: null
        }));

        // Mock firestore returns
        (global as any).mockFirestoreGet.mockImplementation((nameOrId: string) => {
            if (nameOrId === "member-id") {
                return Promise.resolve({
                    exists: true,
                    data: () => ({
                        firstName: "Test",
                        surname: "User",
                        email: "test@example.com"
                    })
                });
            }
            if (nameOrId === "nonexistent-id") {
                return Promise.resolve({
                    exists: false,
                    data: () => null
                });
            }
            // If fetching collection of shipments
            return Promise.resolve({
                docs: [
                    {
                        id: "WSH-1",
                        data: () => ({
                            id: "WSH-1",
                            memberId: "member-id",
                            productName: "WAVE Starter Kit",
                            trackingNumber: "TRK-1",
                            status: "pending",
                            createdAt: { toDate: () => new Date() }
                        })
                    }
                ]
            });
        });
    });

    it('should fail if user is not authenticated', async () => {
        (global as any).mockRequireSession.mockImplementationOnce(() => Promise.resolve({
            session: null,
            error: "Authentication required"
        }));

        const result = await createWaveShipmentAction({
            memberId: "member-id",
            productName: "Kit",
            destination: "Lagos",
            carrier: "MockLogistics"
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Authentication required");
    });

    it('should fail if user is not admin', async () => {
        (global as any).mockRequireSession.mockImplementationOnce(() => Promise.resolve({
            session: {
                user: {
                    id: "member-id",
                    roles: ["general_user"],
                    email: "test@example.com"
                }
            },
            error: null
        }));

        const result = await createWaveShipmentAction({
            memberId: "member-id",
            productName: "Kit",
            destination: "Lagos",
            carrier: "MockLogistics"
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Admin access required");
    });

    it('should fail if member does not exist', async () => {
        const result = await createWaveShipmentAction({
            memberId: "nonexistent-id",
            productName: "Kit",
            destination: "Lagos",
            carrier: "MockLogistics"
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("Member not found");
    });

    it('should create WAVE shipment successfully and auto-generate tracking if not provided', async () => {
        const result = await createWaveShipmentAction({
            memberId: "member-id",
            productName: "WAVE Inputs Pack",
            destination: "Abuja",
            carrier: "MockLogistics"
        });

        expect(result.success).toBe(true);
        expect(result.data?.id).toBeDefined();
        expect(result.data?.trackingNumber).toBeDefined();
        expect(result.data?.trackingNumber).toContain("TRK-");
    });

    it('should fetch all shipments for admin', async () => {
        const result = await getWaveShipmentsAction();

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data?.length).toBe(1);
        expect(result.data?.[0].productName).toBe("WAVE Starter Kit");
    });
});
