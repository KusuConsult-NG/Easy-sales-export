"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

// Helper function to convert Naira to Kobo
function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

export interface PaymentInitState {
    success: boolean;
    error?: string | null;
    data?: {
        authorizationUrl: string;
        reference: string;
    };
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
        const session = await auth();

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
            session.user.email!,
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
            success: true,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        logger.error("Payment initialization error:", error);
        return {
            success: false,
            error: error.message || "Failed to initialize payment. Please try again.",
        };
    }
}

/**
 * Verify Academy Enrollment Payment
 * Updates enrollment status after successful payment
 */
export async function verifyEnrollmentPaymentAction(reference: string): Promise<{
    success: boolean;
    error?: string;
    message?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection("processedPayments").doc(reference);
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
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as any;
        const enrollmentId = `${metadata.userId}_${metadata.courseId}`;
        const amountInNaira = paymentData.data.amount / 100;

        // Verify user match
        if (metadata.userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        if (amountInNaira < 1000 || amountInNaira > 500000) {
            return { error: "Invalid payment amount", success: false };
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
            const courseRef = db.collection(COLLECTIONS.COURSES).doc(metadata.courseId);
            const courseSnap = await transaction.get(courseRef);
            if (courseSnap.exists) {
                const currentStudents = courseSnap.data()!.students || 0;
                transaction.update(courseRef, {
                    students: currentStudents + 1,
                });
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
            success: true,
            message: "Enrollment successful! Check your email for course access details.",
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyEnrollment',
            reference,
        });

        return {
            success: false,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
        };
    }
}
