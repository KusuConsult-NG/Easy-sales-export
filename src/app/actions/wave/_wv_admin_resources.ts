"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue, FieldPath } from "@/lib/firestore-compat";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";
import { RESOURCE_LIVE_FIELDS, RESOURCE_WITHDRAWN_FIELDS } from "@/lib/wave-resource-visibility";
import { retirementPatch } from "@/lib/record-retirement";

// ============================================================================
// RESOURCES MANAGEMENT
// ============================================================================

async function _createResourceAction(data: {
    title: string;
    description: string;
    category: "document" | "video" | "template" | "guide";
    fileUrl: string;
    fileName: string;
    fileSize: number;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const resourceRef = await db.collection(COLLECTIONS.WAVE_RESOURCES).add({
            ...data,
            // Marked live explicitly. This wrote neither visibility field, and
            // getResourcesAction — the listing behind /wave/(member)/resources —
            // queries `.where("isActive", "==", true)`. So every resource uploaded
            // through this screen was invisible to members while showing up in the
            // admin's own list. See wave-resource-visibility.ts.
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
        logger.error("Create resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create resource" , data: null };
    }
}

export const createResourceAction = withFlexibleSafeAction("createResourceAction", _createResourceAction);


async function _updateResourceAction(
    resourceId: string,
    data: Partial<{
        title: string;
        description: string;
        category: "document" | "video" | "template" | "guide";
        fileUrl: string;
        fileName: string;
        fileSize: number;
    }>
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "resource_update",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Update resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update resource" , data: null };
    }
}

export const updateResourceAction = withFlexibleSafeAction("updateResourceAction", _updateResourceAction);


async function _deleteResourceAction(
    resourceId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        await db.collection(COLLECTIONS.WAVE_RESOURCES).doc(resourceId).update({
            // `deleted: true` alone was read by NOTHING — not the listings, not the
            // download guard — so this button removed a resource from nowhere. Both
            // spellings now, because two readers query `isActive` in SQL and cannot
            // call a predicate.
            ...RESOURCE_WITHDRAWN_FIELDS,
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "resource_delete",
            userId: session.user.id,
            targetType: "wave_resource",
            targetId: resourceId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Delete resource error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to delete resource" , data: null };
    }
}

export const deleteResourceAction = withFlexibleSafeAction("deleteResourceAction", _deleteResourceAction);


// ============================================================================
// TRAINING EVENTS MANAGEMENT
// ============================================================================

async function _createTrainingEventAction(data: {
    title: string;
    description: string;
    instructor: string;
    date: Date;
    duration: string;
    maxParticipants: number;
    meetingLink?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const eventRef = await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).add({
            ...data,
            currentParticipants: 0,
            status: "upcoming",
            createdAt: FieldValue.serverTimestamp(),
            createdBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0,
        });

        await createAdminAuditLog({
            action: "wave_training_created",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventRef.id,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Create event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create event" , data: null };
    }
}

export const createTrainingEventAction = withFlexibleSafeAction("createTrainingEventAction", _createTrainingEventAction);


async function _updateTrainingEventAction(
    eventId: string,
    data: Partial<{
        title: string;
        description: string;
        instructor: string;
        date: Date;
        duration: string;
        maxParticipants: number;
        meetingLink: string;
        status: "upcoming" | "ongoing" | "completed" | "cancelled";
        videoUrl: string;
    }>
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        /**
         * The edit form cannot declare an event LIVE.
         *
         * `status` is part of the Partial this action spreads straight into the
         * document, and the admin screen offers all four values in a dropdown.
         * Setting "ongoing" here writes the status and nothing else — no
         * meetingLink, and no row in WAVE_TRAINING_SESSIONS. But
         * getTrainingEventsAction serves members `status in ["upcoming",
         * "ongoing"]`, so the event appears as live on the member's screen with
         * nowhere to go, and endWaveLiveSessionAction's claim then accepts it and
         * marks a session completed that never had a room.
         *
         * Going live is startWaveLiveSessionAction's job, which creates the room
         * and the link together. The other three values are ordinary edits and
         * pass through.
         */
        if (data.status === "ongoing") {
            return {
                success: false as const,
                data: null,
                error: 'Use "Go Live" to start a session — it creates the classroom and the meeting link. Saving the status alone would show members a live event with no room to join.',
            };
        }

        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        });

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Update event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to update event" , data: null };
    }
}

export async function updateTrainingEventAction(...args: Parameters<typeof _updateTrainingEventAction>) {
    return withFlexibleSafeAction("updateTrainingEventAction", _updateTrainingEventAction)(...args);
}


async function _deleteTrainingEventAction(
    eventId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        /**
         *   #302 THIS DESTROYED THREE THINGS, AND ONE OF THE THREE WAS MY OWN
         *        EARLIER FIX.
         *
         *        The event, its live-session documents, and every registration
         *        against it. The note below used to argue for deleting the
         *        registrations: "Deleted rather than marked, matching how the
         *        event itself is removed: a registration for an event that does
         *        not exist is not a record of anything."
         *
         *        That reasoning was sound only while the event was destroyed.
         *        It is retired now, so the event DOES exist, and a member's
         *        record of a training they registered for — and possibly
         *        ATTENDED, since `attended` is set on these rows and
         *        _member.ts counts trainingsCompleted from them — is a record
         *        of something. Deleting it erased attendance history to tidy up
         *        a count.
         *
         *        "cancelled" was already in the vocabulary
         *        (types/wave-actions.ts) and the member list already excludes
         *        it — it queries status in ["upcoming", "ongoing"] — so the
         *        status change alone takes the event off every member's screen.
         */
        const eventRef = db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId);
        const eventSnap = await eventRef.get();
        if (!eventSnap.exists) {
            return { success: false as const, error: "Event not found", data: null };
        }

        await eventRef.update({
            status: "cancelled",
            ...retirementPatch(session.user.id, eventSnap.data()?.status),
        });

        // The live-session documents are retired with it. Nothing joins a
        // cancelled event's room — _wv_admin_live gates on the event — and the
        // session row is the record that the class was scheduled.
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", `wave-training-${eventId}`)
            .get();
        if (!sessionQuery.empty) {
            const sessionBatch = db.batch();
            sessionQuery.docs.forEach(doc => sessionBatch.update(doc.ref, {
                status: "cancelled",
                ...retirementPatch(session.user.id, doc.data()?.status),
            }));
            await sessionBatch.commit();
        }

        /**
         * The REGISTRATIONS were left behind, and then over-corrected.
         *
         * FIRST DEFECT: deleting an event cleaned up its live-session documents
         * and nothing else, so every member who had signed up kept a row in
         * WAVE_TRAINING_REGISTRATIONS pointing at an event that no longer
         * existed. Two readers walk those rows — _member.ts builds the member's
         * training history and their dashboard counts from them — so a deleted
         * event went on being counted as training the member is registered for,
         * with nothing left to render but the id.
         *
         * SECOND DEFECT, #302: the fix for that deleted the registrations. It
         * took a member's record of a training they signed up for — and
         * possibly attended, since `attended` lives on these rows and
         * trainingsCompleted is counted from them — and destroyed it to correct
         * a count. Erasing attendance history is not a way to fix a tally.
         *
         * Now: the registration is marked cancelled and stays. The two readers
         * exclude cancelled rows from the counts, which is what the counts
         * needed all along, and the member's history keeps the row.
         */
        const registrationQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("eventId", "==", eventId)
            .get();
        if (!registrationQuery.empty) {
            const regBatch = db.batch();
            registrationQuery.docs.forEach(doc => regBatch.update(doc.ref, {
                status: "cancelled",
                eventCancelled: true,
                ...retirementPatch(session.user.id, doc.data()?.status),
            }));
            await regBatch.commit();
            logger.info(
                `[WAVE Training] Cancelled event ${eventId} and marked ` +
                `${registrationQuery.docs.length} registration(s) that point at it.`
            );
        }

        await createAdminAuditLog({
            action: "wave_training_deleted",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("Delete event error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to delete event" , data: null };
    }
}

export const deleteTrainingEventAction = withFlexibleSafeAction("deleteTrainingEventAction", _deleteTrainingEventAction);


async function _getEventParticipantsAction(eventId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" , data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        // Every sibling in this file requires "wave:manage_training"; this one
        // took isAdmin(), true for all ten admin roles, and the rows below now
        // carry each registrant's name and email.
        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const snap = await db.collection(COLLECTIONS.WAVE_TRAINING_REGISTRATIONS)
            .where("eventId", "==", eventId)
            .get();

        const participants = serializeDocs(snap.docs);

        /**
         * The registration row is `{ userId, eventId, registeredAt, attended }`
         * and nothing else, so a participant list built from it alone is a column
         * of opaque ids — which is exactly what the admin screen rendered
         * ("User ID: {participant.userId}"). An instructor taking a register
         * needs the name.
         *
         * Chunked at 30 because that is the `in` limit the other hydrations in
         * this codebase use.
         */
        const userIds = [...new Set(participants.map((p: any) => p.userId).filter(Boolean))] as string[];
        const userMap = new Map<string, { name: string; email: string; phone: string }>();

        for (let i = 0; i < userIds.length; i += 30) {
            const chunk = userIds.slice(i, i + 30);
            if (!chunk.length) continue;
            const userSnap = await db.collection(COLLECTIONS.USERS)
                .where(FieldPath.documentId(), "in", chunk)
                .get();
            userSnap.docs.forEach((doc) => {
                const canonical = extractCanonicalUser(doc.data() ?? {});
                userMap.set(doc.id, {
                    name: canonical.name || "",
                    email: canonical.email || "",
                    phone: canonical.phone || "",
                });
            });
        }

        const hydrated = participants.map((p: any) => ({
            ...p,
            user: userMap.get(p.userId) ?? null,
        }));

        /**
         * RETURNED, rather than computed and thrown away.
         *
         * This action queried the registrations, built `participants`, and then
         * returned `data: null`. The variable was never used. The admin screen
         * reads `result.data?.participants` and shows "Failed to load
         * participants" when it is absent — so View Participants on the WAVE
         * training screen has never once succeeded, for any event, for anybody.
         *
         * Keyed under `participants` because that is what the caller reads.
         */
        return { error: null, success: true as const, data: { participants: hydrated } };
    } catch (error) {
        logger.error("Get participants error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch participants" , data: null };
    }
}

export const getEventParticipantsAction = withFlexibleSafeAction("getEventParticipantsAction", _getEventParticipantsAction);
