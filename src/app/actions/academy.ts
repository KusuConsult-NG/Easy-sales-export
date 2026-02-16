"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";

import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Check Academy application status for current user
 */
export async function checkAcademyStatusAction(): Promise<string | null> {
    try {
        const session = await auth();
        if (!session?.user) return null;

        // Check user document for service registration
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.academy;

        if (registration?.status) {
            return registration.status;
        }

        return null;
    } catch (error) {
        logger.error("Check Academy status error:", error);
        return null;
    }
}

export interface Course {
    id?: string;
    title: string;
    description: string;
    instructor: string;
    duration: string; // e.g., "4 weeks"
    level: "beginner" | "intermediate" | "advanced";
    modules: CourseModule[];
    thumbnail?: string;
    createdAt: FieldValue | Timestamp;
    updatedAt: FieldValue | Timestamp;
}

export interface CourseModule {
    id: string;
    title: string;
    description: string;
    lessons: Lesson[];
    quiz?: Quiz;
    order: number;
}

export interface Lesson {
    id: string;
    title: string;
    content: string;
    videoUrl?: string;
    duration: string;
    order: number;
}

export interface Quiz {
    id: string;
    questions: QuizQuestion[];
    passingScore: number;
}

export interface QuizQuestion {
    id: string;
    question: string;
    options: string[];
    correctAnswer: number;
}

export interface UserProgress {
    userId: string;
    courseId: string;
    completedLessons: string[];
    completedModules: string[];
    quizScores: Record<string, number>;
    overallProgress: number;
    startedAt: FieldValue | Timestamp;
    lastAccessedAt: FieldValue | Timestamp;
    completedAt?: FieldValue | Timestamp;
}

export interface LiveSession {
    id?: string;
    courseId: string;
    title: string;
    instructor: string;
    scheduledAt: Date;
    duration: string;
    meetingLink: string;
    maxParticipants: number;
    currentParticipants: number;
    status: "scheduled" | "live" | "ended";
    recordingUrl?: string;
    createdAt: Timestamp;
}

/**
 * Get all courses
 */
export async function getCoursesAction(): Promise<Course[]> {
    try {
        const snapshot = await db.collection("academy_courses").get();

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Course[];
    } catch (error) {
        logger.error("Failed to fetch courses:", error);
        return [];
    }
}

/**
 * Get course by ID
 */
export async function getCourseByIdAction(courseId: string): Promise<Course | null> {
    try {
        const courseDoc = await db.collection("academy_courses").doc(courseId).get();

        if (!courseDoc.exists) {
            return null;
        }

        return {
            id: courseDoc.id,
            ...courseDoc.data(),
        } as Course;
    } catch (error) {
        logger.error("Failed to fetch course:", error);
        return null;
    }
}

/**
 * Enroll in course
 */
export async function enrollInCourseAction(
    userId: string,
    courseId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        // Check if already enrolled
        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (progressDoc.exists) {
            return { success: false, error: "Already enrolled in this course" };
        }

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

        await progressRef.set(progress);

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: courseId,
            targetType: "course_enrollment",
        });

        return { success: true };
    } catch (error) {
        logger.error("Enrollment error:", error);
        return { success: false, error: "Failed to enroll in course" };
    }
}

/**
 * Mark lesson as complete
 */
export async function completeLessonAction(
    userId: string,
    courseId: string,
    lessonId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false, error: "Not enrolled in this course" };
        }

        const progress = progressDoc.data() as UserProgress;

        if (!progress.completedLessons.includes(lessonId)) {
            progress.completedLessons.push(lessonId);
            progress.lastAccessedAt = FieldValue.serverTimestamp();

            // Calculate overall progress
            const courseDoc = await db.collection("academy_courses").doc(courseId).get();
            if (courseDoc.exists) {
                const course = courseDoc.data() as Course;
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                progress.overallProgress = Math.round((progress.completedLessons.length / totalLessons) * 100);

                // Check if course is complete
                if (progress.completedLessons.length === totalLessons) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }
            }

            await progressRef.set(progress);
        }

        return { success: true };
    } catch (error) {
        logger.error("Lesson completion error:", error);
        return { success: false, error: "Failed to mark lesson as complete" };
    }
}

/**
 * Submit quiz score
 */
export async function submitQuizScoreAction(
    userId: string,
    courseId: string,
    moduleId: string,
    score: number
): Promise<{ success: boolean; error?: string; passed?: boolean }> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false, error: "Not enrolled in this course" };
        }

        const progress = progressDoc.data() as UserProgress;
        progress.quizScores[moduleId] = score;
        progress.lastAccessedAt = FieldValue.serverTimestamp();

        // Check if module is complete (quiz passed)
        const courseDoc = await db.collection("academy_courses").doc(courseId).get();
        if (courseDoc.exists) {
            const course = courseDoc.data() as Course;
            const module = course.modules.find((m) => m.id === moduleId);

            if (module?.quiz && score >= module.quiz.passingScore) {
                if (!progress.completedModules.includes(moduleId)) {
                    progress.completedModules.push(moduleId);
                }
                await progressRef.set(progress);
                return { success: true, passed: true };
            }
        }

        await progressRef.set(progress);
        return { success: true, passed: false };
    } catch (error) {
        logger.error("Quiz submission error:", error);
        return { success: false, error: "Failed to submit quiz" };
    }
}

/**
 * Get user progress
 */
export async function getUserProgressAction(
    userId: string,
    courseId: string
): Promise<UserProgress | null> {
    try {
        const progressDoc = await db.doc(`user_progress/${userId}/courses/${courseId}`).get();

        if (!progressDoc.exists) {
            return null;
        }

        return progressDoc.data() as UserProgress;
    } catch (error) {
        logger.error("Failed to fetch progress:", error);
        return null;
    }
}

/**
 * Get user's aggregate progress across all courses
 */
export async function getUserAggregateProgressAction(userId: string): Promise<{
    totalCourses: number;
    completedCourses: number;
    inProgressCourses: number;
    totalHoursLearned: number;
    certificatesEarned: number;
    totalLessons: number;
    completedLessons: number;
    overallProgress: number;
    enrolledCourses: UserProgress[];
}> {
    try {
        const session = await auth();
        if (!session?.user?.id || session.user.id !== userId) {
            return {
                totalCourses: 0,
                completedCourses: 0,
                inProgressCourses: 0,
                totalHoursLearned: 0,
                certificatesEarned: 0,
                totalLessons: 0,
                completedLessons: 0,
                overallProgress: 0,
                enrolledCourses: [],
            };
        }

        // Fetch all course progress records
        const progressQuery = db.collection(`user_progress/${userId}/courses`);
        const snapshot = await progressQuery.get();
        const enrolledCourses = snapshot.docs.map(doc => doc.data() as UserProgress);

        const completedCourses = enrolledCourses.filter(p => p.completedAt).length;
        const inProgressCourses = enrolledCourses.length - completedCourses;
        const totalCompletedLessons = enrolledCourses.reduce((sum, p) => sum + p.completedLessons.length, 0);

        // Calculate total lessons across all enrolled courses
        let totalLessons = 0;
        for (const progress of enrolledCourses) {
            const courseDoc = await db.collection("academy_courses").doc(progress.courseId).get();
            if (courseDoc.exists) {
                const course = courseDoc.data() as Course;
                totalLessons += course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
            }
        }

        const overallProgress = totalLessons > 0 ? Math.round((totalCompletedLessons / totalLessons) * 100) : 0;

        return {
            totalCourses: enrolledCourses.length,
            completedCourses,
            inProgressCourses,
            totalHoursLearned: totalCompletedLessons * 0.5, // Estimate 30 min per lesson
            certificatesEarned: completedCourses, // One certificate per completed course
            totalLessons,
            completedLessons: totalCompletedLessons,
            overallProgress,
            enrolledCourses,
        };
    } catch (error) {
        logger.error("Failed to fetch aggregate progress:", error);
        return {
            totalCourses: 0,
            completedCourses: 0,
            inProgressCourses: 0,
            totalHoursLearned: 0,
            certificatesEarned: 0,
            totalLessons: 0,
            completedLessons: 0,
            overallProgress: 0,
            enrolledCourses: [],
        };
    }
}

/**
 * Get live sessions
 */
export async function getLiveSessionsAction(courseId?: string): Promise<LiveSession[]> {
    try {
        const ref = db.collection("academy_live_sessions");
        const query = courseId ? ref.where("courseId", "==", courseId) : ref;
        const snapshot = await query.get();

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LiveSession[];
    } catch (error) {
        logger.error("Failed to fetch live sessions:", error);
        return [];
    }
}

/**
 * APPLICATION SUBMISSION
 */

export interface AcademyApplicationData {
    personalInfo: {
        fullName: string;
        email: string;
        phone: string;
        dateOfBirth: string;
        state: string;
        occupation: string;
    };
    education: {
        educationLevel: string;
        fieldOfStudy: string;
        yearsExperience: number;
        currentRole: string;
    };
    interests: {
        learningPaths: string[];
        topics: string;
        goals: string;
    };
}

/**
 * Submit Academy learner application
 */
export async function submitAcademyApplicationAction(
    applicationData: AcademyApplicationData
): Promise<{ success: boolean; error?: string; applicationId?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Generate unique application ID
        const applicationId = `ACADEMY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Save to Firestore
        await db.collection("ACADEMY_APPLICATIONS").doc(applicationId).set({
            ...applicationData,
            userId: session.user.id,
            applicationId,
            status: "pending",
            submittedAt: FieldValue.serverTimestamp(),
            reviewedAt: null,
            reviewedBy: null,
            notes: "",
        });

        // CRITICAL: Update user.serviceRegistrations to link application with auth
        await db.collection("users").doc(session.user.id).set({
            serviceRegistrations: {
                academy: {
                    status: "pending",
                    applicationId,
                    submittedAt: FieldValue.serverTimestamp(),
                }
            },
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        // Create audit log
        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "academy_application",
            details: `Learner application submitted for ${applicationData.personalInfo.fullName}`,
        });

        return { success: true, applicationId };
    } catch (error) {
        logger.error("Academy application submission error:", error);
        return { success: false, error: "Failed to submit application. Please try again." };
    }
}

/**
 * ADMIN ACTIONS
 */

export async function createCourseAction(data: Partial<Course>): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const docRef = await db.collection("academy_courses").add({
            ...data,
            instructorId: session.user.id, // Ensure instructor is linked
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            modules: [],
            status: "draft",
        });

        await createAdminAuditLog({
            action: "course_created",
            userId: session.user.id,
            targetId: docRef.id,
            targetType: "course",
        });

        return { success: true, id: docRef.id };
    } catch (error: any) {
        logger.error("Create course error:", error);
        return { success: false, error: error.message };
    }
}

export async function updateCourseAction(courseId: string, data: Partial<Course>): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection("academy_courses").doc(courseId).update({
            ...data,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "course_updated",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Updated details",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update course error:", error);
        return { success: false, error: error.message };
    }
}

export async function updateCourseModulesAction(courseId: string, modules: CourseModule[]): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection("academy_courses").doc(courseId).update({
            modules,
            updatedAt: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "course_updated",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Updated modules",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update modules error:", error);
        return { success: false, error: error.message };
    }
}
