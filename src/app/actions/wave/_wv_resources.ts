"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { incrementWithinCeiling } from "@/lib/wallet-ledger";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
import type { WaveResource, WaveTrainingEvent } from "@/lib/types/wave-actions";

/**
 * Get WAVE resources
 */
async function _getWaveResourcesAction(
    category?: string,
    cursor?: string | null,
    limit = 20
): Promise<ActionResponse<WaveResource[], { cursor: string | null; hasMore: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };

        // STRICT ENROLLMENT CHECK
        const memberDoc = await db.collection(COLLECTIONS.WAVE_MEMBERS).doc(session.user.id).get();
        const { isAdmin } = await import("@/lib/admin-permissions");
        
        let isAuthorized = false;
        if (memberDoc.exists && memberDoc.data()?.active) {
            isAuthorized = true;
        } else if (isAdmin(session.user.roles)) {
            isAuthorized = true;
        } else {
            // Academy Elite users also bypass strict enrollment checks
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const academyReg = userData?.serviceRegistrations?.academy;
                const isAcademyElite = academyReg?.plan === 'elite' && (academyReg?.status === 'approved' || academyReg?.status === 'active');
                if (isAcademyElite) {
                    isAuthorized = true;
                }
            }
        }

        if (!isAuthorized) {
            logger.warn(`Unauthorized WAVE resource access attempt by ${session.user.id}`);
            return { success: false as const, error: "Access denied: Not enrolled in WAVE", meta: { cursor: null, hasMore: false }, data: null };
        }

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_RESOURCES)
            .orderBy("createdAt", "desc")
            .limit(pageSize + 1);

        if (category) {
            queryRef = db.collection(COLLECTIONS.WAVE_RESOURCES)
                .where("category", "==", category)
                .orderBy("createdAt", "desc")
                .limit(pageSize + 1);
        }

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                queryRef = queryRef.startAfter(cursorDate);
            }
        }

        const snapshot = await queryRef.get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

        const data = serializeDocs<WaveResource>(docs);
        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().createdAt?.toDate?.()?.toISOString() ?? null
            : null;

        return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Failed to fetch WAVE resources:", error);
        return { success: false as const, error: "Failed to fetch resources", meta: { cursor: null, hasMore: false }, data: null };
    }
}


export const getWaveResourcesAction = withFlexibleSafeAction("getWaveResourcesAction", _getWaveResourcesAction);


/**
 * Get upcoming WAVE training events
 */
async function _getWaveTrainingEventsAction(
    cursor?: string | null,
    limit = 20,
    includeAllStatuses = false
): Promise<ActionResponse<WaveTrainingEvent[], { cursor: string | null; hasMore: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", meta: { cursor: null, hasMore: false }, data: null };

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let queryRef: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS);

        if (!includeAllStatuses) {
            queryRef = queryRef.where("status", "in", ["upcoming", "ongoing"]);
        }

        queryRef = queryRef
            .orderBy("date", "asc")
            .limit(pageSize + 1);

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                queryRef = queryRef.startAfter(cursorDate);
            }
        }

        const snapshot = await queryRef.get();
        const hasMore = snapshot.docs.length > pageSize;
        const docs = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs;

        const data = serializeDocs<WaveTrainingEvent>(docs);
        const nextCursor = hasMore && docs.length > 0
            ? docs[docs.length - 1].data().date?.toDate?.()?.toISOString() ?? null
            : null;

        return { error: null, success: true as const, data, meta: { cursor: nextCursor, hasMore } };
    } catch (error) {
        logger.error("Get training events error:", error);
        return { success: false as const, error: "Failed to fetch training events", meta: { cursor: null, hasMore: false }, data: null };
    }
}


export async function getWaveTrainingEventsAction(...args: Parameters<typeof _getWaveTrainingEventsAction>) {
    return withFlexibleSafeAction("getWaveTrainingEventsAction", _getWaveTrainingEventsAction)(...args);
}


// ============================================================================
// RESOURCE MANAGEMENT
// ============================================================================

/**
 * Upload resource (admin only)
 */
async function _uploadWaveResourceAction(
    resource: Omit<WaveResource, "id" | "uploadedAt" | "downloads">
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false as const, error: "Admin access required", data: null };
        }

        const resourceId = `resource_${Date.now()}`;
        const resourceData: WaveResource = {
            ...resource,
            id: resourceId,
            uploadedAt: FieldValue.serverTimestamp(),
            downloads: 0
        };

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).set(resourceData);

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Upload resource error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const uploadWaveResourceAction = withFlexibleSafeAction("uploadWaveResourceAction", _uploadWaveResourceAction);


/**
 * Increment resource download count
 */
async function _incrementResourceDownloadAction(
    resourceId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);

        await resourceRef.update({
            downloads: FieldValue.increment(1)
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Increment download error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const incrementResourceDownloadAction = withFlexibleSafeAction("incrementResourceDownloadAction", _incrementResourceDownloadAction);


/**
 * Register for training event
 */
async function _registerForTrainingAction(
    userId: string,
    eventId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId) {
            return { success: false as const, error: "Cannot register for another user", data: null };
        }

        const eventRef = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId);

        // Take the seat before recording the registration.
        //
        // The capacity check ran inside runTransaction, which takes no lock, so
        // two people claiming the last seat both read the same count, both
        // passed, and both registered — someone arrives at a session with no
        // place. Migration 010 made that worse rather than better: the
        // increments used to lose one another, which hid the overshoot.
        //
        // An event with no maxParticipants recorded is treated as unbounded,
        // so uncapped sessions keep working.
        const seat = await incrementWithinCeiling({
            collection: COLLECTIONS.WAVE_TRAINING_EVENTS,
            id: eventId,
            field: "currentParticipants",
            amount: 1,
            ceilingField: "maxParticipants",
        });

        if (!seat.ok) {
            return {
                success: false as const,
                error: seat.reason === "at_capacity" ? "Event is full" : "Event not found",
                data: null,
            };
        }

        await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS).add({
            userId,
            eventId,
            registeredAt: FieldValue.serverTimestamp(),
            attended: false
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: eventId,
            targetType: "training_registration"
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Training registration error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const registerForTrainingAction = withFlexibleSafeAction("registerForTrainingAction", _registerForTrainingAction);
