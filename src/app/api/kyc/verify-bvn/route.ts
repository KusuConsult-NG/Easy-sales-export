export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { qoreIdService } from '@/lib/qoreid';

async function verifyBVNHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // The request body was never read.
        //
        // Both callers send { bvn, firstName, lastName } and this returned
        // isMatch: true to any caller, including one that posted nothing at
        // all. Whatever is decided about the bypass below, answering
        // "the name matches" to a request containing no name is wrong on its
        // own terms — and when the QoreID call is restored these are exactly
        // the arguments it needs.
        const body = await req.json().catch(() => ({}));
        const { bvn, firstName, lastName } = body ?? {};

        if (!bvn || !firstName || !lastName) {
            return NextResponse.json(
                { error: 'BVN, first name and last name are required' },
                { status: 400 }
            );
        }

        // NOT VERIFIED. Read this before trusting the response.
        //
        // qoreIdService.verifyBVN is implemented — OAuth token, real call,
        // timeout, rate-limit and error handling — and /api/kyc/verify-business
        // calls the same service for CAC and TIN today. This route imports it
        // and does not call it.
        //
        // So the reason recorded in kyc-self-assertion.test.ts — that no QoreID
        // call exists in the repository — is no longer true. The integration is
        // here and these two endpoints skip it. Restoring the check is:
        //
        //     const result = await qoreIdService.verifyBVN(bvn, firstName, lastName);
        //
        // and verify-business shows the shape of failing closed when the
        // credentials are absent (503, "Verification service currently
        // unavailable"). The reason not to flip it in an audit is operational,
        // not technical: if QOREID_* is unset in production, every BVN check
        // starts returning 503 and onboarding stops. That is a deployment
        // decision.
        //
        // `checked: false` is on the response so the answer says what it is.
        logger.info('[KYC] BVN verification bypassed and passed as true', { userId: session.user.id });
        return NextResponse.json({ success: true, isMatch: true, checked: false });
    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBVNHandler);
