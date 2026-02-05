import { z } from 'zod';
import { EscrowStatus } from '@/types/strict';

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
    status: z.nativeEnum(EscrowStatus),
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
