export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/rate-limit';

async function verifyNINHandler(req: NextRequest) {
    try {
        const session = await auth();
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

        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.error('QOREID keys not found. Cannot verify NIN in production.');
            return NextResponse.json({ error: 'KYC service is currently unavailable.' }, { status: 503 });
        }

        const result = await qoreIdService.verifyNIN(nin, firstName, lastName);
        return NextResponse.json(result);
    } catch (error) {
        logger.error('Error in verify-nin route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

export const POST = withRateLimit(verifyNINHandler);
