export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { debitJsonbBalanceWithFloor } from "@/lib/wallet-ledger";
import { rateLimit, getClientIp, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

// Rate limiter for withdrawal requests (very strict for financial security)
const withdrawalLimiter = rateLimit(rateLimitConfig.withdrawal);

/**
 * Withdrawal Request API
 * Allows members to request withdrawal of their cooperative savings
 */
export async function POST(request: NextRequest) {
    // RATE LIMITING - Prevent withdrawal spam/abuse
    const clientIp = getClientIp(request);
    const rateLimitResult = await withdrawalLimiter.check(clientIp);

    if (!rateLimitResult.success) {
        return createRateLimitResponse(rateLimitResult);
    }

    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: 'Unauthorized - You must be logged in' },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const { amount, reason, accountNumber, bankName, accountName } = await request.json();

        // Validation
        if (!amount || amount < 1000) {
            return NextResponse.json(
                { success: false, message: 'Minimum withdrawal amount is ₦1,000' },
                { status: 400 }
            );
        }

        if (!accountNumber || !bankName || !accountName) {
            return NextResponse.json(
                { success: false, message: 'Bank account details are required' },
                { status: 400 }
            );
        }

        // Check membership status (Admin SDK)
        const membershipDoc = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId).get();

        if (!membershipDoc.exists) {
            return NextResponse.json(
                { success: false, message: 'You must be a cooperative member to request withdrawal' },
                { status: 403 }
            );
        }

        const membershipData = membershipDoc.data()!;

        // Check if member is active
        if (membershipData.membershipStatus !== 'active') {
            return NextResponse.json(
                { success: false, message: 'Only active members can request withdrawals' },
                { status: 403 }
            );
        }

        // Eligibility is decided by the debit below, not by any read here.
        //
        // TWO defects used to live at this point in the function, and both are
        // now the primitive's job:
        //
        // 1. It read `totalContributions` — a CUMULATIVE LIFETIME TOTAL,
        //    incremented on every contribution (cooperative/_payment.ts), read
        //    by calculateUserTier, and decremented nowhere in src/. A member who
        //    contributed ₦100,000 and had already withdrawn ₦90,000 still
        //    reported ₦100,000 here and could withdraw against money that was
        //    gone. Not a race: wrong on every call. `savingsBalance` is the
        //    spendable figure.
        //
        // 2. The minimum-balance rule was checked with a plain read, which takes
        //    no lock, so two withdrawals that each leave ₦5,000 behind could
        //    together dip under it. debitJsonbBalance could not close that — it
        //    enforces "not negative" and nothing more.
        //
        // debit_jsonb_balance_with_floor (migration 020) applies the balance
        // check and the floor under the same lock as the deduction, so none of
        // the three can be separated. No advisory read is kept as a fast path:
        // leaving the read half of a check-then-write above the primitive is
        // exactly how these came to be mistaken for guards.
        const MINIMUM_BALANCE = 5000; // Minimum ₦5,000 must remain

        // Check for existing pending withdrawal requests (Admin SDK)
        const existingWithdrawalsSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS)
            .where('userId', '==', userId)
            .where('status', '==', 'pending')
            .get();

        if (!existingWithdrawalsSnapshot.empty) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'You already have a pending withdrawal request. Please wait for admin approval.'
                },
                { status: 403 }
            );
        }

        // Reserve the funds under a row lock, BEFORE the request row exists.
        //
        // This route previously reserved nothing at all. That left it out of
        // step with the admin side of the flow, which assumes the money was
        // moved savingsBalance -> lockedBalance at request time: rejecting does
        // `savingsBalance += amount, lockedBalance -= amount`, and approving
        // does `lockedBalance -= amount` (cooperative/_admin.ts).
        //
        // So a request submitted here and then REJECTED credited savingsBalance
        // by an amount that had never been debited — the member's savings grew
        // by the full withdrawal amount, out of nothing. That is the reason this
        // is a money defect rather than a bookkeeping one.
        const debit = await debitJsonbBalanceWithFloor({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount,
            floor: MINIMUM_BALANCE,
        });

        if (!debit.ok) {
            // below_floor is not insufficient_funds. The member HAS the money;
            // they are not allowed to take all of it, and saying "insufficient
            // funds" to someone with a healthy balance would be false.
            const message =
                debit.reason === "below_floor"
                    ? `You must maintain a minimum balance of ₦${MINIMUM_BALANCE.toLocaleString()}. Available for withdrawal: ₦${Math.max(0, Number(debit.balance) - MINIMUM_BALANCE).toLocaleString()}`
                    : debit.reason === "insufficient_funds"
                        ? `Insufficient balance. Available: ₦${Number(debit.balance).toLocaleString()}`
                        : 'You must be a cooperative member to request withdrawal';

            return NextResponse.json({ success: false, message }, { status: 400 });
        }

        const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
        await memberRef.update({
            lockedBalance: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Create withdrawal request (Admin SDK with server timestamps)
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc();
        const withdrawalData = {
            userId,
            userEmail: session.user.email,
            userName: membershipData.firstName + ' ' + membershipData.lastName,
            amount,
            reason: reason || 'Savings withdrawal',
            bankDetails: {
                accountNumber,
                bankName,
                accountName
            },
            status: 'pending',
            requestedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            // Recorded from the debit's own post-write figure rather than the
            // pre-read, so these agree with what actually happened.
            currentBalance: Number(debit.balance) + amount,
            balanceAfterWithdrawal: Number(debit.balance),
        };

        await withdrawalRef.set(withdrawalData);

        return NextResponse.json({
            success: true,
            message: 'Withdrawal request submitted successfully. Admin will review and approve within 2-3 business days.',
            requestId: withdrawalRef.id,
            data: {
                amount,
                status: 'pending',
                requestedAt: new Date().toISOString(),
            }
        });

    } catch (error) {
        logger.error('Withdrawal request error:', error);
        return NextResponse.json(
            { success: false, message: 'Internal server error' },
            { status: 500 }
        );
    }
}
