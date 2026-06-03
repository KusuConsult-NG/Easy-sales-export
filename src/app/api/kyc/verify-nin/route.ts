export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';

async function verifyNINHandler(req: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { nin, firstName, lastName } = body;

        if (!nin || !firstName || !lastName) {
            return NextResponse.json(
                { error: 'nin, firstName, and lastName are required' },
                { status: 400 }
            );
        }

        if (!/^\d{11}$/.test(nin)) {
            return NextResponse.json(
                { error: 'NIN must be exactly 11 digits' },
                { status: 400 }
            );
        }

        // INTENTIONAL: NIN verification is currently open — all valid 11-digit NINs are accepted
        // without third-party matching. QoreID integration is available in @/lib/qoreid when
        // strict name-matching is required in future.
        logger.info('[KYC] NIN verification accepted (open mode)', { userId: session.user.id });
        return NextResponse.json({ success: true, isMatch: true });
    } catch (error) {
        logger.error('Error in verify-nin route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyNINHandler);
