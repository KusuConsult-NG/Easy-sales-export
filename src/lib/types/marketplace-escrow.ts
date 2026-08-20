/**
 * Marketplace escrow types as the SERVER ACTIONS use them.
 *
 * Declared inside marketplace/_escrow.ts and referred to by every action in it,
 * so splitting that 1,167-line file by domain would have left them in whichever
 * piece kept them.
 *
 * packages/marketplace/src/types.ts declares EscrowTransaction and Dispute too.
 * Fifth instance of the pattern these splits keep finding, after academy (#205),
 * WAVE (#206), farm-nation (#207) and cooperative loans (#208, where the count
 * reached four declarations of one name). Not reconciled here for the same
 * reason: choosing a canonical shape changes what every reader of the other
 * sees, and that is a piece of work with product questions in it.
 *
 * A plain module, not one under src/app/actions, where every file must carry
 * "use server" and a session guard.
 */

import type { FieldValue, Timestamp } from "@/lib/firestore-compat";
import type { EscrowStatus } from "@/lib/escrow-status";

/**
 * Marketplace Escrow System
 * Buyer → Escrow → Seller workflow with admin release
 *
 * ON TRANSACTIONS — read before adding a state change here.
 *
 * This file used to say that runTransaction "reads the current state and
 * rejects the write if the precondition is violated — turning a race condition
 * into a clear error". That is what a Firestore transaction does. It is NOT
 * what supabaseDb.runTransaction does: it runs the callback, then replays the
 * queued writes, with no lock and no rollback. A status check inside it is an
 * ordinary read, so two callers can both pass the same check.
 *
 * That belief is why two admins releasing one escrow both credited the seller.
 *
 * The paths that move money now use claimStatusTransition (migration 007),
 * which advances the status only if it still holds the expected value and tells
 * the caller whether it was the one that changed it. Whoever wins the claim is
 * the only one who pays out.
 *
 * Anything added here that moves money, or must happen once per state change,
 * belongs on the same primitive. A check inside runTransaction is not a guard.
 */

export interface EscrowTransaction { id?: string;
    buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    grossAmount?: number;
    productName: string;
    productDescription: string;
    /** participants[] is required so getUserEscrowTransactions' array-contains query resolves correctly */
    participants: string[];
    /**
     * The shared union, not a local one.
     *
     * This listed five of the eight statuses the collection uses — no
     * "in_transit", no "delivered" (which _confirmOrderReceiptAction writes on
     * every receipt confirmation), no "cancelled" — so the type asserted that
     * values this application writes on its main path could not occur.
     *
     * The same defect LandListingStatus had, and it cost the same thing: every
     * caller hand-wrote its own idea of which statuses it would act on, and they
     * disagreed. See lib/escrow-status.ts.
     */
    status: EscrowStatus;
    paymentReference?: string;
    createdAt: FieldValue | Timestamp;
    paidAt?: FieldValue | Timestamp;
    releasedAt?: FieldValue | Timestamp;
    refundedAt?: FieldValue | Timestamp;
    releaseRequestedAt?: FieldValue | Timestamp;
    releaseRequestedBy?: string;
    releasedBy?: string; }


export interface Dispute { id?: string;
    escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    /**
     * The parties, copied from the escrow when the dispute is raised.
     *
     * These are not decoration. Dispute resolution (actions/disputes.ts) reads
     * `sellerId` / `buyerId` off the dispute to decide who gets paid, and throws
     * "Target beneficiary ID not found on dispute" when they are absent.
     *
     * This interface did not declare them and this file did not write them, so
     * every dispute raised from the escrow page was unresolvable. The type that
     * resolution uses — the Dispute in src/types/index.ts — has always declared
     * both. Two types with one name, disagreeing about which fields exist, and
     * the writer happened to use the shorter one.
     */
    buyerId?: string;
    sellerId?: string;
    reason: string;
    evidence: string[];
    status: "open" | "under_review" | "resolved" | "closed";
    resolution?: string;
    resolvedBy?: string;
    resolvedAt?: FieldValue | Timestamp;
    createdAt: FieldValue | Timestamp; }


export interface Message { id?: string;
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
    timestamp: FieldValue | Timestamp;
    read: boolean; }
