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
 *   THE MOCK PROVIDER STOOD HERE, and it is deleted.
 *
 *     THE OWNER: "tracking should be realtime."
 *
 *   `MockLogisticsProvider` invented a tracking number —
 *   `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}` — and a journey
 *   through "Sorting Facility", "Regional Transit Hub", "WAVE Warehouse" and
 *   "Regional Distribution Center", timestamped from the ORDER'S own dates. A
 *   buyer watching their goods cross Nigeria was watching a function.
 *
 *   `getLogisticsProvider()` returned it unconditionally; there was no other
 *   provider and no configuration that could select one. So every tracking
 *   panel on the platform, marketplace and WAVE, was drawing that.
 *
 *   THE INTERFACE ABOVE IS KEPT, because it is the right shape for a real
 *   carrier — GIG, DHL, Kwik — the day there is an account and an API key.
 *   What is gone is the default that made the absence of one invisible.
 *
 *   Until then, what a buyer sees is lib/shipment-record: what the seller
 *   actually said, and the order's own events, both of which are true.
 */

/**
 * The configured carrier, or null when there is none.
 *
 *   NULL IS THE HONEST ANSWER TODAY, and callers must handle it. The previous
 *   version could not return null, so no caller was ever written to ask —
 *   which is exactly how a stub becomes load-bearing.
 */
export function getLogisticsProvider(): LogisticsProvider | null {
    return null;
}
