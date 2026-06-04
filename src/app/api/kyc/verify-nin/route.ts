export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';
import { qoreIdService } from '@/lib/qoreid';

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

        const shouldBypass = process.env.NEXT_PUBLIC_BYPASS_KYC_VERIFICATION === 'true';

        const result = shouldBypass
            ? { success: true as const, isMatch: true, error: null }
            : await qoreIdService.verifyNIN(nin, firstName, lastName);

        if (!result.success) { 
            return NextResponse.json({ error: result.error || 'NIN verification failed' }, { status: 400 });
        }

        if (!result.isMatch) { 
            return NextResponse.json({ error: 'NIN name mismatch' }, { status: 400 });
        }

        logger.info('[KYC] NIN verification successful', { userId: session.user.id });
        return NextResponse.json({ success: true, isMatch: true });
    } catch (error) {
        logger.error('Error in verify-nin route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyNINHandler);
