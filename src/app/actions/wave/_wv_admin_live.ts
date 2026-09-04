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
import { roomKeyFor } from "@/lib/classroom-room-key";

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

        /**
         * #188. `roomName` STAYS, and it is no longer what opens the classroom.
         *
         * It is derived from the event id, which is exactly why it could not go
         * on being the video room: anybody who knew an event id could type
         * `EasySalesExport-wave-training-<eventId>` into meet.jit.si and be in
         * a women's-programme session with no account at all.
         *
         * It is still the correlation key for the session ROW — the lookup
         * below finds the row for this event by it — and that is a legitimate
         * use for a derived identifier. What opens the room is `roomKey`, a
         * 128-bit secret minted on the server and handed out only through the
         * entitlement-gated reader.
         */
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

        let roomKey: string;

        if (sessionQuery.empty) {
            roomKey = roomKeyFor(null);
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).add({
                title: eventData.title,
                description: eventData.description || "",
                scheduledAt: new Date(),
                durationMinutes,
                roomName,
                roomKey,
                isActive: true,
                customMeetingLink: customMeetingLink || null,
                createdAt: new Date(),
                createdBy: session.user.id,
            });
        } else {
            // Update existing to make it active now
            const docId = sessionQuery.docs[0].id;
            // A row written before #188 has no roomKey; an existing minted one
            // is kept, so re-starting does not eject whoever is already in.
            roomKey = roomKeyFor(sessionQuery.docs[0].data()?.roomKey);
            await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS).doc(docId).update({
                scheduledAt: new Date(),
                isActive: true,
                durationMinutes,
                roomKey,
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
            // roomName and the meeting link, NOT roomKey: the audit log is read
            // by every admin role, and the key is the credential that opens the
            // room. What is needed here is which session ran, not how to join it.
            metadata: { phase: "start", roomName, meetingLink: finalMeetingLink },
        });

        return { error: null, success: true as const, data: { roomName, roomKey } };
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


/**
 * The room key for an event's live classroom — #188.
 *
 * The admin classroom page used to build its room name in the browser:
 *
 *     const roomName = `wave-training-${eventId}`;
 *
 * which is the guessable name the finding is about, so it cannot go on doing
 * that. The key lives on the session row and is read HERE, behind the same
 * `wave:manage_training` permission that starts the session, rather than being
 * derived from the id on the URL.
 *
 * It returns null rather than minting: only starting the session mints, so a
 * null answer means the class is not running and the page must say so instead
 * of opening a room.
 */
async function _getWaveLiveRoomKeyAction(
    eventId: string
): Promise<
    | { success: true; error: null; data: { roomKey: string | null }; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }
        if (!hasAdminPermission(sessionResult.session.user.roles, "wave:manage_training")) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.WAVE_TRAINING_SESSIONS)
            .where("roomName", "==", `wave-training-${eventId}`)
            .limit(5)
            .get();

        if (snapshot.empty) {
            return { error: null, success: true as const, data: { roomKey: null } };
        }

        const roomKey = snapshot.docs[0].data()?.roomKey;
        return {
            error: null,
            success: true as const,
            data: { roomKey: typeof roomKey === "string" && roomKey ? roomKey : null },
        };
    } catch (error) {
        logger.error("Get live room key error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        // A failed read is a failure, not "no classroom". #313's lesson.
        return { success: false as const, error: "Failed to load the classroom", data: null };
    }
}

export async function getWaveLiveRoomKeyAction(...args: Parameters<typeof _getWaveLiveRoomKeyAction>) {
    return withFlexibleSafeAction("getWaveLiveRoomKeyAction", _getWaveLiveRoomKeyAction)(...args);
}
