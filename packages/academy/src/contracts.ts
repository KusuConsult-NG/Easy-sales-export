/**
 * Academy Service Contracts
 *
 * @easy-sales/academy/contracts
 *
 * Formal domain API contracts for the Academy LMS.
 * Implementations: src/app/actions/academy/_actions.ts + _admin.ts + _payment.ts
 */

import type { AcademyTier, AcademyStatus } from "./constants";

// ─── Input Payloads ──────────────────────────────────────────────────────────

export interface AcademyEnrollmentPayload {
    userId: string;
    courseId: string;
    paymentReference?: string;
    tier?: AcademyTier;
}

export interface AcademyApplicationPayload {
    userId: string;
    userEmail: string;
    tier: AcademyTier;
    personalInfo: {
        firstName: string;
        lastName: string;
        phone: string;
        state: string;
        lga: string;
    };
    motivation?: string;
}

export interface AcademyApplicationReviewPayload {
    applicationId: string;
    decision: "approved" | "rejected";
    notes?: string;
    reviewedBy: string;
}

export interface QuizSubmissionPayload {
    courseId: string;
    moduleId: string;
    userId: string;
    answers: Record<string, string | string[]>;
    timeTaken?: number;
}

export interface LessonCompletionPayload {
    userId: string;
    courseId: string;
    lessonId: string;
    moduleId: string;
    timeSpent?: number;
}

// ─── Return Types ────────────────────────────────────────────────────────────

export interface PaymentInitResult {
    paymentUrl: string;
    reference: string;
    amount: number;
    tier: AcademyTier;
}

export interface EnrollmentResult {
    enrolled: boolean;
    courseId: string;
    enrollmentId?: string;
    message?: string;
}

export interface CertificateGenerationResult {
    certificateId: string;
    certificateNumber: string;
    verificationUrl: string;
}

// ─── Service Contract ────────────────────────────────────────────────────────

/**
 * AcademyServiceContract
 *
 * The complete interface for the Academy LMS domain.
 * In Phase 4, a WaveService-style class will implement this.
 */
export interface AcademyServiceContract {
    // Learner operations
    checkStatus(userId: string): Promise<{ status: AcademyStatus | null; tier?: AcademyTier }>;
    getCourses(filter?: { tier?: AcademyTier; level?: string; cursor?: string }): Promise<{
        courses: any[];
        nextCursor?: string;
        total: number;
    }>;
    enrollInCourse(payload: AcademyEnrollmentPayload): Promise<EnrollmentResult>;
    completeLesson(payload: LessonCompletionPayload): Promise<void>;
    submitQuiz(payload: QuizSubmissionPayload): Promise<{ score: number; passed: boolean; certificateId?: string }>;
    getProgress(userId: string, courseId?: string): Promise<any>;
    submitApplication(payload: AcademyApplicationPayload): Promise<{ applicationId: string }>;

    // Payment operations
    initiatePayment(userId: string, tier: AcademyTier): Promise<PaymentInitResult>;
    verifyPayment(reference: string): Promise<{ verified: boolean; tier?: AcademyTier }>;

    // Admin operations
    reviewApplication(payload: AcademyApplicationReviewPayload): Promise<void>;
    getApplications(options?: { status?: string; cursor?: string; limit?: number }): Promise<{
        applications: any[];
        nextCursor?: string;
        total: number;
    }>;
    getStats(): Promise<any>;
    upsertCourse(courseId: string | null, data: any): Promise<{ id: string }>;
    deleteCourse(courseId: string): Promise<void>;
}
