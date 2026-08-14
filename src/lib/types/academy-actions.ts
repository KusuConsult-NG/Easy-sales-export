/**
 * Academy types as the SERVER ACTIONS use them.
 *
 * These ten declarations were inside academy/_actions.ts, and almost every
 * action in that 2,227-line file referred to at least one — `Course` alone
 * appears in eleven of them. Splitting the file by domain would otherwise have
 * left the types in whichever piece happened to keep them.
 *
 * WHY THIS IS NOT src/lib/types/academy.ts
 * ----------------------------------------
 * Because that file already exists, and its `Course` is a DIFFERENT SHAPE:
 *
 *     types/academy.ts        id: string          createdAt: Date
 *     here (from _actions.ts) id?: string         createdAt: FieldValue | Timestamp | string | null
 *
 * The first describes a course as a caller receives it; this one describes a
 * course as it is written to and read from the database, where a timestamp may
 * still be a sentinel. Both are in use.
 *
 * Merging them is a real change with real consequences — every reader of one
 * shape would start seeing the other's optionality — and it is not something to
 * do while moving code. Recorded here so the duplication is visible and
 * deliberate rather than discovered again later. types/academy.ts also owns
 * Enrollment and Certificate, which firestore.ts re-exports; nothing here
 * touches those.
 *
 * A plain module, not one under src/app/actions: everything there must carry
 * "use server" and a session guard, which a file of interfaces can satisfy only
 * by pretending to be something it is not.
 */

import type { FieldValue, Timestamp } from "@/lib/firestore-compat";

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
