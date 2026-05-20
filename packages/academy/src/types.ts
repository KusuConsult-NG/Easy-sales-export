/**
 * Academy Domain Types
 *
 * @easy-sales/academy/types
 *
 * Base persistence types are inlined here to avoid cross-package imports
 * that fail in the Docker/Railway build environment.
 */

// ─── Base Persistence Types (inlined from @easy-sales/types/academy) ─────────

export interface Course {
    id: string;
    title: string;
    description: string;
    instructor: string;
    duration: string;
    level: "beginner" | "intermediate" | "advanced";
    tier?: "free" | "foundation" | "standard" | "elite";
    price: number;
    thumbnail?: string;
    enrolledCount: number;
    rating: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface Enrollment {
    id: string;
    userId: string;
    courseId: string;
    progress: number;
    completed: boolean;
    enrolledAt: Date;
    completedAt?: Date;
}

export interface Certificate {
    id: string;
    userId: string;
    courseId: string;
    certificateNumber: string;
    issueDate: Date;
    createdAt: Date;
}

// ─── View Models (UI-specific composites) ────────────────────────────────────

/** Full course card with enrollment + progress for learner dashboard */
export interface CourseWithProgress {
    id: string;
    title: string;
    description: string;
    instructor: string;
    thumbnail?: string;
    level: "beginner" | "intermediate" | "advanced";
    tier: "free" | "foundation" | "standard" | "elite";
    duration: string;
    price: number;
    totalLessons: number;
    completedLessons: number;
    progressPercent: number;
    isEnrolled: boolean;
    isCompleted: boolean;
    enrolledAt?: Date;
    completedAt?: Date;
    certificateId?: string;
}

/** Aggregate learner progress summary */
export interface LearnerProgressSummary {
    userId: string;
    totalCourses: number;
    completedCourses: number;
    inProgressCourses: number;
    totalLessonsCompleted: number;
    currentStreak: number;
    longestStreak: number;
    lastActiveAt?: Date;
    certificates: {
        courseId: string;
        certificateId: string;
        issuedAt: Date;
    }[];
}

/** Admin stats block for the Academy overview page */
export interface AcademyAdminStats {
    totalApplications: number;
    pendingApplications: number;
    approvedApplications: number;
    rejectedApplications: number;
    totalEnrollments: number;
    activeEnrollments: number;
    completedEnrollments: number;
    totalCourses: number;
    activeCourses: number;
    totalRevenue: number;
    monthlyRevenue: number;
}

/** Quiz result submitted by a learner */
export interface QuizSubmissionResult {
    score: number;
    passed: boolean;
    correctAnswers: number;
    totalQuestions: number;
    certificateId?: string;
    completionDate?: Date;
}
