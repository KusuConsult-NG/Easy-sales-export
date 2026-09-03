"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Course, EnrolledCourseWithDetails, UserProgress } from "@/lib/types/academy-actions";
import { normaliseAcademyPlan, checkCourseAccess, isPaidAcademyPlan } from "@/lib/academy-plan";
import { isDecidedAgainst } from "@/lib/registration-progress";
import { isRetired } from "@/lib/record-retirement";

/**
 * Check Academy application status for current user
 */
async function _checkAcademyStatusAction(): Promise<ActionResponse<string | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let currentStatus = userData?.serviceRegistrations?.academy?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for applications.
        if (currentStatus !== "approved") {
            /**
             * THE TWO FALLBACK LOOKUPS DECIDED BY AN ARBITRARY APPLICATION,
             * AND THEN MADE THE GUESS PERMANENT.
             *
             * The primary query sorts by submittedAt and takes the newest,
             * because a learner can hold more than one application and the
             * decision that counts is the LAST one. Neither fallback did.
             *
             * They are reached when no application carries `userId` — legacy
             * rows, from before the submit flow recorded it. One looked the
             * application up by `serviceRegistrations.academy.applicationId`;
             * the other queried `personalInfo.email` with `.limit(1)` and no
             * `orderBy`, so Postgres returned whichever row it liked.
             *
             * Choosing wrong would be bad enough on its own. What made it stick
             * is what the block below does with the answer: on
             * `status === "approved"` it WRITES
             * `serviceRegistrations.academy.status = "approved"` onto the user
             * document, and the fallback backfills `userId` onto the row it
             * chose — so the ordered query above then finds only that one, and
             * the guess becomes the record.
             *
             * The promotion is one-directional: only "approved" is ever written
             * back. So a learner holding an old approval and a newer rejection
             * could have the rejection undone by loading a page. That is
             * #207-#209 exactly, reappearing through the two branches that fix
             * did not reach.
             *
             * All three sources are gathered and the newest is chosen, by the
             * comparator the primary query already used. The `.limit(1)` is
             * gone because it was choosing the answer.
             */
            const submittedMillis = (doc: any): number => {
                const value = doc.data()?.submittedAt || doc.data()?.createdAt;
                return value?.toMillis?.()
                    || value?.seconds * 1000
                    || (value ? new Date(value).getTime() : 0);
            };

            const candidates = new Map<string, any>();

            const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .get();
            for (const doc of appSnap.docs) candidates.set(doc.id, doc);

            // The fallbacks run only when nothing is linked to this learner yet
            // — the case they exist for — and BOTH run, rather than the second
            // being skipped whenever an applicationId happens to be recorded.
            // A stored applicationId names the application that wrote it, which
            // is not necessarily the most recent one.
            if (candidates.size === 0) {
                const appId = userData?.serviceRegistrations?.academy?.applicationId;
                if (appId) {
                    const directDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(appId).get();
                    if (directDoc.exists) candidates.set(directDoc.id, directDoc);
                }

                if (userData?.email) {
                    // Deliberately unbounded: this is an equality on one
                    // person's email address, so the result is the handful of
                    // applications that person has ever submitted. The `.limit(1)`
                    // that was here is what chose the answer, and a limit
                    // without an orderBy would choose it again — while an
                    // orderBy in the database would put rows MISSING
                    // submittedAt first on a DESC sort (finding #49), which is
                    // exactly the legacy rows this branch exists for. The
                    // comparator below handles a missing date; the query must
                    // not pre-filter.
                    const emailQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                        .where("personalInfo.email", "==", userData.email.toLowerCase())
                        .get();
                    for (const doc of emailQuery.docs) candidates.set(doc.id, doc);
                }
            }

            const appDoc = [...candidates.values()].sort((a, b) => submittedMillis(b) - submittedMillis(a))[0] ?? null;

            // Self-healing: link the application this settled on to the learner,
            // so the ordered query above finds it directly next time. On the row
            // that was actually chosen — the backfill used to run on whichever
            // row the fallback had picked, which is how a wrong choice became
            // the stored one.
            if (appDoc && !appDoc.data()?.userId) {
                await appDoc.ref.update({ userId: session.user.id });
            }

            if (appDoc) {
                const appData = appDoc.data()!;
                if (appData.status === "approved") {
                    currentStatus = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.academy.status": "approved",
                        "serviceRegistrations.academy.syncedAt": new Date().toISOString()
                    });
                } else if (appData.status) {
                    currentStatus = appData.status;
                }
            }
        }

        if (currentStatus) {
            return { error: null, success: true as const, data: currentStatus };
        }

        // ── FINAL FALLBACK: Check for any payment records ──────────────
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "academy_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            return { error: null, success: true as const, data: "payment_completed" };
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Check Academy status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Check Academy status error" , data: null };
    }
}


export const checkAcademyStatusAction = withFlexibleSafeAction("checkAcademyStatusAction", _checkAcademyStatusAction);



/**
 * Enroll in course (Gated by Academy Tier)
 */
async function _enrollInCourseAction(
    userId: string,
    courseId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Check user's Academy Plan
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) return { success: false as const, error: "User not found", data: null };
        const userData = userDoc.data();
        const academyReg = userData?.serviceRegistrations?.academy;
        const userPlan = academyReg?.plan || "free";

        /**
         * A REJECTED APPLICANT COULD ENROL THEIR WAY BACK IN.
         *
         * This consulted the PLAN and never the registration STATUS. A free-tier
         * course opens to everybody — checkCourseAccess returns true for a
         * missing or "free" tier regardless of plan — so an applicant whose
         * Academy application an admin had rejected could enrol in one, and step
         * 4 below then granted them `academy_participant` for having done so.
         * checkModuleAccess grants the module on that role alone (Layer 1), so
         * the rejection was undone by a click.
         *
         * That is a hole straight through #210, which had just taught the
         * rejection paths to revoke the role: revoking it means nothing if an
         * unrelated action hands it back without asking why it was taken.
         *
         * isDecidedAgainst is the vocabulary added in #207 for exactly this —
         * rejected, suspended, revoked and the rest all score zero on the
         * progress scale, so "not approved" cannot distinguish them from "not
         * started".
         */
        if (isDecidedAgainst(academyReg?.status)) {
            return {
                success: false as const,
                error: "Your Academy application was not approved, so you cannot enrol in courses. Please contact support.",
                data: null,
            };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);

        // Save to Firestore using a transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // 1. Check for existing enrollment
            const progressDoc = await transaction.get(progressRef);
            if (progressDoc.exists) {
                throw new Error("Already enrolled in this course");
            }

            // 2. Validate package tier
            const courseDoc = await transaction.get(db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId));
            if (!courseDoc.exists) throw new Error("Course not found");

            const course = courseDoc.data() as Course;
            const courseTier = course.tier || "free";
            const hasAccess = checkCourseAccess(userPlan, courseTier);

            if (!hasAccess) {
                // Two different refusals, said differently.
                //
                // This read `Your current package (free) does not grant access`
                // for a learner who had never chosen a package at all — an admin
                // can approve an application without one, and registration
                // itself is free — so the message named a package they had not
                // bought and told them to upgrade from it. Neither they nor
                // support could tell which of the two situations they were in.
                const tierName = courseTier.charAt(0).toUpperCase() + courseTier.slice(1);
                const held = normaliseAcademyPlan(userPlan);
                throw new Error(
                    held
                        ? `Your ${held} package does not grant access to this course. Please upgrade to the ${tierName} tier or higher.`
                        : `Your Academy registration does not include a course package yet. Please choose the ${tierName} tier or higher to enrol.`
                );
            }

            const progress: UserProgress = {
                userId,
                courseId,
                completedLessons: [],
                completedModules: [],
                quizScores: {},
                overallProgress: 0,
                startedAt: FieldValue.serverTimestamp(),
                lastAccessedAt: FieldValue.serverTimestamp(),
            };

            // 3. Create enrollment record
            transaction.set(progressRef, progress);

            // 4. Proactively update user document if not already marked as academy_participant
            if (!userData?.roles?.includes('academy_participant')) {
                transaction.update(userDoc.ref, {
                    roles: FieldValue.arrayUnion('academy_participant'),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            // 5. Increment enrolledCount if it exists in schema
            transaction.update(courseDoc.ref, {
                enrolledCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        await createAdminAuditLog({
            // Was "user_update", the catch-all for an unclassified write, so the
            // one question this row exists to answer — who enrolled in which
            // course — could not be asked of it. Same correction as #200's
            // training_registered.
            action: "course_enrolled",
            userId,
            targetId: courseId,
            targetType: "course_enrollment",
        });

        revalidatePath("/academy");
        // /dashboard/academy is not a route — the academy dashboard is at
        // /academy/dashboard. revalidatePath on a path with no route behind it
        // is a silent no-op, so this invalidated nothing and a learner who had
        // just enrolled could keep seeing the cached dashboard without the new
        // course on it.
        revalidatePath("/academy/dashboard");
        // Likewise /academy/courses/{id} — the course page is /academy/{id}.
        // The only route under /academy/courses is .../quiz.
        revalidatePath(`/academy/${courseId}`);

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Enrollment error:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to enroll", data: null };
    }
}


export const enrollInCourseAction = withFlexibleSafeAction("enrollInCourseAction", _enrollInCourseAction);


/**
 * Auto-enroll paid Academy learners in all courses eligible under their tier.
 */
export async function autoEnrollPaidUser(userId: string, userPlan: string) {
    // WHAT WAS WRONG HERE
    // -------------------
    // This file is "use server", so every export is a reachable server action —
    // and this one is re-exported through academy/index.ts as well. It took BOTH
    // the user and their plan from the caller, with no session guard.
    //
    // So `autoEnrollPaidUser(myOwnId, "elite")` enrolled the caller in every
    // elite course. A paid-content bypass, reachable directly.
    //
    // Its two legitimate callers — the academy dashboard route and
    // getAcademyDashboardAction — both derive the id and plan from the session
    // and check isPaid first. That protected the CALL SITES and did nothing for
    // the function, which is independently addressable.
    //
    // Both values are now taken from the session. The parameters are kept so
    // existing callers compile, and are deliberately ignored: they were passing
    // session-derived values anyway, so nothing legitimate changes.
    const sessionResult = await requireSession();
    if (!sessionResult.session?.user?.id) return;

    const sessionUser = sessionResult.session.user as any;
    const resolvedUserId = sessionUser.id;
    const resolvedPlan = sessionUser?.serviceRegistrations?.academy?.plan;

    // `if (!resolvedUserId || !resolvedPlan) return;` stood here. The second
    // half could never fire: resolvedPlan was `... || "free"`, so it was a
    // non-empty string whatever the registration held. The id is already
    // established by the session guard above.
    if (!resolvedUserId) return;

    // A decided-against registration enrols in nothing, for the same reason
    // enrollInCourseAction now refuses one: a plan is what somebody bought and a
    // status is what an admin decided, and the decision wins. This function runs
    // on every academy dashboard load, so without the guard a rejected applicant
    // who had paid for a tier kept accruing enrolment and progress rows for
    // courses the module gate will not let them open.
    if (isDecidedAgainst(sessionUser?.serviceRegistrations?.academy?.status)) return;

    // One predicate, shared with the two call sites that decide whether to run
    // this at all — see isPaidAcademyPlan for what the four hand-rolled lists
    // disagreed about, and why the longest of them is narrower now.
    const plan = String(resolvedPlan).trim().toLowerCase();
    if (!isPaidAcademyPlan(plan)) return;

    try {
        // 1. Fetch all courses
        const coursesSnap = await db.collection(COLLECTIONS.ACADEMY_COURSES).get();
        if (coursesSnap.empty) return;

        // 2. Filter courses user has access to
        const eligibleCourses = coursesSnap.docs.filter(doc => {
            const courseData = doc.data();
            // #302 A retired course must not be auto-enrolled into. It stays
            // readable by id for the learners already holding an enrolment or a
            // certificate, but it is no longer on offer.
            if (isRetired(courseData)) return false;
            return checkCourseAccess(plan, courseData.tier || "free");
        });

        if (eligibleCourses.length === 0) return;

        // 3. Parallel fetch existing records to avoid sequential Firestore calls
        // The field is `userId`. It always was.
        //
        // When this function was fixed to take the caller from the session, the
        // local was renamed userId -> resolvedUserId — and the rename was applied
        // inside the query STRING LITERALS and the written field names too.
        // Nothing anywhere writes a column called `resolvedUserId`, so both of
        // these queries matched nothing, every time.
        //
        // Three things followed, and the second is the one that cost data:
        //
        //   Every row this function wrote carried `resolvedUserId` instead of
        //   `userId`, so it was invisible to every OTHER reader of these
        //   collections — an auto-enrolled course did not appear in the
        //   learner's course list.
        //
        //   existingProgresses was therefore always empty, so Place B below
        //   re-set COURSE_PROGRESS for `${userId}_${courseId}` — the same
        //   document enrollInCourse, updateLessonProgress and completeCourse all
        //   use — with progressPercent: 0, completed: false, completedAt: null,
        //   merged over whatever the learner had actually done. This function
        //   runs on every academy dashboard load, so a paid learner's progress
        //   was zeroed the next time they opened the dashboard.
        //
        //   existingEnrollments was always empty too, so a learner who had
        //   enrolled properly got a duplicate enrolment row.
        //
        // Each of those self-limits after the first run, because the row it then
        // writes DOES carry resolvedUserId and the query finds it next time —
        // which is exactly why this never looked like an ongoing fault.
        // The legacy queries are kept alongside the correct ones.
        //
        // Rows this function wrote while the field name was wrong carry
        // `resolvedUserId`, so querying only `userId` would miss them — and
        // missing them is what causes the damage below. Reading both and taking
        // the union means the affected records are recognised on the next
        // dashboard load instead of being zeroed one final time, so no backfill
        // is needed for this to stop.
        const [progressSubSnap, progressSnap, legacyProgressSnap, enrollmentsSnap, legacyEnrollmentsSnap] = await Promise.all([
            db.collection(`user_progress/${resolvedUserId}/courses`).get(),
            db.collection(COLLECTIONS.COURSE_PROGRESS).where("userId", "==", resolvedUserId).get(),
            db.collection(COLLECTIONS.COURSE_PROGRESS).where("resolvedUserId", "==", resolvedUserId).get(),
            db.collection(COLLECTIONS.COURSE_ENROLLMENTS).where("userId", "==", resolvedUserId).get(),
            db.collection(COLLECTIONS.COURSE_ENROLLMENTS).where("resolvedUserId", "==", resolvedUserId).get()
        ]);

        const existingProgressSubs = new Set(progressSubSnap.docs.map(doc => doc.id));
        const existingProgresses = new Set([
            ...progressSnap.docs.map(doc => doc.id),
            ...legacyProgressSnap.docs.map(doc => doc.id),
        ]);
        const existingEnrollments = new Set([
            ...enrollmentsSnap.docs.map(doc => doc.data().courseId),
            ...legacyEnrollmentsSnap.docs.map(doc => doc.data().courseId),
        ]);

        // 4. Ensure enrollment in all eligible courses in parallel
        await Promise.all(eligibleCourses.map(async (courseDoc) => {
            const courseId = courseDoc.id;

            // Place A: user_progress subcollection
            if (!existingProgressSubs.has(courseId)) {
                const progressSubRef = db.doc(`user_progress/${resolvedUserId}/courses/${courseId}`);
                await progressSubRef.set({
                    userId: resolvedUserId,
                    courseId,
                    completedLessons: [],
                    completedModules: [],
                    quizScores: {},
                    overallProgress: 0,
                    startedAt: FieldValue.serverTimestamp(),
                    lastAccessedAt: FieldValue.serverTimestamp(),
                });
                
                // Increment enrolledCount
                await courseDoc.ref.update({
                    enrolledCount: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // Place B: course_progress
            const progressRefId = `${resolvedUserId}_${courseId}`;
            const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(progressRefId);

            // Belt and braces on the one write that can destroy something.
            //
            // The document id is deterministic, so its existence is knowable
            // without trusting any query. This write merges zeros over
            // progressPercent, completed and completedAt — so if the guard above
            // is ever wrong again, a learner loses their progress. Reading the
            // document costs one round trip and removes that entirely.
            const alreadyHasProgress = existingProgresses.has(progressRefId)
                || (await progressRef.get()).exists;

            if (!alreadyHasProgress) {
                await progressRef.set({
                    userId: resolvedUserId,
                    courseId,
                    progressPercent: 0,
                    completionPercentage: 0,
                    lastWatchedSecond: 0,
                    completed: false,
                    completedAt: null,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            // Place C: course_enrollments
            if (!existingEnrollments.has(courseId)) {
                await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({
                    userId: resolvedUserId,
                    courseId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        }));
    } catch (err) {
        logger.error("[autoEnrollPaidUser] Error during auto-enrollment:", err);
    }
}


async function _getEnrolledCoursesWithDetailsAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        const userId = session.user.id;

        // Auto-enroll if the user has an active paid plan.
        // Asked of the same predicate the access rule uses, so this cannot
        // withhold the sweep from a learner the catalogue already unlocks.
        const userPlan = (session.user as any)?.serviceRegistrations?.academy?.plan;
        if (isPaidAcademyPlan(userPlan)) {
            await autoEnrollPaidUser(userId, userPlan);
        }


        // 1. Fetch all progress records for this user
        const progressSnap = await db.collection(`user_progress/${userId}/courses`).get();
        // An empty enrolment set is an empty LIST. This returned `data: null`,
        // so the one success shape a caller can rely on — `data.courses` — was
        // absent for exactly the learner who has enrolled in nothing, which is
        // the case a "your courses" screen most needs to render. Same shape as
        // the sibling in course-actions.ts.
        if (progressSnap.empty) return { error: null, success: true as const, data: { courses: [] } };

        // 2. Batch-fetch course metadata for each enrolled course
        const courseIds = progressSnap.docs.map((d) => d.id);
        const courseDocs = await Promise.all(
            courseIds.map((id) => db.collection(COLLECTIONS.ACADEMY_COURSES).doc(id).get())
        );

        const courses: EnrolledCourseWithDetails[] = [];

        progressSnap.docs.forEach((progressDoc, idx) => {
            const progress = progressDoc.data() as UserProgress;
            const courseDoc = courseDocs[idx];
            if (!courseDoc.exists) return;

            const course = courseDoc.data() as Course;
            const totalLessons = course.modules?.reduce((sum, m) => sum + m.lessons.length, 0) ?? 0;
            const completedCount = progress.completedLessons?.length ?? 0;
            const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

            courses.push({
                courseId: progressDoc.id,
                title: course.title,
                instructor: course.instructor,
                thumbnail: course.thumbnail,
                totalLessons,
                completedLessons: completedCount,
                progress: progressPct,
                status: progress.completedAt ? "completed" : (completedCount > 0 ? "in-progress" : "not-started"),
                startedAt: progress.startedAt
                    ? new Date((progress.startedAt as Timestamp).toDate()).toLocaleDateString()
                    : "",
            });
        });

        return { error: null, success: true as const, data: { courses } };
    } catch (error) {
        logger.error("getEnrolledCoursesWithDetailsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: "Failed to load enrolled courses" };
    }
}


export const getEnrolledCoursesWithDetailsAction = withFlexibleSafeAction("getEnrolledCoursesWithDetailsAction", _getEnrolledCoursesWithDetailsAction);
