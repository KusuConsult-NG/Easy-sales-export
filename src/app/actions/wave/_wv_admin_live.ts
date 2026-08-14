"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";

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

        if (!isAdmin(session.user.roles)) {
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

        // 3. Update event status to ongoing
        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            status: "ongoing",
            meetingLink: finalMeetingLink,
            updatedAt: FieldValue.serverTimestamp(),
        });

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

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // 1. Mark the training event as completed
        await db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).doc(eventId).update({
            status: "completed",
            updatedAt: FieldValue.serverTimestamp(),
        });

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
