/**
 * Cooperative Domain Constants
 *
 * @easy-sales/cooperative/constants
 */

/** Cooperative membership status values */
export const COOPERATIVE_STATUS = {
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
    SUSPENDED: "suspended",
    UNDER_REVIEW: "under_review",
    REVISION_REQUIRED: "revision_required",
} as const;

export type CooperativeStatus = typeof COOPERATIVE_STATUS[keyof typeof COOPERATIVE_STATUS];

/** Member tier levels (determines savings interest rates & loan limits) */
export const COOPERATIVE_TIERS = {
    BRONZE: "bronze",
    SILVER: "silver",
    GOLD: "gold",
    PLATINUM: "platinum",
} as const;

export type CooperativeTier = typeof COOPERATIVE_TIERS[keyof typeof COOPERATIVE_TIERS];

/** Loan status values */
export const LOAN_STATUS = {
    PENDING: "pending",
    UNDER_REVIEW: "under_review",
    APPROVED: "approved",
    REJECTED: "rejected",
    DISBURSED: "disbursed",
    ACTIVE: "active",
    COMPLETED: "completed",
    DEFAULTED: "defaulted",
} as const;

export type LoanStatus = typeof LOAN_STATUS[keyof typeof LOAN_STATUS];

/** Transaction types */
export const COOPERATIVE_TRANSACTION_TYPES = {
    CONTRIBUTION: "contribution",
    WITHDRAWAL: "withdrawal",
    LOAN_DISBURSEMENT: "loan_disbursement",
    LOAN_REPAYMENT: "loan_repayment",
    INTEREST: "interest",
    DIVIDEND: "dividend",
    PENALTY: "penalty",
} as const;

/** Contribution frequency options */
export const CONTRIBUTION_FREQUENCY = {
    WEEKLY: "weekly",
    MONTHLY: "monthly",
    QUARTERLY: "quarterly",
} as const;

/** Minimum contribution amounts (NGN) */
export const COOPERATIVE_MIN_CONTRIBUTION: Record<string, number> = {
    [CONTRIBUTION_FREQUENCY.WEEKLY]: 1_000,
    [CONTRIBUTION_FREQUENCY.MONTHLY]: 5_000,
    [CONTRIBUTION_FREQUENCY.QUARTERLY]: 15_000,
} as const;

/** Fixed savings interest rate per annum */
export const FIXED_SAVINGS_INTEREST_RATE = 0.12; // 12%

/** Cooperative route paths */
export const COOPERATIVE_ROUTES = {
    LANDING: "/cooperatives/landing",
    ONBOARDING: "/cooperatives/onboarding",
    ONBOARDING_PENDING: "/cooperatives/onboarding/pending",
    ONBOARDING_PENDING_PAYMENT: "/cooperatives/onboarding/pending-payment",
    PAYMENT: "/cooperatives/payment",
    PAYMENT_CALLBACK: "/cooperatives/payment/callback",
    VERIFY_PAYMENT: "/cooperatives/verify-payment",
    MEMBER_DASHBOARD: "/cooperatives/dashboard",
    MEMBER_CONTRIBUTE: "/cooperatives/contribute",
    MEMBER_HISTORY: "/cooperatives/history",
    MEMBER_DIRECTORY: "/cooperatives/directory",
    MEMBER_LOANS: "/cooperatives/loans",
    MEMBER_MY_LOANS: "/cooperatives/my-loans",
    MEMBER_MY_SAVINGS: "/cooperatives/my-savings",
    MEMBER_FIXED_SAVINGS: "/cooperatives/fixed-savings",
    MEMBER_WITHDRAW: "/cooperatives/withdraw",
    MEMBER_ID_CARD: "/cooperatives/id-card",
    ADMIN_ROOT: "/admin/cooperatives",
    ADMIN_DASHBOARD: "/admin/cooperatives/dashboard",
    ADMIN_MEMBERS: "/admin/cooperatives/members",
    ADMIN_LOANS: "/admin/cooperatives/loans",
    ADMIN_CONTRIBUTIONS: "/admin/cooperatives/contributions",
    ADMIN_TRANSACTIONS: "/admin/cooperatives/transactions",
} as const;

/** Cache TTLs in seconds */
export const COOPERATIVE_CACHE_TTL = {
    MEMBER_DATA: 300,        // 5 minutes
    TRANSACTIONS: 180,       // 3 minutes
    STATS: 300,              // 5 minutes
    DIRECTORY: 600,          // 10 minutes
    LOAN_PRODUCTS: 600,      // 10 minutes
    DASHBOARD: 120,          // 2 minutes
} as const;
