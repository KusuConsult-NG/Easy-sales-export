"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";

async function _startWaveLiveSessionAction(
    eventId: string,
    customMeetingLink?: string
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

        // 1. Get event details
        const eventDoc = await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).get();
        if (!eventDoc.exists) {
            return { success: false as const, error: "Event not found" , data: null };
        }
        const eventData = eventDoc.data()!;

        // 2. Parse duration minutes from duration string (e.g. "2 hours" -> 120, "45 min" -> 45)
        let durationMinutes = 60;
        const durStr = String(eventData.duration || "");
        const numMatch = durStr.match(/\d+/);
        if (numMatch) {
            const num = parseInt(numMatch[0], 10);
            if (durStr.toLowerCase().includes("hour")) {
                durationMinutes = num * 60;
            } else {
                durationMinutes = num;
            }
        }

        const roomName = `wave-training-${eventId}`;
        const finalMeetingLink = customMeetingLink || `/wave/live-training`;

        /**
         * 3. CLAIM the event as ongoing, rather than declaring it so.
         *
         * This was a blind `.update({ status: "ongoing" })`. It read no status
         * and compared nothing, so Go Live worked on an event in ANY state:
         *
         *   - completed  → the finished session reopened. Members whose
         *                  registrations were closed out see it live again, and
         *                  endWaveLiveSessionAction will mark it completed a
         *                  second time.
         *   - cancelled  → a cancelled event went live. Nothing told the
         *                  registrants it was back on.
         *   - ongoing    → two admins pressing Go Live both "started" it, each
         *                  writing their own meetingLink over the other's. The
         *                  members who joined through the first link were left in
         *                  a room the admin is no longer in.
         *
         * Same defect and same fix as the land status writes (#27) and the admin
         * land editor (#143): the transition is claimed in SQL, so exactly one
         * caller starts a given session.
         *
         * `upcoming` is the only starting state, which is what the admin screen
         * already assumes — it renders Go Live behind
         * `event.status === "upcoming"`. The claim closes the direct path the
         * button's condition could not.
         *
         * Safe to be this strict: WAVE_TRAINING_EVENTS has exactly one creator,
         * createTrainingEventAction, and it always writes "upcoming". There are
         * no rows with a missing or legacy status to lock out.
         */
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.WAVE_TRAINING_EVENTS,
            id: eventId,
            fromAny: ["upcoming"],
            to: "ongoing",
            patch: {
                meetingLink: finalMeetingLink,
                startedBy: session.user.id,
                startedAt: new Date().toISOString(),
            },
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                data: null,
                error: claim.status === null
                    ? "Event not found"
                    : claim.status === "ongoing"
                        ? "This session is already live. Open the classroom instead of starting it again."
                        : `This event is ${claim.status} and cannot be started.`,
            };
        }

        // 4. Create/overwrite the live training session document
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", roomName)
            .get();

        if (sessionQuery.empty) {
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).add({
                title: eventData.title,
                description: eventData.description || "",
                scheduledAt: new Date(),
                durationMinutes,
                roomName,
                isActive: true,
                customMeetingLink: customMeetingLink || null,
                createdAt: new Date(),
                createdBy: session.user.id,
            });
        } else {
            // Update existing to make it active now
            const docId = sessionQuery.docs[0].id;
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).doc(docId).update({
                scheduledAt: new Date(),
                isActive: true,
                durationMinutes,
                customMeetingLink: customMeetingLink || null,
                updatedAt: new Date(),
            });
        }

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
            // Start and end shared one action name and carried no metadata, so
            // the log could not distinguish "went live" from "ended the session"
            // from "edited the title" — which is what you need it for when a
            // member disputes whether a session ran.
            metadata: { phase: "start", roomName, meetingLink: finalMeetingLink },
        });

        return { error: null, success: true as const, data: { roomName } };
    } catch (error) {
        logger.error("Start live session error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to start live session" , data: null };
    }
}

export async function startWaveLiveSessionAction(...args: Parameters<typeof _startWaveLiveSessionAction>) {
    return withFlexibleSafeAction("startWaveLiveSessionAction", _startWaveLiveSessionAction)(...args);
}


async function _endWaveLiveSessionAction(
    eventId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        if (!hasAdminPermission(session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        /**
         * 1. CLAIM the event as completed.
         *
         * Blind `.update({ status: "completed" })` before this, with the same
         * consequences as the start path in reverse: End Session on an
         * `upcoming` event marked a session completed that never ran, and on a
         * `cancelled` one it un-cancelled it into completion. Only an ongoing
         * session can end.
         */
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.WAVE_TRAINING_EVENTS,
            id: eventId,
            fromAny: ["ongoing"],
            to: "completed",
            patch: {
                endedBy: session.user.id,
                endedAt: new Date().toISOString(),
            },
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                data: null,
                error: claim.status === null
                    ? "Event not found"
                    : claim.status === "completed"
                        ? "This session has already ended."
                        : `This event is ${claim.status}, so there is no live session to end.`,
            };
        }

        // 2. Mark the training session document as inactive
        const roomName = `wave-training-${eventId}`;
        const sessionQuery = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", roomName)
            .get();

        for (const doc of sessionQuery.docs) {
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).doc(doc.id).update({
                isActive: false,
                endedAt: new Date(),
                updatedAt: new Date(),
            });
        }

        await createAdminAuditLog({
            action: "wave_training_updated",
            userId: session.user.id,
            targetType: "wave_training_event",
            targetId: eventId,
            metadata: { phase: "end", roomName },
        });

        return { error: null, success: true as const, data: null };
    } catch (error) {
        logger.error("End live session error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to end live session", data: null };
    }
}

export async function endWaveLiveSessionAction(...args: Parameters<typeof _endWaveLiveSessionAction>) {
    return withFlexibleSafeAction("endWaveLiveSessionAction", _endWaveLiveSessionAction)(...args);
}
