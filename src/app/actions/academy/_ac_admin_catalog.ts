"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { logAuditAction } from "@/lib/audit-log";
import { isAdmin } from "@/lib/admin-permissions";
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

        if (!isAdmin(session.user.roles)) {
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

        if (courseId === "new") {
            const newRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc();
            await newRef.set({
                ...cleanData,
                createdAt: FieldValue.serverTimestamp(),
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
            action: courseId === "new" ? "CREATE_COURSE" : "UPDATE_COURSE",
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
