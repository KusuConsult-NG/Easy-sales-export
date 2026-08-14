/**
 * Cooperative loan types as the SERVER ACTIONS use them.
 *
 * Declared inside cooperative/_loans.ts and referred to across it, so splitting
 * that 1,580-line file by domain would have left them in whichever piece kept
 * them.
 *
 * LoanApplication IS NOW DECLARED IN FOUR PLACES
 * ----------------------------------------------
 * This is the worst instance of a pattern these splits keep finding. Before
 * this file, the name already existed in:
 *
 *     src/lib/types/firestore.ts
 *     src/lib/types/prd-interfaces.ts
 *     src/lib/types/cooperative.ts
 *
 * and a fourth shape lived inside _loans.ts, which is the one moved here.
 * Nothing reconciles them; each is imported by whoever imported it.
 *
 * Not merged, for the reason the academy (#205), WAVE (#206) and farm-nation
 * (#207) duplicates were not: deciding which shape is canonical changes what
 * every reader of the other three sees, and that is a piece of work with
 * product questions in it, not a step in moving code. Recorded here so the
 * count is visible — four is the number, and someone should know it.
 *
 * A plain module, not one under src/app/actions, where every file must carry
 * "use server" and a session guard.
 */

import type { FieldValue, Timestamp } from "@/lib/firestore-compat";

export interface LoanApplication {
    id?: string;
    userId: string;
    userEmail: string;
    fullName: string;
    amount: number;
    purpose: string;
    durationMonths: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "repaid" | "partially_approved";
    contributionAmount: number;
    tier: "Member";
    interestRate: number;
    totalRepayment: number;
    monthlyPayment: number;
    documents?: string[];
    guarantorName?: string;
    guarantorPhone?: string;
    guarantorEmail?: string;
    guarantorRelationship?: string;
    guarantorVerified?: boolean;
    guarantorVerifiedAt?: FieldValue | Timestamp;
    guarantorVerifiedBy?: string;
    appliedAt: FieldValue | Timestamp;
    reviewedAt?: FieldValue | Timestamp;
    reviewedBy?: string;
    rejectionReason?: string;
    disbursedAt?: FieldValue | Timestamp;
}


/**
 * Repayment Installment Interface
 */
export interface RepaymentInstallment {
    id?: string;
    loanId: string;
    userId: string;
    installmentNumber: number;
    dueDate: Date | string;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
    paidAt?: FieldValue | Timestamp;
    penaltyAmount?: number;
    daysOverdue?: number;
}
