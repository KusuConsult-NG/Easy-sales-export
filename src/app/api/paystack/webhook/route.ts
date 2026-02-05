import { NextRequest, NextResponse } from 'next/server';
import { verifyPaystackWebhook, verifyPaystackPayment } from '@/lib/paystack-server';
import { db } from '@/lib/firebase';
import { COLLECTIONS } from '@/lib/types/firestore';
import { doc, updateDoc, increment, serverTimestamp, getDoc } from 'firebase/firestore';
import { calculateUserTier } from '@/lib/cooperative-tiers';
import { createAuditLog } from '@/lib/audit-log';
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

/**
 * Paystack Webhook Handler
 * Processes payment confirmations from Paystack
 * 
 * Webhook Events: charge.success, charge.failed
 */
// Create rate limiter for webhook
const webhookLimiter = rateLimit(rateLimitConfig.webhook);

export async function POST(request: NextRequest) {
    // Rate limiting check
    const clientIp = getClientIp(request);
    const rateLimitResult = await webhookLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        // Get raw body for signature verification
        const body = await request.text();
        const signature = request.headers.get('x-paystack-signature');

        if (!signature) {
            return NextResponse.json(
                { error: 'Missing signature' },
                { status: 401 }
            );
        }

        // Verify webhook is from Paystack
        const isValid = verifyPaystackWebhook(body, signature);

        if (!isValid) {
            console.error('Invalid Paystack webhook signature');
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 401 }
            );
        }

        // Parse webhook payload
        const event = JSON.parse(body);

        console.log('Paystack webhook received:', {
            event: event.event,
            reference: event.data?.reference,
        });

        // Handle different event types
        switch (event.event) {
            case 'charge.success':
                await handleSuccessfulPayment(event.data);
                break;

            case 'charge.failed':
                console.log('Payment failed:', event.data.reference);
                // Could update a pending_payments collection here
                break;

            default:
                console.log('Unhandled webhook event:', event.event);
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        console.error('Webhook processing error:', error);
        return NextResponse.json(
            { error: 'Webhook processing failed' },
            { status: 500 }
        );
    }
}

/**
 * Handle successful payment
 * Updates cooperative membership and creates audit log
 */
async function handleSuccessfulPayment(paymentData: any) {
    try {
        const { reference, amount, customer, metadata } = paymentData;

        // Extract metadata
        const userId = metadata?.userId;
        const contributionType = metadata?.type || 'contribution';

        if (!userId) {
            console.error('Missing userId in payment metadata:', reference);
            return;
        }

        // Verify payment again (double-check)
        const verification = await verifyPaystackPayment(reference);

        if (verification.data.status !== 'success') {
            console.error('Payment verification failed:', reference);
            return;
        }

        const amountInNaira = amount / 100; // Convert kobo to naira

        // Update cooperative membership
        const membershipRef = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            // Create new membership if doesn't exist
            console.error('Membership not found for user:', userId);
            return;
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
            userEmail: customer.email,
            targetId: reference,
            targetType: 'payment',
            metadata: {
                amount: amountInNaira,
                previousTotal: currentTotal,
                newTotal,
                previousTier: membershipDoc.data().tier,
                newTier,
                paymentReference: reference,
                paymentChannel: verification.data.channel,
            },
            details: `Contribution of ₦${amountInNaira.toLocaleString()} processed successfully`,
        });

        console.log('Payment processed successfully:', {
            reference,
            userId,
            amount: amountInNaira,
            newTier,
        });

    } catch (error) {
        console.error('Error processing successful payment:', error);
        throw error;
    }
}
