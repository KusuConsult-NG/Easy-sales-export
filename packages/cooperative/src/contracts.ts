/**
 * Cooperative Service Contracts
 *
 * @easy-sales/cooperative/contracts
 *
 * Formal domain API contracts for the Cooperative module.
 */

import type { CooperativeStatus, CooperativeTier, LoanStatus } from "./constants";

// ─── Input Payloads ──────────────────────────────────────────────────────────

export interface CooperativeRegistrationPayload {
    userId: string;
    userEmail: string;
    personalInfo: {
        firstName: string;
        lastName: string;
        phone: string;
        stateOfOrigin: string;
        lga: string;
        address: string;
    };
    nextOfKin?: {
        name: string;
        phone: string;
        relationship: string;
    };
    inviteCode?: string;
}

export interface ContributionPayload {
    userId: string;
    amount: number;
    paymentReference: string;
    frequency?: "weekly" | "monthly" | "quarterly";
}

export interface LoanApplicationPayload {
    userId: string;
    amount: number;
    productId: string;
    purpose: string;
    termMonths: number;
    collateral?: string;
}

export interface WithdrawalRequestPayload {
    userId: string;
    amount: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
}

export interface ApplicationReviewPayload {
    memberId: string;
    decision: "approved" | "rejected";
    notes?: string;
    reviewedBy: string;
    tier?: CooperativeTier;
}

// ─── Return Types ────────────────────────────────────────────────────────────

export interface RegistrationResult {
    memberId: string;
    memberNumber: string;
    status: CooperativeStatus;
    requiresPayment: boolean;
    paymentUrl?: string;
}

export interface LoanApprovalResult {
    loanId: string;
    status: LoanStatus;
    disbursedAmount?: number;
    disbursedAt?: Date;
}

export interface WithdrawalResult {
    withdrawalId: string;
    status: "pending" | "processing" | "completed";
    estimatedProcessingTime?: string;
}

// ─── Service Contract ────────────────────────────────────────────────────────

/**
 * CooperativeServiceContract
 *
 * Formal interface for the Cooperative domain service.
 * Implementations: src/app/actions/cooperative/*.ts
 */
export interface CooperativeServiceContract {
    // Member operations
    registerMember(payload: CooperativeRegistrationPayload): Promise<RegistrationResult>;
    checkStatus(userId: string): Promise<{ status: CooperativeStatus | null; tier?: CooperativeTier }>;
    getMembership(userId: string): Promise<any>;
    makeContribution(payload: ContributionPayload): Promise<void>;
    requestWithdrawal(payload: WithdrawalRequestPayload): Promise<WithdrawalResult>;
    getTransactions(userId: string, options?: { cursor?: string; limit?: number }): Promise<{
        transactions: any[];
        nextCursor?: string;
    }>;

    // Loan operations
    applyForLoan(payload: LoanApplicationPayload): Promise<{ applicationId: string }>;
    getLoanApplications(userId: string): Promise<any[]>;
    getRepaymentSchedule(loanId: string): Promise<any>;

    // Savings operations
    createFixedSavings(userId: string, amount: number, termMonths: number): Promise<{ savingsId: string }>;

    // Admin operations
    reviewApplication(payload: ApplicationReviewPayload): Promise<void>;
    getMembers(options?: { status?: string; cursor?: string; limit?: number }): Promise<{
        members: any[];
        nextCursor?: string;
        total: number;
    }>;
    getStats(): Promise<any>;
    approveLoan(loanId: string, adminId: string): Promise<LoanApprovalResult>;
    rejectLoan(loanId: string, adminId: string, reason: string): Promise<void>;
    approveWithdrawal(withdrawalId: string, adminId: string): Promise<void>;
}
