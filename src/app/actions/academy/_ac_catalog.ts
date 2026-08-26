"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { stripAnswerKey, stripLockedContent } from "@/lib/academy-grading";
import { checkCourseAccess } from "@/lib/academy-plan";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Course, CourseModule } from "@/lib/types/academy-actions";
import { retirementPatch, isRetired } from "@/lib/record-retirement";

/**
 * Get all courses
 */
async function _getCoursesAction(
    limit: number = 12,
    lastDocId?: string
): Promise<ActionResponse<Course[]>> {
    try {
        let q = db.collection(COLLECTIONS.ACADEMY_COURSES)
            .orderBy("createdAt", "desc");

        if (lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        /**
         * `limit + 1`, so "is there more" is observed rather than guessed.
         *
         * This fetched exactly `limit` and inferred hasMore from a FULL page:
         *
         *     const hasMore = snapshot.docs.length === limit;
         *
         * which is true on the last page whenever the catalogue size is an exact
         * multiple of the page size. The admin then pressed "load more" and got
         * an empty page. Every other paginated list here reads one extra row for
         * exactly this reason.
         */
        q = q.limit(limit + 1);

        const snapshot = await q.get();

        // The answer key does not go to the browser — from the LIST either.
        //
        // getCourseByIdAction below strips modules[].quiz.questions[].correctAnswer
        // for non-admins. This function did not, and it returns whole course
        // documents: calling it fetched up to `limit` courses complete with the
        // answers to every quiz in them. The fix on the single-course read was
        // bypassed entirely by its own sibling, so the rule was enforced on one
        // of the two ways to obtain exactly the same document.
        //
        // Same admin carve-out as the sibling, and for the same reason:
        // /admin/academy lists courses for an editor that cannot edit questions
        // it cannot see.
        const sessionResult = await requireSession();
        const viewerIsAdmin = isAdmin(sessionResult.session?.user?.roles);

        // Same two rules as the single-course read below: the answer key, and
        // the paid material of a tier this viewer's plan does not open.
        const viewerPlan = (sessionResult.session?.user as any)
            ?.serviceRegistrations?.academy?.plan;

        const hasMore = snapshot.docs.length > limit;
        const pageDocs = hasMore ? snapshot.docs.slice(0, limit) : snapshot.docs;

        // #302 A retired course leaves the catalogue here. It is still readable
        // by id, which is what the enrolments, progress records and issued
        // certificates that key on courseId depend on.
        //
        // Filtered after the page is cut rather than in the query: `retired` is
        // absent on every existing row, and a .where() on a field no row has yet
        // is the shape that has emptied lists in this codebase before. The
        // cursor still advances by raw rows, so pagination stays correct — a
        // page may simply be shorter.
        const raw = serializeDocs<Course>(pageDocs.filter((d: any) => !isRetired(d.data())));
        const courses = viewerIsAdmin
            ? raw
            : raw.map((c) => {
                const visible = checkCourseAccess(viewerPlan, (c as any)?.tier)
                    ? c
                    : stripLockedContent(c);
                return stripAnswerKey(visible);
            });

        const newLastDocId = hasMore && pageDocs.length > 0
            ? pageDocs[pageDocs.length - 1].id
            : null;

        return {
            success: true, 
            error: null, 
            data: courses,
            lastDocId: newLastDocId,
            hasMore
        };
    } catch (error) {
        logger.error("Failed to fetch courses:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { 
            success: false, 
            error: error instanceof Error ? error.message : "Fetch failed", 
            data: null,
            lastDocId: null,
            hasMore: false
        };
    }
}


export const getCoursesAction = withFlexibleSafeAction("getCoursesAction", _getCoursesAction);


/**
 * Get course by ID — direct Firestore fetch (no module-level cache).
 * Using unstable_cache at module scope caused null to be cached at build time.
 * Per-request caching via Next.js fetch cache handles deduplication instead.
 */
async function _getCourseByIdAction(courseId: string): Promise<ActionResponse<any>> {
    try {
        if (!courseId) return { success: false as const, data: null, error: 'Course ID missing' };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();

        if (!courseDoc.exists) {
            logger.warn(`[getCourseByIdAction] Course not found in Firestore: ${courseId}`);
            return { success: true, error: null, data: null };
        }

        const d = courseDoc.data()!;
        const formattedCourse = serializeDoc<Course>(courseDoc.id, d);

        // The answer key does not go to the browser.
        //
        // This returned the whole course document, and modules[].quiz.questions[]
        // carries correctAnswer. Every learner loading a course page received the
        // answers to its quizzes, and QuizComponent then graded against them
        // client-side. The API route path strips exactly this before sending a
        // quiz; this path did not.
        //
        // Admins keep it: /admin/academy/[courseId] is the course editor and
        // cannot edit questions it cannot see. Same shape as the email masking
        // in messages.ts — the caller knows who is asking, so the caller decides.
        const sessionResult = await requireSession();
        const viewerIsAdmin = isAdmin(sessionResult.session?.user?.roles);

        // And the paid material does not go to a plan that does not open it.
        //
        // The tier gate is consulted by the enrolment action, by the course
        // page's redirect and by the catalogue's padlock — but not here, and
        // this is where the content is served. The redirect and the padlock were
        // drawn after the browser already held the videos they were hiding, and
        // a caller who loaded neither page could ask for them directly.
        const viewerPlan = (sessionResult.session?.user as any)
            ?.serviceRegistrations?.academy?.plan;
        const opensThisTier = checkCourseAccess(viewerPlan, (formattedCourse as any)?.tier);

        const visible = viewerIsAdmin || opensThisTier
            ? formattedCourse
            : stripLockedContent(formattedCourse);

        return {
            error: null,
            success: true as const,
            data: viewerIsAdmin ? visible : stripAnswerKey(visible),
        };
    } catch (error) {
        logger.error("[getCourseByIdAction] Failed to fetch course:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}


export async function getCourseByIdAction(...args: Parameters<typeof _getCourseByIdAction>) {
    return withFlexibleSafeAction("getCourseByIdAction", _getCourseByIdAction)(...args);
}


/**
 * ADMIN ACTIONS
 */

async function _createCourseAction(data: any): Promise<ActionResponse<{ id: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        /**
         * THIS HAD NO ADMIN GATE.
         *
         * It checked `session?.user?.id` and nothing else, so any signed-in
         * account could create a course in the Academy catalogue — and the
         * createAdminAuditLog call below recorded it as an admin action naming
         * the caller. The three sibling writes in this file at least asked for a
         * role; this one asked only that somebody was logged in.
         *
         * The audit ratchet could not see it: admin-action-audit-trail matches
         * `hasAdminPermission(` or `requireAdmin(`, and a file using neither is
         * never inspected. That is #190's blind spot in its third form — a gate
         * so weak the ratchet did not recognise the file as gated at all.
         *
         * academy:manage_courses is what the OTHER implementation of this same
         * operation uses (_ac_admin_catalog.ts's upsert), so this is the two
         * paths agreeing rather than a new rule.
         */
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_courses")) {
            return { success: false as const, error: "Unauthorized: academy:manage_courses required", data: null };
        }

        // Validate with Zod
        const { createCourseSchema } = await import("@/lib/validations/course");
        const validation = createCourseSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues[0]?.message || "Validation failed",
                data: null
            };
        }

        const validatedData = validation.data;

        const docRef = await db.collection(COLLECTIONS.ACADEMY_COURSES).add({
            ...validatedData,
            instructorId: session.user.id, // Ensure instructor is linked
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            modules: [],
            status: "draft",
        });

        await createAdminAuditLog({
            action: "course_created",
            userId: session.user.id,
            targetId: docRef.id,
            targetType: "course",
        });

        revalidatePath("/admin/academy", "page");

        return { success: true, error: null, data: { id: docRef.id } };
    } catch (error) {
        logger.error("Create course error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Course creation failed", data: null };
    }
}


export const createCourseAction = withFlexibleSafeAction("createCourseAction", _createCourseAction);


async function _updateCourseAction(courseId: string, data: Partial<Course>): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        /**
         * The ACADEMY admin could not edit an Academy course.
         *
         * A hand-written `admin || super_admin` pair, and `academy_admin` is in
         * neither — while the read above uses isAdmin(), which admits all ten
         * roles. So the academy admin could open the course editor, see every
         * quiz answer, and save nothing. The OTHER implementation of this write
         * (_ac_admin_catalog.ts) already gates on academy:manage_courses, so the
         * two paths disagreed about who may edit a course.
         *
         * Same correction as #115, #122, #158 and #195.
         */
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_courses")) {
            return { success: false as const, error: "Unauthorized: academy:manage_courses required", data: null };
        }

        /**
         * VALIDATED, not spread.
         *
         * This was `{ ...data, updatedAt }` with `data: Partial<Course>` — a
         * TypeScript annotation, which is nothing at a server-action boundary.
         * Any field the caller named was written, including `tier` (the paid
         * access gate checkCourseAccess reads), `status`, `instructorId`,
         * `studentsCount` and `createdAt`. The sibling implementation of this
         * write validates with courseSchema; this one, the path the admin editor
         * actually calls, validated nothing. #43 and #45's family.
         *
         * `.partial()` of the create schema, so the editable set is exactly the
         * creatable set and Zod drops everything else. The editor sends title,
         * description, instructor and tier — all four are in it, and tier is in
         * it BECAUSE of the fix above; validating against the old schema would
         * have silently dropped the field the editor exists to set.
         */
        const { createCourseSchema } = await import("@/lib/validations/course");
        const validation = createCourseSchema.partial().safeParse(data);

        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues[0]?.message || "Validation failed",
                data: null,
            };
        }

        await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update({
            ...validation.data,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "course_updated",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Updated details",
        });

        revalidatePath("/admin/academy", "page");

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Update course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed", data: null };
    }
}


export const updateCourseAction = withFlexibleSafeAction("updateCourseAction", _updateCourseAction);


async function _updateCourseModulesAction(courseId: string, modules: CourseModule[]): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        /**
         * The ACADEMY admin could not edit an Academy course.
         *
         * A hand-written `admin || super_admin` pair, and `academy_admin` is in
         * neither — while the read above uses isAdmin(), which admits all ten
         * roles. So the academy admin could open the course editor, see every
         * quiz answer, and save nothing. The OTHER implementation of this write
         * (_ac_admin_catalog.ts) already gates on academy:manage_courses, so the
         * two paths disagreed about who may edit a course.
         *
         * Same correction as #115, #122, #158 and #195.
         */
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_courses")) {
            return { success: false as const, error: "Unauthorized: academy:manage_courses required", data: null };
        }

        logger.info(`[updateCourseModulesAction] Saving ${modules?.length} modules for course ${courseId}`);

        await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update({
            modules,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "course_updated",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Updated modules",
        });

        revalidatePath("/admin/academy", "page");

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Update modules error:", {
            courseId,
            moduleCount: modules?.length,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed", data: null };
    }
}


export const updateCourseModulesAction = withFlexibleSafeAction("updateCourseModulesAction", _updateCourseModulesAction);


async function _deleteCourseAction(courseId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        /**
         * The ACADEMY admin could not edit an Academy course.
         *
         * A hand-written `admin || super_admin` pair, and `academy_admin` is in
         * neither — while the read above uses isAdmin(), which admits all ten
         * roles. So the academy admin could open the course editor, see every
         * quiz answer, and save nothing. The OTHER implementation of this write
         * (_ac_admin_catalog.ts) already gates on academy:manage_courses, so the
         * two paths disagreed about who may edit a course.
         *
         * Same correction as #115, #122, #158 and #195.
         */
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_courses")) {
            return { success: false as const, error: "Unauthorized: academy:manage_courses required", data: null };
        }

        /**
         *   #302 DELETING A COURSE ORPHANED EVERY ENROLMENT AND CERTIFICATE.
         *
         *        `.delete()` on the course row, while enrolments, progress
         *        records and issued certificates all key on courseId.
         *        _ac_progress.ts reads ACADEMY_COURSES.doc(p.courseId) for each
         *        of a learner's enrolments, and the certificate routes read it
         *        to render the certificate — so a learner who had FINISHED the
         *        course lost the record of what they had finished.
         *
         *        Owner decision, as #300 and #301: nothing is deleted. The row
         *        is archived and the list filters it out; every read by id
         *        keeps working, which is what those enrolments depend on.
         */
        const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId);
        const courseSnap = await courseRef.get();
        if (!courseSnap.exists) {
            return { success: false as const, error: "Course not found", data: null };
        }

        await courseRef.update({
            status: "archived",
            ...retirementPatch(session.user.id, courseSnap.data()?.status),
            updatedAt: new Date().toISOString(),
        });

        await createAdminAuditLog({
            action: "course_deleted",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Deleted course",
        });

        revalidatePath("/admin/academy", "page");

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Delete course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Deletion failed", data: null };
    }
}


export const deleteCourseAction = withFlexibleSafeAction("deleteCourseAction", _deleteCourseAction);
