"use server";

import { z } from "zod";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { courseProgressSchema,
    courseEnrollmentSchema } from "@/lib/validations/course";
import { AuditActionType, type CourseProgress } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";

/**
 * Update lesson progress (called by video player)
 */
export async function updateLessonProgress(
    data: z.infer<typeof courseProgressSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try {
        const validated = courseProgressSchema.parse(data);

        // Use a composite ID for uniqueness: userId_courseId_lessonId
        const progressId = `${session.user.id}_${validated.lessonId}`;
        const lessonProgressRef = db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId);

        // Check existing progress to validate heartbeat watch speed
        const existingDoc = await lessonProgressRef.get();
        let finalLastWatchedSecond = validated.lastWatchedSecond;
        let finalProgressPercent = validated.progressPercent;

        if (existingDoc.exists) {
            const existing = existingDoc.data();
            const lastUpdated = existing?.updatedAt ? (existing.updatedAt instanceof Timestamp ? existing.updatedAt.toDate() : new Date(existing.updatedAt)) : null;
            
            if (lastUpdated) {
                const elapsedTimeSeconds = (Date.now() - lastUpdated.getTime()) / 1000;
                const progressIncreaseSeconds = validated.lastWatchedSecond - (existing?.lastWatchedSecond || 0);

                if (progressIncreaseSeconds > 0) {
                    const maxSpeedMultiplier = 2.0; // Allowed playback rate up to 2.0x
                    const graceBufferSeconds = 10;   // Extra buffer to account for minor sync fluctuations or lag
                    const maxAllowedIncrease = (elapsedTimeSeconds * maxSpeedMultiplier) + graceBufferSeconds;

                    if (progressIncreaseSeconds > maxAllowedIncrease) {
                        logger.warn(`[LMS Progress Guard] Watch-rate anomaly detected for user ${session.user.id} on lesson ${validated.lessonId}. Increase: ${progressIncreaseSeconds}s, Allowed: ${maxAllowedIncrease}s.`);
                        // Clamp the increment to prevent cheating
                        finalLastWatchedSecond = (existing?.lastWatchedSecond || 0) + maxAllowedIncrease;
                        
                        if (validated.lastWatchedSecond > 0) {
                            const ratio = finalLastWatchedSecond / validated.lastWatchedSecond;
                            finalProgressPercent = Math.min(100, Math.max(0, (existing?.progressPercent || 0) + (validated.progressPercent - (existing?.progressPercent || 0)) * ratio));
                        }
                    }
                }
            }
        }

        await lessonProgressRef.set({ userId: session.user.id,
            courseId: validated.courseId,
            lessonId: validated.lessonId,
            progressPercent: finalProgressPercent,
            lastWatchedSecond: finalLastWatchedSecond,
            completed: finalProgressPercent >= 95,
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Lesson progress error:", error);
        if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: error.issues.map(e => e.message)};
        }
        return { success: false as const, error: "Failed to update lesson progress"};
    }
}

/**
 * Enroll in a course
 */
export async function enrollInCourse(
    data: z.infer<typeof courseEnrollmentSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const validated = courseEnrollmentSchema.parse(data);

        // Check if already enrolled
        const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', validated.courseId)
            .get();

        if (!snapshot.empty) {
            return { success: false as const, error: "Already enrolled in this course"};
        }

        // Create enrollment
        const enrollmentRef = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({ userId: session.user.id,
            courseId: validated.courseId,
            enrolledAt: FieldValue.serverTimestamp(),
            status: 'active',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // Initialize progress record with composite ID to eliminate duplicates and queries
        const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${validated.courseId}`);
        await progressRef.set({ userId: session.user.id,
            courseId: validated.courseId,
            progressPercent: 0,
            completionPercentage: 0, // Enforce dual-compatibility for route check
            lastWatchedSecond: 0,
            completed: false,
            completedAt: null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() }, { merge: true });

        // Audit log
        await createAdminAuditLog({ userId: session.user.id,
            action: 'course_enrolled',
            targetId: validated.courseId,
            targetType: 'course',
            metadata: {
                enrollmentId: enrollmentRef.id } });

        return { error: null, success: true as const, data: null };
    } catch (error) { if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: error.issues.map((e: any) => e.message)};
        }
        return { success: false as const, error: "Failed to enroll in course"};
    }
}

/**
 * Get user's course progress
 */
export async function getCourseProgress(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { // Retrieve course progress directly using the composite document ID
        const progressDoc = await db.collection(COLLECTIONS.COURSE_PROGRESS)
            .doc(`${session.user.id}_${courseId}`)
            .get();

        if (!progressDoc.exists) {
            return { error: null, success: true as const, data: null };
        }

        const progressData = progressDoc.data()!;
        const progressPercent = progressData.progressPercent !== undefined 
            ? progressData.progressPercent 
            : (progressData.completionPercentage ?? 0);

        return { error: null, success: true as const, data: { progress: {
                id: progressDoc.id, userId: progressData.userId, courseId: progressData.courseId, progressPercent, lastWatchedSecond: progressData.lastWatchedSecond || 0, completed: progressData.completed || false, completedAt: progressData.completedAt?.toDate?.()?.toISOString() || null, updatedAt: progressData.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString() } } };
    } catch (error) { logger.error("Failed to fetch course progress:", error);
        return { success: false as const, error: "Failed to fetch course progress", progress: null};
    }
}

/**
 * Get lesson progress (video state)
 */
export async function getLessonProgress(lessonId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try {
        const progressId = `${session.user.id}_${lessonId}`;
        const doc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

        if (!doc.exists) { return { error: null, success: true as const, data: null };
        }

        const rawData = doc.data();
        return { error: null, success: true as const, data: { progress: serializeValue({
                progressPercent: rawData?.progressPercent ?? 0,
                lastWatchedSecond: rawData?.lastWatchedSecond ?? 0,
                completed: rawData?.completed ?? false }) } };
    } catch (error) { logger.error("Failed to fetch lesson progress:", error);
        return { success: false as const, error: "Failed to fetch lesson progress", progress: null};
    }
}

/**
 * Get all enrolled courses for user
 */
export async function getUserEnrolledCourses() { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const snapshot = await db.collection(COLLECTIONS.COURSE_ENROLLMENTS)
            .where('userId', '==', session.user.id)
            .where('status', '==', 'active')
            .get();

        const enrollments = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: null };
    } catch (error) { return { success: false as const, error: "Failed to fetch enrolled courses", courses: []};
    }
}

/**
 * Mark course as complete (manual completion)
 */
export async function completeCourse(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${courseId}`);
        
        // Use a transaction to update progress atomically and avoid write race conditions
        await db.runTransaction(async (transaction) => {
            const progressDoc = await transaction.get(progressRef);
            if (!progressDoc.exists) {
                throw new Error("No progress record found");
            }
            transaction.update(progressRef, { completed: true,
                completedAt: FieldValue.serverTimestamp(),
                progressPercent: 100,
                completionPercentage: 100, // Enforce dual-compatibility for route check
                updatedAt: FieldValue.serverTimestamp() });
        });

        // Audit log
        await createAdminAuditLog({ userId: session.user.id,
            action: 'course_completed',
            targetId: courseId,
            targetType: 'course',
            metadata: {
                manualCompletion: true } });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Failed to complete course:", error);
        return { success: false as const, error: "Failed to complete course"};
    }
}

/**
 * Generate certificate for completed course
 * Called automatically when progress reaches 100%
 */
export async function generateCourseCertificate(courseId: string, courseTitle: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { // Verify course is completed using composite ID
        const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists || !progressDoc.data()?.completed) {
            return { success: false as const, error: "Course not completed yet"};
        }

        const progressData = progressDoc.data()!;

        // Check if certificate already exists
        const certSnapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (!certSnapshot.empty) { // Return existing certificate
            const existingCert = certSnapshot.docs[0];
            return { error: null, success: true as const, data: null };
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
            updatedAt: FieldValue.serverTimestamp() });

        // Create notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: session.user.id || "",
            type: "success",
            title: "🎉 Certificate Issued!",
            message: `Congratulations! You've completed "${courseTitle}" and earned your certificate.`,
            link: `/courses/${courseId}/certificate`,
            linkText: "View Certificate" });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id || "",
            action: 'course_completed',
            targetId: certificateRef.id,
            targetType: 'certificate',
            metadata: {
                courseId,
                courseTitle,
                certificateNumber: `CERT-${Date.now()}-${session.user.id?.substring(0, 8)}` } });

        return { error: null, success: true as const, data: { certificateId: certificateRef.id, message: "Certificate generated successfully" } };
    } catch (error) { logger.error("Certificate generation error:", error);
        return { success: false as const, error: "Failed to generate certificate", data: null };
    }
}

/**
 * Get user's course certificate
 */
export async function getCourseCertificate(courseId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const snapshot = await db.collection(COLLECTIONS.COURSE_CERTIFICATES)
            .where('userId', '==', session.user.id)
            .where('courseId', '==', courseId)
            .get();

        if (snapshot.empty) {
            return { error: null, success: true as const, data: null };
        }

        const certData = snapshot.docs[0].data();

        return { error: null, success: true as const, data: { certificate: {
                id: snapshot.docs[0].id, userId: certData.userId, userName: certData.userName, courseId: certData.courseId, courseTitle: certData.courseTitle, completedAt: certData.completedAt?.toDate?.()?.toISOString() || new Date().toISOString(), issuedAt: certData.issuedAt?.toDate?.()?.toISOString() || new Date().toISOString(), certificateNumber: certData.certificateNumber } } };
    } catch (error) { return { success: false as const, error: "Failed to fetch certificate", certificate: null, data: null };
    }
}
