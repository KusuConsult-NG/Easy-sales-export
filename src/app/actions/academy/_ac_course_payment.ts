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
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
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

        // Initialize Paystack
        const result = await initializePaystackPayment(
            session.user.email || "",
            Math.round(course.price * 100), // Kobo
            {
                type: "academy_enrollment",
                courseId,
                userId: session.user.id,
                email: session.user.email,
            },
            `${process.env.NEXT_PUBLIC_APP_URL}/academy/verify` // Redirect to Academy verification page
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

        // Check if already processed
        const existingRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingDoc = await existingRef.get();
        if (existingDoc.exists) return { success: false as const, error: "Payment already processed", data: null };

        // Process enrollment
        const userId = metadata.userId;
        const courseId = metadata.courseId;
        const amountPaid = verify.data.amount / 100;

        // 🔒 SECURITY FIX: Amount re-validation against REAL course price
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found", data: null };

        const course = courseDoc.data() as Course;
        if (course.price && course.price > 0) {
            // Check if amount paid is less than course price
            // Allow small margin? No, be strict but handle float.
            if (amountPaid < course.price) {
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
            return { success: false as const, error: "Payment already processed", data: null };
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
        revalidatePath("/dashboard/academy");
        revalidatePath(`/academy/courses/${courseId}`);

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
