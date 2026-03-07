export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';

async function verifyBVNHandler(req: NextRequest) {
    try {
        const session = await auth();
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

        // --- MOCK: return success if QoreID credentials not configured ---
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.warn('QOREID keys not found. Returning MOCK success for BVN verification.');
            return NextResponse.json({ success: true, isMatch: true, mock: true });
        }
        // --- END MOCK ---

        const result = await qoreIdService.verifyBVN(bvn, firstName, lastName);
        return NextResponse.json(result);
    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyBVNHandler);
