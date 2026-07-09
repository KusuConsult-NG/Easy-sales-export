"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { revalidatePath } from "next/cache";

import { COLLECTIONS } from "@/lib/types/firestore";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { AcademyApplicationInputSchema, AcademyApplicationInput } from "@/lib/validations/academy";
import { ACADEMY_CONFIG } from "@/lib/constants";

async function autoProvisionZereAcademy(userId: string, email: string) {
    if (email !== "zeredogo@gmail.com") return;
    
    try {
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        if (userDoc.exists) {
            const userData = userDoc.data();
            const serviceRegistrations = userData?.serviceRegistrations || {};
            const academyReg = serviceRegistrations.academy || {};
            const roles = userData?.roles || [];
            
            const needsUserUpdate = academyReg.status !== "approved" || 
                                    academyReg.paymentStatus !== "completed" || 
                                    academyReg.plan !== "elite" ||
                                    !roles.includes("academy_participant");
                                    
            if (needsUserUpdate) {
                logger.info(`[autoProvisionZereAcademy] Auto-updating academy registration for ${email}`);
                const updatedRoles = Array.from(new Set([...roles, "academy_participant"]));
                await userRef.set({
                    roles: updatedRoles,
                    serviceRegistrations: {
                        academy: {
                            status: "approved",
                            paymentStatus: "completed",
                            plan: "elite",
                            paidAt: FieldValue.serverTimestamp(),
                            onboardingCompletedAt: new Date().toISOString()
                        }
                    }
                }, { merge: true });
                
                // Invalidate cache
                await invalidateUserCache(userId);
            }
        }
    } catch (error) {
        logger.error("[autoProvisionZereAcademy] Failed to auto-provision Zere:", error);
    }
}

/**
 * Check Academy application status for current user
 */
async function _checkAcademyStatusAction(): Promise<ActionResponse<string | null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: "Unauthorized", data: null };

        // ── PRIMARY: Check central user document for service registration ──
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let currentStatus = userData?.serviceRegistrations?.academy?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for applications.
        if (currentStatus !== "approved") {
            let appDoc: any = null;
            const appSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .get();

            if (!appSnap.empty) {
                const sortedDocs = appSnap.docs.sort((a, b) => {
                    const aVal = a.data().submittedAt || a.data().createdAt;
                    const bVal = b.data().submittedAt || b.data().createdAt;
                    const aTime = aVal?.toMillis?.() || aVal?.seconds * 1000 || (aVal ? new Date(aVal).getTime() : 0);
                    const bTime = bVal?.toMillis?.() || bVal?.seconds * 1000 || (bVal ? new Date(bVal).getTime() : 0);
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
            } else if (userData?.serviceRegistrations?.academy?.applicationId) {
                const appId = userData.serviceRegistrations.academy.applicationId;
                const directDoc = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(appId).get();
                if (directDoc.exists) {
                    appDoc = directDoc;
                    // Self-healing: backfill userId on direct application doc if missing
                    const appData = directDoc.data()!;
                    if (!appData.userId) {
                        await directDoc.ref.update({ userId: session.user.id });
                    }
                }
            } else if (userData?.email) {
                const emailQuery = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                    .where("personalInfo.email", "==", userData.email.toLowerCase())
                    .limit(1)
                    .get();
                if (!emailQuery.empty) {
                    appDoc = emailQuery.docs[0];
                    // Self-healing: backfill userId on application doc if missing
                    const appData = appDoc.data()!;
                    if (!appData.userId) {
                        await appDoc.ref.update({ userId: session.user.id });
                    }
                }
            }

            if (appDoc) {
                const appData = appDoc.data()!;
                if (appData.status === "approved") {
                    currentStatus = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.academy.status": "approved",
                        "serviceRegistrations.academy.syncedAt": new Date().toISOString()
                    });
                } else if (appData.status) {
                    currentStatus = appData.status;
                }
            }
        }

        if (currentStatus) {
            return { error: null, success: true as const, data: currentStatus };
        }

        // ── FINAL FALLBACK: Check for any payment records ──────────────
        const paymentsSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("userId", "==", session.user.id)
            .where("type", "==", "academy_registration")
            .where("status", "==", "completed")
            .limit(1)
            .get();

        if (!paymentsSnap.empty) {
            return { error: null, success: true as const, data: "payment_completed" };
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Check Academy status error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Check Academy status error" , data: null };
    }
}
export const checkAcademyStatusAction = withFlexibleSafeAction("checkAcademyStatusAction", _checkAcademyStatusAction);

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
async function _getCoursesAction(
    limit: number = 12,
    lastDocId?: string
): Promise<ActionResponse<Course[]>> {
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
        const hasMore = snapshot.docs.length === limit;

        return { 
            success: true, 
            error: null, 
            data: courses,
            lastDocId: newLastDocId,
            hasMore
        };
    } catch (error) {
        logger.error("Failed to fetch courses:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { 
            success: false, 
            error: error instanceof Error ? error.message : "Fetch failed", 
            data: null,
            lastDocId: null,
            hasMore: false
        };
    }
}
export const getCoursesAction = withFlexibleSafeAction("getCoursesAction", _getCoursesAction);

/**
 * Get course by ID — direct Firestore fetch (no module-level cache).
 * Using unstable_cache at module scope caused null to be cached at build time.
 * Per-request caching via Next.js fetch cache handles deduplication instead.
 */
async function _getCourseByIdAction(courseId: string): Promise<ActionResponse<any>> {
    try {
        if (!courseId) return { success: false as const, data: null, error: 'Course ID missing' };

        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();

        if (!courseDoc.exists) {
            logger.warn(`[getCourseByIdAction] Course not found in Firestore: ${courseId}`);
            return { success: true, error: null, data: null };
        }

        const d = courseDoc.data()!;
        const formattedCourse = serializeDoc<Course>(courseDoc.id, d);
        return { error: null, success: true as const, data: formattedCourse };
    } catch (error) {
        logger.error("[getCourseByIdAction] Failed to fetch course:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}
export async function getCourseByIdAction(...args: Parameters<typeof _getCourseByIdAction>) {
    return withFlexibleSafeAction("getCourseByIdAction", _getCourseByIdAction)(...args);
}

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
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Check user's Academy Plan
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!userDoc.exists) return { success: false as const, error: "User not found", data: null };
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Enrollment error:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to enroll", data: null };
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
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course", data: null };
        }

        // 🔒 SECURITY FIX: Enforce "Watch to Complete" logic
        // 1. Get the course/lesson details to see if it has a video
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) return { success: false as const, error: "Course not found", data: null };

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

        if (!targetLesson) return { success: false as const, error: "Lesson not found", data: null };

        // 2. If it has a video, verify progress (Bypassed to allow self-paced manual completion)
        /*
        if (targetLesson.videoUrl) {
            const progressId = `${userId}_${lessonId}`;
            const videoProgressDoc = await db.collection(COLLECTIONS.LESSON_VIDEO_PROGRESS).doc(progressId).get();

            // Allow if admin (for testing) ?? No, enforce for everyone for now.
            // Maybe allow if no progress doc exists BUT require it?
            // "The Honor System" fix means we MUST require it.

            if (!videoProgressDoc.exists) {
                return { success: false as const, error: "Please start watching the video to track your progress.", data: null };
            }

            const videoData = videoProgressDoc.data();
            if (!videoData || videoData.progressPercent < 90) { // 90% Threshold
                const current = Math.round(videoData?.progressPercent || 0);
                return {
                    success: false as const,
                    error: `You have only watched ${current}% of the video. Please watch at least 90% to complete.`,
                    data: null
                };
            }
        }
        */

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

                // Calculate overall progress using weighted formula (70% Lessons, 30% Quizzes)
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                const lessonProgressPercent = totalLessons > 0 ? (progress.completedLessons.length / totalLessons) * 100 : 0;

                const modulesWithQuizzes = course.modules.filter(m => m.quiz);
                const totalQuizzes = modulesWithQuizzes.length;
                let passedQuizzesCount = 0;
                modulesWithQuizzes.forEach(m => {
                    if (progress.completedModules?.includes(m.id)) {
                        passedQuizzesCount++;
                    }
                });
                const quizProgressPercent = totalQuizzes > 0 ? (passedQuizzesCount / totalQuizzes) * 100 : 0;

                let overallProgress = 0;
                if (totalQuizzes > 0) {
                    overallProgress = Math.round((lessonProgressPercent * 0.7) + (quizProgressPercent * 0.3));
                } else {
                    overallProgress = Math.round(lessonProgressPercent);
                }
                progress.overallProgress = overallProgress;

                // Check if course is complete
                if (overallProgress >= 100) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }

                // Increment version
                progress._version = (progress._version || 0) + 1;

                t.set(progressRef, progress);
            }
        });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Lesson completion error:", {
            userId,
            courseId,
            lessonId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to mark lesson as complete", data: null };
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
): Promise<ActionResponse<{ passed: boolean }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const progressRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await progressRef.get();

        if (!progressDoc.exists) {
            return { success: false as const, error: "Not enrolled in this course", data: null };
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

                if (!progress.completedModules) progress.completedModules = [];

                if (courseModule?.quiz && score >= (courseModule.quiz.passingScore ?? 95)) {
                    if (!progress.completedModules.includes(moduleId)) {
                        progress.completedModules.push(moduleId);
                    }
                    userPassed = true;
                }

                // Calculate overall progress using weighted formula (70% Lessons, 30% Quizzes)
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                const lessonProgressPercent = totalLessons > 0 ? (progress.completedLessons.length / totalLessons) * 100 : 0;

                const modulesWithQuizzes = course.modules.filter(m => m.quiz);
                const totalQuizzes = modulesWithQuizzes.length;
                let passedQuizzesCount = 0;
                modulesWithQuizzes.forEach(m => {
                    if (progress.completedModules?.includes(m.id)) {
                        passedQuizzesCount++;
                    }
                });
                const quizProgressPercent = totalQuizzes > 0 ? (passedQuizzesCount / totalQuizzes) * 100 : 0;

                let overallProgress = 0;
                if (totalQuizzes > 0) {
                    overallProgress = Math.round((lessonProgressPercent * 0.7) + (quizProgressPercent * 0.3));
                } else {
                    overallProgress = Math.round(lessonProgressPercent);
                }
                progress.overallProgress = overallProgress;

                // Check if course is complete
                if (overallProgress >= 100) {
                    progress.completedAt = FieldValue.serverTimestamp();
                }
            }
            // Increment version
            progress._version = (progress._version || 0) + 1;

            t.set(progressRef, progress);
        });

        return { success: true, error: null, data: { passed: userPassed } };
    } catch (error) {
        logger.error("Quiz submission error:", {
            userId,
            courseId,
            moduleId,
            score,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to submit quiz", data: null };
    }
}
export const submitQuizScoreAction = withFlexibleSafeAction("submitQuizScoreAction", _submitQuizScoreAction);

/**
 * Get user progress
 */
async function _getUserProgressAction(
    userId: string,
    courseId: string
): Promise<ActionResponse<any>> {
    try {
        const progressDoc = await db.doc(`user_progress/${userId}/courses/${courseId}`).get();

        if (!progressDoc.exists) {
            return { success: true, error: null, data: null };
        }

        const data = progressDoc.data();
        return { success: true, error: null, data: serializeValue(data) };
    } catch (error) {
        logger.error("Failed to fetch progress:", {
            userId,
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Fetch failed", data: null };
    }
}
export const getUserProgressAction = withFlexibleSafeAction("getUserProgressAction", _getUserProgressAction);

/**
 * Get user's aggregate progress across all courses
 */
async function _getUserAggregateProgressAction(userId: string): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== userId) {
            return {
                error: "Action failed", success: false as const, data: null };
        }

        // Fetch all course progress records
        const progressQuery = db.collection(`user_progress/${userId}/courses`);
        const snapshot = await progressQuery.get();
        const enrolledCourses = snapshot.docs.map(doc => doc.data() as UserProgress);

        const completedCourses = enrolledCourses.filter(p => p.completedAt).length;
        const inProgressCourses = enrolledCourses.filter(p => !p.completedAt && (p.completedLessons?.length || 0) > 0).length;
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
            error: null, success: true as const,
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
            data: null
        };
    }
}
export const getUserAggregateProgressAction = withFlexibleSafeAction("getUserAggregateProgressAction", _getUserAggregateProgressAction);

/**
 * Get live sessions
 */
async function _getLiveSessionsAction(courseId?: string): Promise<ActionResponse<any>> {
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
        return { success: true, error: null, data: serializeValue(data) };
    } catch (error) {
        logger.error("Failed to fetch live sessions:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: error instanceof Error ? error.message : "Fetch failed" };
    }
}
export async function getLiveSessionsAction(...args: Parameters<typeof _getLiveSessionsAction>) {
    return withFlexibleSafeAction("getLiveSessionsAction", _getLiveSessionsAction)(...args);
}

async function _startAcademyLiveSessionAction(
    courseId: string,
    customMeetingLink?: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin") || session.user.roles?.includes("academy_admin");
        if (!isAdminUser) {
            return { success: false as const, error: "Unauthorized — admin access required", data: null };
        }

        // 1. Fetch course details
        const courseDoc = await db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId).get();
        if (!courseDoc.exists) {
            return { success: false as const, error: "Course not found", data: null };
        }
        const courseData = courseDoc.data()!;

        const title = `Live Class: ${courseData.title}`;
        const instructor = courseData.instructor || "Super Admin";
        const meetingLink = customMeetingLink || `/academy/live/${courseId}`;

        // 2. Look for active session
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        const query = ref.where("courseId", "==", courseId).where("status", "==", "live");
        const snapshot = await query.get();

        let sessionId = "";

        if (snapshot.empty) {
            // Create a new active live session
            const newSession = await ref.add({
                courseId,
                title,
                instructor,
                scheduledAt: new Date(),
                duration: "2 hours",
                meetingLink,
                customMeetingLink: customMeetingLink || null,
                maxParticipants: 100,
                currentParticipants: 0,
                status: "live",
                createdAt: new Date(),
            });
            sessionId = newSession.id;
        } else {
            // Re-activate or use existing
            sessionId = snapshot.docs[0].id;
            await ref.doc(sessionId).update({
                status: "live",
                scheduledAt: new Date(),
                meetingLink,
                customMeetingLink: customMeetingLink || null,
            });
        }

        return { success: true as const, error: null, data: { sessionId } };
    } catch (error) {
        logger.error("Failed to start academy live session:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to start live session", data: null };
    }
}
export async function startAcademyLiveSessionAction(...args: Parameters<typeof _startAcademyLiveSessionAction>) {
    return withFlexibleSafeAction("startAcademyLiveSessionAction", _startAcademyLiveSessionAction)(...args);
}

async function _endAcademyLiveSessionAction(
    courseId: string,
    recordingUrl?: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin") || session.user.roles?.includes("academy_admin");
        if (!isAdminUser) {
            return { success: false as const, error: "Unauthorized — admin access required", data: null };
        }

        // Delete or end live sessions for this course
        const ref = db.collection(COLLECTIONS.ACADEMY_LIVE_SESSIONS);
        let snapshot = await ref.where("courseId", "==", courseId).where("status", "==", "live").get();

        if (snapshot.empty && recordingUrl) {
            snapshot = await ref.where("courseId", "==", courseId).where("status", "==", "ended").get();
        }

        for (const doc of snapshot.docs) {
            const updateData: any = {
                status: "ended",
            };
            if (recordingUrl) {
                updateData.recordingUrl = recordingUrl;
            }
            await ref.doc(doc.id).update(updateData);
        }

        return { success: true as const, error: null, data: null };
    } catch (error) {
        logger.error("Failed to end academy live session:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to end live session", data: null };
    }
}
export async function endAcademyLiveSessionAction(...args: Parameters<typeof _endAcademyLiveSessionAction>) {
    return withFlexibleSafeAction("endAcademyLiveSessionAction", _endAcademyLiveSessionAction)(...args);
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
 * Submit Academy learner application
 */
async function _submitAcademyApplicationAction(
    applicationData: AcademyApplicationData
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Authentication required", data: null };
        }

        const phone = applicationData.personalInfo.phone;
        const email = applicationData.personalInfo.email;
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);

        let finalApplicationId: string = "";
        let isPaid = false;

        await db.runTransaction(async (t) => {
            // Check for existing application status on the user
            const userDoc = await t.get(userRef);
            const userData = userDoc.data();
            const existingStatus = userData?.serviceRegistrations?.academy?.status;

            // Only block if an actual application was already submitted (has applicationId).
            // IMPORTANT: status="pending" is also set by the payment verification step — do NOT
            // treat it as a blocking condition unless a real application doc was also created.
            const existingApplicationId = userData?.serviceRegistrations?.academy?.applicationId;
            if (existingApplicationId && (existingStatus === 'pending' || existingStatus === 'under_review')) {
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

            isPaid = ["completed", "paid", "successful"].includes(existingPaymentStatus);

            // Save to Firestore
            t.set(appRef, {
                ...applicationData,
                userId: session.user.id,
                applicationId,
                status: isPaid ? "approved" : "pending",
                paymentStatus: existingPaymentStatus,
                paymentAmount: existingPaymentAmount,
                plan: "registration",
                submittedAt: FieldValue.serverTimestamp(),
                reviewedAt: isPaid ? FieldValue.serverTimestamp() : null,
                reviewedBy: isPaid ? "system_auto_approval" : null,
                notes: "",
            });

            const userUpdate: any = {
                "serviceRegistrations.academy.status": isPaid ? "approved" : "pending",
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
            };

            if (isPaid) {
                userUpdate["serviceRegistrations.academy.approvedAt"] = FieldValue.serverTimestamp();
                userUpdate["roles"] = FieldValue.arrayUnion("academy_participant");
                userUpdate["isVerified"] = true;
            }

            // CRITICAL: Update user.serviceRegistrations to link application with auth
            t.update(userRef, userUpdate);
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
            if (isPaid) {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache(session.user.id, 'academy');
            }
        } catch (err) {
            logger.error("Failed to invalidate cache after Academy application:", err);
        }

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Academy application submission error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to submit application. Please try again.", data: null };
    }
}
export const submitAcademyApplicationAction = withFlexibleSafeAction("submitAcademyApplicationAction", _submitAcademyApplicationAction);

/**
 * ADMIN ACTIONS
 */

async function _createCourseAction(data: any): Promise<ActionResponse<{ id: string }>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Validate with Zod
        const { createCourseSchema } = await import("@/lib/validations/course");
        const validation = createCourseSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues[0]?.message || "Validation failed",
                data: null
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

        return { success: true, error: null, data: { id: docRef.id } };
    } catch (error) {
        logger.error("Create course error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Course creation failed", data: null };
    }
}
export const createCourseAction = withFlexibleSafeAction("createCourseAction", _createCourseAction);

async function _updateCourseAction(courseId: string, data: Partial<Course>): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized", data: null };
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Update course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed", data: null };
    }
}
export const updateCourseAction = withFlexibleSafeAction("updateCourseAction", _updateCourseAction);

async function _updateCourseModulesAction(courseId: string, modules: CourseModule[]): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized", data: null };
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Update modules error:", {
            courseId,
            moduleCount: modules?.length,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Update failed", data: null };
    }
}
export const updateCourseModulesAction = withFlexibleSafeAction("updateCourseModulesAction", _updateCourseModulesAction);

async function _deleteCourseAction(courseId: string): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false as const, error: "Unauthorized", data: null };
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("Delete course error:", {
            courseId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Deletion failed", data: null };
    }
}
export const deleteCourseAction = withFlexibleSafeAction("deleteCourseAction", _deleteCourseAction);

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
    status: "in-progress" | "completed" | "not-started";
    startedAt: string;
}

/**
 * Auto-enroll paid Academy learners in all courses eligible under their tier.
 */
export async function autoEnrollPaidUser(userId: string, userPlan: string) {
    if (!userId || !userPlan) return;
    const plan = userPlan.toLowerCase();
    const isPaid = ["elite", "standard", "foundation", "advanced"].includes(plan);
    if (!isPaid) return;

    try {
        // 1. Fetch all courses
        const coursesSnap = await db.collection(COLLECTIONS.ACADEMY_COURSES).get();
        if (coursesSnap.empty) return;

        // 2. Filter courses user has access to
        const eligibleCourses = coursesSnap.docs.filter(doc => {
            const courseData = doc.data();
            return checkCourseAccess(plan, courseData.tier || "free");
        });

        if (eligibleCourses.length === 0) return;

        // 3. Parallel fetch existing records to avoid sequential Firestore calls
        const [progressSubSnap, progressSnap, enrollmentsSnap] = await Promise.all([
            db.collection(`user_progress/${userId}/courses`).get(),
            db.collection(COLLECTIONS.COURSE_PROGRESS).where("userId", "==", userId).get(),
            db.collection(COLLECTIONS.COURSE_ENROLLMENTS).where("userId", "==", userId).get()
        ]);

        const existingProgressSubs = new Set(progressSubSnap.docs.map(doc => doc.id));
        const existingProgresses = new Set(progressSnap.docs.map(doc => doc.id));
        const existingEnrollments = new Set(enrollmentsSnap.docs.map(doc => doc.data().courseId));

        // 4. Ensure enrollment in all eligible courses in parallel
        await Promise.all(eligibleCourses.map(async (courseDoc) => {
            const courseId = courseDoc.id;

            // Place A: user_progress subcollection
            if (!existingProgressSubs.has(courseId)) {
                const progressSubRef = db.doc(`user_progress/${userId}/courses/${courseId}`);
                await progressSubRef.set({
                    userId,
                    courseId,
                    completedLessons: [],
                    completedModules: [],
                    quizScores: {},
                    overallProgress: 0,
                    startedAt: FieldValue.serverTimestamp(),
                    lastAccessedAt: FieldValue.serverTimestamp(),
                });
                
                // Increment enrolledCount
                await courseDoc.ref.update({
                    enrolledCount: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // Place B: course_progress
            const progressRefId = `${userId}_${courseId}`;
            if (!existingProgresses.has(progressRefId)) {
                const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(progressRefId);
                await progressRef.set({
                    userId,
                    courseId,
                    progressPercent: 0,
                    completionPercentage: 0,
                    lastWatchedSecond: 0,
                    completed: false,
                    completedAt: null,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            // Place C: course_enrollments
            if (!existingEnrollments.has(courseId)) {
                await db.collection(COLLECTIONS.COURSE_ENROLLMENTS).add({
                    userId,
                    courseId,
                    enrolledAt: FieldValue.serverTimestamp(),
                    status: 'active',
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        }));
    } catch (err) {
        logger.error("[autoEnrollPaidUser] Error during auto-enrollment:", err);
    }
}

async function _getEnrolledCoursesWithDetailsAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

        const userId = session.user.id;

        // Auto-enroll if the user has an active paid plan
        const userPlan = (session.user as any)?.serviceRegistrations?.academy?.plan || "free";
        const isPaid = ["elite", "standard", "foundation", "advanced"].includes(userPlan.toLowerCase());
        if (isPaid) {
            await autoEnrollPaidUser(userId, userPlan);
        }


        // 1. Fetch all progress records for this user
        const progressSnap = await db.collection(`user_progress/${userId}/courses`).get();
        if (progressSnap.empty) return { error: null, success: true as const, data: null };

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
                status: progress.completedAt ? "completed" : (completedCount > 0 ? "in-progress" : "not-started"),
                startedAt: progress.startedAt
                    ? new Date((progress.startedAt as Timestamp).toDate()).toLocaleDateString()
                    : "",
            });
        });

        return { error: null, success: true as const, data: { courses } };
    } catch (error) {
        logger.error("getEnrolledCoursesWithDetailsAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: "Failed to load enrolled courses" };
    }
}
export const getEnrolledCoursesWithDetailsAction = withFlexibleSafeAction("getEnrolledCoursesWithDetailsAction", _getEnrolledCoursesWithDetailsAction);


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
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false as const, error: "Unauthorized: Admin access required", data: null };
        }

        if (!courseId || !quizId) {
            return { success: false as const, error: "Course ID and Quiz ID are required", data: null };
        }

        if (questions.length === 0) {
            return { success: false as const, error: "Quiz must have at least one question", data: null };
        }

        // Validate each question has exactly one correct answer
        for (const q of questions) {
            const correctCount = q.options.filter(o => o.isCorrect).length;
            if (correctCount !== 1) {
                return { success: false as const, error: `Question "${q.text.slice(0, 40)}..." must have exactly one correct answer`, data: null };
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("saveQuizAction error:", {
            quizId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to save quiz", data: null };
    }
}

/**
 * Load a quiz's questions from Firestore.
 */
async function _getQuizAction(
    quizId: string
): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;

        const doc = await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).get();

        if (!doc.exists) {
            return { success: true, error: null, data: null };
        }

        const data = doc.data()!;
        return {
            error: null, success: true as const,
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
        return { success: false as const, error: "Failed to load quiz", data: null };
    }
}
export const getQuizAction = withFlexibleSafeAction("getQuizAction", _getQuizAction);

// ============================================================================
// LEARNING STREAK TRACKING
// ============================================================================

/**
 * Record that the current user completed at least one lesson today.
 * Call this whenever a lesson is marked complete.
 * Collection: user_activity_logs/{userId}/days/{YYYY-MM-DD}
 */
async function _logLessonActivityAction(): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Authentication required", data: null };

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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("logLessonActivityAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { error: "Action failed", success: false as const , data: null };
    }
}
export const logLessonActivityAction = withFlexibleSafeAction("logLessonActivityAction", _logLessonActivityAction);

/**
 * Calculate the current consecutive-day learning streak for a given user.
 * A streak day = any day with at least one lesson logged.
 * Returns { streak } — count of consecutive days ending today (or yesterday if today not yet active).
 */
async function _calculateStreakAction(userId: string): Promise<ActionResponse<any>> {
    try {
        // Fetch the last 90 days of activity (enough for any realistic streak)
        const snap = await db
            .collection(COLLECTIONS.USER_ACTIVITY_LOGS)
            .doc(userId)
            .collection("days")
            .orderBy("date", "desc")
            .limit(90)
            .get();

        if (snap.empty) return { error: null, success: true as const, data: null };

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

        return { error: null, success: true as const, data: { streak } };
    } catch (error) {
        logger.error("calculateStreakAction error:", {
            userId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: null, error: error instanceof Error ? error.message : "Streak calculation failed" };
    }
}
export const calculateStreakAction = withFlexibleSafeAction("calculateStreakAction", _calculateStreakAction);


// ============================================================================
// REVISION FLOW
// ============================================================================

/**
 * Get the current user's existing academy application data (for pre-populating edit form)
 */
async function _getAcademyApplicationAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized', data: null };

        const userDocRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userDocRef.get();
        const userData = userDoc.data();
        let applicationId = userData?.serviceRegistrations?.academy?.applicationId;

        let appDoc: any = null;
        let foundByQuery = false;

        if (applicationId) {
            const docSnap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId).get();
            if (docSnap.exists) {
                appDoc = docSnap;
            }
        }

        if (!appDoc) {
            const snap = await db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)
                .where('userId', '==', session.user.id)
                .get();

            if (!snap.empty) {
                const sortedDocs = snap.docs.sort((a: any, b: any) => {
                    const aTime = a.data().submittedAt?.toMillis?.() || a.data().submittedAt?.seconds * 1000 || a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
                    const bTime = b.data().submittedAt?.toMillis?.() || b.data().submittedAt?.seconds * 1000 || b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
                    return bTime - aTime;
                });
                appDoc = sortedDocs[0];
                applicationId = appDoc.id;
                foundByQuery = true;
            }
        }

        if (!appDoc) {
            return { success: false as const, error: 'No application found', data: null };
        }

        const appData = appDoc.data()!;
        const data = serializeValue(appData);

        // Self-healing: backfill missing links
        const batch = db.batch();
        let needsCommit = false;

        if (foundByQuery || !userData?.serviceRegistrations?.academy?.applicationId) {
            batch.update(userDocRef, {
                "serviceRegistrations.academy.applicationId": applicationId
            });
            needsCommit = true;
        }

        if (!appData.userId) {
            batch.update(appDoc.ref, {
                userId: session.user.id
            });
            needsCommit = true;
        }

        if (needsCommit) {
            await batch.commit();
        }

        return { success: true, error: null, data };
    } catch (error) {
        logger.error("getAcademyApplicationAction error:", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch application", data: null };
    }
}
export const getAcademyApplicationAction = withFlexibleSafeAction("getAcademyApplicationAction", _getAcademyApplicationAction);

/**
 * Admin: Request revision on an academy application
 */
async function _requestAcademyRevisionAction(
    applicationId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required', data: null };
        }

        const appRef = db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();
        if (!appDoc.exists) return { success: false as const, error: 'Application not found', data: null };

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
                    from: process.env.EMAIL_FROM || 'Easy Sales Export Academy <info@easysalesexport.com>',
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error('requestAcademyRevisionAction error:', error);
        return { success: false as const, error: 'Failed to request revision', data: null };
    }
}
export const requestAcademyRevisionAction = withFlexibleSafeAction("requestAcademyRevisionAction", _requestAcademyRevisionAction);


/**
 * Admin: Approve an academy application — sets status + sends approval email
 */
async function _approveAcademyApplicationAction(
    applicationId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes('admin') && !session?.user?.roles?.includes('super_admin')) {
            return { success: false as const, error: 'Admin access required', data: null };
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
                    from: process.env.EMAIL_FROM || 'Easy Sales Export Academy <info@easysalesexport.com>',
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

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error('approveAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to approve application' , data: null };
    }
}
export const approveAcademyApplicationAction = withFlexibleSafeAction("approveAcademyApplicationAction", _approveAcademyApplicationAction);



/**
 * Resubmit academy application after revision request
 */
async function _resubmitAcademyApplicationAction(
    data: AcademyApplicationInput
): Promise<ActionResponse<null>> {
    try {
        // Validate input
        const validation = AcademyApplicationInputSchema.safeParse(data);
        if (!validation.success) {
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null };
        }

        const validatedData = validation.data;

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized' };
        const { session } = sessionResult;
        if (!session?.user) return { success: false as const, error: 'Unauthorized' , data: null };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.academy?.status;

        const allowedStatuses = ['pending', 'revision_required'];
        if (!allowedStatuses.includes(existingStatus)) {
            return { success: false as const, error: 'Your application cannot be resubmitted at this time.' , data: null };
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
                ...validatedData,
                status: 'pending',
                revisionNote: null,
                resubmittedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Update user status and synchronize profile details
            const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
            transaction.update(userRef, {
                'serviceRegistrations.academy.status': 'pending',
                firstName: validatedData.personalInfo.firstName,
                lastName: validatedData.personalInfo.lastName,
                otherName: validatedData.personalInfo.otherName || null,
                fullName: [
                    validatedData.personalInfo.firstName,
                    validatedData.personalInfo.otherName,
                    validatedData.personalInfo.lastName,
                ].filter(Boolean).join(" ").trim(),
                phone: validatedData.personalInfo.phone,
                gender: validatedData.personalInfo.gender,
                stateOfOrigin: validatedData.personalInfo.state,
                lga: validatedData.personalInfo.lga,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error('resubmitAcademyApplicationAction error:', error);
        return { success: false as const, error: 'Failed to resubmit application' , data: null };
    }
}
export const resubmitAcademyApplicationAction = withFlexibleSafeAction("resubmitAcademyApplicationAction", _resubmitAcademyApplicationAction);

