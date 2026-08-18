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
import { claimPaymentOnce } from "@/lib/wallet-ledger";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
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

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/academy/verify-payment`;

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
> { try {
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

        // Verify paid amount matches course price (allow slight epsilon for potential floating point issues, though unlikely with Paystack)
        if (Math.abs(amountInNaira - expectedPrice) > 50) { // 50 Naira margin for safety/fees? No, should be exact. Let's make it tight. 
            // Actually, Paystack returns exact amount paid. 
            // If the user paid less, we reject.
            if (amountInNaira < expectedPrice) {
                logger.warn(`Price mismatch for course ${metadata.courseId}. Expected ${expectedPrice}, got ${amountInNaira}`);
                return { success: false as const, error: `Payment amount (${amountInNaira}) does not match current course price (${expectedPrice}).` , data: null };
            }
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

        if (!claim.claimed) {
            // Already applied, by the webhook or by an earlier delivery. Sync
            // the enrolment doc so the user is not told verification failed
            // after paying, then report success — a duplicate is a success.
            logger.info(`[verifyEnrollmentPaymentAction] Payment ${reference} already claimed — syncing enrollment status.`);
            try {
                await db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS ?? "academy_enrollments").doc(enrollmentId).set({
                    userId: session.user.id,
                    courseId: metadata.courseId,
                    status: "active",
                    paymentStatus: "completed",
                    paymentReference: reference,
                    enrolledAt: FieldValue.serverTimestamp(),
                }, { merge: true });
            } catch (syncErr: unknown) {
                logger.warn(`[verifyEnrollmentPaymentAction] Enrollment sync failed (non-fatal): ${String(syncErr)}`);
            }
            return { error: null, success: true as const, data: null };
        }

        {
            const enrollmentRef = db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId);
            await enrollmentRef.update({
                status: "active",
                // ✅ FIX: Use "completed" consistently — all status checks use === "completed".
                // The old value "paid" caused gate checks in _actions.ts:208 and :346 to always fail.
                paymentStatus: "completed",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() });

            // Increment course student count.
            //
            // This read `students`, added one in JavaScript and wrote the total
            // back, so two enrolments landing together both read the same count
            // and the second overwrote the first — a course silently lost a
            // student from its tally. FieldValue.increment applies the addition
            // in SQL (migration 010), and needs no read at all.
            const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId);
            await courseRef.update({
                students: FieldValue.increment(1) });

            // (The processed_payments row is written by claimPaymentOnce above.)
        }

        return { error: null, success: true as const, data: null };
    } catch (error: any) { // 🔒 SECURITY FIX #2: Sanitized error logging
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

            const userUpdate: any = {
                "serviceRegistrations.academy.paymentStatus": "completed",
                "serviceRegistrations.academy.paymentReference": reference,
                "serviceRegistrations.academy.paymentAmount": paidAmount,
                "serviceRegistrations.academy.plan": resolvedPlan,
                "serviceRegistrations.academy.paidAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.academy.status": hasApp ? "approved" : "pending",
                "updatedAt": FieldValue.serverTimestamp(),
            };

            if (hasApp && appDoc) {
                userUpdate["serviceRegistrations.academy.approvedAt"] = FieldValue.serverTimestamp();
                userUpdate["serviceRegistrations.academy.applicationId"] = appDoc.id;
                userUpdate["roles"] = FieldValue.arrayUnion("academy_participant");
                userUpdate["isVerified"] = true;
            }

            // Update user registration status
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(userUpdate);

            // (The processed_payments row is written by claimPaymentOnce above.)

            // Update matching application if it exists
            if (hasApp && appDoc) {
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
        if (!session?.user?.id) return { error: null, success: true as const, data: "unpaid" };

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
        logger.error("Check academy payment status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: null, success: true as const, data: "unpaid" };
    }
}
export const checkAcademyPaymentStatusAction = withFlexibleSafeAction("checkAcademyPaymentStatusAction", _checkAcademyPaymentStatusAction);
