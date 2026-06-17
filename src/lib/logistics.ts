import { db } from "./firebase-admin";
import { COLLECTIONS } from "./types/firestore";
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
 * Mock Logistics Provider with Database Integration
 * Simulates carrier updates dynamically bound to database status and timestamps
 */
export class MockLogisticsProvider implements LogisticsProvider {
    name = "MockLogistics";

    async createShipment(details: any): Promise<{ trackingNumber: string; carrier: string }> {
        const trackingNumber = `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        return {
            trackingNumber,
            carrier: "GIG Logistics (Mock)",
        };
    }

    async trackShipment(trackingNumber: string): Promise<TrackingUpdate[]> {
        try {
            // 1. Search in Marketplace Orders
            const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("trackingNumber", "==", trackingNumber)
                .limit(1)
                .get();

            if (!orderQuery.empty) {
                const orderDoc = orderQuery.docs[0];
                const orderData = orderDoc.data();
                const status = orderData.status;
                const createdAt = orderData.createdAt?.toDate ? orderData.createdAt.toDate() : new Date();
                const paymentVerifiedAt = orderData.paymentVerifiedAt?.toDate ? orderData.paymentVerifiedAt.toDate() : new Date(createdAt.getTime() + 3600000);
                const updatedAt = orderData.updatedAt?.toDate ? orderData.updatedAt.toDate() : new Date();

                const updates: TrackingUpdate[] = [
                    {
                        timestamp: createdAt,
                        location: orderData.deliveryAddress?.state || "Sender Location",
                        status: "pending",
                        note: "Order created, pending dispatch",
                    }
                ];

                if (status === "processing" || status === "shipped" || status === "delivered" || status === "completed") {
                    updates.push({
                        timestamp: paymentVerifiedAt,
                        location: "Sorting Facility",
                        status: "pending",
                        note: "Payment confirmed, ready for shipping",
                    });
                }

                if (status === "shipped" || status === "delivered" || status === "completed") {
                    updates.push({
                        timestamp: new Date(paymentVerifiedAt.getTime() + 12 * 3600000),
                        location: "Regional Transit Hub",
                        status: "in_transit",
                        note: "Package is in transit",
                    });
                }

                if (status === "delivered" || status === "completed") {
                    updates.push({
                        timestamp: orderData.deliveredAt?.toDate ? orderData.deliveredAt.toDate() : updatedAt,
                        location: orderData.deliveryAddress?.city || "Destination",
                        status: "delivered",
                        note: "Package delivered successfully",
                    });
                }

                return updates;
            }

            // 2. Search in WAVE Shipments
            const shipmentQuery = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
                .where("trackingNumber", "==", trackingNumber)
                .limit(1)
                .get();

            if (!shipmentQuery.empty) {
                const shipmentDoc = shipmentQuery.docs[0];
                const shipmentData = shipmentDoc.data();
                const status = shipmentData.status;
                const createdAt = shipmentData.createdAt?.toDate ? shipmentData.createdAt.toDate() : new Date();
                const updatedAt = shipmentData.updatedAt?.toDate ? shipmentData.updatedAt.toDate() : new Date();

                const updates: TrackingUpdate[] = [
                    {
                        timestamp: createdAt,
                        location: "WAVE Warehouse",
                        status: "pending",
                        note: "Shipment generated and ready for pickup",
                    }
                ];

                if (status === "in_transit" || status === "delivered") {
                    updates.push({
                        timestamp: new Date(createdAt.getTime() + 24 * 3600000),
                        location: "Regional Distribution Center",
                        status: "in_transit",
                        note: "Shipment is in transit to destination",
                    });
                }

                if (status === "delivered") {
                    updates.push({
                        timestamp: shipmentData.actualDelivery?.toDate ? shipmentData.actualDelivery.toDate() : updatedAt,
                        location: shipmentData.destination || "Destination",
                        status: "delivered",
                        note: "Shipment delivered to member",
                    });
                }

                return updates;
            }
        } catch (err) {
            logger.error("Failed to fetch tracking details from DB, falling back to mock", err);
        }

        // 3. Fallback: Return simulated updates based on current time
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
    return new MockLogisticsProvider();
}
