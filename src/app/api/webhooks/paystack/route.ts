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
 * Updates cooperative membership and creates audit log
 */
async function handleSuccessfulPayment(paymentData: any) {
    try {
        const { reference, amount, customer, metadata } = paymentData;

        // Extract metadata
        const userId = metadata?.userId;
        // const contributionType = metadata?.type || 'contribution'; // Unused

        if (!userId) {
            logger.error('Missing userId in payment metadata', undefined, { reference });
            return;
        }

        // IDEMPOTENCY CHECK:
        // Check if this payment reference has already been processed
        // We check the audit logs for a 'contribution_made' action with this targetId
        const auditSnapshot = await db.collection('audit_logs')
            .where('targetId', '==', reference)
            .where('action', '==', 'contribution_made')
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

        // Update cooperative membership
        const membershipRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);

        await db.runTransaction(async (transaction) => {
            const membershipDoc = await transaction.get(membershipRef);

            if (!membershipDoc.exists) {
                // Create new membership if doesn't exist? OR fail.
                // For robustness, log and fail, or create basic. 
                // Assuming user exists if they are paying.
                // logger.error('Membership not found for user', undefined, { userId });
                // throw new Error("Membership not found");
                // Actually, let's create it if missing, or update
                // But better to just update.
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

            // Create audit log WITHIN the transaction (or mainly just ensure atomic update of member)
            // But audit log is a new doc, usually separate.
        });

        // Audit Log (Admin SDK)
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
            timestamp: FieldValue.serverTimestamp(), // Admin SDK uses timestamp
            performedBy: 'system',
            ipAddress: 'webhook'
        });

        logger.info('Payment processed successfully', {
            reference,
            userId,
            amount: amountInNaira,
        });

    } catch (error) {
        logger.error('Error processing successful payment', error instanceof Error ? error : undefined);
        throw error;
    }
}
