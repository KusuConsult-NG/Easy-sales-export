/**
 * @easy-sales/wave
 *
 * WAVE (Women in Agribusiness Ventures & Exports) Domain Package
 *
 * This is the isolated domain boundary for WAVE. All WAVE-specific types,
 * constants, and service contracts live here.
 *
 * Phase 2: Types + contracts layer (actions remain in Next.js app)
 * Phase 4: Full extraction into isolated app/wave workspace
 */

// Domain types
export type * from "./types";

// Domain constants
export {
    WAVE_FEES,
    WAVE_ELIGIBILITY,
    WAVE_STATUS,
    WAVE_CATEGORIES,
} from "./constants";

// Service contracts
export type {
    WaveServiceContract,
    WaveApplicationPayload,
    WaveWithdrawalPayload,
    WaveEnrollmentResult,
} from "./contracts";
