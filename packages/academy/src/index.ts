/**
 * @easy-sales/academy
 *
 * Academy LMS Domain Package
 *
 * Phase 3: Types + contracts layer (actions remain in Next.js app)
 * Phase 4: Full extraction into isolated apps/academy workspace
 */

// Domain types
export type * from "./types";

// Domain constants
export {
    ACADEMY_TIERS,
    ACADEMY_TIER_PRICES,
    ACADEMY_STATUS,
    ACADEMY_PAYMENT_STATUS,
    ACADEMY_COURSE_LEVELS,
    ACADEMY_PASS_THRESHOLD,
    ACADEMY_QUIZ_MIN_SCORE,
    ACADEMY_ROUTES,
    ACADEMY_CACHE_TTL,
} from "./constants";

// Type aliases from constants
export type {
    AcademyTier,
    AcademyStatus,
    AcademyCourseLevel,
} from "./constants";

// Service contracts
export type {
    AcademyServiceContract,
    AcademyEnrollmentPayload,
    AcademyApplicationPayload,
    AcademyApplicationReviewPayload,
    QuizSubmissionPayload,
    LessonCompletionPayload,
    PaymentInitResult,
    EnrollmentResult,
    CertificateGenerationResult,
} from "./contracts";
