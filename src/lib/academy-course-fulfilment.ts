/**
 * Giving a learner the course they bought — one copy, for both doors.
 *
 *   #722 THE LAST OF #695's THREE MISSING PROCESSORS.
 *
 *   `academy_enrollment` is a type this platform charges money under and the
 *   dispatch table could not route. Its fulfilment lived only in
 *   _verifyCoursePaymentAction — the page the learner is redirected back to —
 *   so a learner who bought a course and closed the tab had the money taken and
 *   no progress row, no purchase stamp, and no access to the course they paid
 *   for.
 *
 *   #719 and #721 wrote the first two. This follows the same shape for the same
 *   reason: the delivery lives here once and both doors call it (#272).
 *
 * ── WHY THIS ONE WAS THE HARD ONE, AND WHAT THE PROCESSOR MUST NOT DO ───────
 *
 *   `academy_enrollment` IS ONE TYPE WITH TWO INCOMPATIBLE FULFILMENTS.
 *
 *     verifyCoursePaymentAction       writes user_progress, which is what a
 *                                     learner's ACCESS is read from
 *     verifyEnrollmentPaymentAction   writes an ENROLLMENTS row, which is what
 *                                     the ADMIN REPORT is read from
 *
 *   claimPaymentOnce lets exactly one of them ever run for a reference, and
 *   #378 records what picking wrong costs: "a paying learner listed as enrolled
 *   and locked out of the course — permanently, since the payment is claimed
 *   and cannot be claimed again."
 *
 *   The discriminator is `metadata.flow`, and it is OPTIONAL — #378's own rule
 *   is that "an absent or empty marker belongs to nobody and is accepted",
 *   which is what keeps references created before it working. So for an
 *   UNMARKED reference the webhook cannot tell which fulfilment is owed, and
 *   the processor must not guess. It leaves those to the callback exactly as
 *   today; see processAcademyCoursePurchase.
 *
 *   THAT IS A SMALL REMAINDER, AND IT IS MEASURED RATHER THAN HOPED:
 *   initializeCoursePaymentAction is wired to CourseDetailClient and stamps
 *   COURSE_PURCHASE_FLOW on every payment it mints, while
 *   initializeEnrollmentPaymentAction has no component caller at all — a
 *   property course-price-is-naira-and-uncharged.test.ts already pins. So every
 *   `academy_enrollment` payment the platform can currently mint is a marked
 *   course purchase, and is routable. What stays callback-only is references
 *   minted before #378.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { coursePurchaseStamp } from "@/lib/academy-purchase-flow";
import { ensureCourseAccessRecords } from "@/lib/academy-course-progress";
import { createAdminAuditLog } from "@/lib/audit-log";
import { logger } from "@/lib/logger";
import type { UserProgress } from "@/lib/types/academy-actions";

export interface CoursePurchaseFulfilment {
    /** True only when this call created the enrolment, so an audit row is owed. */
    enrolledNow: boolean;
    /** False when the completion record could not be written — reported, not thrown. */
    accessRecordsComplete: boolean;
}

/**
 * Enrol a learner on a course they have paid for.
 *
 * THE CALLER MUST HAVE CLAIMED THE REFERENCE, OR ESTABLISHED THAT A DUPLICATE
 * DELIVERY IS BEING REPAIRED. Every write below is idempotent and
 * existence-checked, which is #258's design: running it for a duplicate costs
 * one read when the learner really is enrolled and REPAIRS them when they are
 * not. That is why the duplicate path falls through to here rather than
 * returning early.
 */
export async function fulfilAcademyCoursePurchase(args: {
    reference: string;
    userId: string;
    courseId: string;
    amountPaid: number;
}): Promise<CoursePurchaseFulfilment> {
    const { reference, userId, courseId, amountPaid } = args;

    let enrolledNow = false;

    await db.runTransaction(async (t) => {
        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const tProgressDoc = await t.get(progressRef);

        if (!tProgressDoc.exists) {
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
            /**
             *   #378 THE ROW HAS TO SAY IT WAS BOUGHT, OR THE PURCHASE BUYS
             *        NOTHING.
             *
             *        Creating the progress row was taken to BE the enrolment. It
             *        is not what grants access: checkCourseAccess decides that
             *        from the learner's PLAN against the course TIER, and the
             *        course page runs it before the progress row is consulted at
             *        all. So a learner who bought one elite course on a
             *        foundation plan was charged, enrolled, and then redirected
             *        off the course's own page on their next visit.
             *
             *        The flag is written explicitly rather than inferred from the
             *        row existing, because enrollInCourseAction writes the same
             *        row for plan-granted access — reading the row as proof of
             *        purchase would open every course a learner had ever been
             *        enrolled on, including after a plan downgrade.
             */
            t.set(progressRef, { ...progress, ...coursePurchaseStamp(reference, amountPaid) });
            enrolledNow = true;
        } else if (tProgressDoc.data()?.purchased !== true) {
            /**
             *   #378 THE ROW EXISTED BUT DID NOT SAY IT WAS BOUGHT.
             *
             *        Two ways to arrive here and the flag is right in both: a
             *        learner already enrolled on their plan who then buys the
             *        course outright (a downgrade would otherwise take away what
             *        they had just paid for), and #258's repair path, where the
             *        payment was claimed, the enrolment write failed and a retry
             *        arrives. The stamp has to be part of what that repairs, or
             *        the retry confirms an enrolment that still cannot be opened.
             *
             *        A merge, not a set: nothing about the learner's progress is
             *        touched.
             */
            t.set(progressRef, coursePurchaseStamp(reference, amountPaid), { merge: true });
        }
    });

    /**
     *   #424 THE OTHER PROGRESS RECORD — THE ONE COMPLETION IS KEYED ON.
     *
     *   The transaction above writes user_progress/{userId}/courses/{id}, which
     *   carries the purchase stamp and is what OPENS the course. It is not what
     *   FINISHES one: completeCourse and generateCourseCertificate both address
     *   course_progress/{userId}_{courseId}, and completeCourse refuses outright
     *   when that document does not exist.
     *
     *   Outside the transaction on purpose: this is idempotent and
     *   existence-checked, the money has already been claimed, and a failure
     *   here must not roll back an enrolment the learner has paid for.
     */
    const records = await ensureCourseAccessRecords(userId, courseId);
    if (records.failed) {
        // Not fatal to the purchase — but it must not vanish into the log
        // either, because the learner is now enrolled and may be unable to
        // complete. #259's reasoning: a half-delivered fulfilment belongs in
        // reconciliation.
        logger.warn(
            `[AcademyCourseFulfilment] Access records incomplete for ${userId}/${courseId} `
            + `after reference ${reference} — the learner may be unable to complete the course.`,
        );
    }

    /*
     *   #759 — AND THE LEARNER'S OWN RECORD SAYS THEY ARE IN THE ACADEMY.
     *
     *   Reported by the owner, of the Registrations by Module tile: "for academy
     *   the 9 was payments that came from users who paid 50k, 100k and 25k."
     *   Nine people paid and the tile read 0.
     *
     *   Measured: `verifyEnrollmentPaymentAction` — the whole course-purchase
     *   path — touches the USERS collection ZERO times. No
     *   `serviceRegistrations.academy`, no `academy_participant` role, nothing.
     *   The purchase writes a progress row, an enrolment row and its mirror,
     *   and the learner's own document goes on saying they have no connection
     *   to the academy at all.
     *
     *   The registration-FEE path next door does write it. So the platform
     *   records an academy member when they pay to register and not when they
     *   pay for a course — and a course is the more expensive of the two.
     *
     *   WHAT IT COSTS, BEYOND THE TILE. Access itself is fine: #378 made the
     *   progress row carry `purchased: true` and checkCourseAccess honours it.
     *   The role is what everything ELSE keys on — module broadcasts, the admin
     *   member list, and #752's messaging scope, under which a learner holding
     *   no module role cannot reach the academy admin they just paid.
     */
    await recordAcademyParticipation(userId);

    // Audit only a real enrolment.
    //
    // A duplicate delivery falls through to the block above (#258), so
    // auditing unconditionally would write a second "course_enrolled" row for
    // every webhook retry — an audit trail that reports work it did not do,
    // which is the shape #129 fixed for disputes.
    if (enrolledNow) {
        await createAdminAuditLog({
            action: "course_enrolled",
            userId,
            targetId: courseId,
            targetType: "course",
            details: `Enrolled via Paystack Ref: ${reference}`,
        });
    }

    return { enrolledNow, accessRecordsComplete: !records.failed };
}

/**
 * Record that this learner belongs to the academy, without claiming anything
 * they have not paid for.
 *
 *   ADDITIVE, AND IT NEVER OVERRIDES A DECISION. The sibling path in
 *   _payment.ts spells out why that matters: when an application has been
 *   decided against, it omits the status key entirely rather than writing
 *   "pending", because that "would clear the rejection from the user document
 *   while leaving it on the application". The same applies here and more
 *   broadly — an existing status of approved, pending, rejected or
 *   revision_required is somebody's decision, and buying a course is not a
 *   review of it. A status is written ONLY when there is none.
 *
 *   AND IT DOES NOT TOUCH `plan` OR `paymentStatus`. Those belong to the
 *   registration fee. A course purchase is not a plan, and stamping
 *   `paymentStatus: "completed"` here would assert a fee that was never paid —
 *   inventing the very kind of fact this audit keeps removing.
 *
 *   Existence-checked and idempotent, like every other write in this function,
 *   because a webhook retry lands here too.
 */
export async function recordAcademyParticipation(userId: string): Promise<void> {
    try {
        const ref = db.collection("users").doc(userId);
        const snap = await ref.get();
        if (!snap.exists) return;

        const data = snap.data() ?? {};
        const roles: string[] = Array.isArray(data.roles) ? data.roles : [];
        const academy = data.serviceRegistrations?.academy ?? {};

        const patch: Record<string, unknown> = {};

        if (!roles.includes("academy_participant")) {
            patch["roles"] = FieldValue.arrayUnion("academy_participant");
        }
        if (!academy.status) {
            //   "active" and not "approved": nobody reviewed anything. They
            //   bought a course, which is a fact about them, and it is in the
            //   set the module tiles count.
            patch["serviceRegistrations.academy.status"] = "active";
        }
        if (academy.hasPurchasedCourses !== true) {
            patch["serviceRegistrations.academy.hasPurchasedCourses"] = true;
            patch["serviceRegistrations.academy.firstCoursePurchaseAt"] =
                FieldValue.serverTimestamp();
        }

        if (Object.keys(patch).length === 0) return;

        patch["updatedAt"] = FieldValue.serverTimestamp();
        await ref.update(patch);
    } catch (error) {
        /*
         *   NON-FATAL, AND LOUD. The money is claimed and the course is open by
         *   this point; failing the purchase over a reporting field would be the
         *   worse outcome. But a learner who paid and is recorded nowhere is
         *   exactly the state this finding exists to end, so it must not vanish
         *   into silence either.
         */
        logger.warn(
            `[AcademyCourseFulfilment] Could not record academy participation for ${userId}: `
            + `${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
