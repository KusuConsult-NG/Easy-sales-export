"use server";

import { z } from "zod";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import {
    courseProgressSchema,
    courseEnrollmentSchema
} from "@/lib/validations/course";
import { AuditActionType, type CourseProgress } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";

/**
 * Update lesson progress (called by video player)
 */
export async function updateLessonProgress(
    data: z.infer<typeof courseProgressSchema>
) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const validated = courseProgressSchema.parse(data);

        // Use a composite ID for uniqueness: userId_courseId_lessonId
        // Alternately, query by fields. Let's use a specific collection for granular tracking.
        const progressId = `${session.user.id}_${validated.lessonId}`;
        const lessonProgressRef = db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId);

        await lessonProgressRef.set({
            userId: session.user.id,
            courseId: validated.courseId,
            lessonId: validated.lessonId, // Now required
            progressPercent: validated.progressPercent,
            lastWatchedSecond: validated.lastWatchedSecond,
            completed: validated.progressPercent >= 95,
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // If completed, we should probably trigger the main "completeLessonAction" logic?
        // No, let the user click "Mark Complete" but use this data to VERIFY.
        // Or auto-complete? The "Honor System" fix is about verification.
        // Let's keep it manual but verified.

        return { success: true as const, data: { userId: session.user.id,
            completed: validated.progressPercent >= 95, } };
    } catch (error) {
        logger.error("Lesson progress error:", error);
        if (error instanceof z.ZodError) {
            return {
                success: false as const,
                error: "Validation error",
                details: error.issues.map(e => e.message),
            };
        }
        return { success: false as const, error: "Failed to update lesson progress" };
    }
}

/**
 * Enroll in a course
 */
export async function enrollInCourse(
    data: z.infer<typeof courseEnrollmentSchema>
) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const validated = courseEnrollmentSchema.parse(data);

        // Check if already enrolled
        const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', validated.courseId)
            .get();

        if (!snapshot.empty) {
            return { success: false as const, error: "Already enrolled in this course" };
        }

        // Create enrollment
        const enrollmentRef = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({
            userId: session.user.id,
            courseId: validated.courseId,
            enrolledAt: FieldValue.serverTimestamp(),
            status: 'active',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Initialize progress record
        await db.collection(COLLECTIONS.COURSE_PROGRESS).add({
            userId: session.user.id,
            courseId: validated.courseId,
            progressPercent: 0,
            lastWatchedSecond: 0,
            completed: false,
            completedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id,
            action: 'course_enrolled',
            targetId: validated.courseId,
            targetType: 'course',
            metadata: {
                enrollmentId: enrollmentRef.id,
            },
        });

        return { success: true as const, data: { enrollmentId: enrollmentRef.id,
            userId: session.user.id, } };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false as const,
                error: "Validation error",
                details: error.issues.map((e: any) => e.message),
            };
        }
        return { success: false as const, error: "Failed to enroll in course" };
    }
}

/**
 * Get user's course progress
 */
export async function getCourseProgress(courseId: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const snapshot = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (snapshot.empty) {
            return { success: true as const, data: { progress: null, } };
        }

        const progressData = snapshot.docs[0].data();

        return { success: true as const, data: { progress: {
                id: snapshot.docs[0].id,
                userId: progressData.userId,
                courseId: progressData.courseId,
                progressPercent: progressData.progressPercent,
                lastWatchedSecond: progressData.lastWatchedSecond,
                completed: progressData.completed,
                completedAt: progressData.completedAt?.toDate?.()?.toISOString() || null,
                updatedAt: progressData.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            } },
        };
    } catch (error) {
        return { success: false as const, error: "Failed to fetch course progress", progress: null };
    }
}

/**
 * Get lesson progress (video state)
 */
export async function getLessonProgress(lessonId: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const progressId = `${session.user.id}_${lessonId}`;
        const doc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

        if (!doc.exists) {
            return { success: true as const, data: { progress: null } };
        }

        return { success: true as const, data: { progress: doc.data() as {
                progressPercent: number;
                lastWatchedSecond: number;
                completed: boolean; } },
        };
    } catch (error) {
        logger.error("Failed to fetch lesson progress:", error);
        return { success: false as const, error: "Failed to fetch lesson progress", progress: null };
    }
}

/**
 * Get all enrolled courses for user
 */
export async function getUserEnrolledCourses() {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('status', '==', 'active')
            .get();

        const enrollments = serializeDocs(snapshot.docs);

        return { success: true as const, data: { courses: enrollments, } };
    } catch (error) {
        return { success: false as const, error: "Failed to fetch enrolled courses", courses: [] };
    }
}

/**
 * Mark course as complete (manual completion)
 */
export async function completeCourse(courseId: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const snapshot = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (snapshot.empty) {
            return { success: false as const, error: "No progress record found" };
        }

        const progressDoc = snapshot.docs[0];
        await progressDoc.ref.update({
            completed: true,
            completedAt: FieldValue.serverTimestamp(),
            progressPercent: 100,
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id,
            action: 'course_completed',
            targetId: courseId,
            targetType: 'course',
            metadata: {
                manualCompletion: true,
            },
        });

        return { success: true as const, data: { userId: session.user.id } };
    } catch (error) {
        return { success: false as const, error: "Failed to complete course" };
    }
}

/**
 * Generate certificate for completed course
 * Called automatically when progress reaches 100%
 */
export async function generateCourseCertificate(courseId: string, courseTitle: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        // Verify course is completed
        const snapshot = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .where('completed', '==', true)
            .get();

        if (snapshot.empty) {
            return { success: false as const, error: "Course not completed yet" };
        }

        const progressData = snapshot.docs[0].data();

        // Check if certificate already exists
        const certSnapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (!certSnapshot.empty) {
            // Return existing certificate
            const existingCert = certSnapshot.docs[0];
            return { success: true as const, data: { certificateId: existingCert.id,
                message: "Certificate already generated", } };
        }

        // Generate certificate
        const certificateRef = await db.collection(COLLECTIONS.COURSE_CERTIFICATES).add({
            userId: session.user.id,
            userName: session.user.name || "Unknown",
            userEmail: session.user.email,
            courseId,
            courseTitle,
            completedAt: progressData.completedAt || FieldValue.serverTimestamp(),
            issuedAt: FieldValue.serverTimestamp(),
            certificateNumber: `CERT-${Date.now()}-${session.user.id?.substring(0, 8)}`,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: session.user.id || "",
            type: "success",
            title: "🎉 Certificate Issued!",
            message: `Congratulations! You've completed "${courseTitle}" and earned your certificate.`,
            link: `/courses/${courseId}/certificate`,
            linkText: "View Certificate",
        });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id || "",
            action: 'course_completed',
            targetId: certificateRef.id,
            targetType: 'certificate',
            metadata: {
                courseId,
                courseTitle,
                certificateNumber: `CERT-${Date.now()}-${session.user.id?.substring(0, 8)}`,
            },
        });

        return { success: true as const, data: { certificateId: certificateRef.id,
            message: "Certificate generated successfully", } };
    } catch (error) {
        logger.error("Certificate generation error:", error);
        return { success: false as const, error: "Failed to generate certificate" };
    }
}

/**
 * Get user's course certificate
 */
export async function getCourseCertificate(courseId: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const snapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (snapshot.empty) {
            return { success: true as const, data: { certificate: null, } };
        }

        const certData = snapshot.docs[0].data();

        return { success: true as const, data: { certificate: {
                id: snapshot.docs[0].id,
                userId: certData.userId,
                userName: certData.userName,
                courseId: certData.courseId,
                courseTitle: certData.courseTitle,
                completedAt: certData.completedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                issuedAt: certData.issuedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
                certificateNumber: certData.certificateNumber, } },
        };
    } catch (error) {
        return { success: false as const, error: "Failed to fetch certificate", certificate: null };
    }
}
