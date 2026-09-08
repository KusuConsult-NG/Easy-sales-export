"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getLogisticsProvider } from "@/lib/logistics";
import { createAdminAuditLog } from "@/lib/audit-log";
import { estimatedDeliveryFrom } from "@/lib/delivery-estimate";

/** #510 The bound on the shipments listing, matching the admin content queues. */
const WAVE_SHIPMENT_PAGE_SIZE = 500;

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

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
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
            /**
             *   #510 THIS REFERENCE REPEATED EVERY 16.7 MINUTES.
             *
             *   `Date.now().toString().slice(-6)` is the last six digits of the
             *   epoch in milliseconds, so it cycles every 10^6 ms. Measured:
             *   simulating 2,500 shipments one second apart produced 1,500
             *   repeats, the first between shipment #0 and #1000 — both
             *   ORD-000000, 16.7 minutes apart.
             *
             *   It is not the document key (that is shipmentId, which carries
             *   the full timestamp and a random suffix), so nothing was
             *   overwritten. It is the reference a member quotes and a support
             *   admin searches for, and it belonged to several shipments at
             *   once.
             *
             *   The full timestamp plus randomness, the same shape shipmentId
             *   already uses one line below.
             */
            orderId: `ORD-${Date.now()}-${Math.floor(Math.random() * 1e6).toString().padStart(6, "0")}`,
            productName,
            destination,
            carrier,
            trackingNumber: finalTrackingNumber,
            status: "pending" as const,
            /**
             *   #510 A NINTH DOOR ONTO THE DELIVERY ESTIMATE, AND THE HELPER
             *   FOR IT HAS EXISTED SINCE #493.
             *
             *   `new Date(Date.now() + 7 days)` carries the current TIME OF DAY
             *   into a delivery promise — 14:32 is the moment an admin pressed a
             *   button, and it says nothing about when anything arrives. #493
             *   found exactly this in the marketplace, wrote
             *   lib/delivery-estimate.ts, and moved three order screens onto it.
             *   WAVE shipments were never looked at.
             *
             *   estimatedDeliveryFrom() lands at the END of the seventh day, so
             *   a comparison against "is this late" does not fire at breakfast
             *   on the day it was promised for. Seven days is unchanged and is
             *   still stated once, in that module.
             */
            estimatedDelivery: estimatedDeliveryFrom(),
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

        /**
         *   #510 THE READ WAS OPEN TO EVERY ADMIN ROLE WHILE THE WRITE WAS NOT.
         *
         *   _createWaveShipmentAction, seventy lines above, asks
         *   `hasAdminPermission(roles, "wave:manage_training")`. This asked
         *   `isAdmin(roles)` — true for ALL TEN admin roles, including support,
         *   moderator and every other module's own admin. So an academy_admin
         *   could list every WAVE shipment: member names, member EMAIL
         *   ADDRESSES, destinations and carriers.
         *
         *   admin-content.ts already recorded this exact shape and fixed it —
         *   "isAdmin() is true for every admin role, so one gate covered six
         *   collections belonging to four different modules". Same rule, another
         *   door, and here the weaker gate is on the READ, which is the one that
         *   hands the data over.
         *
         *   The write's permission, so the two agree.
         */
        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        /**
         *   #510 AND THE READ HAD NO BOUND AT ALL.
         *
         *   `.orderBy(...).get()` fetched the whole collection, every time the
         *   page loaded, and shipments only accumulate. Every other admin
         *   listing in this codebase bounds itself — admin-content.ts uses
         *   .limit(500), module-access-check uses APPLICATION_SCAN_LIMIT — and
         *   #465 measured what an unbounded read of a grown collection costs
         *   here: `canceling statement due to statement timeout`.
         *
         *   500, matching the admin content queues. Newest first, so the bound
         *   drops the oldest rather than an arbitrary slice.
         */
        const snapshot = await db.collection(COLLECTIONS.WAVE_SHIPMENTS)
            .orderBy("createdAt", "desc")
            .limit(WAVE_SHIPMENT_PAGE_SIZE)
            .get();

        return { error: null, success: true as const, data: serializeDocs(snapshot.docs) };
    } catch (error: any) {
        logger.error("Get wave shipments error:", error);
        return { success: false as const, error: error.message || "Failed to fetch wave shipments", data: null };
    }
}

export const getWaveShipmentsAction = withFlexibleSafeAction("getWaveShipmentsAction", _getWaveShipmentsAction);
