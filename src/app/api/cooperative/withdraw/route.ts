export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
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
        const session = await auth();
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
        const membershipDoc = await db.collection('cooperative_members').doc(userId).get();

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

        // Check available balance
        const totalSavings = membershipData.totalContributions || 0;
        const minimumBalance = 5000; // Minimum ₦5,000 must remain

        if (totalSavings - amount < minimumBalance) {
            return NextResponse.json(
                {
                    success: false,
                    message: `Insufficient balance. You must maintain a minimum balance of ₦${minimumBalance.toLocaleString()}. Available for withdrawal: ₦${Math.max(0, totalSavings - minimumBalance).toLocaleString()}`
                },
                { status: 400 }
            );
        }

        // Check for existing pending withdrawal requests (Admin SDK)
        const existingWithdrawalsSnapshot = await db.collection('withdrawal_requests')
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

        // Create withdrawal request (Admin SDK with server timestamps)
        const withdrawalRef = db.collection('withdrawal_requests').doc();
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
            currentBalance: totalSavings,
            balanceAfterWithdrawal: totalSavings - amount,
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
