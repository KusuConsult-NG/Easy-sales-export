"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { checkCourseAccess } from "@/lib/academy-plan";
import { isAdmin } from "@/lib/admin-permissions";
import type { Course, LiveSession } from "@/lib/types/academy-actions";

/**
 * The tier a session gets when its course cannot be read.
 *
 * checkCourseAccess treats an absent or "free" tier as open to everybody, which
 * is right for a course that really is free and wrong for one that has been
 * deleted or failed to load. A name no plan grants means such a session fails
 * CLOSED (#267).
 */
const LOCKED_TIER = "__unresolved__";

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

        /**
         *   #267 AND A SESSION IS NOT ENTITLEMENT.
         *
         *        The comment above got the reasoning right — a meeting link is
         *        a bearer credential — and then stopped one step short of the
         *        property it needed. Closing "unauthenticated" left
         *        "authenticated but has not bought this tier", and academy
         *        registration is FREE: anyone can join that population in about
         *        thirty seconds, then call this with no courseId and receive the
         *        join link to every paid live class in the platform.
         *
         *        The rule already existed, with this exact argument written out.
         *        _ac_catalog.ts's getCourseByIdAction gates paid material on
         *        checkCourseAccess and explains why: "The tier gate is consulted
         *        by the enrolment action, by the course page's redirect and by
         *        the catalogue's padlock — but not here, and this is where the
         *        content is served." This reader is also where content is
         *        served, and it was not fixed with it.
         *
         *        The ROW stays and the credential goes. A learner seeing that a
         *        live class exists is what the schedule page is for — that is
         *        the padlock, not the content — which is the same choice
         *        stripLockedContent makes in the catalogue.
         */
        const viewerIsAdmin = isAdmin(sessionResult.session.user.roles);
        const viewerPlan = (sessionResult.session.user as any)
            ?.serviceRegistrations?.academy?.plan;

        // One read per distinct course rather than one per session: the
        // whole-platform call returns every session, and most courses carry
        // several.
        const courseIds = [...new Set(snapshot.docs
            .map((doc) => doc.data()?.courseId)
            .filter((id): id is string => typeof id === "string" && id.length > 0))];

        const tierByCourse = new Map<string, unknown>();
        await Promise.all(courseIds.map(async (id) => {
            const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(id).get();
            // A session whose course is gone is left with NO tier, and
            // checkCourseAccess treats an absent tier as free — so it is
            // recorded as a sentinel instead and refused below. Failing open on
            // a missing record is #245.
            tierByCourse.set(id, courseDoc.exists ? courseDoc.data()?.tier : LOCKED_TIER);
        }));

        const data = snapshot.docs.map((doc) => {
            const d = doc.data();
            const row: Record<string, unknown> = {
                id: doc.id,
                ...d,
                // Serialize Timestamps → ISO strings
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
                scheduledAt: d.scheduledAt?.toDate?.() ?? d.scheduledAt ?? null,
            };

            const opensThisTier = checkCourseAccess(viewerPlan, tierByCourse.get(d?.courseId));
            if (!viewerIsAdmin && !opensThisTier) {
                delete row.meetingLink;
                delete row.customMeetingLink;
                // The recording is the same paid artefact by another route:
                // /academy/live lists it as `status === "ended" && recordingUrl`.
                delete row.recordingUrl;
            }

            return row;
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

        // Attaching a recording after the fact touches ONE session.
        //
        // The fallback below fetched every session of the course that had
        // already ended, and the loop then stamped `recordingUrl` onto all of
        // them. A course with a weekly live class had one recording overwrite
        // the recording link of every previous week — /academy/live lists
        // recordings as `status === "ended" && s.recordingUrl`, so every past
        // week pointed at the newest video.
        //
        // The most recently ended session is the one an admin uploading a
        // recording means. Ordering by scheduledAt rather than taking whatever
        // the database returned first, for the reason set out in
        // lib/escrow-status.ts: `docs[0]` is not a choice.
        if (snapshot.empty && recordingUrl) {
            const ended = await ref
                .where("courseId", "==", courseId)
                .where("status", "==", "ended")
                .orderBy("scheduledAt", "desc")
                .limit(1)
                .get();
            snapshot = ended;
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
