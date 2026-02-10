import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/**
 * Contribution Payment API
 * Initializes Paystack payment for cooperative contributions
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - You must be logged in' },
                { status: 401 }
            );
        }

        const userId = session.user.id;
        const { amount, contributionType } = await request.json();

        // Validation
        if (!amount || amount < 1000) {
            return NextResponse.json(
                { error: 'Minimum contribution is ₦1,000' },
                { status: 400 }
            );
        }

        if (!contributionType || !['savings', 'loan_repayment'].includes(contributionType)) {
            return NextResponse.json(
                { error: 'Invalid contribution type. Must be "savings" or "loan_repayment"' },
                { status: 400 }
            );
        }

        // Initialize Paystack payment
        const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!paystackSecretKey) {
            return NextResponse.json(
                { error: 'Payment system not configured' },
                { status: 500 }
            );
        }

        const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${paystackSecretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: session.user.email,
                amount: amount * 100, // Convert to kobo
                metadata: {
                    userId,
                    purpose: 'cooperative_contribution',
                    contributionType,
                },
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/contribute/callback`,
            }),
        });

        if (!paystackResponse.ok) {
            return NextResponse.json(
                { error: 'Failed to initialize payment' },
                { status: 500 }
            );
        }

        const paystackData = await paystackResponse.json();

        if (!paystackData.status || !paystackData.data?.authorization_url) {
            return NextResponse.json(
                { error: 'Failed to generate payment link' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            paymentUrl: paystackData.data.authorization_url,
            reference: paystackData.data.reference,
        });

    } catch (error) {
        console.error('Contribution API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
