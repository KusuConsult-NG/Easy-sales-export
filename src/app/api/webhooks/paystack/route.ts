import { NextRequest, NextResponse } from 'next/server';
import { verifyPaystackWebhook, verifyPaystackPayment } from '@/lib/paystack-server'; // Note: verifyPaystackPayment is client/fetch based, still works
import { db } from '@/lib/firebase-admin'; // Use Admin SDK
import { FieldValue } from 'firebase-admin/firestore';
import { COLLECTIONS } from '@/lib/types/firestore';
import { calculateUserTier } from '@/lib/cooperative-tiers';
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { logger } from '@/lib/logger';

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

        // Verify webhook is from Paystack (using timingSafeEqual)
        const isValid = verifyPaystackWebhook(body, signature);

        if (!isValid) {
            logger.warn('Invalid Paystack webhook signature');
            return NextResponse.json(
                { error: 'Invalid signature' },
                { status: 401 }
            );
        }

        // Parse webhook payload
        const event = JSON.parse(body);

        logger.info('Paystack webhook received', {
            event: event.event,
            reference: event.data?.reference,
        });

        // Handle different event types
        switch (event.event) {
            case 'charge.success':
                await handleSuccessfulPayment(event.data);
                break;

            case 'charge.failed':
                logger.warn('Payment failed', { reference: event.data.reference });
                // Could update a pending_payments collection here
                break;

            default:
                logger.debug('Unhandled webhook event', { event: event.event });
        }

        return NextResponse.json({ received: true });
    } catch (error: any) {
        logger.error('Webhook processing error', error);
        return NextResponse.json(
            { error: 'Webhook processing failed' },
            { status: 500 }
        );
    }
}

/**
 * Handle successful payment
 * Routes to appropriate handler based on payment purpose
 */
async function handleSuccessfulPayment(paymentData: any) {
    try {
        const { reference, amount, customer, metadata } = paymentData;

        // Extract metadata
        const userId = metadata?.userId;
        const purpose = metadata?.purpose; // 'cooperative_membership_registration' or 'contribution'

        if (!userId) {
            logger.error('Missing userId in payment metadata', undefined, { reference });
            return;
        }

        // IDEMPOTENCY CHECK:
        // Check if this payment reference has already been processed
        const auditSnapshot = await db.collection('audit_logs')
            .where('targetId', '==', reference)
            .limit(1)
            .get();

        if (!auditSnapshot.empty) {
            logger.warn('Duplicate webhook event detected (Idempotency)', { reference });
            return; // Exit silently as it's already processed
        }

        // Verify payment again (double-check)
        const verification = await verifyPaystackPayment(reference);

        if (verification.data.status !== 'success') {
            logger.error('Payment verification failed', undefined, { reference });
            return;
        }

        const amountInNaira = amount / 100; // Convert kobo to naira

        // Route to appropriate handler based on purpose
        if (purpose === 'cooperative_membership_registration') {
            await handleMembershipRegistrationPayment(userId, amountInNaira, reference, customer, verification);
        } else {
            await handleContributionPayment(userId, amountInNaira, reference, customer, verification);
        }

        logger.info('Payment processed successfully', {
            reference,
            userId,
            amount: amountInNaira,
            purpose,
        });

    } catch (error) {
        logger.error('Error processing successful payment', error instanceof Error ? error : undefined);
        throw error;
    }
}

/**
 * Handle membership registration payment
 * Activates membership upon successful payment
 */
async function handleMembershipRegistrationPayment(
    userId: string,
    amountInNaira: number,
    reference: string,
    customer: any,
    verification: any
) {
    const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

    await db.runTransaction(async (transaction) => {
        const membershipDoc = await transaction.get(membershipRef);

        if (!membershipDoc.exists) {
            throw new Error(`Membership not found for user ${userId}`);
        }

        // Update membership status to active and mark payment as completed
        transaction.update(membershipRef, {
            membershipStatus: 'active',
            paymentStatus: 'completed',
            paymentReference: reference,
            paymentDate: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });

    // Audit Log for membership registration
    await db.collection('audit_logs').add({
        action: 'membership_registration_completed',
        userId,
        userEmail: customer.email,
        targetId: reference,
        targetType: 'membership_payment',
        metadata: {
            amount: amountInNaira,
            paymentReference: reference,
            paymentChannel: verification.data.channel,
        },
        details: `Cooperative membership registration fee of ₦${amountInNaira.toLocaleString()} processed successfully`,
        timestamp: FieldValue.serverTimestamp(),
        performedBy: 'system',
        ipAddress: 'webhook'
    });
}

/**
 * Handle contribution payment
 * Updates user tier based on total contributions
 */
async function handleContributionPayment(
    userId: string,
    amountInNaira: number,
    reference: string,
    customer: any,
    verification: any
) {
    const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

    await db.runTransaction(async (transaction) => {
        const membershipDoc = await transaction.get(membershipRef);

        if (!membershipDoc.exists) {
            throw new Error(`Membership not found for user ${userId}`);
        }

        const currentTotal = membershipDoc.data()?.totalContributions || 0;
        const newTotal = currentTotal + amountInNaira;
        const newTier = calculateUserTier(newTotal);

        transaction.update(membershipRef, {
            totalContributions: FieldValue.increment(amountInNaira),
            tier: newTier,
            lastContributionAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    });

    // Audit Log for contribution
    await db.collection('audit_logs').add({
        action: 'contribution_made',
        userId,
        userEmail: customer.email,
        targetId: reference,
        targetType: 'payment',
        metadata: {
            amount: amountInNaira,
            paymentReference: reference,
            paymentChannel: verification.data.channel,
        },
        details: `Contribution of ₦${amountInNaira.toLocaleString()} processed successfully`,
        timestamp: FieldValue.serverTimestamp(),
        performedBy: 'system',
        ipAddress: 'webhook'
    });
}
