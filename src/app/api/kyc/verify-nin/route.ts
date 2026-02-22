import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from '@/lib/logger';

export async function POST(req: Request) {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { nin, firstName, lastName } = body;

        if (!nin) {
            return NextResponse.json({ error: 'NIN is required' }, { status: 400 });
        }

        if (!firstName || !lastName) {
            return NextResponse.json({ error: 'First name and last name are required for verification matching' }, { status: 400 });
        }

        // Clean NIN
        const cleanNin = nin.replace(/\D/g, '');

        if (cleanNin.length !== 11) {
            return NextResponse.json({ error: 'NIN must be exactly 11 digits' }, { status: 400 });
        }

        // Check if QoreID is configured
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            if (process.env.NODE_ENV !== 'production') {
                logger.warn('Mocking NIN verification because QoreID credentials are not set');
                // Mock success for development
                return NextResponse.json({
                    success: true,
                    isMatch: true,
                    message: "MOCK VERIFICATION (No credentials provided)"
                });
            } else {
                return NextResponse.json({ error: 'Verification service is not properly configured' }, { status: 500 });
            }
        }

        const result = await qoreIdService.verifyNIN(cleanNin, firstName, lastName);

        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Verification failed' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            isMatch: result.isMatch,
            details: result.isMatch ? 'Identity verified successfully' : 'Name does not match government records',
        });

    } catch (error) {
        logger.error('Error in verify-nin route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
