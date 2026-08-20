"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { incrementWithinCeiling } from "@/lib/wallet-ledger";
import { serializeDocs, toMillis, toIsoOrEmpty } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
import type { WaveResource, WaveTrainingEvent } from "@/lib/types/wave-actions";
import { isResourceWithdrawn, RESOURCE_LIVE_FIELDS } from "@/lib/wave-resource-visibility";
import { canAccessWaveResources } from "@/lib/wave-resource-access";
import { hasAdminPermission } from "@/lib/admin-permissions";

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

        // STRICT ENROLLMENT CHECK — the rule now lives in one place, because a
        // SECOND action over this same collection had no membership check at
        // all. See lib/wave-resource-access.ts.
        const isAuthorized = await canAccessWaveResources(session.user.id, session.user.roles);

        if (!isAuthorized) {
            logger.warn(`Unauthorized WAVE resource access attempt by ${session.user.id}`);
            return { success: false as const, error: "Access denied: Not enrolled in WAVE", meta: { cursor: null, hasMore: false }, data: null };
        }

        const pageSize = Math.min(Math.max(limit, 1), 50);

        let baseQuery: import("@/lib/supabase-db").SupabaseQuery =
            db.collection(COLLECTIONS.WAVE_RESOURCES);

        if (category) {
            baseQuery = baseQuery.where("category", "==", category);
        }
        baseQuery = baseQuery.orderBy("createdAt", "desc");

        /**
         * ONE WITHDRAWN RESOURCE ENDED THE WHOLE LISTING.
         *
         * The withdrawn filter is right — this listing checked neither
         * visibility field, so it served resources an admin had deleted through
         * either path. But it was applied to a single fetch of `pageSize + 1`
         * rows and hasMore was then computed from what survived:
         *
         *     const snapshot = await queryRef.get();          // pageSize + 1
         *     const visibleDocs = snapshot.docs.filter(notWithdrawn);
         *     const hasMore = visibleDocs.length > pageSize;   // <- false
         *
         * So a SINGLE deleted resource inside the page window took hasMore to
         * false, and the member got a short page and no "load more" — with the
         * rest of the library, however large, unreachable behind it. Deleting
         * one document truncated the list for everybody.
         *
         * Scanning instead: keep fetching pages of the underlying query until a
         * full page of VISIBLE resources is in hand or the collection runs out.
         * Bounded, because a library that is mostly withdrawn must not turn one
         * page load into an unbounded walk; reaching the bound reports hasMore
         * so the member can continue rather than being told there is nothing.
         *
         * This depends on the value cursor working — see #192, which is why it
         * could not have been written this way before.
         */
        const MAX_SCANS = 5;
        const visibleDocs: any[] = [];
        let scanCursor: Date | null = null;
        let sourceExhausted = false;

        if (cursor) {
            const cursorDate = new Date(cursor);
            if (!isNaN(cursorDate.getTime())) {
                scanCursor = cursorDate;
            }
        }

        for (let scan = 0; scan < MAX_SCANS; scan++) {
            let pageQuery = baseQuery.limit(pageSize + 1);
            if (scanCursor) pageQuery = pageQuery.startAfter(scanCursor);

            const snapshot = await pageQuery.get();
            if (snapshot.docs.length === 0) { sourceExhausted = true; break; }

            visibleDocs.push(...snapshot.docs.filter((doc: any) => !isResourceWithdrawn(doc.data())));

            if (snapshot.docs.length < pageSize + 1) { sourceExhausted = true; break; }
            if (visibleDocs.length > pageSize) break;

            // Advance past the last row READ, not the last row kept — a page of
            // entirely withdrawn resources still has to move the cursor on.
            const lastRead = snapshot.docs[snapshot.docs.length - 1];
            const lastMs = toMillis(lastRead.data().createdAt);
            if (!lastMs) { sourceExhausted = true; break; }   // cannot advance
            scanCursor = new Date(lastMs);
        }

        const docs = visibleDocs.slice(0, pageSize);
        const data = serializeDocs<WaveResource>(docs);

        /**
         * hasMore AND cursor MUST AGREE.
         *
         * A cursor is the createdAt of the last row on the page, so a row that
         * HAS no createdAt cannot be one — it is not orderable, and a missing
         * value sorts first in a descending order, so such rows land at the top
         * of page one. The old code returned `hasMore: true` beside
         * `cursor: null` in exactly that case, which is a "load more" button
         * that reloads page one for ever.
         *
         * Reported rather than swallowed: those rows come from the upload path
         * corrected in #198, and only a backfill can give them a timestamp. A
         * page load cannot, so it says so instead of pretending.
         *
         * (toIsoOrEmpty is still the right reader here — it handles the Date,
         * number and {_seconds} shapes that `?.toDate?.()` returns null for —
         * but it is hardening, not the fix for this. Nothing recovers a
         * timestamp that was never written.)
         */
        const nextCursor = docs.length > 0
            ? (toIsoOrEmpty(docs[docs.length - 1].data().createdAt) || null)
            : null;

        const moreAvailable =
            visibleDocs.length > pageSize || (!sourceExhausted && visibleDocs.length === pageSize);

        if (moreAvailable && !nextCursor) {
            logger.warn(
                `[WAVE] Resource listing cannot page past '${docs[docs.length - 1]?.id}': it has no ` +
                `createdAt, so there is no cursor value. Resources beyond it are unreachable until ` +
                `the row is backfilled.`
            );
        }

        const hasMore = moreAvailable && nextCursor !== null;
        // Null on the last page, as before: a caller that treats a present
        // cursor as "there is more" must not be handed one at the end.
        const cursorOut = hasMore ? nextCursor : null;

        return { error: null, success: true as const, data, meta: { cursor: cursorOut, hasMore } };
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
        // Same shared helper, same reason: a null cursor next to hasMore: true
        // is a "load more" button that reloads page one.
        const nextCursor = hasMore && docs.length > 0
            ? (toIsoOrEmpty(docs[docs.length - 1].data().date) || null)
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

        /**
         * THE SECOND UPLOAD PATH, WHICH AGREED WITH THE FIRST ABOUT NOTHING.
         *
         * createResourceAction in _wv_admin_resources.ts writes the same
         * collection and is gated on `wave:manage_training`; this one was a
         * hand-written `admin || super_admin`, so the WAVE admin could upload a
         * resource through one screen and not the other. Same shape as #158.
         *
         * And what it wrote was a different document. It set neither `isActive`
         * nor `deleted`, which wave-resource-visibility.ts exists because of —
         * "both writers now set both fields, so new rows are unambiguous" was
         * true of two writers and this was a third. No `createdAt` either, so a
         * resource uploaded here sorted last in a createdAt-ordered listing and
         * could not be paged past. No audit row, no uploadedBy: nothing recorded
         * who added a file to the members' library.
         *
         * The id was `resource_${Date.now()}` written with .set(), so two
         * uploads in the same millisecond silently overwrote one another. .add()
         * lets the database assign it, as the sibling does.
         *
         * Nothing in the UI calls this action; it is exported from the wave
         * barrel and so is a live endpoint regardless.
         */
        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "WAVE training permission required", data: null };
        }

        const resourceRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add({
            ...resource,
            ...RESOURCE_LIVE_FIELDS,
            downloads: 0,
            uploadedAt: FieldValue.serverTimestamp(),
            uploadedBy: session.user.id,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        });

        await createAdminAuditLog({
            action: "resource_uploaded",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceRef.id,
        });

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
        const { session } = sessionResult;

        /**
         * A WRITE OVER THE RESOURCE LIBRARY WITH NO MEMBERSHIP CHECK.
         *
         * The only gate was "is anybody logged in". getWaveResourcesAction, over
         * the same collection, requires an active WAVE membership, an admin role
         * or Academy Elite — so any account at all could increment the download
         * counter of any resource id, including a library it may not read and a
         * resource an admin has withdrawn. The counter is what the admin screen
         * reports as engagement, so it was writable by people who never opened
         * the file.
         *
         * The existence check matters for a second reason: update() on a missing
         * document is a WARNED NO-OP in this adapter, so an unknown id returned
         * success having written nothing.
         */
        if (!(await canAccessWaveResources(session.user.id, session.user.roles))) {
            return { success: false as const, error: "Access denied: Not enrolled in WAVE", data: null };
        }

        const resourceRef = db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId);
        const resourceDoc = await resourceRef.get();

        if (!resourceDoc.exists || isResourceWithdrawn(resourceDoc.data())) {
            return { success: false as const, error: "Resource not found", data: null };
        }

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

        /**
         * ONE ACCOUNT COULD FILL AN EVENT.
         *
         * There was no duplicate check — not here and not anywhere;
         * WAVE_TRAINING_REGISTRATIONS has exactly one writer and it added a row
         * unconditionally. Every call took a seat through incrementWithinCeiling
         * FIRST, so pressing Register twice on the training page consumed two of
         * the event's places for one person, and pressing it maxParticipants
         * times consumed all of them. The member also collected a registration
         * row per press, which the "my training" list and the admin participant
         * list both read.
         *
         * Checked before the seat is taken, so a repeat press costs nothing.
         * This is not a lock — two simultaneous first-time registrations by the
         * same account can still both pass — but the seat count itself is
         * guarded by a CAS function, so the failure mode is a duplicate ROW and
         * not an oversubscribed event. A unique index is the real fix and needs
         * a migration.
         */
        const existing = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("userId", "==", userId)
            .where("eventId", "==", eventId)
            .limit(1)
            .get();

        if (!existing.empty) {
            return { success: false as const, error: "You are already registered for this session", data: null };
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

        /**
         * A SEAT TAKEN AND NEVER GIVEN BACK.
         *
         * The seat is claimed before the registration row is written, which is
         * the right order — the alternative oversubscribes the event. But if the
         * write failed, the increment stayed: currentParticipants counted a
         * member who is not registered, and enough failures closed the event to
         * everyone with places still free. The seat is returned now, and if the
         * return itself fails that is logged as an error rather than lost, since
         * it leaves a discrepancy only a human can reconcile.
         */
        try {
            await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS).add({
                userId,
                eventId,
                registeredAt: FieldValue.serverTimestamp(),
                attended: false
            });
        } catch (writeError) {
            try {
                await eventRef.update({ currentParticipants: FieldValue.increment(-1) });
            } catch (rollbackError) {
                logger.error(
                    `[WAVE] Seat NOT released for event ${eventId} after a failed registration by ${userId}. ` +
                    `currentParticipants is one too high and needs reconciling.`,
                    rollbackError,
                );
            }
            throw writeError;
        }

        await createAdminAuditLog({
            // Was "user_update", which is what every unclassified write in this
            // codebase used to be filed under. The one question a training
            // audit answers — who took a place on which session — could not be
            // asked of a log that called it a user update. Same correction as
            // #160.
            action: "training_registered",
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
