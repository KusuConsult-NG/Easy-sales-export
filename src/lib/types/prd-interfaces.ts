/**
 * @deprecated PRD-Required Type Interfaces (Legacy)
 *
 * STATUS: Being progressively migrated to domain-specific type files.
 * - CooperativeMember    → src/lib/types/cooperative.ts (CooperativeMembershipRecord)
 * - LoanApplication      → src/lib/types/cooperative.ts (LoanApplication)
 * - FixedSavingsPlan     → src/lib/types/cooperative.ts (FixedSavingsPlan)
 * - LoanProduct          → src/lib/types/cooperative.ts (LoanProduct)
 * - AcademyQuiz          → src/lib/types/academy.ts (future)
 * - SellerVerification   → src/lib/types/marketplace.ts (future)
 * - LandVerification     → src/lib/types/farm-nation.ts (future)
 *
 * DO NOT add new types here. Add to the appropriate domain type file.
 * Added: 2026-02-06  |  Deprecated: 2026-05
 */

// ============================================
// COOPERATIVE MODULE - PRD Section 5.5
// ============================================

export interface CooperativeMember {
    id: string;
    userId: string;
    cooperativeId: string;

    // Personal Information (PRD Required Fields)
    firstName: string;
    middleName?: string;
    lastName: string;
    dateOfBirth: Date;
    gender: "male" | "female";
    email: string;
    phone: string;
    stateOfOrigin: string;
    lga: string;
    residentialAddress: string;
    occupation: string;

    // Next of Kin Information
    nextOfKin: {
        fullName: string;
        phone: string;
        residentialAddress: string;
    };

    // Membership Details
    membershipTier: "Member"; // Unified single tier
    registrationFee: number;
    membershipStatus: "pending" | "approved" | "suspended";
    paymentReference: string;

    // Financial
    savingsBalance: number;
    loanBalance: number;

    // Approval Tracking
    approvedBy?: string;
    approvedAt?: Date;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

export interface FixedSavingsPlan {
    id: string;
    memberId: string;
    cooperativeId: string;
    amount: number;
    startDate: Date;
    maturityDate: Date; // 12 months from start
    interestRate: number; // Percentage
    projectedProfit: number;
    actualProfit?: number;
    status: "active" | "matured" | "withdrawn";
    createdAt: Date;
    maturedAt?: Date;
}

export interface LoanProduct {
    id: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number; // Percentage
    durationMonths: number;
    eligibilityRules: string;
    status: "active" | "inactive";
    createdAt: Date;
    updatedAt: Date;
}

export interface LoanApplication {
    id: string;
    memberId: string;
    productId: string;
    amount: number;
    purpose: string;
    interestAmount: number;
    totalRepayment: number;
    monthlyPayment: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "completed";
    repaymentSchedule: {
        dueDate: Date;
        amount: number;
        paid: boolean;
        paidAt?: Date;
    }[];
    approvedBy?: string;
    approvedAt?: Date;
    disbursedAt?: Date;
    completedAt?: Date;
    rejectionReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// MARKETPLACE MODULE - PRD Section 5.1
// ============================================

export interface SellerVerification {
    id: string;
    sellerId: string;

    // Phone Verification
    phoneOTP?: string;
    phoneVerified: boolean;

    // Identity Documents
    ninDocument?: string; // URL
    bvnDocument?: string; // URL
    cacDocument?: string; // URL

    // Bank Details
    bankName: string;
    accountNumber: string;
    accountName: string;

    // Location
    physicalAddress: string;
    locationCoordinates?: {
        lat: number;
        lng: number;
    };

    // Verification Status
    status: "pending" | "documents_submitted" | "approved" | "rejected";
    verifiedBy?: string;
    verifiedAt?: Date;
    rejectionReason?: string;

    createdAt: Date;
    updatedAt: Date;
}

// ============================================
// ACADEMY MODULE - PRD Section 5.3
// ============================================

export interface AcademyQuiz {
    id: string;
    courseId: string;
    moduleId: string;
    title: string;
    description: string;
    passingScore: number; // Percentage
    questions: {
        id: string;
        question: string;
        options: string[];
        correctAnswer: number; // Index of correct option
        points: number;
    }[];
    createdAt: Date;
    updatedAt: Date;
}

export interface QuizAttempt {
    id: string;
    userId: string;
    quizId: string;
    courseId: string;
    score: number;
    totalPoints: number;
    percentage: number;
    passed: boolean;
    answers: {
        questionId: string;
        selectedAnswer: number;
        correct: boolean;
        pointsEarned: number;
    }[];
    attemptedAt: Date;
}

// ============================================
// FARM NATION MODULE - PRD Section 5.2
// ============================================

export interface LandVerification {
    id: string;
    listingId: string;
    ownerId: string;

    // Verification Process
    status: "draft" | "pending" | "approved" | "rejected";
    documentsReviewed: boolean;
    physicalVerificationDone: boolean;

    // GPS Coordinates
    gpsCoordinates?: {
        lat: number;
        lng: number;
    };

    // Verification Details
    verifiedBy?: string;
    verifiedAt?: Date;
    verificationNotes?: string;
    rejectionReason?: string;

    createdAt: Date;
    updatedAt: Date;
}
