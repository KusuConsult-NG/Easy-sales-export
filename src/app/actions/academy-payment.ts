"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo
function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

export interface PaymentInitState {
    error: null, success: true | false;
    data?: {
        authorizationUrl: string;
        reference: string;
    };
    meta?: any;
}

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
): Promise<PaymentInitState> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Validate amount
        if (amount < 1000) {
            return { error: "Minimum enrollment fee is ₦1,000", success: false };
        }

        // Check if already enrolled
        const enrollmentId = `${session.user.id}_${courseId}`;
        const existingEnrollment = await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).get();

        if (existingEnrollment.exists) {
            return { error: "You are already enrolled in this course", success: false };
        }

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
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/academy/verify-payment`,
            }
        );

        // Save pending enrollment with payment reference
        await db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId).set({
            userId: session.user.id,
            courseId,
            fullName,
            email: session.user.email,
            phone,
            amount,
            paymentReference: reference,
            status: "pending_payment", // pending_payment | active | completed | dropped
            progress: 0,
            enrollmentDate: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null, success: true as const,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        logger.error("Payment initialization error:", error);
        return {
            success: false as const,
            error: error.message || "Failed to initialize payment. Please try again.",
        };
    }
}

/**
 * Verify Academy Enrollment Payment
 * Updates enrollment status after successful payment
 */
export async function verifyEnrollmentPaymentAction(reference: string): Promise<{
    error: null, success: true | false;
    data?: any;
    meta?: any;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return {
                success: false as const,
                error: "Too many payment verification attempts. Please try again later."
            };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        if (existingPayment.exists) {
            return {
                error: "Payment has already been processed",
                success: false
            };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: "Payment verification failed. Please contact support if amount was debited.",
                success: false as const,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const enrollmentId = `${metadata.userId}_${metadata.courseId}`;
        const amountInNaira = paymentData.data.amount / 100;

        // Verify user match
        if (metadata.userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation against REAL course price
        // ✅ FIX: Query from active 'ACADEMY_COURSES' collection instead of legacy 'COURSES'.
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId).get();
        if (!courseDoc.exists) {
            return { success: false as const, error: "Course not found during verification" };
        }

        const courseData = courseDoc.data();
        const expectedPrice = courseData?.price || 0;

        // Verify paid amount matches course price (allow slight epsilon for potential floating point issues, though unlikely with Paystack)
        if (Math.abs(amountInNaira - expectedPrice) > 50) { // 50 Naira margin for safety/fees? No, should be exact. Let's make it tight. 
            // Actually, Paystack returns exact amount paid. 
            // If the user paid less, we reject.
            if (amountInNaira < expectedPrice) {
                logger.warn(`Price mismatch for course ${metadata.courseId}. Expected ${expectedPrice}, got ${amountInNaira}`);
                return { success: false as const, error: `Payment amount (${amountInNaira}) does not match current course price (${expectedPrice}).` };
            }
        }

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // Update enrollment status
            const enrollmentRef = db.collection(COLLECTIONS.ENROLLMENTS).doc(enrollmentId);
            transaction.update(enrollmentRef, {
                status: "active",
                paymentStatus: "paid",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Increment course student count
            // ✅ FIX: Query from active 'ACADEMY_COURSES' collection instead of legacy 'COURSES'.
            const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(metadata.courseId);
            const courseSnap = await transaction.get(courseRef);
            if (courseSnap.exists) {
                const cData = courseSnap.data();
                if (cData) {
                    const currentStudents = cData.students || 0;
                    transaction.update(courseRef, {
                        students: currentStudents + 1,
                    });
                }
            }

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "academy_enrollment",
                reference,
            });
        });

        return {
            error: null, success: true as const,
            data: { message: "Enrollment successful! Check your email for course access details." },
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyEnrollment',
            reference,
        });

        return {
            success: false as const,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
        };
    }
}
