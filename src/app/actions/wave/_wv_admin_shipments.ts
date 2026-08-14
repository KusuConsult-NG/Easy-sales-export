"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getLogisticsProvider } from "@/lib/logistics";
import { createAdminAuditLog } from "@/lib/audit-log";

/**
 * Create a new shipment for a WAVE member
 */
async function _createWaveShipmentAction(data: {
    memberId: string;
    productName: string;
    destination: string;
    carrier: string;
    trackingNumber?: string;
}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const { memberId, productName, destination, carrier, trackingNumber } = data;

        if (!memberId || !productName || !destination || !carrier) {
            return { success: false as const, error: "Missing required fields", data: null };
        }

        const memberDoc = await db.collection(COLLECTIONS.USERS).doc(memberId).get();
        if (!memberDoc.exists) {
            return { success: false as const, error: "Member not found", data: null };
        }

        const memberData = memberDoc.data();
        const memberName = memberData?.firstName 
            ? `${memberData.firstName} ${memberData.surname || memberData.lastName || ""}`.trim()
            : (memberData?.name || "Member");

        let finalTrackingNumber = trackingNumber;
        if (!finalTrackingNumber) {
            const provider = getLogisticsProvider();
            const shipment = await provider.createShipment({
                memberId,
                memberName,
                productName,
                destination,
            });
            finalTrackingNumber = shipment.trackingNumber;
        }

        const shipmentId = `WSH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const shipmentRef = db.collection(COLLECTIONS.WAVE_SHIPMENTS).doc(shipmentId);

        const newShipment = {
            id: shipmentId,
            memberId,
            memberName,
            memberEmail: memberData?.email || memberData?.userEmail || "",
            orderId: `ORD-${Date.now().toString().slice(-6)}`,
            productName,
            destination,
            carrier,
            trackingNumber: finalTrackingNumber,
            status: "pending" as const,
            estimatedDelivery: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            updates: [
                {
                    timestamp: new Date(),
                    location: "WAVE Warehouse",
                    status: "pending",
                    note: "Shipment generated and ready for pickup",
                }
            ],
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        };

        await shipmentRef.set(newShipment);

        await createAdminAuditLog({
            action: "wave_shipment_created",
            userId: session.user.id,
            targetType: "wave_shipment",
            targetId: shipmentId,
            metadata: { memberId, trackingNumber: finalTrackingNumber }
        });

        return { error: null, success: true as const, data: { id: shipmentId, trackingNumber: finalTrackingNumber } };
    } catch (error: any) {
        logger.error("Create wave shipment error:", error);
        return { success: false as const, error: error.message || "Failed to create shipment", data: null };
    }
}

export const createWaveShipmentAction = withFlexibleSafeAction("createWaveShipmentAction", _createWaveShipmentAction);


/**
 * Get all WAVE shipments
 */
async function _getWaveShipmentsAction(): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .orderBy("createdAt", "desc")
            .get();

        return { error: null, success: true as const, data: serializeDocs(snapshot.docs) };
    } catch (error: any) {
        logger.error("Get wave shipments error:", error);
        return { success: false as const, error: error.message || "Failed to fetch wave shipments", data: null };
    }
}

export const getWaveShipmentsAction = withFlexibleSafeAction("getWaveShipmentsAction", _getWaveShipmentsAction);
