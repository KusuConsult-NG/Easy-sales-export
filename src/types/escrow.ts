/**
 * Re-export canonical escrow types from the marketplace module.
 * This is the single source of truth — do NOT define EscrowStatus or
 * EscrowTransaction here. Import from this file throughout the app.
 */
export type { EscrowStatus, EscrowTransaction } from "@/lib/types/marketplace";

/**
 * Extended EscrowTransaction shape used by escrow-actions.ts queries.
 * Adds the `participants` array (written at creation time for array-contains queries)
 * and the full lifecycle timestamps as plain Dates (after Timestamp conversion).
 */
export interface EscrowTransactionDoc {
    id: string;
    buyerId: string;
    buyerEmail?: string;
    sellerId: string;
    sellerEmail?: string;
    amount: number;
    productName: string;
    productDescription?: string;
    status: import("@/lib/types/marketplace").EscrowStatus;
    paymentReference?: string;

    // participants array — required for array-contains Firestore queries
    participants: string[];

    // Dispute & Release
    releaseRequestedBy?: string;
    releaseRequestedAt?: Date;
    releasedBy?: string;
    releasedAt?: Date;
    disputeId?: string;
    refundedAt?: Date;
    refundedBy?: string;

    createdAt: Date;
    updatedAt: Date;
    paidAt?: Date;
}
