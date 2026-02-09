"use server";

import { auth } from "@/lib/auth";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, serverTimestamp, updateDoc, increment } from "firebase/firestore";
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
        const existingEnrollment = await getDoc(doc(db, COLLECTIONS.ENROLLMENTS, enrollmentId));

        if (existingEnrollment.exists()) {
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
        await setDoc(doc(db, COLLECTIONS.ENROLLMENTS, enrollmentId), {
            userId: session.user.id,
            courseId,
            fullName,
            email: session.user.email,
            phone,
            amount,
            paymentReference: reference,
            status: "pending_payment", // pending_payment | active | completed | dropped
            progress: 0,
            enrollmentDate: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            success: true,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        console.error("Payment initialization error:", error);
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

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: "Payment verification failed",
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as any;
        const enrollmentId = `${metadata.userId}_${metadata.courseId}`;

        // Update enrollment status
        const enrollmentRef = doc(db, COLLECTIONS.ENROLLMENTS, enrollmentId);
        await updateDoc(enrollmentRef, {
            status: "active",
            paymentStatus: "paid",
            paymentVerifiedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Increment course student count
        const courseRef = doc(db, COLLECTIONS.COURSES, metadata.courseId);
        const courseDoc = await getDoc(courseRef);
        if (courseDoc.exists()) {
            await updateDoc(courseRef, {
                students: increment(1),
            });
        }

        return {
            success: true,
            message: "Enrollment successful! Check your email for course access details.",
        };
    } catch (error: any) {
        console.error("Payment verification error:", error);
        return {
            success: false,
            error: "Failed to verify payment. Please contact support.",
        };
    }
}
