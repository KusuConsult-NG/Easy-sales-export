"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { invalidateServiceCache } from "@/lib/cache-invalidation";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Course, EnrolledCourseWithDetails, UserProgress } from "@/lib/types/academy-actions";
import { normaliseAcademyPlan, checkCourseAccess } from "@/lib/academy-plan";
import { isDecidedAgainst } from "@/lib/registration-progress";
import { isRetired } from "@/lib/record-retirement";
import { latestApplication } from "@/lib/latest-application";
import { formatShortDateOrDash } from "@/lib/date-utils";
import { ownedProfileIds, filterByOwner } from "@/lib/owned-profile-ids";
import { readUserDocOnce } from "@/lib/current-user-doc";
import { claimableByEmail } from "@/lib/claimable-application";
import { startedEarly } from "@/lib/started-early";
import {
    applicationsOwnedBy,
    applicationsTypedTo,
    completedPaymentFor,
    forgetApplicationReads,
} from "@/lib/application-request-reads";

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
        //   THROUGH THE REQUEST MEMO. /academy/application runs this action and
        //   checkAcademyPaymentStatusAction in one Promise.all, and both wanted
        //   this row. One read between them now — see lib/current-user-doc.
        const userDoc = await readUserDocOnce(session.user.id);
        const userData = userDoc.data;

        const academyReg = userData?.serviceRegistrations?.academy;
        let currentStatus = academyReg?.status;

        /*
         *   THE PAYMENT RECORD, ISSUED HERE AND READ AT THE BOTTOM.
         *
         *   Reaching the final fallback at all requires the row to have carried
         *   NO academy status — any status returns before it — so the condition
         *   for needing this read is known now, from a row already in hand. An
         *   approved learner never issues it, and neither does anyone whose
         *   registration says anything at all.
         */
        const paymentsSoon = !currentStatus
            ? startedEarly(completedPaymentFor(session.user.id, "academy_registration"))
            : null;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for applications.
        if (currentStatus !== "approved") {
            /*
             *   THE FALLBACKS GO OUT WITH THE PRIMARY, NOT AFTER IT.
             *
             *   THE OWNER: "fix the academy status one next."
             *
             *       checkAcademyStatusAction took 1433ms ... 3235ms
             *
             *   Measured the way #283 measured the cooperative one — every read
             *   in the fake database made to take a tick, counting WAVES rather
             *   than reads, because READ COUNT IS NOT WHAT LATENCY IS MADE OF:
             *
             *       nothing filed        6 reads, 5 waves
             *       an approved learner  1 read,  1 wave
             *
             *   Six reads was already tight — #272 and #273 shared three of them
             *   with the payment check running beside this. The cost is that the
             *   three lookups below were a CHAIN: the owner-scoped query, then
             *   the by-address sweep if that was empty, then the payment record
             *   if that was empty too. Each one waits a full round trip to learn
             *   whether the next is needed.
             *
             *   PREFETCHED ONLY WHERE THEY COULD ACTUALLY RUN, and the user row
             *   already in hand says exactly that:
             *
             *     - the by-address sweep is reachable only with no
             *       applicationId on the row (the branch above it wins
             *       otherwise) and an address to sweep by;
             *     - the payment record is reachable only with no academy status
             *       on the row, since any status returns before it.
             *
             *   So a learner who has applied pays for nothing extra, the
             *   approved learner never reaches this block at all, and the one
             *   with nothing filed — the one waiting longest — waits three
             *   times instead of five.
             *
             *   NOTHING BELOW IS DECIDED EARLIER. claimableByEmail still rules
             *   on the sweep's rows, in the same place, with the same argument:
             *   issuing a query is not claiming what it returns. #888's defect 2
             *   was that very distinction going the other way.
             */
            const byEmailSoon = (!academyReg?.applicationId && userData?.email)
                ? startedEarly(applicationsTypedTo(
                    COLLECTIONS.ACADEMY_APPLICATIONS, "personalInfo.email", userData.email))
                : null;
            let appDoc: any = null;
            //   SHARED WITH THE PAYMENT CHECK running beside it — identical
            //   query, one round trip. See lib/application-request-reads.
            const appSnap = await applicationsOwnedBy(COLLECTIONS.ACADEMY_APPLICATIONS, session.user.id);

            if (!appSnap.empty) {
                //   #507 An eleventh copy, in a file the ratchet's AFFECTED
                //   list never named — found only once the tree sweep matched
                //   the SHAPE instead of the literal `createdAt?.toMillis?.()`.
                //   That is the argument for a sweep over a list: a list records
                //   what was known, and this file was not.
                appDoc = latestApplication(appSnap.docs);
            } else if (userData?.serviceRegistrations?.academy?.applicationId) {
                const appId = userData.serviceRegistrations.academy.applicationId;
                const directDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(appId).get();
                if (directDoc.exists) {
                    appDoc = directDoc;
                    // Self-healing: backfill userId on direct application doc if missing
                    const appData = directDoc.data()!;
                    if (!appData.userId) {
                        await directDoc.ref.update({ userId: session.user.id });
                    }
                }
            } else if (userData?.email) {
                /*
                 *   #888 DEFECT 2, ON THE FIFTH DOOR — AND THIS ONE PERSISTS IT.
                 *
                 *   lib/claimable-application's header lists the doors that ask
                 *   this correctly: WAVE, Export, Farm Nation, and the gate.
                 *   This was not among them. It read `emailQuery.docs[0]`
                 *   whatever its `userId`, and the `!appData.userId` test
                 *   guarded only the backfill WRITE — which is defect 2 stated
                 *   word for word in that header.
                 *
                 *   AND THE BRANCH BELOW WRITES THE VERDICT DOWN. An `approved`
                 *   application promotes `currentStatus` AND writes
                 *   `serviceRegistrations.academy.status: "approved"` onto the
                 *   caller's own user row, which Layers 2 and 2.5 of
                 *   checkModuleAccess then grant on "for ever without ever
                 *   reaching this code again". So a learner whose address
                 *   somebody else typed into an application form was admitted
                 *   to the Academy, permanently, on a field nobody
                 *   authenticated as. Reproduced against the fake db before
                 *   this change: status "approved", payment "paid", the
                 *   application still owned by the other account.
                 *
                 *   ONLY AN UNCLAIMED APPLICATION CAN BE CLAIMED. Same rule,
                 *   same helper, same wording in the log as the other four.
                 */
                //   Already in the air since the wave above; the claim rule
                //   below is untouched.
                const typed = await byEmailSoon!();
                const { claimable, ownedByOthers } = claimableByEmail(typed.docs);

                if (claimable) {
                    appDoc = claimable;
                    await (claimable as any).ref.update({ userId: session.user.id });
                    //   The owner-scoped query would answer differently now.
                    forgetApplicationReads();
                } else if (ownedByOthers > 0) {
                    logger.warn(
                        `[checkAcademyStatus] ${ownedByOthers} Academy application(s) match `
                        + `${userData.email} but every one already belongs to another account; `
                        + `none claimed (uid: ${session.user.id}).`
                    );
                }
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
                    //   #692 The member's own status check heals the record; the
                    //   cached profile session-guard serves for 300 seconds has to
                    //   go with it, or the heal is invisible to the person who asked.
                    await invalidateServiceCache(session.user.id, 'academy');
                } else if (appData.status) {
                    currentStatus = appData.status;
                }
            }
        }

        if (currentStatus) {
            return { error: null, success: true as const, data: currentStatus };
        }

        // ── FINAL FALLBACK: Check for any payment records ──────────────
        //   SHARED WITH THE PAYMENT CHECK — identical query, one round trip —
        //   and issued in the wave above, since reaching here at all requires
        //   the row to have carried no academy status.
        const paymentsSnap = paymentsSoon
            ? await paymentsSoon()
            //   Unreachable while the guard above matches the return below, and
            //   a read rather than a wrong answer if they ever drift apart.
            : await completedPaymentFor(session.user.id, "academy_registration");

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
    if (!resolvedUserId) return;

    /**
     *   #460 THE PLAN AND THE ADMIN'S DECISION WERE READ OFF THE JWT, WHICH IS
     *        UP TO EIGHT HOURS OLD.
     *
     *        `sessionUser.serviceRegistrations.academy.plan` is a token claim
     *        baked in at login. auth.config.ts issues stateless JWTs with an
     *        8-hour maxAge, so this decided entitlement from a snapshot that can
     *        predate everything that matters about it:
     *
     *          somebody PAYS       claim still says "free", so nothing enrols.
     *                              They are charged and the academy stays empty
     *                              until they happen to sign in again.
     *          an admin REJECTS    claim still says approved, so enrolment and
     *                              progress rows keep accruing for courses the
     *                              module gate will not open.
     *
     *        The comment this replaces said "a plan is what somebody bought and
     *        a status is what an admin decided, and the decision wins". It does
     *        — but the decision it read was the one in the token, not the one
     *        the admin made.
     *
     *        THE PATTERN IS ALREADY IN THIS CODEBASE. #364 swept this class out
     *        of fifteen API routes, requireAdmin re-reads roles live, and
     *        api/wave/training-sessions falls back to the stored document when
     *        the claim does not grant. Academy was missed by all of it, in two
     *        verbatim copies.
     *
     *        Read once, here, where the grant is made — the callers used to
     *        compute `isPaid` from the same stale claim and SKIP THE CALL, which
     *        is what made a fresh payment invisible.
     *
     *        A FAILED READ ENROLS NOBODY. This function writes rows and runs on
     *        every dashboard load, so a retry costs nothing and a wrong grant
     *        persists. Denying on an unreadable document is the safe direction.
     */
    let stored: any;
    try {
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(resolvedUserId).get();
        // Kept although a mutation test showed removing it changes nothing —
        // data() on a missing document is undefined, which already resolves to
        // "free" and returns below. It states the intent rather than relying on
        // that coincidence holding in the adapter.
        if (!userDoc.exists) return;
        stored = userDoc.data() || {};
    } catch (e) {
        logger.error("[autoEnrollPaidUser] Could not read the user document — enrolling nobody", e);
        return;
    }

    const academy = stored?.serviceRegistrations?.academy ?? {};
    const resolvedPlan = academy.plan || "free";

    // A decided-against registration enrols in nothing, for the same reason
    // enrollInCourseAction now refuses one: a plan is what somebody bought and a
    // status is what an admin decided, and the decision wins.
    if (isDecidedAgainst(academy.status)) return;

    const plan = String(resolvedPlan).toLowerCase();
    const isPaid = ["elite", "standard", "foundation", "advanced", "member", "student", "academy_student", "scholarship", "active", "enrolled", "approved"].includes(plan);
    if (!isPaid) return;

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
        //   AND ACROSS EVERY PROFILE, which matters more here than anywhere
        //   else in this module: reading EMPTY is what triggers the reset
        //   described above, so a learner whose progress sits under a
        //   superseded profile would have it zeroed on the next dashboard load.
        //   The `resolvedUserId` FIELD is the separate legacy naming bug this
        //   comment is about; both spellings are still read, now for every
        //   owned id.
        const ownedIds = await ownedProfileIds(resolvedUserId);
        const [progressSubSnap, progressSnap, legacyProgressSnap, enrollmentsSnap, legacyEnrollmentsSnap] = await Promise.all([
            db.collection(`user_progress/${resolvedUserId}/courses`).get(),
            filterByOwner(db.collection(COLLECTIONS.COURSE_PROGRESS), "userId", ownedIds).get(),
            filterByOwner(db.collection(COLLECTIONS.COURSE_PROGRESS), "resolvedUserId", ownedIds).get(),
            filterByOwner(db.collection(COLLECTIONS.COURSE_ENROLLMENTS), "userId", ownedIds).get(),
            filterByOwner(db.collection(COLLECTIONS.COURSE_ENROLLMENTS), "resolvedUserId", ownedIds).get()
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
            /*
             *   EVERY ID THIS LEARNER OWNS, not just the live one.
             *
             *   COURSE_PROGRESS is keyed `${userId}_${courseId}`, so a learner
             *   whose profile was superseded has their row under
             *   `${oldId}_${courseId}`. Widening the QUERY above was not enough
             *   on its own: this membership test asked for the LIVE-keyed id,
             *   so the row it had just fetched could never match.
             *
             *   The consequence is not destruction — the old row is untouched —
             *   but a second row at the live id with progressPercent 0,
             *   alongside the real one. The dashboard now reads both, so the
             *   learner would see their course listed twice, once at zero.
             *
             *   `existingEnrollments` below needs none of this: it keys on
             *   `courseId` alone, so the widened query already settles it.
             */
            const ownedProgressIds = ownedIds.map((id) => `${id}_${courseId}`);
            const alreadyHasProgress = ownedProgressIds.some((rid) => existingProgresses.has(rid))
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

        //   #460 The same stale-claim gate the API route carried, verbatim.
        //        A false `isPaid` skipped the call, so a fresh payment enrolled
        //        nobody. autoEnrollPaidUser reads the stored document and
        //        returns immediately for anyone unpaid.
        await autoEnrollPaidUser(userId, "");


        // 1. Fetch all progress records for this user
        const progressSnap = await db.collection(`user_progress/${userId}/courses`).get();
        if (progressSnap.empty) return { error: null, success: true as const, data: null };

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
                //   #605 — was `new Date((progress.startedAt as Timestamp).toDate())`.
                //   The cast is not a runtime check: `.toDate` exists on a Firestore
                //   Timestamp and on nothing else, so a startedAt that reached here as
                //   an ISO string — which is what crosses any serialisation boundary —
                //   threw "toDate is not a function" and took the enrolled-courses
                //   action down. The reader below knows all four shapes this codebase
                //   stores, so the cast is not needed and the throw is gone.
                startedAt: progress.startedAt ? formatShortDateOrDash(progress.startedAt) : "",
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
