"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimPaymentOnce, markFulfilmentFailed } from "@/lib/wallet-ledger";
import { checkOrderPaymentAmount } from "@/lib/order-payment-amount";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import type { Course, UserProgress } from "@/lib/types/academy-actions";
import { COURSE_PURCHASE_FLOW, coursePurchaseStamp, isForeignPaymentFlow } from "@/lib/academy-purchase-flow";

/**
 * Initialize Payment for a Course
 */
/**
 *   #368 THE BETTER OF THE TWO PER-COURSE INITIATORS, AND ALSO UNREACHABLE.
 *
 *        It takes only a courseId and derives the price from the course
 *        document, so the browser cannot name the amount — the shape
 *        _payment.ts's initializeEnrollmentPaymentAction should have had. No
 *        component calls either of them.
 *
 *   #378 WIRED. THIS IS THE ONE THE PRODUCT SELLS A COURSE WITH.
 *
 *        academy/[courseId]/page.tsx calls it: a learner whose plan does not
 *        cover the course's tier is now shown the price and a Buy button
 *        instead of being redirected to the whole-plan upgrade, and the
 *        catalogue offers the same course rather than filtering it out of the
 *        list entirely.
 *
 *        Chosen over the sibling for exactly the reason above — the amount is
 *        derived here and passed in there — so the shape "charge whatever the
 *        browser said, then decline to enrol if it was wrong" never reaches a
 *        learner. The sibling is superseded and kept; see the #378 note in
 *        _payment.ts.
 *
 *        Two things had to follow, or wiring it would have sold nothing:
 *        the verifier stamps the purchase where the ACCESS rule can see it
 *        (checkCourseAccess decides from the plan, and it runs before the
 *        progress row is read), and the payment names its flow so the sibling
 *        verifier cannot fulfil it into the wrong record.
 */
async function _initializeCoursePaymentAction(courseId: string): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found", data: null };

        const course = courseDoc.data() as Course;
        if (!course.price || course.price <= 0) {
            return { success: false as const, error: "This course is free. Please enroll directly.", data: null };
        }

        // A callback that is a page, on the base URL everything else uses.
        //
        // This was `${process.env.NEXT_PUBLIC_APP_URL}/academy/verify`, and two
        // things were wrong with it.
        //
        // /academy/verify is not a page. The only route beneath it is
        // /academy/verify/[certificateId], so a learner who paid for a course
        // was charged and then landed on a 404 — and since the Paystack webhook
        // has no case for `academy_enrollment`, the verify action that missing
        // page would have called was their only route to being enrolled at all.
        //
        // And NEXT_PUBLIC_APP_URL was read bare, with no fallback: unset, the
        // callback becomes the string "undefined/academy/verify". Every other
        // academy payment resolves its base through getBaseUrl().
        //
        // `flow=course` tells the callback page which verifier to call —
        // verifyAcademyPaymentAction refuses anything that is not an academy
        // registration, so without it a course payer would have been shown
        // "Payment Verification Failed" instead.
        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/academy/payment/callback?flow=course`;

        // Initialize Paystack
        const result = await initializePaystackPayment(
            session.user.email || "",
            Math.round(course.price * 100), // Kobo
            {
                type: "academy_enrollment",
                /**
                 *   #378 WHICH FULFILMENT THIS PAYMENT IS FOR.
                 *
                 *        Two verifiers accept `type: "academy_enrollment"` —
                 *        this file's and verifyEnrollmentPaymentAction — and
                 *        they fulfil into DIFFERENT shapes: this one writes the
                 *        progress row a learner's access is read from, the other
                 *        writes an ENROLLMENTS row the admin report is read
                 *        from. claimPaymentOnce means only one of them can ever
                 *        run for a given reference.
                 *
                 *        While both initiators were unreachable that was
                 *        harmless. Wiring this one puts real references in the
                 *        wild, and /api/academy/verify-payment is reachable — so
                 *        a course purchase verified through the wrong door would
                 *        leave the learner enrolled in the admin's report and
                 *        locked out of the course, permanently, because the
                 *        payment is claimed.
                 *
                 *        The marker travels on the payment itself, and each
                 *        verifier refuses the other's. A reference with NO
                 *        marker is accepted by both exactly as before, so
                 *        nothing already in flight is stranded.
                 */
                flow: COURSE_PURCHASE_FLOW,
                courseId,
                userId: session.user.id,
                email: session.user.email,
                callback_url: callbackUrl,
            },
            callbackUrl
        );

        return { success: true, error: null, data: result };
    } catch (error) {
        logger.error("Course payment init error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Initialization failed", data: null };
    }
}


export const initializeCoursePaymentAction = withFlexibleSafeAction("initializeCoursePaymentAction", _initializeCoursePaymentAction);


/**
 * Verify Course Payment and Enroll
 */
async function _verifyCoursePaymentAction(reference: string): Promise<ActionResponse<null>> {
    // Set once THIS call owns the fulfilment — see the catch at the end (#259).
    let claimedReference: string | null = null;

    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        // Verify with Paystack
        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false as const, error: "Payment verification failed", data: null };
        }

        const metadata = verify.data.metadata;
        if (metadata.type !== "academy_enrollment") {
            return { success: false as const, error: "Invalid payment type", data: null };
        }

        // #378 And not somebody else's fulfilment. See lib/academy-purchase-flow.ts:
        // the two verifiers of this payment type write different records, and
        // claimPaymentOnce lets only one of them ever run.
        if (isForeignPaymentFlow(metadata.flow, COURSE_PURCHASE_FLOW)) {
            return { success: false as const, error: "This payment is not a course purchase", data: null };
        }

        // The buyer is the session, not the metadata.
        //
        // This read `const userId = metadata.userId` and enrolled that user, with
        // the session checked only for existence. Its sibling
        // verifyEnrollmentPaymentAction refuses on `metadata.userId !==
        // session.user.id`; this one did not compare them at all, so a signed-in
        // caller holding somebody else's reference could drive that person's
        // enrolment. The same rule is applied here.
        const userId = session.user.id;
        if (metadata.userId && metadata.userId !== userId) {
            return { success: false as const, error: "Payment verification failed: User mismatch", data: null };
        }

        const courseId = metadata.courseId;
        const amountPaid = verify.data.amount / 100;

        // The pre-claim read is gone; claimPaymentOnce below is the whole answer.
        //
        // It was `if (existingDoc.exists) return { success: false, error: "Payment
        // already processed" }` — a check-then-write whose write happens further
        // down, so it took no lock and settled nothing, AND it reported a
        // duplicate as a FAILURE. A learner whose payment had already been
        // applied was told verification failed after being charged, which is the
        // exact outcome the registration path carries a comment about having
        // fixed. claimPaymentOnce distinguishes the two cases for certain, and
        // the `!claim.claimed` branch below now reports success.

        // 🔒 SECURITY FIX: Amount re-validation against REAL course price
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found", data: null };

        const course = courseDoc.data() as Course;
        if (course.price && course.price > 0) {
            // The shared rule, rather than a fourth hand-rolled comparison.
            //
            // `amountPaid < course.price` has no tolerance at all, so a price and
            // a payment that differ only in floating-point representation refuse
            // a legitimate payment. checkOrderPaymentAmount allows one naira of
            // rounding slack, refuses any real shortfall, and accepts
            // overpayment — which this comparison also did, by omission.
            const verdict = checkOrderPaymentAmount(amountPaid, course.price);
            if (!verdict.ok) {
                logger.warn(`Price drift detected for course ${courseId}. Expected ${course.price}, Paid ${amountPaid}`);
                return { success: false as const, error: "Payment verification failed: Amount paid is less than current course price.", data: null };
            }
        }

        // Claim the payment before enrolling anyone.
        //
        // The check that used to live inside runTransaction was labelled a fix
        // for race conditions, and was not one: runTransaction takes no lock, so
        // a re-read inside it is still an ordinary read and two deliveries of
        // the same Paystack webhook both passed it. Paystack retries webhooks by
        // design.
        const claim = await claimPaymentOnce({
            reference,
            userId,
            amount: amountPaid,
            type: "academy_enrollment",
            source: "academy_course_purchase",
            metadata: { courseId },
        });

        if (!claim.claimed) {
            /**
             *   #258 A CLAIMED PAYMENT WITH A FAILED ENROLMENT WAS PERMANENT.
             *
             *        This returned success on the spot, with the comment "the
             *        learner paid and is enrolled". The first half is certain;
             *        the second is an assumption, and it is the one that fails.
             *
             *        The claim is taken BEFORE the enrolment — deliberately, so
             *        a duplicate webhook delivery cannot enrol twice. But if the
             *        enrolment write then fails (a transient database error;
             *        Paystack retries webhooks by design), the payment is
             *        already claimed. The catch reports "Failed to verify
             *        payment", the retry arrives, `claim.claimed` is false, and
             *        this branch told the learner it had worked. They paid, and
             *        were enrolled in nothing — permanently, because no later
             *        call will ever claim that reference again.
             *
             *        Verifying beats asserting, and it is nearly free: the
             *        enrolment below is already idempotent (`if
             *        (!tProgressDoc.exists)`), so running it for a duplicate
             *        costs one read when the learner really is enrolled and
             *        repairs them when they are not.
             *
             *        Falling through rather than returning early is what makes
             *        that happen — the buyer check and the price check above
             *        have already run, so the repair cannot be used to enrol on
             *        somebody else's reference.
             */
            logger.info(
                `[verifyCoursePaymentAction] Payment ${reference} already claimed — ` +
                `confirming the enrolment exists before reporting success.`);
        } else {
            // This call claimed it, so this call owes the fulfilment.
            claimedReference = reference;
        }

        let enrolledNow = false;
        await db.runTransaction(async (t) => {
            // 1. Enroll User
            const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
            // Check if user already has progress (in case they are somehow re-enrolling or upgrading)
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
                 *   #378 THE ROW HAS TO SAY IT WAS BOUGHT, OR THE PURCHASE
                 *        BUYS NOTHING.
                 *
                 *        Creating the progress row was taken to BE the
                 *        enrolment. It is not what grants access:
                 *        checkCourseAccess decides that from the learner's PLAN
                 *        against the course TIER, and the course page runs it
                 *        before the progress row is consulted at all. So a
                 *        learner who bought one elite course on a foundation
                 *        plan was charged, enrolled, and then redirected off the
                 *        course's own page on their next visit.
                 *
                 *        The flag is written explicitly rather than inferred
                 *        from the row existing, because enrollInCourseAction
                 *        writes the same row for plan-granted access — reading
                 *        the row as proof of purchase would open every course a
                 *        learner had ever been enrolled on, including after a
                 *        plan downgrade.
                 */
                t.set(progressRef, { ...progress, ...coursePurchaseStamp(reference, amountPaid) });
                enrolledNow = true;
            } else if (tProgressDoc.data()?.purchased !== true) {
                /**
                 *   #378 THE ROW EXISTED BUT DID NOT SAY IT WAS BOUGHT.
                 *
                 *        Two ways to arrive here, and the flag is right in both:
                 *
                 *        A learner already enrolled on their plan, who then buys
                 *        the course outright — a downgrade would otherwise take
                 *        away what they had just paid for.
                 *
                 *        And #258's repair path: the payment was claimed, the
                 *        enrolment write failed, a retry arrives. That case
                 *        falls through to here deliberately, and the stamp has
                 *        to be part of what it repairs — otherwise the retry
                 *        confirms an enrolment that still cannot be opened.
                 *
                 *        A merge, not a set: nothing about the learner's
                 *        progress is touched.
                 */
                t.set(progressRef, coursePurchaseStamp(reference, amountPaid), { merge: true });
            }

            // 2. (The processed_payments row is written by claimPaymentOnce
            //     above. Writing it here as well is what put the marker AFTER
            //     the enrolment, so a duplicate delivery could enrol twice.)
        });

        // Audit only a real enrolment.
        //
        // Now that a duplicate delivery falls through to the block above
        // (#258), auditing unconditionally would write a second
        // "course_enrolled" row for every webhook retry — an audit trail that
        // reports work it did not do, which is the shape #129 fixed for
        // disputes.
        if (enrolledNow) {
            await createAdminAuditLog({
                action: "course_enrolled",
                userId,
                targetId: courseId,
                targetType: "course",
                details: `Enrolled via Paystack Ref: ${reference}`,
            });
        }

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
        // Money collected, nothing delivered — that has to reach reconciliation
        // rather than only the log (#259). Guarded on having claimed: a failure
        // before the claim collected nothing in our name, and on a DUPLICATE the
        // earlier attempt owns the reference.
        if (claimedReference) {
            await markFulfilmentFailed(
                claimedReference,
                error instanceof Error ? error.message : String(error),
            );
        }

        logger.error("Course payment verification error:", {
            reference,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to verify payment", data: null };
    }
}


export const verifyCoursePaymentAction = withFlexibleSafeAction("verifyCoursePaymentAction", _verifyCoursePaymentAction);
