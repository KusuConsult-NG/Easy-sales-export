/**
 * Cooperative Domain Types
 *
 * @easy-sales/cooperative/types
 *
 * Base persistence types are inlined here to avoid cross-package imports
 * that fail in the Docker/Railway build environment.
 */

// ─── Base Persistence Types (inlined from @easy-sales/types/cooperative) ────

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

// ─── View Models ──────────────────────────────────────────────────────────────

/** Member dashboard summary */
export interface CooperativeDashboardSummary {
    memberId: string;
    fullName: string;
    memberNumber: string;
    tier: string;
    totalSavings: number;
    totalContributions: number;
    availableBalance: number;
    pendingWithdrawals: number;
    activeLoan?: {
        id: string;
        amount: number;
        outstanding: number;
        nextPaymentDate: Date;
    };
    lastContributionDate?: Date;
    memberSince: Date;
}

/** Admin cooperative overview stats */
export interface CooperativeAdminStats {
    totalMembers: number;
    pendingMembers: number;
    approvedMembers: number;
    totalSavingsPool: number;
    totalLoansOutstanding: number;
    totalContributionsThisMonth: number;
    pendingWithdrawals: number;
    pendingLoans: number;
    defaultedLoans: number;
}

/** Loan product definition */
export interface LoanProduct {
    id: string;
    name: string;
    description: string;
    minAmount: number;
    maxAmount: number;
    interestRate: number;        // Annual rate as decimal (e.g., 0.15 = 15%)
    maxTermMonths: number;
    requiredSavingsMultiple?: number;  // e.g., 3 = loan up to 3x savings
    isActive: boolean;
    eligibilityTiers: string[];
    createdAt: Date;
}

/** Savings account summary */
export interface SavingsAccountSummary {
    userId: string;
    totalBalance: number;
    totalContributed: number;
    totalInterestEarned: number;
    fixedSavings: {
        id: string;
        amount: number;
        maturityDate: Date;
        interestRate: number;
        status: "active" | "matured" | "withdrawn";
    }[];
    flexibleBalance: number;
    lastUpdated: Date;
}

/** ID card data returned for member ID generation */
export interface MemberIdCard {
    memberId: string;
    memberNumber: string;
    fullName: string;
    passportPhotoUrl?: string;
    tier: string;
    joinedAt: Date;
    qrCodeData: string;
    cooperativeName: string;
}
