/**
 * Submit Withdrawal Request
 * Creates a withdrawal request that requires admin approval
 */
'use server';

import { auth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { db } from '@/lib/firebase-admin';
import { COLLECTIONS } from '@/lib/types/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { createAdminAuditLog } from '@/lib/audit-log-admin';
import { revalidatePath } from 'next/cache';

interface WithdrawalRequestData {
    amount: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
    reason?: string;
}

interface ActionState {
    success: boolean;
    error?: string | null;
    message?: string;
}

export async function submitWithdrawalRequestAction(
    data: WithdrawalRequestData
): Promise<ActionState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: 'Authentication required', success: false };
        }

        const userId = session.user.id;
        const userEmail = session.user.email || "";

        // Validate Input with Zod
        // We omit cooperativeId because this action infers it from the user's membership record
        const { withdrawalSchema } = await import("@/lib/schemas");
        const submissionSchema = withdrawalSchema.omit({ cooperativeId: true });

        const validation = submissionSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || "Invalid withdrawal data",
            };
        }

        const validatedData = validation.data;

        // Transactional execution for Financial Integrity
        await db.runTransaction(async (transaction) => {
            const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const membershipDoc = await transaction.get(membershipRef);

            if (!membershipDoc.exists) {
                throw new Error('You are not a member of any cooperative');
            }

            const membership = membershipDoc.data()!;
            const availableBalance = membership.savingsBalance || 0;

            // Validate balance
            if (validatedData.amount > availableBalance) {
                throw new Error(`Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`);
            }

            // 1. Decrement Savings Balance (Lock funds)
            transaction.update(membershipRef, {
                savingsBalance: FieldValue.increment(-validatedData.amount),
                lockedBalance: FieldValue.increment(validatedData.amount), // Track locked funds
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Create withdrawal request
            const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc();
            transaction.set(withdrawalRef, {
                userId,
                userEmail,
                userName: session.user.name || userEmail,
                cooperativeId: membership.cooperativeId, // Link to coop
                amount: validatedData.amount,
                bankName: validatedData.bankName,
                accountNumber: validatedData.accountNumber,
                accountName: validatedData.accountName,
                reason: validatedData.reason || 'Personal withdrawal',
                status: 'pending',
                requestedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // Create audit log (After successful transaction)
        await createAdminAuditLog({
            action: 'payment_initiated',
            userId,
            userEmail,
            targetId: `W-${Date.now()}`,
            targetType: 'withdrawal',
            metadata: {
                amount: validatedData.amount,
                bankName: validatedData.bankName,
                accountNumber: validatedData.accountNumber,
            },
            details: `Withdrawal request of ₦${validatedData.amount.toLocaleString()} submitted`,
        });

        // Send confirmation email
        try {
            const { sendWithdrawalConfirmationEmail } = await import('@/lib/email-notifications');
            if (sendWithdrawalConfirmationEmail) {
                await sendWithdrawalConfirmationEmail(
                    userEmail,
                    session.user.name || userEmail,
                    validatedData.amount,
                    "PENDING"
                );
            }
        } catch (emailError) {
            logger.error('Failed to send confirmation email:', emailError);
        }

        revalidatePath('/dashboard/wallet');
        revalidatePath('/cooperatives/loans');

        return {
            error: null,
            success: true,
            message: `Withdrawal request for ₦${validatedData.amount.toLocaleString()} submitted successfully`,
        };
    } catch (error: any) {
        logger.error('Withdrawal request error:', error);
        return {
            error: error.message || 'Failed to submit withdrawal request',
            success: false,
        };
    }
}
