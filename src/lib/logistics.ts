
import { logger } from "./logger";

export interface TrackingUpdate {
    timestamp: Date;
    location: string;
    status: "pending" | "in_transit" | "delivered" | "cancelled";
    note?: string;
}

export interface LogisticsProvider {
    name: string;
    createShipment(details: any): Promise<{ trackingNumber: string; carrier: string }>;
    trackShipment(trackingNumber: string): Promise<TrackingUpdate[]>;
}

/**
 * Mock Logistics Provider for Development/Demo
 * Simulates GIG/Kwik responses
 */
export class MockLogisticsProvider implements LogisticsProvider {
    name = "MockLogistics";

    async createShipment(details: any): Promise<{ trackingNumber: string; carrier: string }> {
        // Simulate API call
        const trackingNumber = `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        return {
            trackingNumber,
            carrier: "GIG Logistics (Mock)",
        };
    }

    async trackShipment(trackingNumber: string): Promise<TrackingUpdate[]> {
        // Return simulated updates based on time
        const now = new Date();

        return [
            {
                timestamp: new Date(now.getTime() - 86400000 * 2), // 2 days ago
                location: "Lagos Sort Center",
                status: "pending",
                note: "Shipment received",
            },
            {
                timestamp: new Date(now.getTime() - 86400000), // 1 day ago
                location: "Abuja Terminal",
                status: "in_transit",
                note: "Arrived at regional hub",
            },
            {
                timestamp: now,
                location: "Central Area Delivery Hub",
                status: "in_transit",
                note: "Out for delivery",
            }
        ];
    }
}

// Factory to get provider (can be switched to real GIG/Kwik later)
export function getLogisticsProvider(): LogisticsProvider {
    // In production, check env vars to decide which provider to use
    // if (process.env.GIG_API_KEY) return new GIGLogisticsProvider();

    return new MockLogisticsProvider();
}
