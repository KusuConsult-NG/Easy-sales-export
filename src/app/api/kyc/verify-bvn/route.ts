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
        const { bvn, firstName, lastName } = body;

        if (!bvn) {
            return NextResponse.json({ error: 'BVN is required' }, { status: 400 });
        }

        if (!firstName || !lastName) {
            return NextResponse.json({ error: 'First name and last name are required for verification matching' }, { status: 400 });
        }

        // Clean BVN (remove non-digits)
        const cleanBvn = bvn.replace(/\D/g, '');

        if (cleanBvn.length !== 11) {
            return NextResponse.json({ error: 'BVN must be exactly 11 digits' }, { status: 400 });
        }

        // Check if QoreID is configured. If not, bypass for local testing if needed, or fail.
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            if (process.env.NODE_ENV !== 'production') {
                logger.warn('Mocking BVN verification because QoreID credentials are not set');
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

        const result = await qoreIdService.verifyBVN(cleanBvn, firstName, lastName);

        if (!result.success) {
            return NextResponse.json({ error: result.error || 'Verification failed' }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            isMatch: result.isMatch,
            details: result.isMatch ? 'Identity verified successfully' : 'Name does not match government records',
            // Do not send back full sensitive payload to client
        });

    } catch (error) {
        logger.error('Error in verify-bvn route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
