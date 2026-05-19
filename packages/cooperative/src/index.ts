/**
 * @easy-sales/cooperative
 *
 * Cooperative Domain Package
 *
 * Phase 4: Types + contracts layer (actions remain in Next.js app)
 */

// Domain types
export type * from "./types";

// Domain constants
export {
    COOPERATIVE_STATUS,
    COOPERATIVE_TIERS,
    LOAN_STATUS,
    COOPERATIVE_TRANSACTION_TYPES,
    CONTRIBUTION_FREQUENCY,
    COOPERATIVE_MIN_CONTRIBUTION,
    FIXED_SAVINGS_INTEREST_RATE,
    COOPERATIVE_ROUTES,
    COOPERATIVE_CACHE_TTL,
} from "./constants";

// Type aliases from constants
export type {
    CooperativeStatus,
    CooperativeTier,
    LoanStatus,
} from "./constants";

// Service contracts
export type {
    CooperativeServiceContract,
    CooperativeRegistrationPayload,
    ContributionPayload,
    LoanApplicationPayload,
    WithdrawalRequestPayload,
    ApplicationReviewPayload,
    RegistrationResult,
    LoanApprovalResult,
    WithdrawalResult,
} from "./contracts";
