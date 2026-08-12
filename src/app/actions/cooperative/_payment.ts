/**
 * Initialize Paystack Payment for Cooperative Contribution
 * Creates a payment session and returns authorization URL
 */
"use server";

import { auth } from '@/lib/auth';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment } from '@/lib/paystack-server';
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { claimPaymentOnce } from '@/lib/wallet-ledger';
import { FieldValue } from '@/lib/firestore-compat';

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

export type ActionState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null | any; meta?: any; [key: string]: any };

export async function initializeContributionPaymentAction(
    amount: number
): Promise<ActionState & { data?: { authorizationUrl: string; reference: string } }> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
        const { session } = sessionResult;

        if (!session?.user) { return { error: 'Authentication required', success: false as const, data: undefined };
        }

        // Validate amount
        if (amount < 1000) { return { error: 'Minimum contribution is ₦1, 000', success: false as const, data: undefined };
        }

        if (amount > 1000000) { return { error: 'Maximum contribution is ₦1, 000, 000', success: false as const, data: undefined };
        }

        // Initialize payment with Paystack (Paystack generates the reference)
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(amount),
            { type: 'contribution',
                amount,
                userName: session.user.name || session.user.email,
                userId: session.user.id }
        );

        return { error: null, success: true as const, data: {
                authorizationUrl, reference } };
    } catch (error: any) { logger.error('Payment initialization error:', error);
        return { error: error.message || 'Failed to initialize payment', success: false as const, data: undefined };
    }
}

/**
 * Verify Paystack Payment and Update Membership
 * Called after user completes payment
 */
export async function verifyContributionPaymentAction(
    reference: string
): Promise<ActionState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
        const { session } = sessionResult;

        if (!session?.user) { return { error: 'Authentication required', success: false as const, data: undefined };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) { return { success: false as const, error: "Too many payment verification attempts. Please try again later.", data: undefined };
        }

        // Import here to avoid circular dependency
        const { verifyPaystackPayment } = await import('@/lib/paystack-server');
        const { supabaseDb: db, doc, getDoc, setDoc, runTransaction, serverTimestamp } = await import('@/lib/supabase-db');
        const { COLLECTIONS } = await import('@/lib/types/firestore');
        const { calculateUserTier } = await import('@/lib/cooperative-tiers');
        const { createAdminAuditLog } = await import('@/lib/audit-log');

        // Verify payment with Paystack
        const verification = await verifyPaystackPayment(reference);

        if (verification.data.status !== 'success') {
            return {
                error: `Payment ${verification.data.status}. Please contact support if amount was debited.`,
                success: false as const};
        }

        const amountInNaira = verification.data.amount / 100;
        const userId = verification.data.metadata?.userId;
        const expectedAmount = verification.data.metadata?.amount;

        // User ID verification
        if (userId !== session.user.id) { return { error: 'Payment verification failed: User mismatch', success: false as const, data: undefined };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        if (amountInNaira < 1000 || amountInNaira > 1000000) { return { error: 'Invalid payment amount', success: false as const, data: undefined };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) { return { error: 'Payment amount mismatch', success: false as const, data: undefined };
        }

        // Claim the reference before anything is credited.
        //
        // The guard used to be a read of processedPayments near the top of this
        // function, followed much later by a blind
        // `transaction.set(processedRef, ...)`. That is a check-then-write, and
        // runTransaction on this adapter takes no lock and cannot roll back, so
        // both halves are just ordinary statements. A webhook and a client
        // verification landing on one reference together both saw an absent row
        // and both credited the contribution.
        //
        // claim_payment_once is INSERT ... ON CONFLICT DO NOTHING, so exactly
        // one caller wins. It is the same gate export.ts, export-payment.ts and
        // farm-nation-payment.ts already moved to; this file was the one left
        // behind, with its own hand-rolled version of the same idea.
        // Checked BEFORE the claim, deliberately.
        //
        // Claiming first is the right order for money — it is what stops two
        // callers both crediting — but it means a later failure leaves the
        // reference marked processed and the member uncredited, and a retry then
        // returns "already recorded" without ever adding the contribution.
        //
        // A missing membership is the one failure here that is both plausible
        // and knowable in advance, so it is ruled out while backing out is still
        // free. Anything after the claim is a reconciliation problem, which is
        // the trade every sibling module already makes.
        const preMembership = await getDoc(doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId));
        if (!preMembership.exists) {
            return { error: 'Membership not found', success: false as const, data: undefined };
        }

        const claim = await claimPaymentOnce({
            reference,
            userId,
            amount: amountInNaira,
            type: "cooperative_contribution",
            source: "client_verify",
            metadata: { module: "cooperative" },
        });

        // Losing the claim means someone else already recorded this exact
        // payment. That is success — the money is where it should be.
        if (!claim.claimed) {
            logger.info(`[verifyContributionPaymentAction] Payment ${reference} already processed — returning success.`);
            return { error: null, success: true as const, message: 'Your contribution has been recorded.', data: undefined };
        }

        const membershipRefOuter = doc(db, COLLECTIONS.COOPERATIVE_MEMBERS, userId);

        const result = await runTransaction(db, async (transaction) => { const membershipRef = membershipRefOuter;
            const membershipDoc = await transaction.get(membershipRef);

            if (!membershipDoc.exists) {
                throw new Error('Membership not found');
            }

            const membershipData = membershipDoc.data();
            if (!membershipData) { throw new Error('Membership data not found');
            }

            const currentTotal = membershipData.totalContributions || 0;
            // ✅ FIX: read cooperativeId from membership doc — not a hardcoded constant
            const cooperativeId = membershipData.cooperativeId || "default";

            // Add to the savings balance; do not overwrite it.
            //
            // This read `totalContributions`, added the amount in JavaScript and
            // wrote the result back. Two contributions from the same member
            // processed at once — a webhook and a client verification for two
            // different references, which is the normal shape of this system —
            // both read the same starting figure and both wrote their own total.
            // One member's savings quietly disappeared.
            //
            // The claim above stops one reference being counted twice. It does
            // nothing about two references arriving together, which is what this
            // increment is for.
            transaction.update(membershipRef, { totalContributions: FieldValue.increment(amountInNaira),
                lastContributionAt: serverTimestamp(),
                updatedAt: serverTimestamp() });

            // Unified Ledger write
            transaction.set(doc(db, COLLECTIONS.TRANSACTIONS, reference), { id: reference,
                userId,
                type: "contribution",
                module: "cooperative",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: serverTimestamp(),
                reference,
                description: "Cooperative savings contribution"
            });

            // Cooperative Ledger write — auto-generated id, so go through the
            // collection reference. doc() needs an explicit document id.
            const coopTxRef = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc();
            transaction.set(coopTxRef, { userId,
                cooperativeId,
                type: "contribution",
                amount: amountInNaira,
                date: serverTimestamp(),
                status: "completed",
                description: "Cooperative Contribution",
                reference
            });

            return { currentTotal,
                previousTier: membershipData.tier };
        });

        // Recompute the tier from the stored total, not from an arithmetic
        // guess made before the write.
        //
        // The tier used to be calculated as `currentTotal + amountInNaira` from
        // the same stale snapshot as the balance, so a member whose two
        // contributions raced was placed on the tier for one of them. Reading
        // back what the increment actually produced gives the right answer for
        // whatever total the row ended up holding, and concurrent callers
        // converge because each reads strictly after its own increment.
        //
        // Tier is derived state. Deriving it from the authoritative figure is
        // the whole job.
        const freshMembership = await getDoc(membershipRefOuter);
        const newTotal = freshMembership.data()?.totalContributions ?? (result.currentTotal + amountInNaira);
        const newTier = calculateUserTier(newTotal);

        await membershipRefOuter.update({ tier: newTier, updatedAt: serverTimestamp() });

        // Create audit log (outside transaction - not critical)
        await createAdminAuditLog({ action: 'contribution_made',
            userId,
            userEmail: session.user.email || "",
            targetId: reference,
            targetType: 'payment',
            metadata: {
                amount: amountInNaira,
                previousTotal: result.currentTotal,
                newTotal,
                previousTier: result.previousTier,
                newTier: result.newTier,
                paymentReference: reference },
            details: `Contribution of ₦${amountInNaira.toLocaleString()} processed successfully` });

        return { error: null, success: true as const, message: `Payment successful! Your contribution of ₦${amountInNaira.toLocaleString() } has been recorded.`, data: undefined
        };
    } catch (error: any) { // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyContribution',
            reference });

        return { error: 'Payment verification failed. Please contact support with reference: ' + reference, success: false as const, data: undefined };
    }
}
