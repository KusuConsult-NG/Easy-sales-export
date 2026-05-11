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

        return NextResponse.json(result);
    } catch (error) {
        logger.error('Error in verify-business route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBusinessHandler);
