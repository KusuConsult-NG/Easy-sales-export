/**
 * WAVE Domain Constants
 *
 * @easy-sales/wave/constants
 *
 * Single source of truth for all WAVE business rules and configuration.
 * These constants were previously scattered across wave.ts and wave-admin.ts.
 */

/** Fee structure for the WAVE programme (all amounts in NGN) */
export const WAVE_FEES = {
    /** Minimum amount a member can withdraw at once */
    MIN_WITHDRAWAL: 5_000,
    /** Maximum withdrawal in a single request */
    MAX_WITHDRAWAL: 500_000,
    /** Registration fee (₦0 — WAVE is free) */
    REGISTRATION: 0,
} as const;

/** Eligibility rules */
export const WAVE_ELIGIBILITY = {
    /** Only female-presenting applicants are eligible */
    GENDER_RESTRICTED: true,
    ELIGIBLE_GENDER: "female" as const,
    /** Minimum age to apply */
    MIN_AGE: 18,
    /** Maximum age to apply */
    MAX_AGE: 60,
} as const;

/** Application/membership status values */
export const WAVE_STATUS = {
    DRAFT: "draft",
    PENDING: "pending",
    SUBMITTED: "submitted",
    UNDER_REVIEW: "under_review",
    APPROVED: "approved",
    REJECTED: "rejected",
    /** Member has been enrolled (post-approval) */
    ENROLLED: "enrolled",
} as const;

export type WaveStatus = typeof WAVE_STATUS[keyof typeof WAVE_STATUS];

/** Withdrawal status values */
export const WAVE_WITHDRAWAL_STATUS = {
    PENDING: "pending",
    APPROVED: "approved",
    APPROVED_PENDING_PAYOUT: "approved_pending_payout",
    REJECTED: "rejected",
    COMPLETED: "completed",
} as const;

export type WaveWithdrawalStatus = typeof WAVE_WITHDRAWAL_STATUS[keyof typeof WAVE_WITHDRAWAL_STATUS];

/** Resource categories */
export const WAVE_CATEGORIES = {
    RESOURCE: {
        DOCUMENT: "document",
        VIDEO: "video",
        TEMPLATE: "template",
        GUIDE: "guide",
    },
    EARNING: {
        TRAINING_BONUS: "training_bonus",
        REFERRAL: "referral",
        SALES_COMMISSION: "sales_commission",
        OTHER: "other",
    },
    CERTIFICATE: {
        TRAINING: "training",
        ACHIEVEMENT: "achievement",
        COMPLETION: "completion",
    },
} as const;

/** WAVE route paths — used for redirects and navigation */
export const WAVE_ROUTES = {
    LANDING: "/wave/landing",
    APPLICATION: "/wave/application",
    APPLICATION_SUCCESS: "/wave/application/success",
    APPLICATION_PENDING: "/wave/application/review-pending",
    ACCESS_DENIED: "/wave/access-denied",
    BRIEFING: "/wave/briefing",
    MEMBER_DASHBOARD: "/wave/dashboard",
    MEMBER_RESOURCES: "/wave/resources",
    MEMBER_TRAINING: "/wave/training",
    MEMBER_SHIPMENTS: "/wave/shipments",
    MEMBER_EARNINGS: "/wave/earnings",
    MEMBER_CERTIFICATES: "/wave/certificates",
    MEMBER_PROFILE: "/wave/profile",
    ADMIN_ROOT: "/admin/wave",
    ADMIN_APPLICATIONS: "/admin/wave/applications",
    ADMIN_MEMBERS: "/admin/wave/members",
    ADMIN_WITHDRAWALS: "/admin/wave/withdrawals",
    ADMIN_RESOURCES: "/admin/wave/resources",
    ADMIN_TRAINING: "/admin/wave/training",
} as const;

/** Paystack payout reason prefix */
export const WAVE_PAYOUT_REASON_PREFIX = "WAVE Earnings Withdrawal -" as const;

/** Cache TTLs in seconds */
export const WAVE_CACHE_TTL = {
    MEMBER_STATS: 300,      // 5 minutes
    APPLICATIONS: 120,       // 2 minutes
    RESOURCES: 600,          // 10 minutes
    TRAINING_EVENTS: 300,    // 5 minutes
} as const;
