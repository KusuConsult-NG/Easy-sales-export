"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimPaymentOnce } from "@/lib/wallet-ledger";
import { checkOrderPaymentAmount } from "@/lib/order-payment-amount";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import type { Course, UserProgress } from "@/lib/types/academy-actions";

/**
 * Initialize Payment for a Course
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
            // A duplicate is a SUCCESS. The learner paid and is enrolled; saying
            // "Payment already processed" as an error tells someone who has been
            // charged that verification failed.
            logger.info(`[verifyCoursePaymentAction] Payment ${reference} already claimed — reporting success.`);
            return { success: true, error: null, data: null };
        }

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
                t.set(progressRef, progress);
            }

            // 2. (The processed_payments row is written by claimPaymentOnce
            //     above. Writing it here as well is what put the marker AFTER
            //     the enrolment, so a duplicate delivery could enrol twice.)
        });

        // Audit
        await createAdminAuditLog({
            action: "course_enrolled",
            userId,
            targetId: courseId,
            targetType: "course",
            details: `Enrolled via Paystack Ref: ${reference}`,
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
        logger.error("Course payment verification error:", {
            reference,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to verify payment", data: null };
    }
}


export const verifyCoursePaymentAction = withFlexibleSafeAction("verifyCoursePaymentAction", _verifyCoursePaymentAction);
