/**
 * WAVE Service Contracts
 *
 * @easy-sales/wave/contracts
 *
 * Defines the interface contracts for WAVE business logic.
 * The actual implementations live in src/app/actions/wave*.ts.
 * In Phase 4, implementations will be moved into this package.
 *
 * Having the contract here means:
 *   1. Any future implementation must satisfy this interface
 *   2. Tests can mock against the contract, not the implementation
 *   3. Domain boundary is explicit and enforced at the type level
 */

import type { WaveApplication, WaveWithdrawal, WaveResource } from "./types";

// ─── Input Payloads ──────────────────────────────────────────────────────────

/** Payload for submitting a new WAVE application */
export interface WaveApplicationPayload {
    userId: string;
    userEmail: string;
    applicationData: Omit<WaveApplication,
        | "id"
        | "status"
        | "createdAt"
        | "updatedAt"
        | "submittedAt"
        | "reviewedAt"
        | "reviewedBy"
    >;
}

/** Payload for requesting a WAVE earnings withdrawal */
export interface WaveWithdrawalPayload {
    userId: string;
    amount: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
    bvn?: string;
}

/** Payload for reviewing a WAVE application */
export interface WaveApplicationReviewPayload {
    applicationId: string;
    decision: "approved" | "rejected";
    reviewNotes?: string;
    reviewedBy: string;
}

// ─── Return Types ────────────────────────────────────────────────────────────

/** Result of an enrollment attempt */
export interface WaveEnrollmentResult {
    enrolled: boolean;
    memberId?: string;
    message?: string;
}

/** Eligibility check result */
export interface WaveEligibilityResult {
    eligible: boolean;
    reason?: string;
    blockers?: string[];
}

/** Payout processing result */
export interface WavePayoutResult {
    success: boolean;
    transferCode?: string;
    requiresManualPayout?: boolean;
    error?: string;
}

// ─── Service Contract ────────────────────────────────────────────────────────

/**
 * WaveServiceContract
 *
 * The complete interface contract for the WAVE domain service.
 * Implementations: src/app/actions/wave.ts, wave-admin.ts, wave-member.ts
 * Future: This interface will be the constructor contract for a WaveService class.
 */
export interface WaveServiceContract {
    // Member-facing operations
    checkEligibility(userId: string): Promise<WaveEligibilityResult>;
    submitApplication(payload: WaveApplicationPayload): Promise<{ applicationId: string }>;
    enrollMember(userId: string): Promise<WaveEnrollmentResult>;
    getApplicationStatus(userId: string): Promise<{ status: WaveApplication["status"]; submittedAt?: Date } | null>;
    requestWithdrawal(payload: WaveWithdrawalPayload): Promise<{ withdrawalId: string }>;
    getResources(filter?: { category?: string }): Promise<WaveResource[]>;

    // Admin operations
    getApplications(options?: { status?: string; cursor?: string; limit?: number }): Promise<{
        applications: WaveApplication[];
        nextCursor?: string;
        total: number;
    }>;
    reviewApplication(payload: WaveApplicationReviewPayload): Promise<void>;
    processWithdrawal(withdrawalId: string, adminId: string): Promise<WavePayoutResult>;
    getWithdrawals(options?: { status?: string; cursor?: string }): Promise<{
        withdrawals: WaveWithdrawal[];
        nextCursor?: string;
    }>;
}
