/**
 * Submit Withdrawal Request
 * Creates a withdrawal request that requires admin approval
 */
'use server';

import { auth } from '@/lib/auth';
import { requireSession } from "@/lib/session-guard";
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
    error: null, success: true | false;
    error?: string | null;
    message?: string;
}

import { withFlexibleSafeAction } from "@/lib/safe-action";

async function _submitWithdrawalRequestAction(
    data: WithdrawalRequestData
): Promise<ActionState> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        const userId = session.user.id;
        const userEmail = session.user.email || "";

        const { withdrawalSchema } = await import("@/lib/schemas");
        const submissionSchema = withdrawalSchema.omit({ cooperativeId: true });

        const validation = submissionSchema.safeParse(data);

        if (!validation.success) {
            return {
                success: false as const,
                error: validation.error.issues[0]?.message || "Invalid withdrawal data",
            };
        }

        const validatedData = validation.data;

        await db.runTransaction(async (transaction) => {
            const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const membershipDoc = await transaction.get(membershipRef);

            if (!membershipDoc.exists) {
                throw new Error('You are not a member of any cooperative');
            }

            const membership = membershipDoc.data()!;
            const availableBalance = membership.savingsBalance || 0;

            if (validatedData.amount > availableBalance) {
                throw new Error(`Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`);
            }

            transaction.update(membershipRef, {
                savingsBalance: FieldValue.increment(-validatedData.amount),
                lockedBalance: FieldValue.increment(validatedData.amount),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });

            const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
            transaction.set(withdrawalRef, {
                userId,
                userEmail,
                userName: session.user.name || userEmail,
                cooperativeId: membership.cooperativeId || "default",
                amount: validatedData.amount,
                bankName: validatedData.bankName,
                accountNumber: validatedData.accountNumber,
                accountName: validatedData.accountName,
                reason: validatedData.reason || 'Personal withdrawal',
                status: 'pending',
                _version: 0,
                requestedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

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
            success: true as const,
            message: `Withdrawal request for ₦${validatedData.amount.toLocaleString()} submitted successfully`,
        };
    } catch (error: any) {
        logger.error('Withdrawal request error:', {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return {
            error: error.message || 'Failed to submit withdrawal request',
            success: false as const,
        };
    }
}
export const submitWithdrawalRequestAction = withFlexibleSafeAction("submitWithdrawalRequestAction", _submitWithdrawalRequestAction);
