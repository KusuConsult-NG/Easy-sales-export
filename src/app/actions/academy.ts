"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { revalidatePath, unstable_cache } from "next/cache";

import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Check Academy application status for current user
 */
export async function checkAcademyStatusAction(): Promise<string | null> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return null;

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.academy;

        if (registration?.status) {
            return registration.status;
        }

        // ── FALLBACK: Returning student whose data predates V2 schema ──────
        // Query the raw academy_applications collection directly.
        const legacySnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (!legacySnap.empty) {
            const legacyData = legacySnap.docs[0].data();
            const legacyStatus = legacyData?.status ?? 'pending';

            // Auto-backfill serviceRegistrations so future logins resolve instantly
            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                { serviceRegistrations: { academy: { status: legacyStatus, syncedFromLegacy: true, syncedAt: new Date().toISOString() } } },
                { merge: true }
            );

            logger.info(`[checkAcademyStatus] Backfilled legacy academy status '${legacyStatus}' for user ${session.user.id}`);
            return legacyStatus;
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
    tier?: "free" | "foundation" | "standard" | "elite";
    price: number; // 0 for free
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
    documentUrl?: string;
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
export async function getCoursesAction(
    limit: number = 12,
    lastDocId?: string
): Promise<{ courses: Course[]; lastDocId: string | null }> {
    const getCachedCourses = unstable_cache(
        async () => {
            try {
                let q = db.collection(COLLECTIONS.ACADEMY_COURSES)
                    .orderBy("createdAt", "desc");

                if (lastDocId) {
                    const lastDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(lastDocId).get();
                    if (lastDoc.exists) {
                        q = q.startAfter(lastDoc);
                    }
                }

                q = q.limit(limit);

                const snapshot = await q.get();

                const courses = snapshot.docs.map((doc) => ({
                    id: doc.id,
                    ...doc.data(),
                })) as Course[];

                const newLastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

                return { courses, lastDocId: newLastDocId };
            } catch (error) {
                logger.error("Failed to fetch courses:", error);
                return { courses: [], lastDocId: null };
            }
        },
        [`academy-courses`, limit.toString(), lastDocId || "none"],
        { revalidate: 3600, tags: ["academy-courses"] }
    );

    return getCachedCourses();
}

/**
 * Get course by ID
 */
const getCachedCourseById = (courseId: string) => unstable_cache(
    async () => {
        try {
            const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();

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
    },
    [`academy-course-${courseId}`],
    { revalidate: 3600, tags: [`academy-course-${courseId}`] }
)();

export async function getCourseByIdAction(courseId: string): Promise<Course | null> {
    return getCachedCourseById(courseId);
}

/**
 * Initialize Payment for a Course
 */
export async function initializeCoursePaymentAction(courseId: string): Promise<{
    success: boolean;
    error?: string;
    data?: { authorizationUrl: string; reference: string };
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Authentication required" };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false, error: "Course not found" };

        const course = courseDoc.data() as Course;
        if (!course.price || course.price <= 0) {
            return { success: false, error: "This course is free. Please enroll directly." };
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

        return { success: true, data: result };
    } catch (error: any) {
        logger.error("Course payment init error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Verify Course Payment and Enroll
 */
export async function verifyCoursePaymentAction(reference: string): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Authentication required" };

        // Verify with Paystack
        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false, error: "Payment verification failed" };
        }

        const metadata = verify.data.metadata;
        if (metadata.type !== "academy_enrollment") {
            return { success: false, error: "Invalid payment type" };
        }

        // Check if already processed
        const existingRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingDoc = await existingRef.get();
        if (existingDoc.exists) return { success: false, error: "Payment already processed" };

        // Process enrollment
        const userId = metadata.userId;
        const courseId = metadata.courseId;
        const amountPaid = verify.data.amount / 100;

        // 🔒 SECURITY FIX: Amount re-validation against REAL course price
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false, error: "Course not found" };

        const course = courseDoc.data() as Course;
        if (course.price && course.price > 0) {
            // Check if amount paid is less than course price
            // Allow small margin? No, be strict but handle float.
            if (amountPaid < course.price) {
                logger.warn(`Price drift detected for course ${courseId}. Expected ${course.price}, Paid ${amountPaid}`);
                return { success: false, error: "Payment verification failed: Amount paid is less than current course price." };
            }
        }

        await db.runTransaction(async (t) => {
            // 1. Enroll User
            const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
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

            // 2. Mark Payment Processed
            t.set(existingRef, {
                reference,
                type: "academy_enrollment",
                courseId,
                userId,
                amount: verify.data.amount / 100,
                processedAt: FieldValue.serverTimestamp(),
            });

            // 3. Update Course Analytics (optional)
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

        return { success: true };
    } catch (error: any) {
        logger.error("Course payment verification error:", error);
        return { success: false, error: "Failed to verify payment" };
    }
}

function checkCourseAccess(userPlan: string, courseTier: string): boolean {
    // Treat undefined or 'free' tier as open to all
    if (!courseTier || courseTier === "free") return true;
    
    // Elite plan has access to everything
    if (userPlan === "elite") return true;
    
    // Standard/Legacy-Advanced plan has access to foundation and standard
    if (userPlan === "standard" || userPlan === "advanced") {
        return courseTier === "foundation" || courseTier === "standard";
    }
    
    // Foundation plan only has access to foundation
    if (userPlan === "foundation") {
        return courseTier === "foundation";
    }
    
    // Default deny for unrecognized plans or free users trying to access paid tiers
    return false;
}

/**
 * Enroll in course (Gated by Academy Tier)
 */
export async function enrollInCourseAction(
    userId: string,
    courseId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        // Check user's Academy Plan
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) return { success: false, error: "User not found" };
        const userData = userDoc.data();
        const userPlan = userData?.serviceRegistrations?.academy?.plan || "free";

        // Check if already enrolled
        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (progressDoc.exists) {
            return { success: false, error: "Already enrolled in this course" };
        }

        // 🔒 SECURITY FIX: Validate package tier
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false, error: "Course not found" };

        const course = courseDoc.data() as Course;
        const courseTier = course.tier || "free";

        const hasAccess = checkCourseAccess(userPlan, courseTier);

        if (!hasAccess) {
            return { success: false, error: `Your current package (${userPlan}) does not grant access to this course. Please upgrade your package to the ${courseTier.charAt(0).toUpperCase() + courseTier.slice(1)} tier or higher.` };
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

        revalidatePath("/academy");
        revalidatePath("/dashboard/academy");
        revalidatePath(`/academy/courses/${courseId}`);

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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false, error: "Unauthorized" };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false, error: "Not enrolled in this course" };
        }

        // 🔒 SECURITY FIX: Enforce "Watch to Complete" logic
        // 1. Get the course/lesson details to see if it has a video
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false, error: "Course not found" };

        const course = courseDoc.data() as Course;
        let targetLesson: Lesson | null = null;

        // Find the lesson
        for (const mod of course.modules) {
            const found = mod.lessons.find(l => l.id === lessonId);
            if (found) {
                targetLesson = found;
                break;
            }
        }

        if (!targetLesson) return { success: false, error: "Lesson not found" };

        // 2. If it has a video, verify progress
        if (targetLesson.videoUrl) {
            const progressId = `${userId}_${lessonId}`;
            const videoProgressDoc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

            // Allow if admin (for testing) ?? No, enforce for everyone for now.
            // Maybe allow if no progress doc exists BUT require it?
            // "The Honor System" fix means we MUST require it.

            if (!videoProgressDoc.exists) {
                return { success: false, error: "Please start watching the video to track your progress." };
            }

            const videoData = videoProgressDoc.data();
            if (!videoData || videoData.progressPercent < 90) { // 90% Threshold
                const current = Math.round(videoData?.progressPercent || 0);
                return {
                    success: false,
                    error: `You have only watched ${current}% of the video. Please watch at least 90% to complete.`
                };
            }
        }

        const progress = progressDoc.data() as UserProgress;

        if (!progress.completedLessons.includes(lessonId)) {
            progress.completedLessons.push(lessonId);
            progress.lastAccessedAt = FieldValue.serverTimestamp();

            // Calculate overall progress
            const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
            progress.overallProgress = Math.round((progress.completedLessons.length / totalLessons) * 100);

            // Check if course is complete
            if (progress.completedLessons.length === totalLessons) {
                progress.completedAt = FieldValue.serverTimestamp();
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
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
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (courseDoc.exists) {
            const course = courseDoc.data() as Course;
            // eslint-disable-next-line @next/next/no-assign-module-variable
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
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
            const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(progress.courseId).get();
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
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
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
        gender: string;
        state: string;
        lga: string;
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

const ACADEMY_REGISTRATION_FEE = 5000; // ₦5,000

/**
 * Initiate academy onboarding payment (must pay before submitting application)
 */
export async function initiateAcademyPaymentAction(
    plan?: "foundation" | "standard" | "elite" | "registration"
): Promise<{
    success: boolean;
    paymentUrl?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

        const userId = session.user.id;

        // Check if already paid
        const existingApp = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where("userId", "==", userId)
            .where("paymentStatus", "==", "completed")
            .limit(1)
            .get();

        if (!existingApp.empty) {
            return { error: "You have already paid. Please proceed to complete your application.", success: false };
        }

        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return { error: "Payment system not configured", success: false };
        }

        let amount = ACADEMY_REGISTRATION_FEE; // Default to 5000 (Registration)
        const purpose = "academy_registration";

        if (plan && plan !== "registration") {
            if (plan === "foundation") amount = 25000;
            else if (plan === "standard") amount = 50000;
            else if (plan === "elite") amount = 100000;
        } else {
            plan = "registration";
        }

        const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                email: session.user.email,
                amount: amount * 100, // Kobo
                channels: ["bank_transfer"],
                metadata: {
                    userId,
                    type: "academy_registration", // Required for webhook routing
                    purpose: "academy_registration", // Kept for backward compat with verifyAcademyPaymentAction
                    plan, // Store the plan!
                },
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/academy/payment/callback`,
            }),
        });

        if (!paystackResponse.ok) {
            return { error: "Failed to initialize payment", success: false };
        }

        const paystackData = await paystackResponse.json();

        if (!paystackData.status || !paystackData.data?.authorization_url) {
            return { error: "Failed to generate payment link", success: false };
        }

        return {
            success: true,
            paymentUrl: paystackData.data.authorization_url,
        };
    } catch (error) {
        logger.error("Academy payment init failed:", error);
        return { error: "Failed to initiate payment", success: false };
    }
}

/**
 * Verify academy registration payment callback
 */
export async function verifyAcademyPaymentAction(reference: string): Promise<{
    success: boolean;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, error: "Authentication required" };

        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false, error: "Payment verification failed" };
        }

        const metadata = verify.data.metadata;
        if (metadata.purpose !== "academy_registration") {
            return { success: false, error: "Invalid payment type" };
        }

        // Mark payment as completed for the user using dot notation to prevent overwriting
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.academy.paymentStatus": "completed",
            "serviceRegistrations.academy.paymentReference": reference,
            "serviceRegistrations.academy.paymentAmount": verify.data.amount / 100,
            "serviceRegistrations.academy.plan": metadata.plan || "foundation",
            "serviceRegistrations.academy.paidAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        });

        // Auto-create academy_applications record so admin can see paid users
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const applicationId = `ACADEMY-${Date.now()}-${(Date.now() / 10000000000).toString(36).substr(2, 9)}`;

        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).set({
            userId: session.user.id,
            applicationId,
            personalInfo: {
                fullName: userData?.fullName || userData?.name || session.user.name || "Unknown",
                email: userData?.email || session.user.email || "Unknown",
                phone: userData?.phone || userData?.phoneNumber || "",
            },
            education: {
                educationLevel: "Not provided (auto-created from payment)",
                fieldOfStudy: "Not provided",
            },
            interests: {
                learningPaths: [],
                topics: "",
                goals: "",
            },
            status: "pending",
            paymentStatus: "completed",
            paymentReference: reference,
            paymentAmount: verify.data.amount / 100,
            plan: metadata.plan || "foundation",
            submittedAt: FieldValue.serverTimestamp(),
            source: "payment_callback",
        });

        // Link the application to the user
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.status": "pending",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Academy payment verification error:", error);
        return { success: false, error: "Failed to verify payment" };
    }
}

/**
 * Check if user has paid for academy registration
 */
export async function checkAcademyPaymentStatusAction(): Promise<"paid" | "unpaid"> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return "unpaid";

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        if (userData?.serviceRegistrations?.academy?.paymentStatus === "completed") {
            return "paid";
        }

        return "unpaid";
    } catch (error) {
        logger.error("Check academy payment status error:", error);
        return "unpaid";
    }
}

/**
 * Submit Academy learner application
 */
export async function submitAcademyApplicationAction(
    applicationData: AcademyApplicationData
): Promise<{ success: boolean; error?: string; applicationId?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Authentication required" };
        }

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.academy?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return {
                success: false,
                error: "Your previous application is still being processed."
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already enrolled in the Academy program."
            };
        }

        // 🔒 DEDUP GUARD: Collection-level phone check
        // Catches cross-account duplicates (same phone, different account)
        const phone = applicationData.personalInfo.phone;
        const email = applicationData.personalInfo.email;
        const [phoneExists, emailExists] = await Promise.all([
            phone
                ? db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("personalInfo.phone", "==", phone)
                    .limit(1)
                    .get()
                : Promise.resolve({ empty: true }),
            email
                ? db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("personalInfo.email", "==", email)
                    .limit(1)
                    .get()
                : Promise.resolve({ empty: true }),
        ]);

        if (!(phoneExists as any).empty) {
            return { success: false, error: "An Academy application with this phone number already exists." };
        }
        if (!(emailExists as any).empty) {
            return { success: false, error: "An Academy application with this email already exists." };
        }

        // Generate unique application ID
        const applicationId = `ACADEMY-${Date.now()}-${(Date.now() / 10000000000).toString(36).substr(2, 9)}`;

        // Save to Firestore
        await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).set({
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
        // CRITICAL: Update user.serviceRegistrations to link application with auth using dot notation
        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            "serviceRegistrations.academy.status": "pending",
            "serviceRegistrations.academy.applicationId": applicationId,
            "serviceRegistrations.academy.submittedAt": FieldValue.serverTimestamp(),
            "updatedAt": FieldValue.serverTimestamp(),
        });

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

export async function createCourseAction(data: any): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Validate with Zod
        const { createCourseSchema } = await import("@/lib/validations/course");
        const validation = createCourseSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || "Validation failed",
            };
        }

        const validatedData = validation.data;

        const docRef = await db.collection(COLLECTIONS.ACADEMY_COURSES).add({
            ...validatedData,
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update({
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).update({
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

/**
 * Get all courses a user is enrolled in, joined with course metadata.
 * Used by the My Courses page.
 */
export interface EnrolledCourseWithDetails {
    courseId: string;
    title: string;
    instructor: string;
    thumbnail?: string;
    totalLessons: number;
    completedLessons: number;
    progress: number;
    status: "in-progress" | "completed";
    startedAt: string;
}

export async function getEnrolledCoursesWithDetailsAction(): Promise<{
    success: boolean;
    courses: EnrolledCourseWithDetails[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, courses: [], error: "Authentication required" };

        const userId = session.user.id;

        // 1. Fetch all progress records for this user
        const progressSnap = await db.collection(`user_progress/${userId}/courses`).get();
        if (progressSnap.empty) return { success: true, courses: [] };

        // 2. Batch-fetch course metadata for each enrolled course
        const courseIds = progressSnap.docs.map((d) => d.id);
        const courseDocs = await Promise.all(
            courseIds.map((id) => db.collection(COLLECTIONS.ACADEMY_COURSES).doc(id).get())
        );

        const courses: EnrolledCourseWithDetails[] = [];

        progressSnap.docs.forEach((progressDoc, idx) => {
            const progress = progressDoc.data() as UserProgress;
            const courseDoc = courseDocs[idx];
            if (!courseDoc.exists) return;

            const course = courseDoc.data() as Course;
            const totalLessons = course.modules?.reduce((sum, m) => sum + m.lessons.length, 0) ?? 0;
            const completedCount = progress.completedLessons?.length ?? 0;
            const progressPct = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

            courses.push({
                courseId: progressDoc.id,
                title: course.title,
                instructor: course.instructor,
                thumbnail: course.thumbnail,
                totalLessons,
                completedLessons: completedCount,
                progress: progressPct,
                status: progress.completedAt ? "completed" : "in-progress",
                startedAt: progress.startedAt
                    ? new Date((progress.startedAt as Timestamp).toDate()).toLocaleDateString()
                    : "",
            });
        });

        return { success: true, courses };
    } catch (error: any) {
        logger.error("getEnrolledCoursesWithDetailsAction error:", error);
        return { success: false, courses: [], error: "Failed to load enrolled courses" };
    }
}


// ============================================================================
// QUIZ MANAGEMENT (Admin)
// ============================================================================

export interface QuizEditorQuestion {
    id: string;
    text: string;
    options: {
        id: string;
        text: string;
        isCorrect: boolean;
    }[];
}

/**
 * Save (upsert) a quiz's questions and title to Firestore.
 * Used by the admin quiz editor page.
 */
export async function saveQuizAction(
    courseId: string,
    quizId: string,
    title: string,
    questions: QuizEditorQuestion[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized: Admin access required" };
        }

        if (!courseId || !quizId) {
            return { success: false, error: "Course ID and Quiz ID are required" };
        }

        if (questions.length === 0) {
            return { success: false, error: "Quiz must have at least one question" };
        }

        // Validate each question has exactly one correct answer
        for (const q of questions) {
            const correctCount = q.options.filter(o => o.isCorrect).length;
            if (correctCount !== 1) {
                return { success: false, error: `Question "${q.text.slice(0, 40)}…" must have exactly one correct answer` };
            }
        }

        await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).set({
            courseId,
            title,
            questions,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        return { success: true };
    } catch (error: any) {
        logger.error("saveQuizAction error:", error);
        return { success: false, error: "Failed to save quiz" };
    }
}

/**
 * Load a quiz's questions from Firestore.
 */
export async function getQuizAction(
    quizId: string
): Promise<{ success: boolean; title?: string; questions?: QuizQuestion[]; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;

        const doc = await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).get();

        if (!doc.exists) {
            return { success: true, title: "New Quiz", questions: [] };
        }

        const data = doc.data()!;
        return {
            success: true,
            title: data.title || "Module Quiz",
            questions: data.questions || [],
        };
    } catch (error: any) {
        logger.error("getQuizAction error:", error);
        return { success: false, error: "Failed to load quiz" };
    }
}

// ============================================================================
// LEARNING STREAK TRACKING
// ============================================================================

/**
 * Record that the current user completed at least one lesson today.
 * Call this whenever a lesson is marked complete.
 * Collection: user_activity_logs/{userId}/days/{YYYY-MM-DD}
 */
export async function logLessonActivityAction(): Promise<{ success: boolean }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false };

        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
        await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(session.user.id)
            .collection("days")
            .doc(today)
            .set({
                date: today,
                lessonsCompletedCount: FieldValue.increment(1),
                lastUpdated: FieldValue.serverTimestamp(),
            }, { merge: true });

        return { success: true };
    } catch (error: any) {
        logger.error("logLessonActivityAction error:", error);
        return { success: false };
    }
}

/**
 * Calculate the current consecutive-day learning streak for a given user.
 * A streak day = any day with at least one lesson logged.
 * Returns { streak } — count of consecutive days ending today (or yesterday if today not yet active).
 */
export async function calculateStreakAction(userId: string): Promise<{ streak: number }> {
    try {
        // Fetch the last 90 days of activity (enough for any realistic streak)
        const snap = await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(userId)
            .collection("days")
            .orderBy("date", "desc")
            .limit(90)
            .get();

        if (snap.empty) return { streak: 0 };

        const activeDays = new Set(snap.docs.map(d => d.id)); // Set of "YYYY-MM-DD" strings

        let streak = 0;
        // Start from today and walk back
        const cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        while (true) {
            const dateStr = cursor.toISOString().split("T")[0];
            if (activeDays.has(dateStr)) {
                streak++;
                cursor.setDate(cursor.getDate() - 1);
            } else if (streak === 0) {
                // Allow one day gap at the start (e.g. user completed lessons yesterday but not today yet)
                cursor.setDate(cursor.getDate() - 1);
                const yesterdayStr = cursor.toISOString().split("T")[0];
                if (activeDays.has(yesterdayStr)) {
                    streak++;
                    cursor.setDate(cursor.getDate() - 1);
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        return { streak };
    } catch (error: any) {
        logger.error("calculateStreakAction error:", error);
        return { streak: 0 };
    }
}


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing academy application data (for pre-populating edit form)
 */
export async function getAcademyApplicationAction(): Promise<{
    success: boolean;
    data?: any;
    revisionNote?: string;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (snap.empty) return { success: false, error: 'No application found' };

        const data = snap.docs[0].data();
        return { success: true, data, revisionNote: data?.revisionNote };
    } catch (error) {
        logger.error('getAcademyApplicationAction error:', error);
        return { success: false, error: 'Failed to fetch application' };
    }
}

/**
 * Admin: Request revision on an academy application
 */
export async function requestAcademyRevisionAction(
    applicationId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false, error: 'Admin access required' };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false, error: 'Application not found' };

        const appData = appDoc.data();
        const userId = appData?.userId;

        await appRef.update({
            status: 'revision_required',
            revisionNote: reason,
            revisionRequestedAt: FieldValue.serverTimestamp(),
            revisionRequestedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.academy.status': 'revision_required',
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        try {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const email = userDoc.data()?.email;
            const name = appData?.personalInfo?.fullName || 'Applicant';
            if (email) {
                const { data, error } = await resend.emails.send({
                    from: 'Easy Sales Export Academy <noreply@easysalesexport.com>',
                    to: email,
                    subject: 'Action Required: Update Your Academy Application',
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><h2 style="color:#2563eb;">Academy Application Update Required</h2><p>Dear <strong>${name}</strong>,</p><p>Our team requires some updates before your application can be approved.</p><div style="background:#eff6ff;border:1px solid #93c5fd;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0;color:#1d4ed8;"><strong>Note:</strong><br/>${reason}</p></div><p>Please <a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/application">log in to update your application</a>.</p></div>`,
                });
                if (error) {
                    logger.error("Resend API Error (Academy revision email):", error);
                }
            }
        } catch (emailError) {
            logger.error('Academy revision email failed (non-blocking):', emailError);
        }

        return { success: true };
    } catch (error) {
        logger.error('requestAcademyRevisionAction error:', error);
        return { success: false, error: 'Failed to request revision' };
    }
}

/**
 * Admin: Approve an academy application — sets status + sends approval email
 */
export async function approveAcademyApplicationAction(
    applicationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false, error: 'Admin access required' };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false, error: 'Application not found' };

        const appData = appDoc.data();
        const userId = appData?.userId;

        await appRef.update({
            status: 'approved',
            approvedAt: FieldValue.serverTimestamp(),
            approvedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
        });

        if (userId) {
            await db.collection(COLLECTIONS.USERS).doc(userId).update({
                'serviceRegistrations.academy.status': 'approved',
                roles: FieldValue.arrayUnion('academy_learner'),
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        try {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            const email = userDoc.data()?.email;
            const name = appData?.personalInfo?.fullName || 'Learner';
            if (email) {
                const { data, error } = await resend.emails.send({
                    from: 'Easy Sales Export Academy <noreply@easysalesexport.com>',
                    to: email,
                    subject: 'Congratulations! Your Academy Application is Approved',
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;"><div style="background:linear-gradient(135deg,#2563eb,#4f46e5);padding:32px;border-radius:12px;text-align:center;margin-bottom:24px;"><h1 style="color:white;margin:0;">You are Accepted!</h1></div><p>Dear <strong>${name}</strong>,</p><p>Your <strong>Easy Sales Export Academy</strong> application has been <strong>approved</strong>!</p><div style="text-align:center;margin:24px 0;"><a href="${process.env.NEXTAUTH_URL || 'https://easysalesexport.com'}/academy/dashboard" style="background:#2563eb;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Academy Dashboard</a></div></div>`,
                });
                if (error) {
                    logger.error("Resend API Error (Academy approval email):", error);
                }
            }
        } catch (emailError) {
            logger.error('Academy approval email failed (non-blocking):', emailError);
        }

        return { success: true };
    } catch (error) {
        logger.error('approveAcademyApplicationAction error:', error);
        return { success: false, error: 'Failed to approve application' };
    }
}

/**
 * Resubmit academy application after revision request
 */
export async function resubmitAcademyApplicationAction(data: {
    personalInfo: any;
    education: any;
    interests: any;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null as any;
        const { session } = sessionResult;
        if (!session?.user) return { success: false, error: 'Unauthorized' };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.academy?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false, error: 'Your application cannot be resubmitted at this time.' };
        }

        const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .limit(1)
            .get();

        if (snap.empty) return { success: false, error: 'No existing application found' };

        await snap.docs[0].ref.update({
            ...data,
            status: 'pending',
            revisionNote: null,
            resubmittedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
            'serviceRegistrations.academy.status': 'pending',
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { success: true };
    } catch (error) {
        logger.error('resubmitAcademyApplicationAction error:', error);
        return { success: false, error: 'Failed to resubmit application' };
    }
}
