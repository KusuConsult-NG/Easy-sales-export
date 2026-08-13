export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

// Rate limiter for cooperative contributions (prevent double submissions)
const contributionLimiter = rateLimit(rateLimitConfig.payment);

/**
 * Contribution Payment API
 * Initializes Paystack payment for cooperative contributions
 */
export async function POST(request: NextRequest) {
    // RATE LIMITING - Prevent payment spam/double submissions

    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { error: 'Unauthorized - You must be logged in' },
                { status: 401 }
            );
        }

        // Keyed on the ACCOUNT, not the IP address.
        //
        // This endpoint is authenticated, and rate-limits.config.ts already
        // spells out why an IP key is the wrong unit here: "Nigerian mobile
        // networks share IPs heavily, so a limit tuned as though an IP were a
        // person locks out real users." That note was written for the public
        // contact form and applies with more force to a signed-in one — behind a
        // carrier NAT, a handful of members exhausting this limit blocked
        // everyone else sharing that address.
        //
        // The four payment ACTIONS already key on session.user.id. The API
        // routes doing the same work did not, so one convention was correct and
        // the other was not, for the same operation.
        //
        // The check moves below the session because that is where the user id
        // exists. The trade is that an unauthenticated flood now reaches
        // requireSession() first — which reads a token and returns 401 without
        // touching the database, so it is the cheap path either way, and
        // volumetric protection belongs at the edge rather than here.
        const rateLimitResult = await contributionLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return createRateLimitResponse(rateLimitResult);
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
                channels: ["bank_transfer"],
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
        logger.error('Contribution API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
