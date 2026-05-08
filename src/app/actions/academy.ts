"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { revalidatePath } from "next/cache";

import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";

/**
 * Check Academy application status for current user
 */
export async function checkAcademyStatusAction(): Promise<{ success: true | false; data?: string | null; error?: string; meta?: any }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, data: null, error: 'Unauthorized' };

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let currentStatus = userData?.serviceRegistrations?.academy?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for applications.
        if (currentStatus !== "approved") {
            const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!appSnap.empty) {
                const appData = appSnap.docs[0].data();
                if (appData.status === "approved") {
                    currentStatus = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
                        serviceRegistrations: { academy: { status: "approved", syncedAt: new Date().toISOString() } }
                    }, { merge: true });
                } else if (appData.status) {
                    currentStatus = appData.status;
                }
            }
        }

        if (currentStatus) {
            return { success: true as const, data: currentStatus };
        }

        // ── FINAL FALLBACK: Check for any payment records ──────────────
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "academy_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            return { success: true as const, data: "payment_completed" };
        }

        return { success: true as const, data: null };
    } catch (error) {
        logger.error("Check Academy status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Check Academy status error" };
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
    // Serialized as ISO strings when returned from server actions
    createdAt: FieldValue | Timestamp | string | null;
    updatedAt: FieldValue | Timestamp | string | null;
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
    excelUrl?: string;
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
    _version?: number;
}

export interface LiveSession {
    id?: string;
    courseId: string;
    title: string;
    instructor: string;
    scheduledAt: Timestamp | Date | string | null;
    duration: string;
    meetingLink: string;
    maxParticipants: number;
    currentParticipants: number;
    status: "scheduled" | "live" | "ended";
    recordingUrl?: string;
    createdAt: Timestamp | Date | string | null;
}

/**
 * Get all courses
 */
export async function getCoursesAction(
    limit: number = 12,
    lastDocId?: string
): Promise<{ success: true | false; data?: Course[]; meta?: { lastDocId: string | null }; error?: string }> {
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

        const courses = serializeDocs<Course>(snapshot.docs);

        const newLastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return { success: true as const, data: courses, meta: { lastDocId: newLastDocId } };
    } catch (error) {
        logger.error("Failed to fetch courses:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: [], meta: { lastDocId: null }, error: error instanceof Error ? error.message : "Fetch failed" };
    }
}

/**
 * Get course by ID — direct Firestore fetch (no module-level cache).
 * Using unstable_cache at module scope caused null to be cached at build time.
 * Per-request caching via Next.js fetch cache handles deduplication instead.
 */
export async function getCourseByIdAction(courseId: string): Promise<{ success: true | false; data?: Course | null; error?: string }> {
    try {
        if (!courseId) return { success: false as const, data: null, error: 'Course ID missing' };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();

        if (!courseDoc.exists) {
            logger.warn(`[getCourseByIdAction] Course not found in Firestore: ${courseId}`);
            return { success: true as const, data: null };
        }

        const d = courseDoc.data()!;
        const formattedCourse = serializeDoc<Course>(courseDoc.id, d);
        
        return { success: true as const, data: formattedCourse };
    } catch (error) {
        logger.error("[getCourseByIdAction] Failed to fetch course:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: error instanceof Error ? error.message : "Fetch failed" };
    }
}

/**
 * Initialize Payment for a Course
 */
export async function initializeCoursePaymentAction(courseId: string): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required" };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found" };

        const course = courseDoc.data() as Course;
        if (!course.price || course.price <= 0) {
            return { success: false as const, error: "This course is free. Please enroll directly." };
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

        return { success: true as const, data: result };
    } catch (error) {
        logger.error("Course payment init error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Initialization failed" };
    }
}

/**
 * Verify Course Payment and Enroll
 */
export async function verifyCoursePaymentAction(reference: string): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required" };

        // Verify with Paystack
        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false as const, error: "Payment verification failed" };
        }

        const metadata = verify.data.metadata;
        if (metadata.type !== "academy_enrollment") {
            return { success: false as const, error: "Invalid payment type" };
        }

        // Check if already processed
        const existingRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingDoc = await existingRef.get();
        if (existingDoc.exists) return { success: false as const, error: "Payment already processed" };

        // Process enrollment
        const userId = metadata.userId;
        const courseId = metadata.courseId;
        const amountPaid = verify.data.amount / 100;

        // 🔒 SECURITY FIX: Amount re-validation against REAL course price
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found" };

        const course = courseDoc.data() as Course;
        if (course.price && course.price > 0) {
            // Check if amount paid is less than course price
            // Allow small margin? No, be strict but handle float.
            if (amountPaid < course.price) {
                logger.warn(`Price drift detected for course ${courseId}. Expected ${course.price}, Paid ${amountPaid}`);
                return { success: false as const, error: "Payment verification failed: Amount paid is less than current course price." };
            }
        }

        await db.runTransaction(async (t) => {
            // 🔒 TRANSACTION FIX: Check again inside transaction to prevent race conditions
            const tExistingDoc = await t.get(existingRef);
            if (tExistingDoc.exists) {
                throw new Error("Payment already processed");
            }

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

            // 2. Mark Payment Processed
            t.set(existingRef, {
                reference,
                type: "academy_enrollment",
                courseId,
                userId,
                amount: amountPaid,
                processedAt: FieldValue.serverTimestamp(),
            });
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
    } catch (error) {
        logger.error("Course payment verification error:", {
            reference,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to verify payment" };
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
async function _enrollInCourseAction(
    userId: string,
    courseId: string
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }

        // Check user's Academy Plan
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) return { success: false as const, error: "User not found" };
        const userData = userDoc.data();
        const userPlan = userData?.serviceRegistrations?.academy?.plan || "free";

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);

        // Save to Firestore using a transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // 1. Check for existing enrollment
            const progressDoc = await transaction.get(progressRef);
            if (progressDoc.exists) {
                throw new Error("Already enrolled in this course");
            }

            // 2. Validate package tier
            const courseDoc = await transaction.get(db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId));
            if (!courseDoc.exists) throw new Error("Course not found");

            const course = courseDoc.data() as Course;
            const courseTier = course.tier || "free";
            const hasAccess = checkCourseAccess(userPlan, courseTier);

            if (!hasAccess) {
                throw new Error(`Your current package (${userPlan}) does not grant access to this course. Please upgrade your package to the ${courseTier.charAt(0).toUpperCase() + courseTier.slice(1)} tier or higher.`);
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

            // 3. Create enrollment record
            transaction.set(progressRef, progress);

            // 4. Proactively update user document if not already marked as academy_participant
            if (!userData?.roles?.includes('academy_participant')) {
                transaction.update(userDoc.ref, {
                    roles: FieldValue.arrayUnion('academy_participant'),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
            
            // 5. Increment enrolledCount if it exists in schema
            transaction.update(courseDoc.ref, {
                enrolledCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: courseId,
            targetType: "course_enrollment",
        });

        revalidatePath("/academy");
        revalidatePath("/dashboard/academy");
        revalidatePath(`/academy/courses/${courseId}`);

        return { success: true as const, data: { enrollmentId: courseId } };
    } catch (error) {
        logger.error("Enrollment error:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to enroll" };
    }
}
export const enrollInCourseAction = withFlexibleSafeAction("enrollInCourseAction", _enrollInCourseAction);

/**
 * Mark lesson as complete
 */
async function _completeLessonAction(
    userId: string,
    courseId: string,
    lessonId: string,
    expectedVersion?: number
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course" };
        }

        // 🔒 SECURITY FIX: Enforce "Watch to Complete" logic
        // 1. Get the course/lesson details to see if it has a video
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found" };

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

        if (!targetLesson) return { success: false as const, error: "Lesson not found" };

        // 2. If it has a video, verify progress
        if (targetLesson.videoUrl) {
            const progressId = `${userId}_${lessonId}`;
            const videoProgressDoc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

            // Allow if admin (for testing) ?? No, enforce for everyone for now.
            // Maybe allow if no progress doc exists BUT require it?
            // "The Honor System" fix means we MUST require it.

            if (!videoProgressDoc.exists) {
                return { success: false as const, error: "Please start watching the video to track your progress." };
            }

            const videoData = videoProgressDoc.data();
            if (!videoData || videoData.progressPercent < 90) { // 90% Threshold
                const current = Math.round(videoData?.progressPercent || 0);
                return {
                    success: false as const,
                    error: `You have only watched ${current}% of the video. Please watch at least 90% to complete.`
                };
            }
        }

        // Use transaction to prevent concurrent lesson completions from overwriting each other
        await db.runTransaction(async (t) => {
            const tProgressDoc = await t.get(progressRef);
            if (!tProgressDoc.exists) throw new Error("Not enrolled");
            
            const progress = tProgressDoc.data() as UserProgress;

            if (!progress.completedLessons.includes(lessonId)) {
                // Concurrency Guard: Optimistic Locking
                if (expectedVersion !== undefined && progress._version !== undefined && progress._version !== expectedVersion) {
                    throw new Error("STALE_DATA: Progress has been updated elsewhere.");
                }

                progress.completedLessons.push(lessonId);
                progress.lastAccessedAt = FieldValue.serverTimestamp();

                // Calculate overall progress
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                progress.overallProgress = Math.round((progress.completedLessons.length / totalLessons) * 100);

                // Check if course is complete
                if (progress.completedLessons.length === totalLessons) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }

                // Increment version
                progress._version = (progress._version || 0) + 1;

                t.set(progressRef, progress);
            }
        });

        return { success: true };
    } catch (error) {
        logger.error("Lesson completion error:", {
            userId,
            courseId,
            lessonId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to mark lesson as complete" };
    }
}
export const completeLessonAction = withFlexibleSafeAction("completeLessonAction", _completeLessonAction);

/**
 * Submit quiz score
 */
async function _submitQuizScoreAction(
    userId: string,
    courseId: string,
    moduleId: string,
    score: number,
    expectedVersion?: number
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized" };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course" };
        }

        let userPassed = false;
        
        await db.runTransaction(async (t) => {
            const tProgressDoc = await t.get(progressRef);
            if (!tProgressDoc.exists) throw new Error("Not enrolled");
            
            const progress = tProgressDoc.data() as UserProgress;

            // Concurrency Guard: Optimistic Locking
            if (expectedVersion !== undefined && progress._version !== undefined && progress._version !== expectedVersion) {
                throw new Error("STALE_DATA: Progress has been updated elsewhere.");
            }

            progress.quizScores = progress.quizScores || {};
            progress.quizScores[moduleId] = score;
            progress.lastAccessedAt = FieldValue.serverTimestamp();
            
            // Check if module is complete (quiz passed)
            const academyCourseDoc = await t.get(db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId));
            if (academyCourseDoc.exists) {
                const course = academyCourseDoc.data() as Course;
                const courseModule = course.modules?.find((m) => m.id === moduleId);

                if (courseModule?.quiz && score >= courseModule.quiz.passingScore) {
                    if (!progress.completedModules) progress.completedModules = [];
                    if (!progress.completedModules.includes(moduleId)) {
                        progress.completedModules.push(moduleId);
                    }
                    userPassed = true;
                }
            }
            
            // Increment version
            progress._version = (progress._version || 0) + 1;

            t.set(progressRef, progress);
        });

        return { success: true as const, data: { passed: userPassed } };
    } catch (error) {
        logger.error("Quiz submission error:", {
            userId,
            courseId,
            moduleId,
            score,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to submit quiz" };
    }
}
export const submitQuizScoreAction = withFlexibleSafeAction("submitQuizScoreAction", _submitQuizScoreAction);

/**
 * Get user progress
 */
export async function getUserProgressAction(
    userId: string,
    courseId: string
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const progressDoc = await db.doc(`user_progress/${userId}/courses/${courseId}`).get();

        if (!progressDoc.exists) {
            return { success: true as const, data: null };
        }

        const data = progressDoc.data();
        return { success: true as const, data: serializeValue(data) };
    } catch (error) {
        logger.error("Failed to fetch progress:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: "Fetch failed" };
    }
}

/**
 * Get user's aggregate progress across all courses
 */
export async function getUserAggregateProgressAction(userId: string): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return {
                success: false as const,
                data: {
                    totalCourses: 0,
                completedCourses: 0,
                inProgressCourses: 0,
                totalHoursLearned: 0,
                certificatesEarned: 0,
                totalLessons: 0,
                completedLessons: 0,
                overallProgress: 0,
                enrolledCourses: [],
                }
            };
        }

        // Fetch all course progress records
        const progressQuery = db.collection(`user_progress/${userId}/courses`);
        const snapshot = await progressQuery.get();
        const enrolledCourses = snapshot.docs.map(doc => doc.data() as UserProgress);

        const completedCourses = enrolledCourses.filter(p => p.completedAt).length;
        const inProgressCourses = enrolledCourses.length - completedCourses;
        const totalCompletedLessons = enrolledCourses.reduce((sum, p) => sum + p.completedLessons.length, 0);

        // Calculate total lessons: batch all course reads in parallel (N+1 → 1 burst)
        const courseSnapshots = await Promise.all(
            enrolledCourses.map(p =>
                db.collection(COLLECTIONS.ACADEMY_COURSES).doc(p.courseId).get()
            )
        );
        let totalLessons = 0;
        for (const courseDoc of courseSnapshots) {
            if (courseDoc.exists) {
                const course = courseDoc.data() as Course;
                totalLessons += course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
            }
        }

        const overallProgress = totalLessons > 0 ? Math.round((totalCompletedLessons / totalLessons) * 100) : 0;

        return {
            success: true as const,
            data: {
                totalCourses: enrolledCourses.length,
                completedCourses,
                inProgressCourses,
                totalHoursLearned: totalCompletedLessons * 0.5, // Estimate 30 min per lesson
                certificatesEarned: completedCourses, // One certificate per completed course
                totalLessons,
                completedLessons: totalCompletedLessons,
                overallProgress,
                enrolledCourses: serializeValue(enrolledCourses),
            }
        };
    } catch (error) {
        logger.error("Failed to fetch aggregate progress:", {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            success: false as const,
            error: error instanceof Error ? error.message : "Fetch failed",
            data: {
                totalCourses: 0,
                completedCourses: 0,
                inProgressCourses: 0,
                totalHoursLearned: 0,
                certificatesEarned: 0,
                totalLessons: 0,
                completedLessons: 0,
                overallProgress: 0,
                enrolledCourses: [],
            }
        };
    }
}

/**
 * Get live sessions
 */
export async function getLiveSessionsAction(courseId?: string): Promise<{ success: true | false; data?: LiveSession[]; error?: string }> {
    try {
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        const query = courseId ? ref.where("courseId", "==", courseId) : ref;
        const snapshot = await query.get();

        const data = snapshot.docs.map((doc) => {
            const d = doc.data();
            return {
                id: doc.id,
                ...d,
                // Serialize Timestamps → ISO strings
                createdAt: d.createdAt?.toDate?.()?.toISOString() ?? null,
                scheduledAt: d.scheduledAt?.toDate?.() ?? d.scheduledAt ?? null,
            };
        }) as unknown as LiveSession[];
        return { success: true as const, data };
    } catch (error) {
        logger.error("Failed to fetch live sessions:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: [], error: error instanceof Error ? error.message : "Fetch failed" };
    }
}

/**
 * APPLICATION SUBMISSION
 */

export interface AcademyApplicationData {
    personalInfo: {
        firstName: string;
        lastName: string;
        otherName?: string;
        fullName?: string; // backward compat — derived from firstName + lastName if missing
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





const ACADEMY_REGISTRATION_FEE = 0; // Registration is now free, users pay only for tiers

/**
 * Initiate academy onboarding payment (must pay before submitting application)
 */
async function _initiateAcademyPaymentAction(
    plan?: "foundation" | "standard" | "elite" | "advanced"
): Promise<{
    success: true | false;
    data?: { paymentUrl: string };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) {
            return { error: "You must be logged in", success: false };
        }

        const userId = session.user.id;

        // Check if already paid
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (userDoc.data()?.serviceRegistrations?.academy?.paymentStatus === "completed") {
            return { error: "You have already paid. Please proceed to complete your application.", success: false };
        }

        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return { error: "Payment system not configured", success: false };
        }

        let amount = 25000; // Default to Foundation
        let planToStore = plan;

        if (plan === "foundation") {
            amount = 25000;
        } else if (plan === "standard" || (plan as string) === "advanced") {
            amount = 50000;
            planToStore = "standard";
        } else if (plan === "elite") {
            amount = 100000;
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
                metadata: {
                    userId,
                    purpose: "academy_registration",
                    plan: planToStore,
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
            success: true as const,
            data: { paymentUrl: paystackData.data.authorization_url },
        };
    } catch (error) {
        logger.error("Academy payment init failed:", {
            plan,
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Failed to initiate payment", success: false };
    }
}
export const initiateAcademyPaymentAction = withFlexibleSafeAction("initiateAcademyPaymentAction", _initiateAcademyPaymentAction);

/**
 * Verify academy registration payment callback
 */
async function _verifyAcademyPaymentAction(reference: string): Promise<{
    success: true | false;
    data?: any;
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required" };

        const verify = await verifyPaystackPayment(reference);
        if (!verify.status || verify.data.status !== "success") {
            return { success: false as const, error: "Payment verification failed" };
        }

        const metadata = verify.data.metadata;
        if (metadata.purpose !== "academy_registration") {
            return { success: false as const, error: "Invalid payment type" };
        }

        const paidAmount = verify.data.amount / 100;
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);

        // 🔒 ATOMIC TRANSACTION: Update user and record ledger entries
        await db.runTransaction(async (transaction) => {
            const tProcessedDoc = await transaction.get(processedRef);
            if (tProcessedDoc.exists) {
                throw new Error("Payment already processed");
            }

            // Update user registration status
            transaction.update(db.collection(COLLECTIONS.USERS).doc(session.user.id), {
                "serviceRegistrations.academy.paymentStatus": "completed",
                "serviceRegistrations.academy.paymentReference": reference,
                "serviceRegistrations.academy.paymentAmount": paidAmount,
                "serviceRegistrations.academy.plan": metadata.plan || "registration",
                "serviceRegistrations.academy.paidAt": FieldValue.serverTimestamp(),
                "updatedAt": FieldValue.serverTimestamp(),
            });

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: paidAmount,
                type: "academy_registration",
                reference,
            });

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

        return { success: true };
    } catch (error) {
        logger.error("Academy payment verification error:", {
            reference,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to verify payment" };
    }
}
export const verifyAcademyPaymentAction = withFlexibleSafeAction("verifyAcademyPaymentAction", _verifyAcademyPaymentAction);

/**
 * Check if user has paid for academy registration
 */
export async function checkAcademyPaymentStatusAction(): Promise<{ success: true | false, data?: "paid" | "unpaid", error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: true as const, data: "unpaid" };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        if (userData?.serviceRegistrations?.academy?.paymentStatus === "completed") {
            return { success: true as const, data: "paid" };
        }

        // ── AUTHORITATIVE FALLBACK ──────────────────────────────────────
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "academy_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            return { success: true as const, data: "paid" };
        }

        return { success: true as const, data: "unpaid" };
    } catch (error) {
        logger.error("Check academy payment status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: true as const, data: "unpaid" };
    }
}

/**
 * Submit Academy learner application
 */
async function _submitAcademyApplicationAction(
    applicationData: AcademyApplicationData
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Authentication required" };
        }

        const phone = applicationData.personalInfo.phone;
        const email = applicationData.personalInfo.email;
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);

        let finalApplicationId: string = "";

        await db.runTransaction(async (t) => {
            // Check for existing application status on the user
            const userDoc = await t.get(userRef);
            const userData = userDoc.data();
            const existingStatus = userData?.serviceRegistrations?.academy?.status;

            if (existingStatus === 'pending' || existingStatus === 'under_review') {
                throw new Error("Your previous application is still being processed.");
            }
            if (existingStatus === 'approved') {
                throw new Error("You are already enrolled in the Academy program.");
            }

            const existingPaymentStatus = userData?.serviceRegistrations?.academy?.paymentStatus || "pending";
            const existingPaymentAmount = userData?.serviceRegistrations?.academy?.paymentAmount || 0;

            // 🔒 DEDUP GUARD: Collection-level phone and email check within transaction
            const collectionsContext = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS);
            if (phone) {
                const phoneQuery = collectionsContext.where("personalInfo.phone", "==", phone).limit(1);
                const phoneSnap = await t.get(phoneQuery);
                if (!phoneSnap.empty) {
                    throw new Error("An Academy application with this phone number already exists.");
                }
            }

            if (email) {
                const emailQuery = collectionsContext.where("personalInfo.email", "==", email).limit(1);
                const emailSnap = await t.get(emailQuery);
                if (!emailSnap.empty) {
                    throw new Error("An Academy application with this email already exists.");
                }
            }

            // Generate unique application ID
            const applicationId = `ACADEMY-${Date.now()}-${(Date.now() / 10000000000).toString(36).substring(2, 11)}`;
            finalApplicationId = applicationId;
            const appRef = collectionsContext.doc(applicationId);

            // Save to Firestore
            t.set(appRef, {
                ...applicationData,
                userId: session.user.id,
                applicationId,
                status: "pending",
                paymentStatus: existingPaymentStatus,
                paymentAmount: existingPaymentAmount,
                plan: "registration",
                submittedAt: FieldValue.serverTimestamp(),
                reviewedAt: null,
                reviewedBy: null,
                notes: "",
            });

            // CRITICAL: Update user.serviceRegistrations to link application with auth
            t.update(userRef, {
                "serviceRegistrations.academy.status": "pending",
                "serviceRegistrations.academy.applicationId": applicationId,
                "serviceRegistrations.academy.submittedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.academy.paymentStatus": existingPaymentStatus,
                firstName: applicationData.personalInfo.firstName,
                lastName: applicationData.personalInfo.lastName,
                otherName: applicationData.personalInfo.otherName || null,
                fullName: [
                    applicationData.personalInfo.firstName,
                    applicationData.personalInfo.otherName,
                    applicationData.personalInfo.lastName,
                ].filter(Boolean).join(" ").trim(),
                phone: applicationData.personalInfo.phone,
                gender: applicationData.personalInfo.gender,
                stateOfOrigin: applicationData.personalInfo.state,
                lga: applicationData.personalInfo.lga,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // Create audit log outside transaction
        await createAdminAuditLog({
            action: "user_update",
            userId: session.user.id,
            targetId: finalApplicationId,
            targetType: "academy_application",
            details: `Learner application submitted for ${applicationData.personalInfo.firstName || ''} ${applicationData.personalInfo.lastName || applicationData.personalInfo.fullName || ''}`.trim(),
        });

        try {
            await invalidateUserCache(session.user.id);
        } catch (err) {
            logger.error("Failed to invalidate cache after Academy application:", err);
        }

        return { success: true as const, data: { applicationId: finalApplicationId } };
    } catch (error) {
        logger.error("Academy application submission error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit application. Please try again." };
    }
}
export const submitAcademyApplicationAction = withFlexibleSafeAction("submitAcademyApplicationAction", _submitAcademyApplicationAction);

/**
 * ADMIN ACTIONS
 */

export async function createCourseAction(data: any): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized" };
        }

        // Validate with Zod
        const { createCourseSchema } = await import("@/lib/validations/course");
        const validation = createCourseSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false as const,
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

        revalidatePath("/admin/academy", "page");

        return { success: true as const, data: { id: docRef.id } };
    } catch (error) {
        logger.error("Create course error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Course creation failed" };
    }
}

export async function updateCourseAction(courseId: string, data: Partial<Course>): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized" };
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

        revalidatePath("/admin/academy", "page");

        return { success: true };
    } catch (error) {
        logger.error("Update course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed" };
    }
}

export async function updateCourseModulesAction(courseId: string, modules: CourseModule[]): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized" };
        }

        logger.info(`[updateCourseModulesAction] Saving ${modules?.length} modules for course ${courseId}`);

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

        revalidatePath("/admin/academy", "page");

        return { success: true };
    } catch (error) {
        logger.error("Update modules error:", {
            courseId,
            moduleCount: modules?.length,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed" };
    }
}

export async function deleteCourseAction(courseId: string): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).delete();

        await createAdminAuditLog({
            action: "course_deleted",
            userId: session.user.id,
            targetId: courseId,
            targetType: "course",
            details: "Deleted course",
        });

        revalidatePath("/admin/academy", "page");

        return { success: true };
    } catch (error) {
        logger.error("Delete course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Deletion failed" };
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

export async function getEnrolledCoursesWithDetailsAction(): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required" };

        const userId = session.user.id;

        // 1. Fetch all progress records for this user
        const progressSnap = await db.collection(`user_progress/${userId}/courses`).get();
        if (progressSnap.empty) return { success: true as const, data: { courses: [] } };

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

        return { success: true as const, data: { courses } };
    } catch (error) {
        logger.error("getEnrolledCoursesWithDetailsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: { courses: [] }, error: "Failed to load enrolled courses" };
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
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false as const, error: "Unauthorized: Admin access required" };
        }

        if (!courseId || !quizId) {
            return { success: false as const, error: "Course ID and Quiz ID are required" };
        }

        if (questions.length === 0) {
            return { success: false as const, error: "Quiz must have at least one question" };
        }

        // Validate each question has exactly one correct answer
        for (const q of questions) {
            const correctCount = q.options.filter(o => o.isCorrect).length;
            if (correctCount !== 1) {
                return { success: false as const, error: `Question "${q.text.slice(0, 40)}…" must have exactly one correct answer` };
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
    } catch (error) {
        logger.error("saveQuizAction error:", {
            quizId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to save quiz" };
    }
}

/**
 * Load a quiz's questions from Firestore.
 */
export async function getQuizAction(
    quizId: string
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;

        const doc = await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).get();

        if (!doc.exists) {
            return { success: true as const, data: { title: "New Quiz", questions: [] } };
        }

        const data = doc.data()!;
        return {
            success: true as const,
            data: {
                title: data.title || "Module Quiz",
                questions: data.questions || [],
            }
        };
    } catch (error) {
        logger.error("getQuizAction error:", {
            quizId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to load quiz" };
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
export async function logLessonActivityAction(): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required" };

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
    } catch (error) {
        logger.error("logLessonActivityAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false };
    }
}

/**
 * Calculate the current consecutive-day learning streak for a given user.
 * A streak day = any day with at least one lesson logged.
 * Returns { streak } — count of consecutive days ending today (or yesterday if today not yet active).
 */
export async function calculateStreakAction(userId: string): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        // Fetch the last 90 days of activity (enough for any realistic streak)
        const snap = await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(userId)
            .collection("days")
            .orderBy("date", "desc")
            .limit(90)
            .get();

        if (snap.empty) return { success: true as const, data: { streak: 0 } };

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

        return { success: true as const, data: { streak } };
    } catch (error) {
        logger.error("calculateStreakAction error:", {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: { streak: 0 }, error: error instanceof Error ? error.message : "Streak calculation failed" };
    }
}


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing academy application data (for pre-populating edit form)
 */
export async function getAcademyApplicationAction(): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' };

        const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .get();

        if (snap.empty) return { success: false as const, error: 'No application found' };

        const sortedDocs = snap.docs.map(d => d.data()).sort((a: any, b: any) => {
            const aTime = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
            const bTime = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const data = sortedDocs[0];
        return { success: true as const, data: { ...data, revisionNote: data?.revisionNote } };
    } catch (error) {
        logger.error("getAcademyApplicationAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch application" };
    }
}

/**
 * Admin: Request revision on an academy application
 */
async function _requestAcademyRevisionAction(
    applicationId: string,
    reason: string
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required' };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found' };

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

        if (userId) {
            try {
                const { Resend } = await import('resend');
                const resend = new Resend(process.env.RESEND_API_KEY);
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                const email = userDoc.data()?.email;
                const name = appData?.personalInfo?.firstName ? `${appData.personalInfo.firstName} ${appData.personalInfo.lastName || ''}`.trim() : appData?.personalInfo?.fullName || 'Applicant';
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
        }

        return { success: true };
    } catch (error) {
        logger.error('requestAcademyRevisionAction error:', error);
        return { success: false as const, error: 'Failed to request revision' };
    }
}
export const requestAcademyRevisionAction = withFlexibleSafeAction("requestAcademyRevisionAction", _requestAcademyRevisionAction);


/**
 * Admin: Approve an academy application — sets status + sends approval email
 */
async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required' };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        
        let userId: string | undefined;
        let appData: any;

        // Atomic update using a transaction
        await db.runTransaction(async (transaction) => {
            const appDoc = await transaction.get(appRef);
            if (!appDoc.exists) throw new Error('Application not found');

            appData = appDoc.data();
            userId = appData?.userId;

            // 1. Update application status
            transaction.update(appRef, {
                status: 'approved',
                approvedAt: FieldValue.serverTimestamp(),
                approvedBy: session.user.id,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user document
            if (userId) {
                const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
                transaction.update(userRef, {
                    'serviceRegistrations.academy.status': 'approved',
                    roles: FieldValue.arrayUnion('academy_participant'),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        if (userId) {
            try {
                const { Resend } = await import('resend');
                const resend = new Resend(process.env.RESEND_API_KEY);
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                const email = userDoc.data()?.email;
            const name = appData?.personalInfo?.firstName ? `${appData.personalInfo.firstName} ${appData.personalInfo.lastName || ''}`.trim() : appData?.personalInfo?.fullName || 'Learner';
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
        }

        return { success: true };
    } catch (error) {
        logger.error('approveAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to approve application' };
    }
}
export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);


import { AcademyApplicationInputSchema, AcademyApplicationInput } from "@/lib/validations/academy";

/**
 * Resubmit academy application after revision request
 */
async function _resubmitAcademyApplicationAction(
    data: AcademyApplicationInput
): Promise<{ success: true | false; data?: any; meta?: any; error?: string }> {
    try {
        // Validate input
        AcademyApplicationInputSchema.parse(data);

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.academy?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false as const, error: 'Your application cannot be resubmitted at this time.' };
        }

        // Atomic update using a transaction
        await db.runTransaction(async (transaction) => {
            const snap = await transaction.get(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', session.user.id));

            if (snap.empty) throw new Error('No existing application found');

            const sortedDocs = snap.docs.sort((a, b) => {
                const aData = a.data();
                const bData = b.data();
                const aTime = aData.createdAt?.toMillis?.() || aData.createdAt?.seconds * 1000 || 0;
                const bTime = bData.createdAt?.toMillis?.() || bData.createdAt?.seconds * 1000 || 0;
                return bTime - aTime;
            });

            const latestDoc = sortedDocs[0];

            // 1. Update application
            transaction.update(latestDoc.ref, {
                ...data,
                status: 'pending',
                revisionNote: null,
                resubmittedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user status
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
            transaction.update(userRef, {
                'serviceRegistrations.academy.status': 'pending',
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true };
    } catch (error) {
        logger.error('resubmitAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to resubmit application' };
    }
}
export const resubmitAcademyApplicationAction = withFlexibleSafeAction("resubmitAcademyApplicationAction", _resubmitAcademyApplicationAction);

