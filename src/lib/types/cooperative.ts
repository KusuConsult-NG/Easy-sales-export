import { z } from "zod";

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
    firstName: z.string().min(2, "First name is required"),
    middleName: z.string().optional(),
    lastName: z.string().min(2, "Last name is required"),
    dateOfBirth: z.string().min(1, "Date of birth is required"),
    gender: z.enum(["male", "female"], { message: "Please select gender" }),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(11, "Valid phone number is required"),
    stateOfOrigin: z.string().min(1, "State of origin is required"),
    lga: z.string().min(1, "LGA is required"),
    residentialAddress: z.string().min(10, "Complete address is required"),
    occupation: z.string().min(2, "Occupation is required"),

    // Next of Kin
    nextOfKinName: z.string().min(2, "Next of kin name is required"),
    nextOfKinPhone: z.string().min(11, "Next of kin phone is required"),
    nextOfKinAddress: z.string().min(10, "Next of kin address is required"),

    // Membership Tier
    membershipTier: z.enum(["basic", "premium"], {
        message: "Please select membership tier"
    }),
});

export type CooperativeMembershipFormData = z.infer<typeof cooperativeMembershipSchema>;

export type CooperativeMembershipRecord = {
    id: string;
    userId: string;
    // Personal info
    firstName: string;
    middleName?: string;
    lastName: string;
    dateOfBirth: string;
    gender: "male" | "female";
    email: string;
    phone: string;
    stateOfOrigin: string;
    lga: string;
    residentialAddress: string;
    occupation: string;
    // Next of kin
    nextOfKin: {
        name: string;
        phone: string;
        address: string;
    };
    // Membership details
    membershipTier: "basic" | "premium";
    registrationFee: number; // ₦10,000 or ₦20,000
    membershipStatus: "pending" | "approved" | "suspended";
    paymentReference?: string;
    paymentStatus: "pending" | "completed" | "failed";
    // Approval tracking
    approvedBy?: string;
    approvedAt?: Date;
    rejectionReason?: string;
    // Timestamps
    createdAt: Date;
    updatedAt: Date;
};

// ============================================
// CONTRIBUTION SCHEMA (Existing)
// ============================================

export const contributionSchema = z.object({
    cooperativeId: z.string().min(1, "Cooperative ID is required"),
    amount: z.number().positive("Amount must be greater than 0"),
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
    amount: z.number().positive("Loan amount is required"),
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
    cooperativeId: string;
    cooperativeName: string;
    savingsBalance: number;
    loanBalance: number;
    memberSince: Date;
    monthlyTarget: number;
};

export type CooperativeTransaction = {
    id: string;
    type: "contribution" | "withdrawal" | "loan" | "loan_repayment";
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
};

type JoinSuccessState = {
    error: null;
    success: true;
    message: string;
};

type ContributionSuccessState = {
    error: null;
    success: true;
    message: string;
};

type MembershipSuccessState = {
    error: null;
    success: true;
    data: CooperativeMembership;
};

type TransactionsSuccessState = {
    error: null;
    success: true;
    data: CooperativeTransaction[];
};

export type JoinCooperativeState = ActionErrorState | JoinSuccessState;
export type MakeContributionState = ActionErrorState | ContributionSuccessState;
export type GetMembershipState = ActionErrorState | MembershipSuccessState;
export type GetTransactionsState = ActionErrorState | TransactionsSuccessState;

// Alias for modal compatibility
export type ContributionActionState = MakeContributionState;
export type WithdrawalActionState =
    | { error: string; success: false }
    | { error: null; success: true; message: string };

// New action states for Phase 2
export type MembershipRegistrationState =
    | ActionErrorState
    | { error: null; success: true; message: string; paymentUrl?: string };

export type FixedSavingsState = ActionErrorState | ContributionSuccessState;
export type LoanApplicationState = ActionErrorState | ContributionSuccessState;
