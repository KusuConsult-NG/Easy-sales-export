"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createAuditLog } from "@/lib/audit-log";

/**
 * Academy (LMS) - Courses, Progress Tracking, Live Sessions
 */

export interface Course {
    id?: string;
    title: string;
    description: string;
    instructor: string;
    duration: string; // e.g., "4 weeks"
    level: "beginner" | "intermediate" | "advanced";
    modules: CourseModule[];
    thumbnail?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
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
    startedAt: Timestamp;
    lastAccessedAt: Timestamp;
    completedAt?: Timestamp;
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
        const snapshot = await getDocs(collection(db, "academy_courses"));

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Course[];
    } catch (error) {
        console.error("Failed to fetch courses:", error);
        return [];
    }
}

/**
 * Get course by ID
 */
export async function getCourseByIdAction(courseId: string): Promise<Course | null> {
    try {
        const courseDoc = await getDoc(doc(db, "academy_courses", courseId));

        if (!courseDoc.exists()) {
            return null;
        }

        return {
            id: courseDoc.id,
            ...courseDoc.data(),
        } as Course;
    } catch (error) {
        console.error("Failed to fetch course:", error);
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
        // Check if already enrolled
        const progressRef = doc(db, `user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await getDoc(progressRef);

        if (progressDoc.exists()) {
            return { success: false, error: "Already enrolled in this course" };
        }

        const progress: UserProgress = {
            userId,
            courseId,
            completedLessons: [],
            completedModules: [],
            quizScores: {},
            overallProgress: 0,
            startedAt: Timestamp.now(),
            lastAccessedAt: Timestamp.now(),
        };

        await setDoc(progressRef, progress);

        await createAuditLog({
            action: "user_update",
            userId,
            targetId: courseId,
            targetType: "course_enrollment",
        });

        return { success: true };
    } catch (error) {
        console.error("Enrollment error:", error);
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
        const progressRef = doc(db, `user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await getDoc(progressRef);

        if (!progressDoc.exists()) {
            return { success: false, error: "Not enrolled in this course" };
        }

        const progress = progressDoc.data() as UserProgress;

        if (!progress.completedLessons.includes(lessonId)) {
            progress.completedLessons.push(lessonId);
            progress.lastAccessedAt = Timestamp.now();

            // Calculate overall progress
            const courseDoc = await getDoc(doc(db, "academy_courses", courseId));
            if (courseDoc.exists()) {
                const course = courseDoc.data() as Course;
                const totalLessons = course.modules.reduce((sum, mod) => sum + mod.lessons.length, 0);
                progress.overallProgress = Math.round((progress.completedLessons.length / totalLessons) * 100);

                // Check if course is complete
                if (progress.completedLessons.length === totalLessons) {
                    progress.completedAt = Timestamp.now();
                }
            }

            await setDoc(progressRef, progress);
        }

        return { success: true };
    } catch (error) {
        console.error("Lesson completion error:", error);
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
        const progressRef = doc(db, `user_progress/${userId}/courses/${courseId}`);
        const progressDoc = await getDoc(progressRef);

        if (!progressDoc.exists()) {
            return { success: false, error: "Not enrolled in this course" };
        }

        const progress = progressDoc.data() as UserProgress;
        progress.quizScores[moduleId] = score;
        progress.lastAccessedAt = Timestamp.now();

        // Check if module is complete (quiz passed)
        const courseDoc = await getDoc(doc(db, "academy_courses", courseId));
        if (courseDoc.exists()) {
            const course = courseDoc.data() as Course;
            const module = course.modules.find((m) => m.id === moduleId);

            if (module?.quiz && score >= module.quiz.passingScore) {
                if (!progress.completedModules.includes(moduleId)) {
                    progress.completedModules.push(moduleId);
                }
                await setDoc(progressRef, progress);
                return { success: true, passed: true };
            }
        }

        await setDoc(progressRef, progress);
        return { success: true, passed: false };
    } catch (error) {
        console.error("Quiz submission error:", error);
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
        const progressDoc = await getDoc(doc(db, `user_progress/${userId}/courses/${courseId}`));

        if (!progressDoc.exists()) {
            return null;
        }

        return progressDoc.data() as UserProgress;
    } catch (error) {
        console.error("Failed to fetch progress:", error);
        return null;
    }
}

/**
 * Get live sessions
 */
export async function getLiveSessionsAction(courseId?: string): Promise<LiveSession[]> {
    try {
        let q = query(collection(db, "academy_live_sessions"));

        if (courseId) {
            q = query(q, where("courseId", "==", courseId));
        }

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LiveSession[];
    } catch (error) {
        console.error("Failed to fetch live sessions:", error);
        return [];
    }
}
