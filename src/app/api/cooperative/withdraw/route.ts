import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, collection } from 'firebase/firestore';

/**
 * Withdrawal Request API
 * Allows members to request withdrawal of their cooperative savings
 */
export async function POST(request: NextRequest) {
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

        // Check membership status
        const membershipRef = doc(db, 'cooperative_members', userId);
        const membershipDoc = await getDoc(membershipRef);

        if (!membershipDoc.exists()) {
            return NextResponse.json(
                { success: false, message: 'You must be a cooperative member to request withdrawal' },
                { status: 403 }
            );
        }

        const membershipData = membershipDoc.data();

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

        // Check for existing pending withdrawal requests
        const { collection: collectionFn, query, where, getDocs } = await import('firebase/firestore');
        const existingWithdrawalsQuery = query(
            collectionFn(db, 'withdrawal_requests'),
            where('userId', '==', userId),
            where('status', '==', 'pending')
        );
        const existingWithdrawalsSnapshot = await getDocs(existingWithdrawalsQuery);

        if (!existingWithdrawalsSnapshot.empty) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'You already have a pending withdrawal request. Please wait for admin approval.'
                },
                { status: 403 }
            );
        }

        // Create withdrawal request
        const withdrawalRef = doc(collection(db, 'withdrawal_requests'));
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
            requestedAt: new Date(),
            createdAt: new Date(),
            currentBalance: totalSavings,
            balanceAfterWithdrawal: totalSavings - amount,
        };

        await setDoc(withdrawalRef, withdrawalData);

        return NextResponse.json({
            success: true,
            message: 'Withdrawal request submitted successfully. Admin will review and approve within 2-3 business days.',
            requestId: withdrawalRef.id,
            data: {
                amount,
                status: 'pending',
                requestedAt: withdrawalData.requestedAt
            }
        });

    } catch (error) {
        console.error('Withdrawal request error:', error);
        return NextResponse.json(
            { success: false, message: 'Internal server error' },
            { status: 500 }
        );
    }
}
