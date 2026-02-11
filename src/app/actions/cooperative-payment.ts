/**
 * Initialize Paystack Payment for Cooperative Contribution
 * Creates a payment session and returns authorization URL
 */
'use server';

import { auth } from '@/lib/auth';
import { initializePaystackPayment } from '@/lib/paystack-server';

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

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

        // Initialize payment with Paystack (Paystack generates the reference)
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email!,
            nairaToKobo(amount),
            {
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
        const { doc, getDoc, setDoc, runTransaction, serverTimestamp, FieldValue } = await import('firebase/firestore');
        const { calculateUserTier } = await import('@/lib/cooperative-tiers');
        const { createAuditLog } = await import('@/lib/audit-log');

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = doc(db, 'processedPayments', reference);
        const existingPayment = await getDoc(processedRef);

        if (existingPayment.exists()) {
            return {
                error: 'Payment has already been processed',
                success: false
            };
        }

        // Verify payment with Paystack
        const verification = await verifyPaystackPayment(reference);

        if (verification.data.status !== 'success') {
            return {
                error: `Payment ${verification.data.status}. Please contact support if amount was debited.`,
                success: false
            };
        }

        const amountInNaira = verification.data.amount / 100;
        const userId = verification.data.metadata?.userId;
        const expectedAmount = verification.data.metadata?.amount;

        // User ID verification
        if (userId !== session.user.id) {
            return { error: 'Payment verification failed: User mismatch', success: false };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        if (amountInNaira < 1000 || amountInNaira > 1000000) {
            return { error: 'Invalid payment amount', success: false };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) {
            return { error: 'Payment amount mismatch', success: false };
        }

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        const result = await runTransaction(db, async (transaction) => {
            // Get membership
            const membershipRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId);
            const membershipDoc = await transaction.get(membershipRef);

            if (!membershipDoc.exists) {
                throw new Error('Membership not found');
            }

            const membershipData = membershipDoc.data();
            if (!membershipData) {
                throw new Error('Membership data not found');
            }

            const currentTotal = membershipData.totalContributions || 0;
            const newTotal = currentTotal + amountInNaira;
            const newTier = calculateUserTier(newTotal);

            // Update membership atomically
            transaction.update(membershipRef, {
                totalContributions: newTotal,
                tier: newTier,
                lastContributionAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });

            // Mark payment as processed atomically
            transaction.set(processedRef, {
                processedAt: serverTimestamp(),
                amount: amountInNaira,
                type: 'contribution',
                reference,
            });

            return {
                currentTotal,
                newTotal,
                previousTier: membershipData.tier,
                newTier,
            };
        });

        // Create audit log (outside transaction - not critical)
        await createAuditLog({
            action: 'contribution_made',
            userId,
            userEmail: session.user.email!,
            targetId: reference,
            targetType: 'payment',
            metadata: {
                amount: amountInNaira,
                previousTotal: result.currentTotal,
                newTotal: result.newTotal,
                previousTier: result.previousTier,
                newTier: result.newTier,
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
        // 🔒 SECURITY FIX #2: Sanitized error logging
        console.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyContribution',
            reference,
        });

        return {
            error: 'Payment verification failed. Please contact support with reference: ' + reference,
            success: false,
        };
    }
}
