"use server";

import { z } from "zod";
import { collection, addDoc, updateDoc, doc, getDoc, getDocs, query, where, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    courseProgressSchema,
    courseEnrollmentSchema
} from "@/lib/validations/course";
import { AuditActionType, type CourseProgress } from "@/types/strict";
import { createAuditLog } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";

/**
 * Update course progress (called by video player)
 */
export async function updateCourseProgress(
    data: z.infer<typeof courseProgressSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = courseProgressSchema.parse(data);

        // Check if progress record exists
        const progressQuery = query(
            collection(db, 'course_progress'),
            where('userId', '==', session.user.id),
            where('courseId', '==', validated.courseId)
        );

        const snapshot = await getDocs(progressQuery);

        if (snapshot.empty) {
            // Create new progress record
            await addDoc(collection(db, 'course_progress'), {
                userId: session.user.id,
                courseId: validated.courseId,
                progressPercent: validated.progressPercent,
                lastWatchedSecond: validated.lastWatchedSecond,
                completed: validated.progressPercent >= 95,
                completedAt: validated.progressPercent >= 95 ? serverTimestamp() : null,
                updatedAt: serverTimestamp(),
            });
        } else {
            // Update existing progress
            const progressDoc = snapshot.docs[0];
            await updateDoc(doc(db, 'course_progress', progressDoc.id), {
                progressPercent: validated.progressPercent,
                lastWatchedSecond: validated.lastWatchedSecond,
                completed: validated.progressPercent >= 95,
                completedAt: validated.progressPercent >= 95 ? serverTimestamp() : null,
                updatedAt: serverTimestamp(),
            });
        }

        // Audit log for completion
        if (validated.progressPercent >= 95) {
            await createAuditLog({
                userId: session.user.id,
                actionType: AuditActionType.COURSE_COMPLETE,
                resourceId: validated.courseId,
                resourceType: 'course',
                metadata: {
                    progressPercent: validated.progressPercent,
                },
            });
        }

        return {
            success: true,
            userId: session.user.id,
            completed: validated.progressPercent >= 95,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.issues.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to update course progress" };
    }
}

/**
 * Enroll in a course
 */
export async function enrollInCourse(
    data: z.infer<typeof courseEnrollmentSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = courseEnrollmentSchema.parse(data);

        // Check if already enrolled
        const enrollmentQuery = query(
            collection(db, 'course_enrollments'),
            where('userId', '==', session.user.id),
            where('courseId', '==', validated.courseId)
        );

        const snapshot = await getDocs(enrollmentQuery);

        if (!snapshot.empty) {
            return { success: false, error: "Already enrolled in this course" };
        }

        // Create enrollment
        const enrollmentRef = await addDoc(collection(db, 'course_enrollments'), {
            userId: session.user.id,
            courseId: validated.courseId,
            enrolledAt: serverTimestamp(),
            status: 'active',
        });

        // Initialize progress record
        await addDoc(collection(db, 'course_progress'), {
            userId: session.user.id,
            courseId: validated.courseId,
            progressPercent: 0,
            lastWatchedSecond: 0,
            completed: false,
            completedAt: null,
            updatedAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.COURSE_ENROLL,
            resourceId: validated.courseId,
            resourceType: 'course',
            metadata: {
                enrollmentId: enrollmentRef.id,
            },
        });

        return {
            success: true,
            enrollmentId: enrollmentRef.id,
            userId: session.user.id,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.issues.map((e: any) => e.message),
            };
        }
        return { success: false, error: "Failed to enroll in course" };
    }
}

/**
 * Get user's course progress
 */
export async function getCourseProgress(courseId: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", progress: null };
    }

    try {
        const progressQuery = query(
            collection(db, 'course_progress'),
            where('userId', '==', session.user.id),
            where('courseId', '==', courseId)
        );

        const snapshot = await getDocs(progressQuery);

        if (snapshot.empty) {
            return {
                success: true,
                progress: null,
            };
        }

        const progressData = snapshot.docs[0].data();

        return {
            success: true,
            progress: {
                id: snapshot.docs[0].id,
                userId: progressData.userId,
                courseId: progressData.courseId,
                progressPercent: progressData.progressPercent,
                lastWatchedSecond: progressData.lastWatchedSecond,
                completed: progressData.completed,
                completedAt: progressData.completedAt?.toDate() || null,
                updatedAt: progressData.updatedAt?.toDate() || new Date(),
            } as CourseProgress,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch course progress", progress: null };
    }
}

/**
 * Get all enrolled courses for user
 */
export async function getUserEnrolledCourses() {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", courses: [] };
    }

    try {
        const enrollmentsQuery = query(
            collection(db, 'course_enrollments'),
            where('userId', '==', session.user.id),
            where('status', '==', 'active')
        );

        const snapshot = await getDocs(enrollmentsQuery);

        const enrollments = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            enrolledAt: (doc.data().enrolledAt as Timestamp)?.toDate() || new Date(),
        }));

        return {
            success: true,
            courses: enrollments,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch enrolled courses", courses: [] };
    }
}

/**
 * Mark course as complete (manual completion)
 */
export async function completeCourse(courseId: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const progressQuery = query(
            collection(db, 'course_progress'),
            where('userId', '==', session.user.id),
            where('courseId', '==', courseId)
        );

        const snapshot = await getDocs(progressQuery);

        if (snapshot.empty) {
            return { success: false, error: "No progress record found" };
        }

        const progressDoc = snapshot.docs[0];
        await updateDoc(doc(db, 'course_progress', progressDoc.id), {
            completed: true,
            completedAt: serverTimestamp(),
            progressPercent: 100,
            updatedAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.COURSE_COMPLETE,
            resourceId: courseId,
            resourceType: 'course',
            metadata: {
                manualCompletion: true,
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        return { success: false, error: "Failed to complete course" };
    }
}

/**
 * Generate certificate for completed course
 * Called automatically when progress reaches 100%
 */
export async function generateCourseCertificate(courseId: string, courseTitle: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        // Verify course is completed
        const progressQuery = query(
            collection(db, 'course_progress'),
            where('userId', '==', session.user.id),
            where('courseId', '==', courseId),
            where('completed', '==', true)
        );

        const snapshot = await getDocs(progressQuery);

        if (snapshot.empty) {
            return { success: false, error: "Course not completed yet" };
        }

        const progressData = snapshot.docs[0].data();

        // Check if certificate already exists
        const certQuery = query(
            collection(db, 'course_certificates'),
            where('userId', '==', session.user.id),
            where('courseId', '==', courseId)
        );

        const certSnapshot = await getDocs(certQuery);

        if (!certSnapshot.empty) {
            // Return existing certificate
            const existingCert = certSnapshot.docs[0];
            return {
                success: true,
                certificateId: existingCert.id,
                message: "Certificate already generated",
            };
        }

        // Generate certificate
        const certificateRef = await addDoc(collection(db, 'course_certificates'), {
            userId: session.user.id,
            userName: session.user.name || "Unknown",
            userEmail: session.user.email,
            courseId,
            courseTitle,
            completedAt: progressData.completedAt || serverTimestamp(),
            issuedAt: serverTimestamp(),
            certificateNumber: `CERT-${Date.now()}-${session.user.id!.substring(0, 8)}`,
        });

        // Create notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: session.user.id!,
            type: "success",
            title: "🎉 Certificate Issued!",
            message: `Congratulations! You've completed "${courseTitle}" and earned your certificate.`,
            link: `/courses/${courseId}/certificate`,
            linkText: "View Certificate",
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id!,
            actionType: AuditActionType.COURSE_COMPLETE,
            resourceId: certificateRef.id,
            resourceType: 'certificate',
            metadata: {
                courseId,
                courseTitle,
                certificateNumber: `CERT-${Date.now()}-${session.user.id!.substring(0, 8)}`,
            },
        });

        return {
            success: true,
            certificateId: certificateRef.id,
            message: "Certificate generated successfully",
        };
    } catch (error) {
        console.error("Certificate generation error:", error);
        return { success: false, error: "Failed to generate certificate" };
    }
}

/**
 * Get user's course certificate
 */
export async function getCourseCertificate(courseId: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", certificate: null };
    }

    try {
        const certQuery = query(
            collection(db, 'course_certificates'),
            where('userId', '==', session.user.id),
            where('courseId', '==', courseId)
        );

        const snapshot = await getDocs(certQuery);

        if (snapshot.empty) {
            return {
                success: true,
                certificate: null,
            };
        }

        const certData = snapshot.docs[0].data();

        return {
            success: true,
            certificate: {
                id: snapshot.docs[0].id,
                userId: certData.userId,
                userName: certData.userName,
                courseId: certData.courseId,
                courseTitle: certData.courseTitle,
                completedAt: certData.completedAt?.toDate() || new Date(),
                issuedAt: certData.issuedAt?.toDate() || new Date(),
                certificateNumber: certData.certificateNumber,
            },
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch certificate", certificate: null };
    }
}
