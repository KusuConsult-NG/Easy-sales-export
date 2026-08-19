export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { getBaseUrl } from "@/lib/server-utils";

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
                // Math.round, as nairaToKobo in cooperative/_payment.ts does.
                // `amount * 100` on a fractional naira figure produces a
                // non-integer kobo value, which Paystack rejects.
                amount: Math.round(amount * 100),
                channels: ["bank_transfer"],
                // THE MONEY WAS NEVER CREDITED, AND THE MEMBER LANDED ON A 404.
                //
                // Two independent faults, either one fatal.
                //
                // 1. THE WRONG SPELLING OF THE EVENT. The Paystack webhook
                //    resolves `const type = metadata.type || metadata.purpose`
                //    and credits a member's savings on `type === "contribution"`.
                //    This route sent no `type` and a `purpose` of
                //    'cooperative_contribution' — so the fallback handed the
                //    dispatcher a value that matches no branch, and the payment
                //    fell through to the unknown-type path: recorded with a
                //    deliberately non-completed status, logged, and never
                //    fulfilled. The member paid and their savings did not move.
                //
                //    contribution vs cooperative_contribution is the SAME split
                //    an earlier pass fixed in CLAIM_TYPE — "the only claim type
                //    in the codebase with two spellings". It was settled in the
                //    claim layer and left standing here, in the layer that
                //    decides whether the money is credited at all.
                //
                //    `purpose` is kept as well as `type`: it is what this route
                //    has always recorded, and dropping it would change what
                //    existing reconciliation sees.
                //
                // 2. `amount` was absent from the metadata, so
                //    verifyContributionPaymentAction's amount cross-check
                //    (`if (expectedAmount && Math.abs(...) > 1)`) was skipped
                //    for every payment started here — the one guard that catches
                //    a tampered payment page.
                //
                // 3. callback_url pointed at /cooperatives/contribute/callback,
                //    which does not exist. There is no `callback` segment under
                //    that route, only the page itself. Paystack redirected the
                //    member there after they paid and they got a 404.
                //    /cooperatives/verify-payment is the page that verifies a
                //    contribution — it calls verifyContributionPaymentAction —
                //    and it is the default paystack-server.ts already uses.
                metadata: {
                    userId,
                    type: 'contribution',
                    amount,
                    purpose: 'cooperative_contribution',
                    contributionType,
                },
                // The base comes from the request, not from a bare env read.
                //
                // This was `${process.env.NEXT_PUBLIC_APP_URL}/...`. That
                // variable is not in env-validator's required list, so an
                // environment that never set it starts and serves normally —
                // and the string becomes "undefined/cooperatives/verify-payment".
                // Paystack accepts the transaction and sends the member who has
                // just paid to a URL that resolves nowhere, with no page to run
                // verifyContributionPaymentAction. The same read was removed
                // from the academy and export initiators in earlier passes;
                // these two were missed because the fix there was about the
                // callback PATH and this is about the base in front of it.
                callback_url: `${await getBaseUrl()}/cooperatives/verify-payment`,
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
