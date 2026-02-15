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
import { createAuditLog } from '@/lib/audit-log';

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
        const userEmail = session.user.email!;

        // Validate amount
        if (data.amount < 1000) {
            return { error: 'Minimum withdrawal amount is ₦1,000', success: false };
        }

        // Check user's cooperative membership
        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        const membershipDoc = await membershipRef.get();

        if (!membershipDoc.exists) {
            return { error: 'You are not a member of any cooperative', success: false };
        }

        const membership = membershipDoc.data()!;
        const availableBalance = membership.savingsBalance || 0;

        // Validate balance
        if (data.amount > availableBalance) {
            return {
                error: `Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`,
                success: false
            };
        }

        // Create withdrawal request
        const withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc();
        await withdrawalRef.set({
            userId,
            userEmail,
            userName: session.user.name || userEmail,
            amount: data.amount,
            bankName: data.bankName,
            accountNumber: data.accountNumber,
            accountName: data.accountName,
            reason: data.reason || 'Personal withdrawal',
            status: 'pending',
            requestedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create audit log
        await createAuditLog({
            action: 'payment_initiated', // Using existing audit action type
            userId,
            userEmail,
            targetId: withdrawalRef.id,
            targetType: 'withdrawal',
            metadata: {
                amount: data.amount,
                bankName: data.bankName,
                accountNumber: data.accountNumber,
                availableBalance,
            },
            details: `Withdrawal request of ₦${data.amount.toLocaleString()} submitted`,
        });

        // Send confirmation email (dynamically imported to avoid build issues if missing)
        try {
            const { sendWithdrawalConfirmationEmail } = await import('@/lib/email-notifications');
            if (sendWithdrawalConfirmationEmail) {
                await sendWithdrawalConfirmationEmail(
                    userEmail,
                    session.user.name || userEmail,
                    data.amount,
                    withdrawalRef.id
                );
            }
        } catch (emailError) {
            logger.error('Failed to send confirmation email:', emailError);
            // Don't fail the request if email fails
        }


        return {
            error: null,
            success: true,
            message: `Withdrawal request for ₦${data.amount.toLocaleString()} submitted successfully`,
        };
    } catch (error: any) {
        logger.error('Withdrawal request error:', error);
        return {
            error: error.message || 'Failed to submit withdrawal request',
            success: false,
        };
    }
}
