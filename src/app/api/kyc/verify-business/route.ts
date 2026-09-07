export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { withRateLimit } from "@/lib/rate-limit";
import { IDENTITY_PROVIDER } from "@/lib/identity-verification";

async function verifyBusinessHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;

        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { type, number, companyName } = body;

        if (!type || !number) {
            return NextResponse.json({ error: 'Verification type and number are required' }, { status: 400 });
        }

        if (type === 'cac' && !companyName) {
            return NextResponse.json({ error: 'Company Name is required to verify CAC registration' }, { status: 400 });
        }

        //   #485 THE TYPE IS STILL VALIDATED BEFORE THE REFUSAL BELOW.
        //
        //   The dispatch this replaces ended in an `else` that answered 400 to
        //   an unrecognised type, and folding every request into one 503 would
        //   have told a caller with a typo that the service was down. A
        //   malformed request is still a malformed request whether or not
        //   anything is behind the endpoint.
        if (type !== 'cac' && type !== 'tin') {
            return NextResponse.json({ error: 'Invalid business verification type' }, { status: 400 });
        }

        /**
         *   #485 THE ONLY ROUTE THAT REALLY CALLED THE PROVIDER, AND THE
         *        PROVIDER IS PARKED.
         *
         *        It resolved CAC and TIN numbers against an external register.
         *        The owner has taken that integration out of service, so there
         *        is nothing behind this endpoint to ask — and an endpoint whose
         *        whole job is a verdict must not invent one.
         *
         *        It REFUSES, with the status it already used when credentials
         *        were absent (503), so any caller written against it keeps the
         *        error path it already handles. The route is kept rather than
         *        deleted so the URL answers something explicable instead of a
         *        404, and so restoring the module is a change in one file.
         *
         *        Nothing in the application calls this today — swept, it is
         *        referenced only by tests. So this refusal changes no user
         *        journey; it just stops the endpoint being a live door to a
         *        service that is off.
         */
        logger.warn('[KYC] Business verification requested while no provider is in service', {
            userId: session.user.id,
            type,
        });
        return NextResponse.json(
            {
                success: false,
                error: 'Business verification is not available. An administrator reviews CAC and TIN details manually.',
                checked: false,
                provider: IDENTITY_PROVIDER,
            },
            { status: 503 }
        );
    } catch (error) {
        logger.error('Error in verify-business route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBusinessHandler);
