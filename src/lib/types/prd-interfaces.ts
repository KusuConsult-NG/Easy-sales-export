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

/**
 * CooperativeMember and LoanApplication WERE DECLARED HERE AND UNREACHABLE.
 *
 * The header above already listed both as migrated to cooperative.ts. The
 * migration moved them and did not delete them, and nothing failed, because
 * firestore.ts does
 *
 *     export * from "./prd-interfaces";
 *
 * and ALSO declares both names itself. A local declaration shadows a star
 * re-export silently — no error, no warning — so the versions here lost, and
 * neither had a direct importer either. They were edited-in-good-faith dead
 * code: a file titled "PRD-Required Type Interfaces" in which two of eight
 * requirements could not be enforced by anything.
 *
 * WHAT THE WINNING SHAPES DO NOT HAVE
 * -----------------------------------
 * Recorded because it is the only part worth keeping. The firestore.ts
 * declarations that win carry more fields overall, but not these:
 *
 *   LoanApplication    approvedBy, completedAt, dueDate, interestAmount,
 *                      memberId, paid, paidAt, productId, repaymentSchedule
 *   CooperativeMember  approvedAt, approvedBy, fullName, paymentReference
 *
 * Whether any of those SHOULD be on the live shapes is a product question. It
 * is now a visible question rather than an interface nobody could reach.
 *
 * prd-interfaces-shadowing.test.ts fails if any name here is shadowed again.
 */
