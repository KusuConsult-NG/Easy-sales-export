import { z } from "zod";

// ─── Inline schema primitives ─────────────────────────────────────────────
// Defined inline to avoid relative path issues when this file is consumed
// from packages/types/src/ via symlink.
const strictNameSchema = z.string()
    .min(1, "This field is required")
    .max(100, "Too long")
    .regex(/^[a-zA-Z\s'\-]+$/, "Only letters, spaces, hyphens and apostrophes allowed");

const strictEmailSchema = z.string()
    .email("Invalid email address")
    .toLowerCase()
    .trim();

const strictPhoneSchema = z.string()
    .min(10, "Phone number must be at least 10 digits")
    .max(15, "Phone number is too long")
    .regex(/^[\+\d\s\-\(\)]+$/, "Invalid phone number format");
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cooperative Types and Schemas
 * 
 * Separated from server actions to comply with Next.js "use server" constraints.
 * Updated with PRD requirements for Phase 2 implementation.
 */

// ============================================
// MEMBERSHIP REGISTRATION SCHEMA (PRD Phase 2)
// ============================================

export const cooperativeMembershipSchema = z.object({
    // Personal Information (11 required fields from PRD)
    firstName: strictNameSchema,
    otherName: strictNameSchema.optional(),
    lastName: strictNameSchema,
    dateOfBirth: z.string().min(1, "Date of birth is required"),
    gender: z.enum(["male", "female", "Male", "Female"], { message: "Please select gender" }),
    email: strictEmailSchema,
    phone: strictPhoneSchema,
    stateOfOrigin: z.string().min(1, "State of origin is required"),
    lga: z.string().min(1, "LGA is required"),
    ward: z.string().optional().default("N/A"),
    residentialAddress: z.string().min(2, "Complete address is required"),
    occupation: z.string().min(2, "Occupation is required"),

    // Next of Kin
    nextOfKinName: strictNameSchema,
    nextOfKinPhone: strictPhoneSchema,
    nextOfKinAddress: z.string().min(2, "Next of kin address is required"),

    // Membership Tier
    membershipTier: z.enum(["Member"], {
        message: "Please select membership tier"
    }),
});

export type CooperativeMembershipFormData = z.infer<typeof cooperativeMembershipSchema>;

export type CooperativeMembershipRecord = {
    id: string;
    userId: string;
    // Personal info
    firstName: string;
    otherName?: string;
    lastName: string;
    dateOfBirth: string;
    gender: "male" | "female";
    email: string;
    phone: string;
    stateOfOrigin: string;
    lga: string;
    ward: string;
    residentialAddress: string;
    occupation: string;
    // Next of kin
    nextOfKin: {
        name: string;
        phone: string;
        address: string;
    };
    // Membership details
    membershipTier: "Member";
    registrationFee: number; // ₦5,000
    membershipStatus: "pending" | "approved" | "active" | "rejected" | "suspended";
    paymentReference?: string;
    paymentStatus: "pending" | "completed" | "failed";
    // Approval tracking
    approvedBy?: string;
    approvedAt?: Date;
    rejectionReason?: string;
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
    bvn?: string;
    nin?: string;
    ninVerified?: boolean;
};

// ============================================
// CONTRIBUTION SCHEMA (Existing)
// ============================================

export const contributionSchema = z.object({
    cooperativeId: z.string().min(1, "Cooperative ID is required"),
    // z.coerce, not z.number.
    //
    // This schema is fed by parseFormData, and FormData values are ALWAYS
    // strings — formDataToObject does no conversion. A bare z.number() therefore
    // rejected every submission with "expected number, received string", so
    // making a contribution failed 100% of the time. The user saw a validation
    // error on a form they had filled in correctly.
    //
    // Callers that already hold a real number (react-hook-form via zodResolver)
    // are unaffected: coerce passes numbers through untouched.
    amount: z.coerce.number().positive("Amount must be greater than 0"),
    type: z.enum(["savings", "loan_repayment"], {
        message: "Please select contribution type",
    }),
});

export type ContributionFormData = z.infer<typeof contributionSchema>;

// ============================================
// FIXED SAVINGS SCHEMA (PRD Phase 2)
// ============================================

export const fixedSavingsSchema = z.object({
    amount: z.number().min(50000, "Minimum amount is ₦50,000"),
    durationMonths: z.number().int().min(1).max(12, "Duration must be 1-12 months"),
});

export type FixedSavingsFormData = z.infer<typeof fixedSavingsSchema>;

export type FixedSavingsPlan = {
    id: string;
    memberId: string;
    amount: number;
    startDate: Date;
    maturityDate: Date;
    durationMonths: number;
    interestRate: number; // e.g., 10% annual
    projectedProfit: number;
    status: "active" | "matured" | "withdrawn";
    createdAt: Date;
    maturedAt?: Date;
};

// ============================================
// LOAN SCHEMAS (PRD Phase 2)
// ============================================

export const loanProductSchema = z.object({
    name: z.string().min(3, "Product name is required"),
    description: z.string().min(10, "Description is required"),
    minAmount: z.number().positive("Minimum amount required"),
    maxAmount: z.number().positive("Maximum amount required"),
    interestRate: z.number().min(0).max(100, "Interest rate must be 0-100%"),
    durationMonths: z.number().int().positive("Duration required"),
    status: z.enum(["active", "inactive"]),
});

export type LoanProductFormData = z.infer<typeof loanProductSchema>;

export type LoanProduct = {
    id: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;
    durationMonths: number;
    eligibilityRules?: string;
    status: "active" | "inactive";
    createdAt: Date;
    updatedAt: Date;
};

export const loanApplicationSchema = z.object({
    productId: z.string().min(1, "Please select a loan product"),
    // z.coerce — same defect as contributionSchema above. Applying for a
    // cooperative loan failed on every attempt.
    amount: z.coerce.number().positive("Loan amount is required"),
    purpose: z.string().min(10, "Please describe the purpose"),
});

export type LoanApplicationFormData = z.infer<typeof loanApplicationSchema>;

export type LoanApplication = {
    id: string;
    memberId: string;
    productId: string;
    amount: number;
    purpose: string;
    interestAmount: number;
    totalRepayment: number;
    monthlyPayment: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "completed";
    approvedBy?: string;
    approvedAt?: Date;
    disbursedAt?: Date;
    rejectionReason?: string;
    repaymentSchedule?: Array<{
        dueDate: Date;
        amount: number;
        status: "pending" | "paid";
    }>;
    createdAt: Date;
    updatedAt: Date;
};

// ============================================
// EXISTING TYPES
// ============================================

export type CooperativeMembership = {
    id: string; // Document ID (User ID in this case)
    cooperativeId: string;
    cooperativeName: string;
    savingsBalance: number;
    loanBalance: number;
    memberSince: Date;
    monthlyTarget: number;
    membershipTier: "Member";
    membershipStatus: "pending" | "approved" | "active" | "rejected" | "suspended";
    paymentStatus: "pending" | "completed" | "failed";
};

export type CooperativeTransaction = {
    id: string;
    type: "contribution" | "withdrawal" | "loan" | "loan_repayment" | "interest";
    amount: number;
    date: Date;
    status: string;
    description: string;
};

// ============================================
// ACTION STATE TYPES
// ============================================

type ActionErrorState = {
    error: string;
    success: false;
    data?: null;
    meta?: null;
};

type JoinSuccessState = {
    error: null;
    success: true;
    data: { message: string };
    meta?: null;
};

type ContributionSuccessState = {
    error: null;
    success: true;
    data: { message: string };
    meta?: null;
};

type MembershipSuccessState = {
    error: null;
    success: true;
    data: { membership: CooperativeMembership };
    meta?: null;
};

type TransactionsSuccessState = {
    error: null;
    success: true;
    data: { transactions: CooperativeTransaction[] };
    meta?: null;
};

export type JoinCooperativeState = ActionErrorState | JoinSuccessState;
export type MakeContributionState = ActionErrorState | ContributionSuccessState;
export type GetMembershipState = ActionErrorState | MembershipSuccessState;
export type GetTransactionsState = ActionErrorState | TransactionsSuccessState;

// Alias for modal compatibility
export type ContributionActionState = MakeContributionState;
export type WithdrawalActionState =
    | { error: string; success: false; data?: null; meta?: null }
    | { error: null; success: true; data: { message: string }; meta?: null };

// New action states for Phase 2
export type MembershipRegistrationState =
    | ActionErrorState
    | { error: null; success: true; data: { message: string; paymentUrl?: string | null; redirectTo?: string; version?: number }; meta?: null };

export type FixedSavingsState = ActionErrorState | ContributionSuccessState;
export type LoanApplicationState = ActionErrorState | ContributionSuccessState;
