export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { debitJsonbBalance } from "@/lib/wallet-ledger";
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

        // Check available balance.
        //
        // This read `totalContributions`, which is a CUMULATIVE LIFETIME TOTAL:
        // it is incremented on every contribution (cooperative/_payment.ts) and
        // feeds calculateUserTier, and nothing in src/ ever decrements it. A
        // member who contributed ₦100,000 and has already withdrawn ₦90,000
        // still reported ₦100,000 here and could withdraw against money that was
        // already gone. That was not a race — it was wrong on every call.
        //
        // savingsBalance is the spendable figure, and is what every other
        // withdrawal door debits.
        const savingsBalance = membershipData.savingsBalance || 0;
        const minimumBalance = 5000; // Minimum ₦5,000 must remain

        // The floor is a policy rule and this read is advisory: two withdrawals
        // that each leave ₦5,000 behind can together dip under it. The debit
        // below is what guarantees the balance cannot go negative. Same caveat
        // as platform.ts; closing the floor race needs a debit primitive that
        // takes a floor.
        if (savingsBalance - amount < minimumBalance) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Insufficient balance. You must maintain a minimum balance of ₦${minimumBalance.toLocaleString()}. Available for withdrawal: ₦${Math.max(0, savingsBalance - minimumBalance).toLocaleString()}`
                },
                { status: 400 }
            );
        }

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
        const debit = await debitJsonbBalance({
            table: "cooperative_members",
            id: userId,
            field: "savingsBalance",
            amount,
        });

        if (!debit.ok) {
            return NextResponse.json(
                {
                    success: false,
                    message: debit.reason === "insufficient_funds"
                        ? `Insufficient balance. Available: ₦${Number(debit.balance).toLocaleString()}`
                        : 'You must be a cooperative member to request withdrawal'
                },
                { status: 400 }
            );
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
