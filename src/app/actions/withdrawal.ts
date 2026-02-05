/**
 * Submit Withdrawal Request
 * Creates a withdrawal request that requires admin approval
 */
'use server';

import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/types/firestore';
import { doc, getDoc, setDoc, collection, serverTimestamp } from 'firebase/firestore';
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
        const membershipRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return { error: 'You are not a member of any cooperative', success: false };
        }

        const membership = membershipDoc.data();
        const availableBalance = membership.totalContributions || 0;

        // Validate balance
        if (data.amount > availableBalance) {
            return {
                error: `Insufficient balance. Available: ₦${availableBalance.toLocaleString()}`,
                success: false
            };
        }

        // Create withdrawal request
        const withdrawalRef = doc(collection(db, COLLECTIONS.WITHDRAWALS));
        await setDoc(withdrawalRef, {
            userId,
            userEmail,
            userName: session.user.name || userEmail,
            amount: data.amount,
            bankName: data.bankName,
            accountNumber: data.accountNumber,
            accountName: data.accountName,
            reason: data.reason || 'Personal withdrawal',
            status: 'pending',
            requestedAt: serverTimestamp(),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
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

        // TODO: Send confirmation email once email utility is available

        return {
            error: null,
            success: true,
            message: `Withdrawal request for ₦${data.amount.toLocaleString()} submitted successfully`,
        };
    } catch (error: any) {
        console.error('Withdrawal request error:', error);
        return {
            error: error.message || 'Failed to submit withdrawal request',
            success: false,
        };
    }
}
