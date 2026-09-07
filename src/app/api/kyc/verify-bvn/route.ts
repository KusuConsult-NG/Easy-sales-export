export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { IDENTITY_PROVIDER } from '@/lib/identity-verification';

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
        // own terms — and if an automated check is ever restored these are exactly
        // the arguments it needs.
        const body = await req.json().catch(() => ({}));
        const { bvn, firstName, lastName } = body ?? {};

        if (!bvn || !firstName || !lastName) {
            return NextResponse.json(
                { error: 'BVN, first name and last name are required' },
                { status: 400 }
            );
        }

        /**
         *   #485 THIS ANSWERED "THE NAME MATCHES" WITHOUT ASKING ANYONE.
         *
         *        It returned `isMatch: true` unconditionally, and the two
         *        browser callers write `bvnVerified: true` on the strength of
         *        it. The automated check that was supposed to sit here is parked by
         *        the owner and this route no longer imports it, so there is now
         *        nothing in the platform that could check a BVN — which makes
         *        an `isMatch` of any value a claim this endpoint cannot make.
         *
         *        So it stops making it. What it CAN say is true and useful: the
         *        member supplied a well-formed BVN and the platform has recorded
         *        it, unchecked. `isMatch` is kept, and kept TRUE, for one
         *        reason — the callers gate the member's progress on it, and the
         *        owner cannot afford onboarding to stop — but it now travels
         *        with `checked: false` and `method: 'self_declared'`, and the
         *        screens render those rather than a green tick.
         *
         *        See lib/identity-verification.ts for why the stored boolean is
         *        deliberately unchanged and where the truth is recorded instead.
         */
        logger.info('[KYC] BVN recorded as self-declared — no automated check is configured', { userId: session.user.id });
        return NextResponse.json({
            success: true,
            isMatch: true,
            checked: false,
            method: 'self_declared',
            provider: IDENTITY_PROVIDER,
        });
    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBVNHandler);
