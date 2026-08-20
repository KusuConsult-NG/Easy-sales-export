"use server";

import { z } from "zod";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { courseProgressSchema,
    courseEnrollmentSchema } from "@/lib/validations/course";
import { AuditActionType, type CourseProgress } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { checkCourseAccess, normaliseAcademyPlan } from "@/lib/academy-plan";
import { isDecidedAgainst } from "@/lib/registration-progress";

/**
 * Update lesson progress (called by video player)
 */
export async function updateLessonProgress(
    data: z.infer<typeof courseProgressSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try {
        const validated = courseProgressSchema.parse(data);

        // Use a composite ID for uniqueness: userId_courseId_lessonId
        const progressId = `${session.user.id}_${validated.lessonId}`;
        const lessonProgressRef = db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId);

        // Check existing progress to validate heartbeat watch speed
        const existingDoc = await lessonProgressRef.get();
        let finalLastWatchedSecond = validated.lastWatchedSecond;
        let finalProgressPercent = validated.progressPercent;

        if (existingDoc.exists) {
            const existing = existingDoc.data();
            const lastUpdated = existing?.updatedAt ? (existing.updatedAt instanceof Timestamp ? existing.updatedAt.toDate() : new Date(existing.updatedAt)) : null;
            
            if (lastUpdated) {
                const elapsedTimeSeconds = (Date.now() - lastUpdated.getTime()) / 1000;
                const progressIncreaseSeconds = validated.lastWatchedSecond - (existing?.lastWatchedSecond || 0);

                if (progressIncreaseSeconds > 0) {
                    const maxSpeedMultiplier = 2.0; // Allowed playback rate up to 2.0x
                    const graceBufferSeconds = 10;   // Extra buffer to account for minor sync fluctuations or lag
                    const maxAllowedIncrease = (elapsedTimeSeconds * maxSpeedMultiplier) + graceBufferSeconds;

                    if (progressIncreaseSeconds > maxAllowedIncrease) {
                        logger.warn(`[LMS Progress Guard] Watch-rate anomaly detected for user ${session.user.id} on lesson ${validated.lessonId}. Increase: ${progressIncreaseSeconds}s, Allowed: ${maxAllowedIncrease}s.`);
                        // Clamp the increment to prevent cheating
                        finalLastWatchedSecond = (existing?.lastWatchedSecond || 0) + maxAllowedIncrease;
                        
                        if (validated.lastWatchedSecond > 0) {
                            const ratio = finalLastWatchedSecond / validated.lastWatchedSecond;
                            finalProgressPercent = Math.min(100, Math.max(0, (existing?.progressPercent || 0) + (validated.progressPercent - (existing?.progressPercent || 0)) * ratio));
                        }
                    }
                }
            }
        }

        await lessonProgressRef.set({ userId: session.user.id,
            courseId: validated.courseId,
            lessonId: validated.lessonId,
            progressPercent: finalProgressPercent,
            lastWatchedSecond: finalLastWatchedSecond,
            completed: finalProgressPercent >= 95,
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Lesson progress error:", error);
        if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: error.issues.map(e => e.message)};
        }
        return { success: false as const, error: "Failed to update lesson progress"};
    }
}

/**
 * Enroll in a course
 */
export async function enrollInCourse(
    data: z.infer<typeof courseEnrollmentSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const validated = courseEnrollmentSchema.parse(data);

        /**
         * THE SECOND ENROLMENT ENDPOINT, WITH NEITHER GATE ON IT.
         *
         * There are two ways to enrol in a course, and they disagreed about
         * who may:
         *
         *   _ac_enrollment.ts  _enrollInCourseAction   refuses a registration
         *                                              decided against (#225),
         *                                              and refuses a tier the
         *                                              learner's plan does not
         *                                              open.
         *   course-actions.ts  enrollInCourse          neither. Any signed-in
         *                                              account, any course.
         *
         * This file is "use server" and the lesson page imports from it, so
         * every export of it carries an action id the browser can call — the
         * same reasoning that made autoEnrollPaidUser reachable. Having no
         * caller in the app is not the same as being unreachable.
         *
         * What it granted was the ENROLMENT RECORD, not the videos:
         * getCourseByIdAction strips locked material by tier, so the material
         * itself stayed shut. What it did grant was a course_enrollments row
         * and a course_progress row for an elite course held by a foundation
         * learner — rows every dashboard, count and report reads as a real
         * enrolment — and it granted them to an applicant an admin had
         * rejected, which is the hole #225 closed on the other endpoint.
         *
         * Both gates are asked here now, in the same order and from the same
         * source of truth (the user document, not the session token).
         */
        const enroleeDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const academyReg = enroleeDoc.data()?.serviceRegistrations?.academy;

        if (isDecidedAgainst(academyReg?.status)) {
            return {
                success: false as const,
                error: "Your Academy application was not approved, so you cannot enrol in courses. Please contact support.",
                data: null,
            };
        }

        const courseRecord = await loadCourseForCompletion(validated.courseId);
        if (!courseRecord.found) {
            return { success: false as const, error: "Course not found", data: null };
        }

        if (!checkCourseAccess(academyReg?.plan, courseRecord.tier)) {
            // The same two refusals the sibling distinguishes: a learner who
            // bought a lower tier is told to upgrade from it, and one who
            // bought none is not told to upgrade from a package they never had.
            const tier = String(courseRecord.tier ?? "");
            const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
            const held = normaliseAcademyPlan(academyReg?.plan);
            return {
                success: false as const,
                error: held
                    ? `Your ${held} package does not grant access to this course. Please upgrade to the ${tierName} tier or higher.`
                    : `Your Academy registration does not include a course package yet. Please choose the ${tierName} tier or higher to enrol.`,
                data: null,
            };
        }

        // Check if already enrolled
        const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', validated.courseId)
            .get();

        if (!snapshot.empty) {
            return { success: false as const, error: "Already enrolled in this course"};
        }

        // Create enrollment
        const enrollmentRef = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({ userId: session.user.id,
            courseId: validated.courseId,
            enrolledAt: FieldValue.serverTimestamp(),
            status: 'active',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // Initialize progress record with composite ID to eliminate duplicates and queries
        const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${validated.courseId}`);
        await progressRef.set({ userId: session.user.id,
            courseId: validated.courseId,
            progressPercent: 0,
            completionPercentage: 0, // Enforce dual-compatibility for route check
            lastWatchedSecond: 0,
            completed: false,
            completedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        // Audit log
        await createAdminAuditLog({ userId: session.user.id,
            action: 'course_enrolled',
            targetId: validated.courseId,
            targetType: 'course',
            metadata: {
                enrollmentId: enrollmentRef.id } });

        return { error: null, success: true as const, data: null };
    } catch (error) { if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: error.issues.map((e: any) => e.message)};
        }
        return { success: false as const, error: "Failed to enroll in course"};
    }
}

/**
 * Get user's course progress
 */
export async function getCourseProgress(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { // Retrieve course progress directly using the composite document ID
        const progressDoc = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .doc(`${session.user.id}_${courseId}`)
            .get();

        if (!progressDoc.exists) {
            return { error: null, success: true as const, data: null };
        }

        const progressData = progressDoc.data()!;
        const progressPercent = progressData.progressPercent !== undefined 
            ? progressData.progressPercent 
            : (progressData.completionPercentage ?? 0);

        return { error: null, success: true as const, data: { progress: {
                id: progressDoc.id, userId: progressData.userId, courseId: progressData.courseId, progressPercent, lastWatchedSecond: progressData.lastWatchedSecond || 0, completed: progressData.completed || false, completedAt: progressData.completedAt?.toDate?.()?.toISOString() || null, updatedAt: progressData.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString() } } };
    } catch (error) { logger.error("Failed to fetch course progress:", error);
        return { success: false as const, error: "Failed to fetch course progress", progress: null};
    }
}

/**
 * Get lesson progress (video state)
 */
export async function getLessonProgress(lessonId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try {
        const progressId = `${session.user.id}_${lessonId}`;
        const doc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

        if (!doc.exists) { return { error: null, success: true as const, data: null };
        }

        const rawData = doc.data();
        return { error: null, success: true as const, data: { progress: serializeValue({
                progressPercent: rawData?.progressPercent ?? 0,
                lastWatchedSecond: rawData?.lastWatchedSecond ?? 0,
                completed: rawData?.completed ?? false }) } };
    } catch (error) { logger.error("Failed to fetch lesson progress:", error);
        return { success: false as const, error: "Failed to fetch lesson progress", progress: null};
    }
}

/**
 * Get all enrolled courses for user
 */
export async function getUserEnrolledCourses() { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('status', '==', 'active')
            .get();

        // THIS RETURNED NOTHING. EVERY TIME.
        //
        // `enrollments` was computed and then dropped on the floor — the
        // success branch returned `data: null` — so "get all enrolled courses
        // for user" ran the query, serialized the rows, and answered with an
        // empty success. A caller could not tell that from a learner who has
        // enrolled in nothing.
        //
        // The failure branch returns `courses: []` and the success branch
        // carried no `courses` key at all, so a caller reading `.courses` got
        // `[]` on error and `undefined` on success — the two outcomes inverted,
        // with the working one being the unusable one. Both shapes are filled
        // in now.
        const enrollments = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: { courses: enrollments }, courses: enrollments };
    } catch (error) {
        logger.error("Failed to fetch enrolled courses:", error);
        return { success: false as const, error: "Failed to fetch enrolled courses", data: null, courses: []};
    }
}

/**
 * Mark course as complete (manual completion)
 */

/**
 * Load a course and flatten its lesson ids.
 *
 * Courses live in academy_courses; platform.ts also writes a `courses`
 * collection, so both are tried before giving up.
 */
async function loadCourseForCompletion(courseId: string): Promise<{
    title: string | null;
    tier: string | null;
    lessonIds: string[];
    found: boolean;
}> {
    for (const collectionName of [COLLECTIONS.ACADEMY_COURSES, COLLECTIONS.COURSES]) {
        const doc = await db.collection(collectionName).doc(courseId).get();
        if (!doc.exists) continue;
        const data = doc.data() || {};
        const modules: any[] = Array.isArray(data.modules) ? data.modules : [];
        const lessonIds = modules.flatMap((m: any) =>
            (Array.isArray(m?.lessons) ? m.lessons : []).map((l: any) => String(l?.id ?? "")).filter(Boolean)
        );
        return {
            title: data.title ? String(data.title) : null,
            // The tier comes back too, so the enrolment gate above reads the
            // course through the same two-collection lookup the completion
            // path does rather than guessing which collection holds it.
            tier: data.tier != null ? String(data.tier) : null,
            lessonIds,
            found: true,
        };
    }
    return { title: null, tier: null, lessonIds: [], found: false };
}

/** The lessons of this course the learner has actually finished. */
async function completedLessonIds(userId: string, courseId: string): Promise<Set<string>> {
    const snap = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS)
        .where("userId", "==", userId)
        .where("courseId", "==", courseId)
        .get();
    const done = new Set<string>();
    for (const d of snap.docs) {
        const data = d.data() || {};
        if (data.completed === true && data.lessonId) done.add(String(data.lessonId));
    }
    return done;
}

export async function completeCourse(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${courseId}`);

        // Completion is earned, not declared.
        //
        // This set completed:true and progressPercent:100 for anyone who asked,
        // needing only that a progress record existed — which enrolling creates.
        // generateCourseCertificate then checks exactly that flag, so enrol,
        // call this, collect a certificate, having watched nothing.
        //
        // The irony is that the lesson endpoint in this same file already
        // guards against exactly this. updateLessonProgress measures elapsed
        // wall-clock time against claimed watch time and CLAMPS anything faster
        // than 2x playback, logging a "[LMS Progress Guard] Watch-rate anomaly".
        // Someone took care that a learner cannot skim a video, and the endpoint
        // next door skipped the whole course in one call.
        //
        // So completion is now derived from the per-lesson records that guard
        // produces: every lesson of the course must have one marked completed.
        const course = await loadCourseForCompletion(courseId);
        if (!course.found || course.lessonIds.length === 0) {
            // Fail closed. A course whose lessons cannot be read is exactly the
            // case a caller would want when self-completing.
            return { success: false as const, error: "Course content unavailable — completion cannot be verified", data: null };
        }

        const finished = await completedLessonIds(session.user.id, courseId);
        const outstanding = course.lessonIds.filter((id) => !finished.has(id));
        if (outstanding.length > 0) {
            return {
                success: false as const,
                error: `Course not finished — ${outstanding.length} of ${course.lessonIds.length} lessons still incomplete`,
                data: null,
            };
        }

        // Use a transaction to update progress atomically and avoid write race conditions
        await db.runTransaction(async (transaction) => {
            const progressDoc = await transaction.get(progressRef);
            if (!progressDoc.exists) {
                throw new Error("No progress record found");
            }
            transaction.update(progressRef, { completed: true,
                completedAt: FieldValue.serverTimestamp(),
                progressPercent: 100,
                completionPercentage: 100, // Enforce dual-compatibility for route check
                updatedAt: FieldValue.serverTimestamp() });
        });

        // Audit log
        await createAdminAuditLog({ userId: session.user.id,
            action: 'course_completed',
            targetId: courseId,
            targetType: 'course',
            metadata: {
                // Verified against per-lesson progress rather than accepted on
                // request, which is what "manualCompletion: true" used to mean.
                lessonsCompleted: course.lessonIds.length } });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Failed to complete course:", error);
        return { success: false as const, error: "Failed to complete course"};
    }
}

/**
 * Generate certificate for completed course
 * Called automatically when progress reaches 100%
 */
export async function generateCourseCertificate(courseId: string, _courseTitle?: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { // Verify course is completed using composite ID
        const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists || !progressDoc.data()?.completed) {
            return { success: false as const, error: "Course not completed yet"};
        }

        const progressData = progressDoc.data()!;

        // The certificate says what the COURSE is called, not what the holder
        // asked it to say.
        //
        // `courseTitle` arrived as a parameter and was written onto the
        // certificate, into the notification and into the audit log. A learner
        // could mint themselves a credential reading anything at all — and these
        // are issued with a certificateNumber and stored to be looked up later,
        // so it is a document meant to be shown to somebody else.
        //
        // The parameter is kept so existing callers still compile, and ignored.
        const courseRecord = await loadCourseForCompletion(courseId);
        if (!courseRecord.found || !courseRecord.title) {
            return { success: false as const, error: "Course not found", data: null };
        }
        const verifiedCourseTitle = courseRecord.title;

        // Check if certificate already exists
        const certSnapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (!certSnapshot.empty) {
            // Return the certificate that already exists.
            //
            // `existingCert` was assigned and then thrown away — the branch
            // returned `data: null`, so a caller asking for a certificate the
            // learner already holds got success and nothing to link to. The
            // success shape below carries certificateId; this one now matches it.
            const existingCert = certSnapshot.docs[0];
            return {
                error: null,
                success: true as const,
                data: { certificateId: existingCert.id, message: "Certificate already issued" },
            };
        }

        // One certificate number, computed once.
        //
        // It was built twice from two separate Date.now() calls — once onto the
        // certificate and once into the audit log — so the two disagreed by
        // however many milliseconds separated them. The audit entry could not be
        // matched to the document it records, which is the only reason to record
        // the number there.
        const certificateNumber = `CERT-${Date.now()}-${session.user.id?.substring(0, 8)}`;

        // Generate certificate
        const certificateRef = await db.collection(COLLECTIONS.COURSE_CERTIFICATES).add({
            userId: session.user.id,
            userName: session.user.name || "Unknown",
            userEmail: session.user.email,
            courseId,
            courseTitle: verifiedCourseTitle,
            completedAt: progressData.completedAt || FieldValue.serverTimestamp(),
            issuedAt: FieldValue.serverTimestamp(),
            certificateNumber,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // Create notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: session.user.id || "",
            type: "success",
            title: "🎉 Certificate Issued!",
            message: `Congratulations! You've completed "${verifiedCourseTitle}" and earned your certificate.`,
            // /courses does not exist — there is no such route segment anywhere
            // in the app, so every certificate notification linked to a 404. The
            // certificate page is /academy/certificate/{courseId}: its folder is
            // named [certificateId] but the param it reads is the course id.
            link: `/academy/certificate/${courseId}`,
            linkText: "View Certificate" });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id || "",
            action: 'course_completed',
            targetId: certificateRef.id,
            targetType: 'certificate',
            metadata: {
                courseId,
                courseTitle: verifiedCourseTitle,
                certificateNumber } });

        return { error: null, success: true as const, data: { certificateId: certificateRef.id, message: "Certificate generated successfully" } };
    } catch (error) { logger.error("Certificate generation error:", error);
        return { success: false as const, error: "Failed to generate certificate", data: null };
    }
}

/**
 * Get user's course certificate
 */
export async function getCourseCertificate(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const snapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (snapshot.empty) {
            return { error: null, success: true as const, data: null };
        }

        const certData = snapshot.docs[0].data();

        return { error: null, success: true as const, data: { certificate: {
                id: snapshot.docs[0].id, userId: certData.userId, userName: certData.userName, courseId: certData.courseId, courseTitle: certData.courseTitle, completedAt: certData.completedAt?.toDate?.()?.toISOString() || new Date().toISOString(), issuedAt: certData.issuedAt?.toDate?.()?.toISOString() || new Date().toISOString(), certificateNumber: certData.certificateNumber } } };
    } catch (error) { return { success: false as const, error: "Failed to fetch certificate", certificate: null, data: null };
    }
}
