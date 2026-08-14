export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { qoreIdService } from '@/lib/qoreid';
import { logger } from "@/lib/logger";
import { withRateLimit } from "@/lib/rate-limit";

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

        // --- STRICT PRODUCTION CHECK: Fail if QoreID credentials missing ---
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.error('CRITICAL: QoreID credentials missing. Failing business verification securely.');
            return NextResponse.json({ error: 'Verification service currently unavailable.' }, { status: 503 });
        }
        // --- END STRICT CHECK ---

        let result;

        if (type === 'cac') {
            result = await qoreIdService.verifyCAC(number, companyName);
        } else if (type === 'tin') {
            result = await qoreIdService.verifyTIN(number);
        } else {
            return NextResponse.json({ error: 'Invalid business verification type' }, { status: 400 });
        }

        // THE UPSTREAM RECORD IS NOT PART OF THE ANSWER.
        //
        // This returned `result` whole, and verifyCAC and verifyTIN both end:
        //
        //     return { success: true, isMatch: ..., details: result.data };
        //
        // where `details` is QoreID's raw payload for whatever RC number or TIN
        // the caller typed. So any signed-in account could POST an arbitrary
        // number and read back the record it resolves to — a third party's
        // business, not their own. Nothing in this codebase establishes that the
        // caller has anything to do with the company they are asking about,
        // because nothing calls this route at all: it is referenced only by
        // comments in verify-bvn/verify-nin and by kyc-route-bypass.test.ts,
        // which cite it as the evidence that the QoreID integration is real.
        //
        // A verification endpoint owes its caller a verdict, and that is what it
        // returns now. The failure shape is unchanged — qoreIdFetch's error
        // paths carry a message string and never a payload.
        //
        // Kept rather than deleted, on the strength of what #184 established:
        // this route calling verifyCAC and verifyTIN is the standing evidence
        // that BVN and NIN are *deliberately* bypassed while the rest of KYC is
        // wired for real. Deleting it would take that argument with it.
        //
        // If a screen ever needs a resolved company name to show the user, add
        // that one named field. Do not restore `details` — the reason this was
        // exposed is that a whole payload is easier to forward than to read.
        if (!result.success) {
            return NextResponse.json(result);
        }

        return NextResponse.json({ success: true, isMatch: result.isMatch });
    } catch (error) {
        logger.error('Error in verify-business route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBusinessHandler);
