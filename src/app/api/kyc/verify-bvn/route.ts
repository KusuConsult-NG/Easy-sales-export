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

        const shouldBypass = process.env.NEXT_PUBLIC_BYPASS_KYC_VERIFICATION === 'true';

        const result = shouldBypass
            ? { success: true as const, isMatch: true, error: null }
            : await qoreIdService.verifyBVN(bvn, firstName, lastName);

        if (!result.success) { 
            return NextResponse.json({ error: result.error || 'BVN verification failed' }, { status: 400 });
        }

        if (!result.isMatch) { 
            return NextResponse.json({ error: 'BVN name mismatch' }, { status: 400 });
        }

        logger.info('[KYC] BVN verification successful', { userId: session.user.id });
        return NextResponse.json({ success: true, isMatch: true });
    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBVNHandler);
