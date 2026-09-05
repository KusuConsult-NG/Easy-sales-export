/**
 * The TWO records that together mean "this learner is on this course".
 *
 *   #424 A COURSE BOUGHT OUTRIGHT COULD BE OPENED AND WATCHED, AND NEVER
 *   COMPLETED.
 *
 *   Academy keeps a learner's place on a course in two documents, written by
 *   different code and read by different code:
 *
 *     PLACE A   user_progress/{userId}/courses/{courseId}      (subcollection)
 *               Carries the #378 purchase stamp. The course page reads it
 *               through getUserProgressAction and asks isPurchasedCourse, so
 *               this is what OPENS a bought course.
 *
 *     PLACE B   course_progress/{userId}_{courseId}            (composite id)
 *               Carries progressPercent / completed / completedAt.
 *               completeCourse and generateCourseCertificate BOTH address it by
 *               that id, and completeCourse refuses outright when it is absent:
 *
 *                   if (!progressDoc.exists) throw new Error("No progress record found")
 *
 *   autoEnrollPaidUser writes both, which is why nothing looked wrong for a
 *   learner on a paid PLAN — it runs on every academy dashboard load and
 *   creates whichever is missing.
 *
 *   The per-course purchase (#378, _ac_course_payment.ts) wrote only PLACE A.
 *   And it is exactly the path that autoEnrollPaidUser cannot cover: that
 *   function enrols from the learner's PLAN against the course TIER, and
 *   somebody who buys a single elite course on a foundation plan fails that
 *   test — which is why they bought the course. So for them PLACE B was never
 *   created by anything:
 *
 *     open the course      works    (PLACE A, purchased: true)
 *     watch the lessons    works    (lesson_video_progress, its own collection)
 *     finish the course    FAILS    "Failed to complete course"
 *     get the certificate  FAILS    "Course not completed yet"
 *
 *   They paid, they watched it to the end, and the button that ends it refused
 *   them with an error that reads like a bug rather than an explanation.
 *
 *   Nothing lazily repairs it either: updateLessonProgress writes only
 *   lesson_video_progress, so no amount of watching creates PLACE B.
 *
 *   THE RULE IS STATED ONCE, HERE, and both enrolment paths ask for it. A
 *   fourth place that grants course access — and this codebase has had four
 *   names for one enrolment tally before (#336) — starts by calling this rather
 *   than by remembering which two documents to write.
 *
 *   MERGE, NEVER OVERWRITE. The zeroed shape is written only when PLACE B does
 *   not already exist. Merging zeros over a learner who has progress is exactly
 *   how autoEnrollPaidUser once wiped it (see _ac_enrollment.ts), and the guard
 *   there is a read of the deterministic id rather than trust in a query.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/** PLACE B's document id. Deterministic, so existence is knowable without a query. */
export function courseProgressDocId(userId: string, courseId: string): string {
    return `${userId}_${courseId}`;
}

/** PLACE A's document path. */
export function userProgressPath(userId: string, courseId: string): string {
    return `user_progress/${userId}/courses/${courseId}`;
}

/**
 * The zeroed PLACE B shape.
 *
 * Both progressPercent and completionPercentage are written: readers are split
 * between the two names and getCourseProgress falls back from one to the other.
 */
export function initialCourseProgress(userId: string, courseId: string): Record<string, unknown> {
    return {
        userId,
        courseId,
        progressPercent: 0,
        completionPercentage: 0,
        lastWatchedSecond: 0,
        completed: false,
        completedAt: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    };
}

/**
 * Make sure PLACE B exists for this learner and course.
 *
 * Returns true when it created one. Never touches an existing row — a learner
 * part-way through a course must come out of this unchanged.
 */
export async function ensureCourseProgressRecord(
    userId: string,
    courseId: string,
): Promise<boolean> {
    if (!userId || !courseId) return false;

    const ref = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(courseProgressDocId(userId, courseId));

    // Read before write. The id is deterministic, so this is authoritative —
    // unlike a query, which is what went wrong in _ac_enrollment.ts when the
    // queried field name drifted and every learner's progress was re-zeroed.
    const existing = await ref.get();
    if (existing.exists) return false;

    await ref.set(initialCourseProgress(userId, courseId), { merge: true });
    return true;
}

/**
 * Make sure the learner has an enrolment row for the course.
 *
 * course_enrollments is what the learner's course list and the certificates
 * route read. A bought course that produced no row here is invisible to both.
 */
export async function ensureCourseEnrolmentRecord(
    userId: string,
    courseId: string,
): Promise<boolean> {
    if (!userId || !courseId) return false;

    const existing = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
        .where("userId", "==", userId)
        .where("courseId", "==", courseId)
        .get();

    if (!existing.empty) return false;

    await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({
        userId,
        courseId,
        enrolledAt: FieldValue.serverTimestamp(),
        status: "active",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
}

/**
 * Both of them, for one learner and one course.
 *
 * Failures are logged and swallowed DELIBERATELY, and only where the caller has
 * already taken the money: refusing a purchase because a reporting row could
 * not be written would be worse than the missing row, and the next call repairs
 * it because both halves are existence-checked. The caller is told what
 * happened through the return value rather than through an exception.
 */
export async function ensureCourseAccessRecords(
    userId: string,
    courseId: string,
): Promise<{ progressCreated: boolean; enrolmentCreated: boolean; failed: boolean }> {
    let progressCreated = false;
    let enrolmentCreated = false;
    let failed = false;

    try {
        progressCreated = await ensureCourseProgressRecord(userId, courseId);
    } catch (err) {
        failed = true;
        logger.error(`[ensureCourseAccessRecords] course_progress for ${userId}/${courseId}:`, err);
    }

    try {
        enrolmentCreated = await ensureCourseEnrolmentRecord(userId, courseId);
    } catch (err) {
        failed = true;
        logger.error(`[ensureCourseAccessRecords] course_enrollments for ${userId}/${courseId}:`, err);
    }

    return { progressCreated, enrolmentCreated, failed };
}
