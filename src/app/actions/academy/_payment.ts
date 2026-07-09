"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import { ACADEMY_CONFIG } from "@/lib/constants";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

async function autoProvisionZereAcademy(userId: string, email: string) {
    if (email !== "zeredogo@gmail.com") return;
    
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

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        // ✅ FIX: If webhook already processed this payment, return success not an error.
        // Users saw "verification failed" after paying because the webhook fires first.
        // ROOT CAUSE #2 FIX: Also sync enrollment doc so status checks don't fall through.
        if (existingPayment.exists) {
            logger.info(`[verifyEnrollmentPaymentAction] Payment ${reference} already processed — syncing enrollment status and returning success.`);
            try {
                const processedData = existingPayment.data();
                const courseId = processedData?.courseId;
                if (courseId && session.user.id) {
                    const enrollmentId = `${session.user.id}_${courseId}`;
                    await db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS ?? "academy_enrollments").doc(enrollmentId).set({
                        userId: session.user.id,
                        courseId,
                        status: "active",
                        paymentStatus: "completed",
                        paymentReference: reference,
                        enrolledAt: FieldValue.serverTimestamp(),
                    }, { merge: true });
                }
            } catch (syncErr: unknown) {
                logger.warn(`[verifyEnrollmentPaymentAction] Enrollment sync failed (non-fatal): ${String(syncErr)}`);
            }
            return { error: null, success: true as const, data: null };
        }

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

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        await db.runTransaction(async (transaction) => { // Update enrollment status
            const enrollmentRef = db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId);
            transaction.update(enrollmentRef, {
                status: "active",
                // ✅ FIX: Use "completed" consistently — all status checks use === "completed".
                // The old value "paid" caused gate checks in _actions.ts:208 and :346 to always fail.
                paymentStatus: "completed",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() });

            // Increment course student count
            // ✅ FIX: Query from active 'ACADEMY_COURSES' collection instead of legacy 'COURSES'.
            const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId);
            const courseSnap = await transaction.get(courseRef);
            if (courseSnap.exists) { const cData = courseSnap.data();
                if (cData) {
                    const currentStudents = cData.students || 0;
                    transaction.update(courseRef, {
                        students: currentStudents + 1 });
                }
            }

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "academy_enrollment",
                // ✅ FIX: status field required so the fallback query in _checkAcademyPaymentStatusAction works.
                status: "completed",
                reference });
        });

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

        // Unified Bypass for zeredogo@gmail.com
        if (session.user.email === "zeredogo@gmail.com") {
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

        let amount: number = ACADEMY_CONFIG.plans.foundation.fee; // Default to Foundation
        let planToStore = plan;

        if (plan === "foundation") {
            amount = ACADEMY_CONFIG.plans.foundation.fee;
        } else if (plan === "standard" || (plan as string) === "advanced") {
            amount = ACADEMY_CONFIG.plans.standard.fee;
            planToStore = "standard";
        } else if (plan === "elite") {
            amount = ACADEMY_CONFIG.plans.elite.fee;
        }

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
        return { error: "Failed to initiate payment", success: false as const , data: null };
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
                const processedData = existingProcessed.data();
                await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
                    serviceRegistrations: {
                        academy: {
                            paymentStatus: "completed",
                            paymentReference: reference,
                            paymentAmount: processedData?.amount ?? null,
                            plan: processedData?.plan ?? null,
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

        // 🔒 ATOMIC TRANSACTION: Update user and record ledger entries
        let hasApp = false;
        await db.runTransaction(async (transaction) => {
            // ── READS FIRST ───────────────────────────────────────────
            const tProcessedDoc = await transaction.get(processedRef);
            if (tProcessedDoc.exists) {
                // Another concurrent call processed it — return gracefully
                return;
            }

            const appQuery = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .orderBy("submittedAt", "desc")
                .limit(1);
            const appSnap = await transaction.get(appQuery);

            // ── WRITES SECOND ──────────────────────────────────────────
            // Update user registration status
            hasApp = !appSnap.empty;
            const appDoc = hasApp ? appSnap.docs[0] : null;

            const userUpdate: any = {
                "serviceRegistrations.academy.paymentStatus": "completed",
                "serviceRegistrations.academy.paymentReference": reference,
                "serviceRegistrations.academy.paymentAmount": paidAmount,
                "serviceRegistrations.academy.plan": metadata.plan || "registration",
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
            transaction.update(db.collection(COLLECTIONS.USERS).doc(session.user.id), userUpdate);

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: paidAmount,
                type: "academy_registration",
                plan: metadata.plan || "foundation",
                status: "completed",
                reference,
            });

            // Update matching application if it exists
            if (hasApp && appDoc) {
                transaction.update(appDoc.ref, {
                    status: "approved",
                    paymentStatus: "completed",
                    paymentAmount: paidAmount,
                    plan: metadata.plan || "foundation",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    reviewedAt: FieldValue.serverTimestamp(),
                    reviewedBy: "paystack_auto_approval",
                });
            }

            // Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            transaction.set(globalTxRef, {
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
        });

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

        // Unified Bypass for zeredogo@gmail.com
        if (session.user.email === "zeredogo@gmail.com") {
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
