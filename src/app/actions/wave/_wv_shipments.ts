"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
/**
 * Update shipment status (admin only)
 */
import { getLogisticsProvider } from "@/lib/logistics";
import type { ShipmentTracking } from "@/lib/types/wave-actions";

/**
 * Get user's shipment tracking info
 */
async function _getShipmentTrackingAction(userId: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // Users can only see their own shipments
        if (session.user.id !== userId) return { success: false as const, error: "Unauthorized to view other shipments", data: null };

        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .where("memberId", "==", userId)
            .get();

        return { error: null, success: true as const, data: serializeDocs<ShipmentTracking>(snapshot.docs) };
    } catch (error) {
        logger.error("Get shipment tracking error:", error);
        return { success: false as const, error: "Failed to fetch shipment tracking", data: null };
    }
}


export const getShipmentTrackingAction = withFlexibleSafeAction("getShipmentTrackingAction", _getShipmentTrackingAction);


// ... existing code ...

/**
 * Update shipment status (admin only)
 */
async function _updateShipmentStatusAction(
    shipmentId: string,
    status: ShipmentTracking["status"],
    location: string,
    note?: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const { isAdmin } = await import("@/lib/admin-permissions");
        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false as const, error: "Shipment not found", data: null };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        const newUpdate = {
            timestamp: new Date(),
            location,
            status,
            note
        };

        const updateData: any = {
            status,
            updates: [...(shipmentData.updates || []), newUpdate]
        };

        if (status === "delivered") {
            updateData.actualDelivery = FieldValue.serverTimestamp();
        }

        await shipmentRef.update(updateData);

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Update shipment error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const updateShipmentStatusAction = withFlexibleSafeAction("updateShipmentStatusAction", _updateShipmentStatusAction);


/**
 * Sync shipment with carrier (Admin or Automator)
 * This fetches real-time updates from the Logistics Provider (GIG/Kwik)
 */
async function _syncShipmentWithCarrierAction(shipmentId: string): Promise<ActionResponse<null>> {
    try {
        // This was reachable with no session at all.
        //
        // Found by grouping every entry point by business module rather than by
        // directory: among WAVE's endpoints, all of which require a session, one
        // took an id and required nothing.
        //
        // Three things followed from that. It calls out to the logistics
        // provider on every invocation, so an anonymous caller could drive the
        // platform's outbound carrier API usage without limit — a bill and a
        // rate limit that belong to somebody else. It WRITES the returned status
        // onto the shipment. And its three distinct replies — "Shipment not
        // found", "No tracking number explicitly linked", success — tell an
        // unauthenticated caller which shipment ids exist and which are live.
        //
        // Shipments carry memberId, so ownership was available the whole time.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);
        const shipmentDoc = await shipmentRef.get();

        if (!shipmentDoc.exists) {
            return { success: false as const, error: "Shipment not found", data: null };
        }

        const shipmentData = shipmentDoc.data() as ShipmentTracking;

        // The member whose shipment it is, or someone who administers WAVE.
        // Anyone else gets the same "not found" a missing id gets, so this stops
        // being an oracle for which shipments exist.
        const { isAdmin } = await import("@/lib/admin-permissions");
        const isOwner = (shipmentData as any).memberId === session.user.id;
        if (!isOwner && !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Shipment not found", data: null };
        }

        if (!shipmentData.trackingNumber) {
            return { success: false as const, error: "No tracking number explicitly linked", data: null };
        }

        const provider = getLogisticsProvider();
        const updates = await provider.trackShipment(shipmentData.trackingNumber);

        if (updates.length > 0) {
            const latest = updates[updates.length - 1];
            const existingUpdates = shipmentData.updates || [];
            const mergedUpdates = [...existingUpdates];

            for (const carrierUpdate of updates) {
                const isDuplicate = existingUpdates.some(
                    ex => ex.status === carrierUpdate.status && ex.location === carrierUpdate.location
                );

                if (!isDuplicate) {
                    mergedUpdates.push(carrierUpdate);
                }
            }

            mergedUpdates.sort((a, b) => {
                const timeA = (a.timestamp as any)?.toDate ? (a.timestamp as any).toDate().getTime() : new Date(a.timestamp).getTime();
                const timeB = (b.timestamp as any)?.toDate ? (b.timestamp as any).toDate().getTime() : new Date(b.timestamp).getTime();
                return timeA - timeB;
            });

            await shipmentRef.update({
                status: latest.status,
                updates: mergedUpdates,
                lastSyncedAt: FieldValue.serverTimestamp()
            });

            return { error: null, success: true as const, data: null };
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Sync shipment error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const syncShipmentWithCarrierAction = withFlexibleSafeAction("syncShipmentWithCarrierAction", _syncShipmentWithCarrierAction);
