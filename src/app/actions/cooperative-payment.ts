/**
 * Initialize Paystack Payment for Cooperative Contribution
 * Creates a payment session and returns authorization URL
 */
'use server';

import { auth } from '@/lib/auth';
import { initializePaystackPayment } from '@/lib/paystack-server';
import { nairaToKobo, generatePaymentReference } from '@/lib/paystack';

// Action state type
interface ActionState {
    success: boolean;
    error?: string | null;
    message?: string;
}

export async function initializeContributionPaymentAction(
    amount: number
): Promise<ActionState & { data?: { authorizationUrl: string; reference: string } }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: 'Authentication required', success: false };
        }

        // Validate amount
        if (amount < 1000) {
            return { error: 'Minimum contribution is ₦1,000', success: false };
        }

        if (amount > 1000000) {
            return { error: 'Maximum contribution is ₦1,000,000', success: false };
        }

        // Generate reference
        const reference = generatePaymentReference();

        // Initialize payment with Paystack
        const { authorizationUrl } = await initializePaystackPayment(
            session.user.email!,
            nairaToKobo(amount),
            {
                userId: session.user.id,
                type: 'contribution',
                amount,
                userName: session.user.name || session.user.email,
            }
        );

        return {
            error: null,
            success: true,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        console.error('Payment initialization error:', error);
        return {
            error: error.message || 'Failed to initialize payment',
            success: false
        };
    }
}

/**
 * Verify Paystack Payment and Update Membership
 * Called after user completes payment
 */
export async function verifyContributionPaymentAction(
    reference: string
): Promise<ActionState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: 'Authentication required', success: false };
        }

        // Import here to avoid circular dependency
        const { verifyPaystackPayment } = await import('@/lib/paystack-server');
        const { db } = await import('@/lib/firebase');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const { doc, updateDoc, increment, serverTimestamp, getDoc } = await import('firebase/firestore');
        const { calculateUserTier } = await import('@/lib/cooperative-tiers');
        const { createAuditLog } = await import('@/lib/audit-log');

        // Verify payment with Paystack
        const verification = await verifyPaystackPayment(reference);

        if (verification.data.status !== 'success') {
            return {
                error: `Payment ${verification.data.status}: ${verification.data.gateway_response}`,
                success: false
            };
        }

        const amountInNaira = verification.data.amount / 100;
        const userId = verification.data.metadata?.userId;

        if (userId !== session.user.id) {
            return { error: 'Payment verification failed: User mismatch', success: false };
        }

        // Update membership
        const membershipRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return { error: 'Membership not found', success: false };
        }

        const currentTotal = membershipDoc.data().totalContributions || 0;
        const newTotal = currentTotal + amountInNaira;
        const newTier = calculateUserTier(newTotal);

        await updateDoc(membershipRef, {
            totalContributions: increment(amountInNaira),
            tier: newTier,
            lastContributionAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        // Create audit log
        await createAuditLog({
            action: 'contribution_made',
            userId,
            userEmail: session.user.email!,
            targetId: reference,
            targetType: 'payment',
            metadata: {
                amount: amountInNaira,
                previousTotal: currentTotal,
                newTotal,
                previousTier: membershipDoc.data().tier,
                newTier,
                paymentReference: reference,
            },
            details: `Contribution of ₦${amountInNaira.toLocaleString()} processed successfully`,
        });

        return {
            error: null,
            success: true,
            message: `Payment successful! Your contribution of ₦${amountInNaira.toLocaleString()} has been recorded.`,
        };
    } catch (error: any) {
        console.error('Payment verification error:', error);
        return {
            error: error.message || 'Payment verification failed',
            success: false,
        };
    }
}
