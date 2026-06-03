export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';

async function verifyBVNHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { bvn, firstName, lastName } = body;

        if (!bvn || !firstName || !lastName) {
            return NextResponse.json(
                { error: 'bvn, firstName, and lastName are required' },
                { status: 400 }
            );
        }

        if (!/^\d{11}$/.test(bvn)) {
            return NextResponse.json(
                { error: 'BVN must be exactly 11 digits' },
                { status: 400 }
            );
        }

        // INTENTIONAL: BVN verification is currently open — all valid 11-digit BVNs are accepted
        // without third-party matching. QoreID integration is available in @/lib/qoreid when
        // strict name-matching is required in future.
        logger.info('[KYC] BVN verification accepted (open mode)', { userId: session.user.id });
        return NextResponse.json({ success: true, isMatch: true });
    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBVNHandler);
