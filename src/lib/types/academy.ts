/**
 * Academy LMS Types
 * 
 * Domain: Academy
 * Part of the Platform Type Isolation — Phase 0 Migration
 */

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
