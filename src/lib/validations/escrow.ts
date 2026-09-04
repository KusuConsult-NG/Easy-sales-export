import { z } from 'zod';
import { ESCROW_STATUSES } from '@/lib/escrow-status';

/**
 *   #369 NOTHING IMPORTS THIS FILE, AND ITS STATUS LIST HAD A NINTH VALUE THE
 *        APPLICATION NEVER WRITES.
 *
 *        The enum below was hand-written and read
 *
 *            "pending", "funded", "in_transit", "delivered", "released",
 *            "refunded", "disputed", "cancelled", "completed"
 *
 *        ESCROW_STATUSES in lib/escrow-status.ts — the union the application
 *        actually writes, and the one every releasable/freezable/refundable set
 *        is derived from — has EIGHT values and no "completed". The `completed`
 *        this file admitted belongs to WALLET TRANSACTIONS and ledger rows
 *        (_escrow_lifecycle.ts, _escrow_actions.ts write `status: "completed"`
 *        on those, never on the escrow), so a schema calling itself the escrow
 *        status validator would have accepted a value that makes an escrow
 *        invisible to every one of those sets.
 *
 *        More precisely: escrow-status.ts KNOWS about "completed" and treats it
 *        as a legacy value to coerce — normaliseEscrowStatus maps it to
 *        "released" — because it does occur in stored data. So the live module
 *        converts it and this schema would have stored it as a status in its
 *        own right.
 *
 *        That is the exact drift escrow-status.ts was written to end. Its own
 *        header says so: "Every question about it is answered from one of the
 *        sets here, so two callers cannot drift apart again." A third
 *        vocabulary sitting one directory away is how that promise fails.
 *        DERIVED now, so it cannot.
 *
 *        THE OTHER DISAGREEMENT, LEFT ALONE. escrowReleaseSchema below requires
 *        `deliveryConfirmed === true` before a release. ESCROW_RELEASABLE_FROM
 *        includes "funded" and "in_transit", so the live rule permits release
 *        before delivery is confirmed — which is what the admin release and the
 *        dispute-resolution release both do. Adopting this schema as written
 *        would break both. Recorded rather than changed: which of the two is
 *        the intended policy is a product question, not a refactor.
 *
 *        OWNER DECISION: adopt these schemas at the escrow entry points — and
 *        settle the release rule first — or retire the file.
 */

// Escrow Transaction Creation Schema
export const escrowTransactionSchema = z.object({
    buyerId: z.string().min(1, 'Buyer ID is required'),
    sellerId: z.string().min(1, 'Seller ID is required'),
    productId: z.string().min(1, 'Product ID is required'),
    amount: z.number().min(1, 'Amount must be greater than 0'),
    description: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

export type EscrowTransactionInput = z.infer<typeof escrowTransactionSchema>;

// Escrow Status Update Schema
export const escrowStatusUpdateSchema = z.object({
    transactionId: z.string().min(1),
    // #369. Derived from the live union rather than written out again.
    status: z.enum(ESCROW_STATUSES),
    notes: z.string().optional(),
});

export type EscrowStatusUpdateInput = z.infer<typeof escrowStatusUpdateSchema>;

// Dispute Creation Schema
export const disputeSchema = z.object({
    transactionId: z.string().min(1, 'Transaction ID is required'),
    reason: z.string().min(10, 'Dispute reason must be at least 10 characters'),
    evidence: z.array(z.string().url()).optional(),
    description: z.string().min(20, 'Please provide detailed description'),
});

export type DisputeInput = z.infer<typeof disputeSchema>;

// Escrow Release Schema
export const escrowReleaseSchema = z.object({
    transactionId: z.string().min(1),
    deliveryConfirmed: z.boolean().refine(val => val === true, {
        message: 'Delivery must be confirmed before release',
    }),
    releaseNotes: z.string().optional(),
});

export type EscrowReleaseInput = z.infer<typeof escrowReleaseSchema>;
