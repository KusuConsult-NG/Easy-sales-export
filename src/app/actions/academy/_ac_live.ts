"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Course, LiveSession } from "@/lib/types/academy-actions";

/**
 * Get live sessions
 */
async function _getLiveSessionsAction(courseId?: string): Promise<ActionResponse<any>> {
    try {
        // A meeting link is a bearer credential, so this needs a session.
        //
        // The rows returned below carry `meetingLink` and `customMeetingLink` —
        // the Zoom/Meet URL an admin sets when starting a live class. Anyone
        // holding that URL can join. This function had no session check, and
        // `courseId` is optional, so calling it with NO arguments returned every
        // live session in the collection together with its join link: the whole
        // paid live-class schedule, joinable, to an unauthenticated caller.
        //
        // All four call sites — /academy/live, /academy/live/[courseId],
        // /academy/dashboard and /admin/academy/live/[courseId] — already
        // redirect an unauthenticated visitor. That is a client-side redirect
        // and not authorisation: the action is reachable whatever the page does.
        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { success: false as const, error: 'Unauthorized', data: null };
        }

        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        const query = courseId ? ref.where("courseId", "==", courseId) : ref;
        const snapshot = await query.get();

        const data = snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                ...d,
                // Serialize Timestamps → ISO strings
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
                scheduledAt: d.scheduledAt?.toDate?.() ?? d.scheduledAt ?? null,
            };
        }) as unknown as LiveSession[];
        return { success: true, error: null, data: serializeValue(data) };
    } catch (error) {
        logger.error("Failed to fetch live sessions:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: error instanceof Error ? error.message : "Fetch failed" };
    }
}


export async function getLiveSessionsAction(...args: Parameters<typeof _getLiveSessionsAction>) {
    return withFlexibleSafeAction("getLiveSessionsAction", _getLiveSessionsAction)(...args);
}


async function _startAcademyLiveSessionAction(
    courseId: string,
    customMeetingLink?: string
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

        const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin") || session.user.roles?.includes("academy_admin");
        if (!isAdminUser) {
            return { success: false as const, error: "Unauthorized — admin access required", data: null };
        }

        // 1. Fetch course details
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) {
            return { success: false as const, error: "Course not found", data: null };
        }
        const courseData = courseDoc.data()!;

        const title = `Live Class: ${courseData.title}`;
        const instructor = courseData.instructor || "Super Admin";
        const meetingLink = customMeetingLink || `/academy/live/${courseId}`;

        // 2. Look for active session
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        const query = ref.where("courseId", "==", courseId).where("status", "==", "live");
        const snapshot = await query.get();

        let sessionId = "";

        if (snapshot.empty) {
            // Create a new active live session
            const newSession = await ref.add({
                courseId,
                title,
                instructor,
                scheduledAt: new Date(),
                duration: "2 hours",
                meetingLink,
                customMeetingLink: customMeetingLink || null,
                maxParticipants: 100,
                currentParticipants: 0,
                status: "live",
                createdAt: new Date(),
            });
            sessionId = newSession.id;
        } else {
            // Re-activate or use existing
            sessionId = snapshot.docs[0].id;
            await ref.doc(sessionId).update({
                status: "live",
                scheduledAt: new Date(),
                meetingLink,
                customMeetingLink: customMeetingLink || null,
            });
        }

        return { success: true as const, error: null, data: { sessionId } };
    } catch (error) {
        logger.error("Failed to start academy live session:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to start live session", data: null };
    }
}


export async function startAcademyLiveSessionAction(...args: Parameters<typeof _startAcademyLiveSessionAction>) {
    return withFlexibleSafeAction("startAcademyLiveSessionAction", _startAcademyLiveSessionAction)(...args);
}


async function _endAcademyLiveSessionAction(
    courseId: string,
    recordingUrl?: string
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

        const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin") || session.user.roles?.includes("academy_admin");
        if (!isAdminUser) {
            return { success: false as const, error: "Unauthorized — admin access required", data: null };
        }

        // Delete or end live sessions for this course
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        let snapshot = await ref.where("courseId", "==", courseId).where("status", "==", "live").get();

        if (snapshot.empty && recordingUrl) {
            snapshot = await ref.where("courseId", "==", courseId).where("status", "==", "ended").get();
        }

        for (const doc of snapshot.docs) {
            const updateData: any = {
                status: "ended",
            };
            if (recordingUrl) {
                updateData.recordingUrl = recordingUrl;
            }
            await ref.doc(doc.id).update(updateData);
        }

        return { success: true as const, error: null, data: null };
    } catch (error) {
        logger.error("Failed to end academy live session:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to end live session", data: null };
    }
}


export async function endAcademyLiveSessionAction(...args: Parameters<typeof _endAcademyLiveSessionAction>) {
    return withFlexibleSafeAction("endAcademyLiveSessionAction", _endAcademyLiveSessionAction)(...args);
}
