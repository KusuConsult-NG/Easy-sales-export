"use server";

import { z } from "zod";
import { db } from "@/lib/firebase";
import { serverTimestamp } from "firebase/firestore";
import {
    escrowTransactionSchema,
    escrowStatusUpdateSchema,
    disputeSchema,
    escrowReleaseSchema
} from "@/lib/validations/escrow";
import { EscrowStatus, AuditActionType } from "@/types/strict";
import { createAuditLog, withAuditLog } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";

/**
 * Create new escrow transaction
 */
export async function createEscrowTransaction(
    data: z.infer<typeof escrowTransactionSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        // Validate with Zod
        const validated = escrowTransactionSchema.parse(data);

        // Create transaction in Firestore
        const transactionRef = await db.collection('escrow_transactions').add({
            ...validated,
            status: EscrowStatus.PENDING,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            createdBy: session.user.id,
            heldAt: null,
            releasedAt: null,
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.ESCROW_CREATE,
            resourceId: transactionRef.id,
            resourceType: 'escrow_transaction',
            metadata: {
                amount: validated.amount,
                buyerId: validated.buyerId,
                sellerId: validated.sellerId,
            },
        });

        return {
            success: true,
            transactionId: transactionRef.id,
            userId: session.user.id,
        };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: error.errors
            };
        }
        return { success: false, error: "Failed to create escrow transaction" };
    }
}

/**
 * Update escrow transaction status
 */
export async function updateEscrowStatus(
    data: z.infer<typeof escrowStatusUpdateSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = escrowStatusUpdateSchema.parse(data);

        const updateData: Record<string, unknown> = {
            status: validated.status,
            updatedAt: serverTimestamp(),
        };

        // Set timestamp based on status
        if (validated.status === EscrowStatus.HELD) {
            updateData.heldAt = serverTimestamp();
        } else if (validated.status === EscrowStatus.RELEASED) {
            updateData.releasedAt = serverTimestamp();
            updateData['metadata.releaseApprovedBy'] = session.user.id;
        } else if (validated.status === EscrowStatus.DISPUTED) {
            updateData.disputedAt = serverTimestamp();
        }

        await db.collection('escrow_transactions')
            .doc(validated.transactionId)
            .update(updateData);

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: validated.status === EscrowStatus.HELD
                ? AuditActionType.ESCROW_HOLD
                : validated.status === EscrowStatus.RELEASED
                    ? AuditActionType.ESCROW_RELEASE
                    : AuditActionType.ESCROW_DISPUTE,
            resourceId: validated.transactionId,
            resourceType: 'escrow_transaction',
            metadata: {
                newStatus: validated.status,
                notes: validated.notes,
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: "Validation error", details: error.errors };
        }
        return { success: false, error: "Failed to update escrow status" };
    }
}

/**
 * Create dispute for escrow transaction
 */
export async function createEscrowDispute(
    data: z.infer<typeof disputeSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = disputeSchema.parse(data);

        // Update transaction to DISPUTED status
        await db.collection('escrow_transactions')
            .doc(validated.transactionId)
            .update({
                status: EscrowStatus.DISPUTED,
                disputeReason: validated.reason,
                disputedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

        // Create dispute record
        await db.collection('disputes').add({
            transactionId: validated.transactionId,
            reason: validated.reason,
            description: validated.description,
            evidence: validated.evidence || [],
            createdBy: session.user.id,
            status: 'open',
            createdAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.ESCROW_DISPUTE,
            resourceId: validated.transactionId,
            resourceType: 'escrow_transaction',
            metadata: { reason: validated.reason },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: "Validation error", details: error.errors };
        }
        return { success: false, error: "Failed to create dispute" };
    }
}

/**
 * Release escrow funds to seller
 */
export async function releaseEscrowFunds(
    data: z.infer<typeof escrowReleaseSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = escrowReleaseSchema.parse(data);

        await db.collection('escrow_transactions')
            .doc(validated.transactionId)
            .update({
                status: EscrowStatus.RELEASED,
                releasedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                'metadata.deliveryConfirmed': true,
                'metadata.releaseApprovedBy': session.user.id,
                'metadata.releaseNotes': validated.releaseNotes,
            });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.ESCROW_RELEASE,
            resourceId: validated.transactionId,
            resourceType: 'escrow_transaction',
            metadata: {
                deliveryConfirmed: true,
                releaseNotes: validated.releaseNotes,
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return { success: false, error: "Validation error", details: error.errors };
        }
        return { success: false, error: "Failed to release escrow funds" };
    }
}

/**
 * Get all escrow transactions for current user
 */
export async function getUserEscrowTransactions() {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", transactions: [] };
    }

    try {
        const snapshot = await db.collection('escrow_transactions')
            .where('buyerId', '==', session.user.id)
            .orderBy('createdAt', 'desc')
            .get();

        const transactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
            heldAt: doc.data().heldAt?.toDate(),
            releasedAt: doc.data().releasedAt?.toDate(),
            disputedAt: doc.data().disputedAt?.toDate(),
        }));

        return { success: true, transactions };
    } catch (error) {
        return { success: false, error: "Failed to fetch transactions", transactions: [] };
    }
}
