"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/lib/audit-log";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";

async function _getAcademyInstructorsAction(): Promise<ActionResponse<any[]>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated", data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        const instructorsSnap = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "academy_instructor")
            .get();

        const instructors = serializeDocs(instructorsSnap.docs);

        return { success: true, error: null, data: instructors };
    } catch (error) {
        logger.error("Get academy instructors error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch instructors", data: null };
    }
}

export const getAcademyInstructorsAction = withFlexibleSafeAction("getAcademyInstructorsAction", _getAcademyInstructorsAction);


async function _getAcademyCoursesAction(options?: {
    limit?: number;
    search?: string;
}): Promise<ActionResponse<{ courses: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated", data: null };
        }

        if (!isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.ACADEMY_COURSES);
        const fetchLimit = options?.search ? 5000 : (options?.limit || 50);
        q = q.orderBy("createdAt", "desc").limit(fetchLimit);

        const snapshot = await q.get();
        let courses = serializeDocs(snapshot.docs);

        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            courses = courses.filter((c: any) => {
                const searchString = [
                    c.id,
                    c.title,
                    c.instructorName,
                    c.category,
                    c.level
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        return { success: true, error: null, data: { courses } };
    } catch (error) {
        logger.error("Get academy courses error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to fetch courses", data: null };
    }
}

export const getAcademyCoursesAction = withFlexibleSafeAction("getAcademyCoursesAction", _getAcademyCoursesAction);


async function _upsertAcademyCourseAction(
    courseId: string | "new",
    courseData: any
): Promise<ActionResponse<null>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated", data: null };
        }

        if (!hasAdminPermission(session.user.roles, "academy:manage_courses")) {
            return { success: false, error: "Unauthorized", data: null };
        }
        const { courseSchema } = await import("@/lib/schemas");
        const validated = courseSchema.safeParse(courseData);
        if (!validated.success) {
            return { success: false, error: validated.error.issues[0].message, data: null };
        }

        const cleanData = {
            ...validated.data,
            updatedAt: FieldValue.serverTimestamp(),
            _version: FieldValue.increment(1),
        };

        // Which of the two this is, decided BEFORE courseId is reassigned.
        //
        // The audit call below asked `courseId === "new"` — but the create
        // branch sets `courseId = newRef.id` first, so by the time the question
        // was put it could never be "new". Every course creation was recorded as
        // UPDATE_COURSE, and the audit log has never contained a CREATE_COURSE
        // entry for this action. A log that cannot distinguish a course being
        // created from one being edited is the half that matters missing.
        const isNew = courseId === "new";

        if (isNew) {
            const newRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc();
            await newRef.set({
                ...cleanData,
                createdAt: FieldValue.serverTimestamp(),
                /**
                 *   #336 THE TALLY THE TYPE REQUIRES WAS THE ONE NO CREATOR
                 *        WROTE.
                 *
                 *        lib/types/academy.ts declares `enrolledCount: number`
                 *        — REQUIRED — and this creator initialised
                 *        `studentsCount` instead, while the other creator
                 *        (_ac_catalog.ts) initialised no counter at all. So
                 *        every course was born violating its own type, and the
                 *        two enrolment paths then incremented two further
                 *        names: `enrolledCount` (free, _ac_enrollment.ts) and
                 *        `students` (paid, _payment.ts). Four names, one tally.
                 *
                 *        `enrolledCount` is initialised here because it is the
                 *        declared one and the one the free path already
                 *        maintains. `studentsCount` is KEPT rather than
                 *        renamed: rows already carry it, and this audit does
                 *        not strand data.
                 */
                enrolledCount: 0,
                studentsCount: 0,
                rating: 0,
                status: "draft",
                _version: 0,
            });
            courseId = newRef.id;
        } else {
            await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update(cleanData);
        }

        await logAuditAction({
            userId: session.user.id,
            action: isNew ? "CREATE_COURSE" : "UPDATE_COURSE",
            resourceId: courseId,
            resourceType: "academy_course",
            metadata: { title: courseData.title },
        });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Upsert academy course error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false, error: "Failed to save course", data: null };
    }
}

export const upsertAcademyCourseAction = withFlexibleSafeAction("upsertAcademyCourseAction", _upsertAcademyCourseAction);
