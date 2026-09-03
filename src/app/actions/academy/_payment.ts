"use server";

import { auth } from "@/lib/auth";
import { isPaymentBypassAccount } from "@/lib/payment-bypass";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimPaymentOnce, markFulfilmentFailed } from "@/lib/wallet-ledger";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import { checkOrderPaymentAmount } from "@/lib/order-payment-amount";
import { isDecidedAgainst } from "@/lib/registration-progress";
import {
    checkAcademyPayment,
    normaliseAcademyPlan,
    academyPlanFee,
    DEFAULT_ACADEMY_PLAN,
} from "@/lib/academy-plan";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

async function autoProvisionZereAcademy(userId: string, email: string) {
    if (!isPaymentBypassAccount(email)) return;
    
    try {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const serviceRegistrations = userData?.serviceRegistrations || {};
            const academyReg = serviceRegistrations.academy || {};
            const roles = userData?.roles || [];
            
            const needsUserUpdate = academyReg.status !== "approved" || 
                                    academyReg.paymentStatus !== "completed" || 
                                    academyReg.plan !== "elite" ||
                                    !roles.includes("academy_participant");
                                    
            if (needsUserUpdate) {
                logger.info(`[autoProvisionZereAcademy] Auto-updating academy registration for ${email}`);
                const updatedRoles = Array.from(new Set([...roles, "academy_participant"]));
                await userRef.set({
                    roles: updatedRoles,
                    serviceRegistrations: {
                        academy: {
                            status: "approved",
                            paymentStatus: "completed",
                            plan: "elite",
                            paidAt: FieldValue.serverTimestamp(),
                            onboardingCompletedAt: new Date().toISOString()
                        }
                    }
                }, { merge: true });
                
                // Invalidate cache
                const { invalidateUserCache } = await import("@/lib/cache-invalidation");
                await invalidateUserCache(userId);
            }
        }
    } catch (error) {
        logger.error("[autoProvisionZereAcademy] Failed to auto-provision Zere:", error);
    }
}

export type PaymentInitState =
    | { success: true; error: null; data: { authorizationUrl: string; reference: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any };

/**
 * Initialize Paystack Payment for Course Enrollment
 * Creates a payment session and returns authorization URL
 */
export async function initializeEnrollmentPaymentAction(
    courseId: string,
    courseTitle: string,
    amount: number,
    fullName: string,
    phone: string
): Promise<PaymentInitState> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        // Validate amount
        if (amount < 1000) { return { error: "Minimum enrollment fee is ₦1, 000", success: false as const, data: null };
        }

        // Check if already enrolled
        const enrollmentId = `${session.user.id}_${courseId}`;
        const existingEnrollment = await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).get();

        if (existingEnrollment.exists) { return { error: "You are already enrolled in this course", success: false as const, data: null };
        }

        // /academy/verify-payment is not a page. Paying for a course enrolment
        // charged the learner and dropped them on a 404, and the Paystack
        // webhook has no `academy_enrollment` case, so the verify action that
        // missing page would have called was the only thing that could enrol
        // them. `flow=enrollment` picks that verifier on the callback page,
        // which otherwise defaults to the registration one and would have
        // refused this payment as the wrong type.
        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/academy/payment/callback?flow=enrollment`;

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(amount),
            {
                userId: session.user.id,
                courseId,
                courseTitle,
                fullName,
                phone,
                type: "academy_enrollment",
                callback_url: callbackUrl 
            },
            callbackUrl
        );

        // Save pending enrollment with payment reference
        await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).set({ userId: session.user.id,
            courseId,
            fullName,
            email: session.user.email,
            phone,
            amount,
            paymentReference: reference,
            status: "pending_payment", // pending_payment | active | completed | dropped
            progress: 0,
            enrollmentDate: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const, data: { authorizationUrl, reference } };
    } catch (error: any) { logger.error("Payment initialization error:", error);
        return { success: false as const, error: error.message || "Failed to initialize payment. Please try again."};
    }
}

/**
 * Verify Academy Enrollment Payment
 * Updates enrollment status after successful payment
 */
export async function verifyEnrollmentPaymentAction(reference: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    // Set once THIS call owns the fulfilment — see the catch at the end (#259).
    let claimedReference: string | null = null;

    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) { return { success: false as const, error: "Too many payment verification attempts. Please try again later."};
        }

        // The "SECURITY FIX #1: Double-payment protection" read that used to sit
        // here returned early when the marker existed. It was the read half of a
        // check-then-write whose write ran after fulfilment, so it caught a
        // webhook that had already FINISHED and nothing else.
        //
        // It also did something useful, which is kept: when the webhook got
        // there first the enrolment doc was synced so the user is not told
        // "verification failed" after paying. That now hangs off the claim
        // result, which knows for certain whether the payment was already
        // applied — see the `!claim.claimed` branch below.

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") { return { error: "Payment verification failed. Please contact support if amount was debited.", success: false as const, data: null };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const enrollmentId = `${metadata.userId}_${metadata.courseId}`;
        const amountInNaira = paymentData.data.amount / 100;

        // Verify user match
        if (metadata.userId !== session.user.id) { return { error: "Payment verification failed: User mismatch", success: false as const, data: null };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation against REAL course price
        // ✅ FIX: Query from active 'ACADEMY_COURSES' collection instead of legacy 'COURSES'.
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId).get();
        if (!courseDoc.exists) { return { success: false as const, error: "Course not found during verification"};
        }

        const courseData = courseDoc.data();
        const expectedPrice = courseData?.price || 0;

        // Underpayment is refused — at any size.
        //
        // The check here was nested:
        //
        //     if (Math.abs(paid - expected) > 50) {
        //         if (paid < expected) { reject }
        //     }
        //
        // so the reject was unreachable for any shortfall of ₦50 or less. The
        // outer condition was written as a float-tolerance guard and the comment
        // beside it argues with itself — "50 Naira margin for safety/fees? No,
        // should be exact" — and then leaves the 50 in. Paying ₦50 under the
        // course price was accepted, silently, on every course.
        //
        // checkOrderPaymentAmount is the rule the marketplace order path already
        // uses: it refuses any shortfall beyond one naira of rounding slack, and
        // ACCEPTS overpayment rather than stranding a learner who has been
        // charged. That is what the nested version did by accident on the
        // overpayment side, and what it failed to do on the underpayment side.
        const amountVerdict = checkOrderPaymentAmount(amountInNaira, expectedPrice);
        if (!amountVerdict.ok) {
            logger.warn(`Price mismatch for course ${metadata.courseId}. Expected ${expectedPrice}, got ${amountInNaira}`);
            return { success: false as const, error: `Payment amount (${amountInNaira}) does not match current course price (${expectedPrice}).`, data: null };
        }

        // "SECURITY FIX #4: Use Firestore transaction for atomicity" provided
        // no atomicity, and the marker it wrote at the end was the second half
        // of a check-then-write whose first half ran ~60 lines above. The
        // webhook and this callback could both pass that read and both fulfil.
        //
        // Claimed first now. The status stays "completed" because an academy
        // enrolment IS money in — this is one of the few paths where the
        // revenue default is the correct one.
        const claim = await claimPaymentOnce({
            reference,
            userId: session.user.id,
            amount: amountInNaira,
            type: "academy_enrollment",
            source: "client_verify",
            metadata: { courseId: metadata.courseId, enrollmentId },
        });

        // The enrolment record, written the same way whichever branch runs.
        //
        // TWO COLLECTIONS, ONE ENROLMENT
        // ------------------------------
        // The duplicate branch below used to write COLLECTIONS.ACADEMY_ENROLLMENTS
        // while the primary branch updated COLLECTIONS.ENROLLMENTS. They are
        // different tables, and the choice depended on whether the payment had
        // already been claimed.
        //
        // That mattered because the admin Academy enrolments report
        // (_ac_admin_reports.ts) and the platform enrolment metrics
        // (userMetrics.service.ts) both read ACADEMY_ENROLLMENTS. So the only
        // enrolments they could see were the ones produced by a DUPLICATE
        // delivery — the recovery branch was healing the table the admin reads,
        // and the path that actually enrols somebody was writing elsewhere.
        //
        // Both branches now write both: ENROLLMENTS is what
        // initializeEnrollmentPaymentAction created and what dashboard.ts reads,
        // and the ACADEMY_ENROLLMENTS mirror is what the admin sees. Neither
        // reader is repointed, so nothing that works today stops working.
        const mirrorEnrolmentForAdmin = async () => {
            try {
                await db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS).doc(enrollmentId).set({
                    userId: session.user.id,
                    courseId: metadata.courseId,
                    courseTitle: courseData?.title ?? metadata.courseTitle ?? null,
                    status: "active",
                    paymentStatus: "completed",
                    paymentReference: reference,
                    amount: amountInNaira,
                    enrolledAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (syncErr: unknown) {
                // Non-fatal: the learner is enrolled either way, and the mirror
                // is a reporting copy.
                logger.warn(`[verifyEnrollmentPaymentAction] Enrollment mirror failed (non-fatal): ${String(syncErr)}`);
            }
        };

        if (!claim.claimed) {
            // Already applied, by the webhook or by an earlier delivery. Sync
            // the enrolment doc so the user is not told verification failed
            // after paying, then report success — a duplicate is a success.
            logger.info(`[verifyEnrollmentPaymentAction] Payment ${reference} already claimed — syncing enrollment status.`);
            try {
                await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).set({
                    userId: session.user.id,
                    courseId: metadata.courseId,
                    status: "active",
                    paymentStatus: "completed",
                    paymentReference: reference,
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (syncErr: unknown) {
                logger.warn(`[verifyEnrollmentPaymentAction] Enrollment sync failed (non-fatal): ${String(syncErr)}`);
            }
            await mirrorEnrolmentForAdmin();
            return { error: null, success: true as const, data: null };
        }

        // This call claimed it, so this call owes the fulfilment (#259).
        claimedReference = reference;

        {
            const enrollmentRef = db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId);
            await enrollmentRef.update({
                status: "active",
                // ✅ FIX: Use "completed" consistently — all status checks use === "completed".
                // The old value "paid" caused gate checks in _actions.ts:208 and :346 to always fail.
                paymentStatus: "completed",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() });

            await mirrorEnrolmentForAdmin();

            // Increment course student count.
            //
            // This read `students`, added one in JavaScript and wrote the total
            // back, so two enrolments landing together both read the same count
            // and the second overwrote the first — a course silently lost a
            // student from its tally. FieldValue.increment applies the addition
            // in SQL (migration 010), and needs no read at all.
            const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId);
            await courseRef.update({
                /**
                 *   #336 A PAID ENROLMENT COUNTED ON A DIFFERENT FIELD FROM A
                 *        FREE ONE.
                 *
                 *        This incremented `students`. _ac_enrollment.ts — the
                 *        free/auto path — increments `enrolledCount`, which is
                 *        what lib/types/academy.ts declares (required) and what
                 *        both course creators now initialise. So the two halves
                 *        of "how many people are on this course" were kept in
                 *        two different places, and neither was ever the whole
                 *        number.
                 *
                 *        `enrolledCount` is incremented here so the paid half
                 *        lands in the same tally as the free half. `students`
                 *        is incremented alongside rather than dropped, because
                 *        rows already carry it — the same treatment #183 gave
                 *        `message`/`content`. Nothing reads either yet; if a
                 *        screen is ever built it should read `enrolledCount`,
                 *        and courses enrolled before this commit will need a
                 *        one-off backfill from `students`.
                 */
                enrolledCount: FieldValue.increment(1),
                students: FieldValue.increment(1) });

            // (The processed_payments row is written by claimPaymentOnce above.)
        }

        return { error: null, success: true as const, data: null };
    } catch (error: any) { // 🔒 SECURITY FIX #2: Sanitized error logging
        // Money collected, nothing delivered — reconciliation has to see it,
        // not just the log (#259). Guarded on having claimed: a failure before
        // the claim collected nothing in our name, and on a DUPLICATE the
        // earlier delivery owns the reference.
        if (claimedReference) {
            await markFulfilmentFailed(
                claimedReference,
                error instanceof Error ? error.message : String(error),
            );
        }

        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyEnrollment',
            reference });

        return { success: false as const, error: "Failed to verify payment. Please contact support with reference: " + reference, data: null };
    }
}

/**
 * Initialize academy registration payment
 */
async function _initiateAcademyPaymentAction(plan: "foundation" | "standard" | "elite"): Promise<ActionResponse<{ paymentUrl: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false as const , data: null };
        }

        const userId = session.user.id;

        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereAcademy(userId, session.user.email);
            return { error: null, success: true as const, data: { paymentUrl: "/academy/dashboard" } };
        }

        // Check if already paid — return success with redirect so the UI continues gracefully
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (userDoc.data()?.serviceRegistrations?.academy?.paymentStatus === "completed") {
            return { error: null, success: true as const, data: { paymentUrl: "/academy/application" } };
        }

        // DO NOT TAKE MONEY YOU WILL NOT HONOUR.
        //
        // Paying the registration fee is what admits an Academy applicant —
        // verifyAcademyPaymentAction and the webhook both auto-approve on it. So
        // a rejected applicant who reached this page paid ₦45,000 and had their
        // rejection overwritten. Both fulfilment paths now refuse to approve
        // over a decision; this refuses to charge for one in the first place,
        // which is the half that leaves nothing to refund.
        const decidedStatus = userDoc.data()?.serviceRegistrations?.academy?.status;
        if (isDecidedAgainst(decidedStatus)) {
            return {
                error: "Your Academy application is not currently approved, so this payment cannot be started. "
                    + "Please contact support or submit a new application.",
                success: false as const,
                data: null,
            };
        }

        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return { error: "Payment system not configured", success: false as const , data: null };
        }

        // The plan charged for and the plan recorded, from the same rule the two
        // fulfilment paths verify against.
        //
        // This is a "use server" export, so `plan` is whatever the caller sent
        // regardless of its declared type. The if/else chain here fell through to
        // the Foundation FEE for an unrecognised plan while storing the
        // unrecognised STRING in the Paystack metadata — so a registration could
        // be charged ₦45,000 and carry a plan no fee lookup answers. Normalising
        // here means the amount charged and the plan stored always agree, and
        // agree with what checkAcademyPayment will compare them to later.
        const planToStore = normaliseAcademyPlan(plan) ?? DEFAULT_ACADEMY_PLAN;
        const amount: number = academyPlanFee(planToStore);

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/academy/payment/callback`;

        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(amount),
            {
                userId,
                type: "academy_registration",
                purpose: "academy_registration",
                plan: planToStore,
                callback_url: callbackUrl
            },
            callbackUrl
        );

        return {
            error: null, success: true as const, data: { paymentUrl: authorizationUrl } };
    } catch (error) {
        logger.error("Academy payment init failed:", {
            plan,
            error: error instanceof Error ? error.message : String(error)
        });
        const errMsg = error instanceof Error ? error.message : String(error);
        return { error: errMsg || "Failed to initiate payment", success: false as const , data: null };
    }
}
export const initiateAcademyPaymentAction = withFlexibleSafeAction("initiateAcademyPaymentAction", _initiateAcademyPaymentAction);

/**
 * Verify academy registration payment callback
 */
async function _verifyAcademyPaymentAction(reference: string): Promise<ActionResponse<null>> {
    // Set once THIS call owns the fulfilment — see the catch at the end (#259).
    let claimedReference: string | null = null;

    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false as const, error: "Payment verification failed", data: null };
        }

        const metadata = verify.data.metadata;
        const type = metadata.type || metadata.purpose;
        if (type !== "academy_registration") {
            return { success: false as const, error: "Invalid payment type", data: null };
        }

        const paidAmount = verify.data.amount / 100;

        // The amount, checked against what the plan costs.
        //
        // This path had NO amount validation. It read verify.data.amount, wrote
        // it as paymentAmount, marked paymentStatus "completed", granted the
        // academy_participant role and isVerified, auto-approved the application
        // and wrote a completed ledger row — without ever comparing what was paid
        // against what the plan costs.
        //
        // The WEBHOOK (processAcademyRegistration) has always derived the fee from
        // the plan and thrown on underpayment. The two race by design: the webhook
        // usually finishes before the user is redirected back. So which one reached
        // a payment first decided whether an underpaid registration was accepted.
        // Same shape as the marketplace order defect, with the permissive path on
        // the other side. See lib/academy-plan.ts.
        const amountVerdict = checkAcademyPayment(paidAmount, metadata.plan);
        if (!amountVerdict.ok) {
            logger.error("[verifyAcademyPaymentAction] Academy payment refused on amount", {
                reference,
                reason: amountVerdict.reason,
                paidAmount,
                plan: metadata.plan,
            });
            return { success: false as const, error: amountVerdict.message, data: null };
        }

        // A real plan, never the string "registration".
        //
        // The user update below stored `metadata.plan || "registration"`, and
        // "registration" is not one of the three plans sold — so a record carrying
        // it matches no plan lookup and the fee it was meant to cover cannot be
        // determined afterwards.
        const resolvedPlan = amountVerdict.plan;

        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        // ✅ FIX: If the Paystack webhook already processed this payment, return SUCCESS.
        // The webhook fires before the user is redirected back on fast connections.
        // Before this fix, users saw "Payment verification failed" even after paying.
        // ADDITIONAL FIX: Also sync the USERS doc here so the primary status check
        // (serviceRegistrations.academy.paymentStatus) is always populated.
        // Previously this early-return skipped that write, so future logins always
        // fell through to the slow PROCESSED_PAYMENTS fallback query.
        const existingProcessed = await processedRef.get();
        if (existingProcessed.exists) {
            logger.info(`[verifyAcademyPaymentAction] Payment ${reference} already processed by webhook — syncing USERS doc and returning success.`);
            try {
                // The amount and plan already in hand, not a re-read of the
                // processed_payments row.
                //
                // That row lives in a DEDICATED table and the plan was passed as
                // `metadata: { plan }`, so it is stored in raw_data rather than as
                // a column — `processedData?.plan` was undefined and this wrote
                // `plan: null` over a registration that had one. `paidAmount` and
                // `resolvedPlan` are derived above from the Paystack response,
                // which is the same source the webhook uses.
                await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
                    serviceRegistrations: {
                        academy: {
                            paymentStatus: "completed",
                            paymentReference: reference,
                            paymentAmount: paidAmount,
                            plan: resolvedPlan,
                        }
                    },
                    updatedAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (syncErr) {
                // Non-fatal — log and continue. The PROCESSED_PAYMENTS fallback
                // will still work for this session even if the sync fails.
                logger.warn(`[verifyAcademyPaymentAction] USERS doc sync failed (non-fatal):`, syncErr as any);
            }
            return { success: true, error: null, data: null };
        }

        // The re-read of processedRef inside the wrapper was labelled "Another
        // concurrent call processed it" — and it was the one guard here that
        // looked like it addressed concurrency while addressing none of it. The
        // read took no lock and the marker was written after the work, so two
        // concurrent calls both saw an absent row and both fulfilled: the user
        // was granted the academy role twice and two ledger rows were written
        // under the same reference.
        //
        // claimPaymentOnce settles it in Postgres. status stays "completed"
        // because an academy registration fee IS revenue.
        let hasApp = false;
        const claim = await claimPaymentOnce({
            reference,
            userId: session.user.id,
            amount: paidAmount,
            type: "academy_registration",
            source: "client_verify",
            metadata: { plan: resolvedPlan },
        });

        if (!claim.claimed) {
            logger.info(`[verifyAcademyPaymentAction] Payment ${reference} already claimed — nothing to do.`);
            return { success: true, error: null, data: null };
        }

        // This call claimed it, so this call owes the fulfilment.
        claimedReference = reference;

        {
            const appQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .orderBy("submittedAt", "desc")
                .limit(1);
            const appSnap = await appQuery.get();

            // ── WRITES SECOND ──────────────────────────────────────────
            // Update user registration status
            hasApp = !appSnap.empty;
            const appDoc = hasApp ? appSnap.docs[0] : null;

            // PAYING DID NOT OVERTURN A REJECTION.
            //
            // This path auto-approves: find the applicant's latest application,
            // write `status: "approved"` with `reviewedBy:
            // "paystack_auto_approval"`, grant `academy_participant` and set
            // `isVerified`. That is the intended model for a NEW applicant —
            // paying the registration fee is what admits them, and no admin need
            // review it.
            //
            // It did not ask whether an admin had already decided. Nothing
            // stopped a rejected applicant from opening the payment page and
            // paying again, and when they did, the rejection on the application
            // document was overwritten with "approved" — attributed to
            // "paystack_auto_approval" — and the role #210 revoked was handed
            // straight back. An admin's decision was reversible for ₦45,000.
            //
            // The money is still recorded. claimPaymentOnce has already banked
            // the reference and the ledger row below is still written, so the
            // payment is visible to support and refundable. What does not happen
            // is the approval. The initiate path now refuses to start such a
            // payment at all, so reaching here means the applicant was rejected
            // between initiating and returning — rare, and exactly the case that
            // needs the money trail intact rather than the approval.
            const decidedAgainst = isDecidedAgainst(appDoc?.data()?.status);
            const autoApprove = hasApp && !!appDoc && !decidedAgainst;

            if (decidedAgainst) {
                logger.warn(
                    "[verifyAcademyPaymentAction] Payment received for an application already decided against — "
                    + "recorded, NOT approved. Refund or manual review required.",
                    {
                        reference,
                        userId: session.user.id,
                        applicationId: appDoc?.id,
                        applicationStatus: appDoc?.data()?.status,
                        paidAmount,
                    },
                );
            }

            const userUpdate: any = {
                "serviceRegistrations.academy.paymentStatus": "completed",
                "serviceRegistrations.academy.paymentReference": reference,
                "serviceRegistrations.academy.paymentAmount": paidAmount,
                "serviceRegistrations.academy.plan": resolvedPlan,
                "serviceRegistrations.academy.paidAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            };

            // The status key is omitted entirely when a decision stands. Writing
            // "pending" here would be its own reversal — it would clear the
            // rejection from the user document while leaving it on the
            // application, which is the divergence Layer 2 of checkModuleAccess
            // reads first.
            if (!decidedAgainst) {
                userUpdate["serviceRegistrations.academy.status"] = hasApp ? "approved" : "pending";
            }

            if (autoApprove) {
                userUpdate["serviceRegistrations.academy.approvedAt"] = FieldValue.serverTimestamp();
                userUpdate["serviceRegistrations.academy.applicationId"] = appDoc.id;
                userUpdate["roles"] = FieldValue.arrayUnion("academy_participant");
                userUpdate["isVerified"] = true;
            }

            // Update user registration status
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(userUpdate);

            // (The processed_payments row is written by claimPaymentOnce above.)

            // Update matching application if it exists
            if (autoApprove) {
                await appDoc.ref.update({
                    status: "approved",
                    paymentStatus: "completed",
                    paymentAmount: paidAmount,
                    plan: resolvedPlan,
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    reviewedAt: FieldValue.serverTimestamp(),
                    reviewedBy: "paystack_auto_approval",
                });
            }

            // Ledger row last — a crash leaves the member registered without a
            // duplicate ledger entry rather than the reverse.
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            await globalTxRef.set({
                id: reference,
                userId: session.user.id,
                type: "academy_registration",
                module: "academy",
                amount: paidAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: "Academy registration fee"
            });
        }

        // Invalidate cache if auto-approved
        try {
            const { invalidateUserCache } = await import('@/lib/cache-invalidation');
            await invalidateUserCache(session.user.id);
            if (hasApp) {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(session.user.id, 'academy');
            }
        } catch (cacheErr) {
            logger.error('[verifyAcademyPaymentAction] Cache clear error:', cacheErr);
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        // See #259 — a fulfilment that dies after the claim must be visible to
        // reconciliation, not only to the log.
        if (claimedReference) {
            await markFulfilmentFailed(
                claimedReference,
                error instanceof Error ? error.message : String(error),
            );
        }

        logger.error("Academy payment verification error:", {
            reference,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to verify payment", data: null };
    }
}
export const verifyAcademyPaymentAction = withFlexibleSafeAction("verifyAcademyPaymentAction", _verifyAcademyPaymentAction);

/**
 * Check if user has paid for academy registration
 */
async function _checkAcademyPaymentStatusAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        // #316 — a session with no user id is a broken session, not a learner
        // known not to have paid. It used to answer "unpaid" definitively.
        if (!session?.user?.id) return { success: false as const, error: "Unauthorized", data: null };

        // Payment bypass — see src/lib/payment-bypass.ts for who and why.
        if (isPaymentBypassAccount(session.user.email)) {
            await autoProvisionZereAcademy(session.user.id, session.user.email);
            return { error: null, success: true as const, data: "paid" };
        }

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        if (userData?.serviceRegistrations?.academy?.paymentStatus === "completed" || userData?.legacyOnboardedBy) {
            return { error: null, success: true as const, data: "paid" };
        }

        // ── AUTHORITATIVE FALLBACK 1: Processed Payments ─────────────────
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "academy_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            return { error: null, success: true as const, data: "paid" };
        }

        // ── AUTHORITATIVE FALLBACK 2: Application Payment Status ─────────
        const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("userId", "==", session.user.id)
            .get();

        if (!appSnap.empty) {
            const hasPaidApp = appSnap.docs.some(doc => doc.data().paymentStatus === "completed");
            if (hasPaidApp) {
                return { error: null, success: true as const, data: "paid" };
            }
        } else if (userData?.email) {
            const emailQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("personalInfo.email", "==", userData.email.toLowerCase())
                .limit(1)
                .get();
            if (!emailQuery.empty && emailQuery.docs[0].data().paymentStatus === "completed") {
                return { error: null, success: true as const, data: "paid" };
            }
        }

        return { error: null, success: true as const, data: "unpaid" };
    } catch (error) {
        // Was: { error: null, success: true, data: "unpaid" } — #316.
        //
        // A database failure asserted a DEFINITIVE "this learner has not paid".
        // It is #313's shape on money: not knowing reported as a fact, in the
        // direction that harms the person who DID pay.
        //
        // And it defeated the caller that was doing the right thing.
        // academy/(learner)/layout.tsx guards its hard redirect with
        // `payStatus.success && payStatus.data === "unpaid"` under the comment
        // "Only hard-redirect if the payment check definitively confirms
        // unpaid" — success:true made that guard meaningless, so a transient
        // read error threw a paid learner out of the academy and into the
        // payment flow, which offers to charge them again.
        //
        // Callers must now distinguish three answers, not two: paid, unpaid,
        // and we-could-not-tell.
        logger.error("Check academy payment status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Could not check payment status", data: null };
    }
}
export const checkAcademyPaymentStatusAction = withFlexibleSafeAction("checkAcademyPaymentStatusAction", _checkAcademyPaymentStatusAction);
