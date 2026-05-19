/**
 * Academy Domain Constants
 *
 * @easy-sales/academy/constants
 *
 * Single source of truth for all Academy business rules and configuration.
 */

/** Academy membership tiers */
export const ACADEMY_TIERS = {
    FREE: "free",
    FOUNDATION: "foundation",
    STANDARD: "standard",
    ELITE: "elite",
} as const;

export type AcademyTier = typeof ACADEMY_TIERS[keyof typeof ACADEMY_TIERS];

/** Tier pricing in NGN */
export const ACADEMY_TIER_PRICES: Record<string, number> = {
    [ACADEMY_TIERS.FREE]: 0,
    [ACADEMY_TIERS.FOUNDATION]: 15_000,
    [ACADEMY_TIERS.STANDARD]: 35_000,
    [ACADEMY_TIERS.ELITE]: 75_000,
} as const;

/** Application/enrollment status values */
export const ACADEMY_STATUS = {
    PENDING: "pending",
    APPROVED: "approved",
    REJECTED: "rejected",
    UNDER_REVIEW: "under_review",
    SUSPENDED: "suspended",
    REVISION_REQUIRED: "revision_required",
} as const;

export type AcademyStatus = typeof ACADEMY_STATUS[keyof typeof ACADEMY_STATUS];

/** Payment status values */
export const ACADEMY_PAYMENT_STATUS = {
    PENDING: "pending",
    COMPLETED: "completed",
    FAILED: "failed",
    REFUNDED: "refunded",
} as const;

/** Course levels */
export const ACADEMY_COURSE_LEVELS = {
    BEGINNER: "beginner",
    INTERMEDIATE: "intermediate",
    ADVANCED: "advanced",
} as const;

export type AcademyCourseLevel = typeof ACADEMY_COURSE_LEVELS[keyof typeof ACADEMY_COURSE_LEVELS];

/** Certificate pass threshold (percentage) */
export const ACADEMY_PASS_THRESHOLD = 70;

/** Minimum quiz score to unlock certificate */
export const ACADEMY_QUIZ_MIN_SCORE = 70;

/** Academy route paths */
export const ACADEMY_ROUTES = {
    LANDING: "/academy",
    DASHBOARD: "/academy/dashboard",
    COURSES: "/academy/courses",
    APPLICATION: "/academy/application",
    APPLICATION_PENDING: "/academy/application/pending",
    APPLICATION_SUCCESS: "/academy/application/success",
    PAYMENT: "/academy/payment",
    PAYMENT_CALLBACK: "/academy/payment/callback",
    SETUP: "/academy/setup",
    LIVE: "/academy/live",
    MY_COURSES: "/academy/(learner)/my-courses",
    PROGRESS: "/academy/(learner)/progress",
    ADMIN_ROOT: "/admin/academy",
    ADMIN_COURSES: "/admin/academy/courses",
    ADMIN_CREATE: "/admin/academy/create",
    ADMIN_APPLICATIONS: "/admin/academy/applications",
} as const;

/** Cache TTLs in seconds */
export const ACADEMY_CACHE_TTL = {
    COURSES: 600,         // 10 minutes
    ENROLLMENT: 300,      // 5 minutes
    PROGRESS: 180,        // 3 minutes
    STATS: 300,           // 5 minutes
    LIVE_SESSIONS: 60,    // 1 minute
} as const;

/** Paystack plan codes (prod) */
export const ACADEMY_PAYSTACK_PLANS = {
    [ACADEMY_TIERS.FOUNDATION]: process.env.PAYSTACK_ACADEMY_FOUNDATION_PLAN ?? "",
    [ACADEMY_TIERS.STANDARD]: process.env.PAYSTACK_ACADEMY_STANDARD_PLAN ?? "",
    [ACADEMY_TIERS.ELITE]: process.env.PAYSTACK_ACADEMY_ELITE_PLAN ?? "",
} as const;
