export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { IDENTITY_PROVIDER } from '@/lib/identity-verification';
import { nationalIdField } from '@/lib/kyc-validators';

async function verifyNINHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // The request body was never read.
        //
        // Both callers send { nin, firstName, lastName } and this returned
        // isMatch: true to any caller, including one that posted nothing at
        // all. Whatever is decided about the bypass below, answering
        // "the name matches" to a request containing no name is wrong on its
        // own terms — and if an automated check is ever restored these are exactly
        // the arguments it needs.
        const body = await req.json().catch(() => ({}));
        const { nin, firstName, lastName } = body ?? {};

        if (!nin || !firstName || !lastName) {
            return NextResponse.json(
                { error: 'NIN, first name and last name are required' },
                { status: 400 }
            );
        }

        /**
         *   #522 THE ROUTE'S OWN COMMENT CLAIMED A PROPERTY IT NEVER CHECKED.
         *
         *   #485 rewrote the answer below to say what this endpoint can honestly
         *   say — "the member supplied a WELL-FORMED NIN and the platform has
         *   recorded it, unchecked". Nothing here checked well-formedness. The
         *   only test was `!nin`, so "1" reached the success branch and came
         *   back as isMatch: true.
         *
         *   The owner's rule is explicit and predates this: an ID must be eleven
         *   digits and must not be 11111111111 or a similar combination. #501
         *   built nationalIdField and isObviouslyFakeId for exactly that and
         *   wired them into five submission paths. This door — the one with a
         *   button labelled Verify on it — was not one of them.
         */
        const idCheck = nationalIdField('NIN').safeParse(String(nin).trim());
        if (!idCheck.success) {
            return NextResponse.json(
                { error: idCheck.error.issues[0]?.message ?? 'Invalid NIN' },
                { status: 400 }
            );
        }

        /**
         *   #485 THIS ANSWERED "THE NAME MATCHES" WITHOUT ASKING ANYONE.
         *
         *        It returned `isMatch: true` unconditionally, and the two
         *        browser callers write `ninVerified: true` on the strength of
         *        it. The automated check that was supposed to sit here is parked by
         *        the owner and this route no longer imports it, so there is now
         *        nothing in the platform that could check a NIN — which makes
         *        an `isMatch` of any value a claim this endpoint cannot make.
         *
         *        So it stops making it. What it CAN say is true and useful: the
         *        member supplied a well-formed NIN and the platform has recorded
         *        it, unchecked. `isMatch` is kept, and kept TRUE, for one
         *        reason — the callers gate the member's progress on it, and the
         *        owner cannot afford onboarding to stop — but it now travels
         *        with `checked: false` and `method: 'self_declared'`, and the
         *        screens render those rather than a green tick.
         *
         *        See lib/identity-verification.ts for why the stored boolean is
         *        deliberately unchanged and where the truth is recorded instead.
         */
        logger.info('[KYC] NIN recorded as self-declared — no automated check is configured', { userId: session.user.id });
        return NextResponse.json({
            success: true,
            isMatch: true,
            checked: false,
            method: 'self_declared',
            provider: IDENTITY_PROVIDER,
        });
    } catch (error) {
        logger.error('Error in verify-nin route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyNINHandler, "kyc-verify-nin");
