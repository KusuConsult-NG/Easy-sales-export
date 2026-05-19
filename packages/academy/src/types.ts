/**
 * Academy Domain Types
 *
 * @easy-sales/academy/types
 *
 * Re-exports base types from @easy-sales/types/academy and adds
 * Academy-specific composite/view-model types.
 */

// Re-export base persistence types
export type {
    Course,
    Enrollment,
    Certificate,
} from "@easy-sales/types/academy";

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
