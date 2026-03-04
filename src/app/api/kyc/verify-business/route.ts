export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from "@/lib/logger";
import { withRateLimit } from "@/lib/rate-limit";

async function verifyBusinessHandler(req: NextRequest) {
    try {
        const session = await auth();

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

        // --- MOCK RESPONSE FOR LOCAL DEVELOPMENT IF NO API KEYS ---
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.warn('QOREID_CLIENT_ID or KEY not found. Returning MOCK success response for business verification.');

            // Allow bypassing mock check with an intentional error string for testing UI error states
            if (number === '0000000') {
                return NextResponse.json({
                    success: false,
                    isMatch: false,
                    error: "Mock: The Business or Tax Number was not found."
                });
            }

            return NextResponse.json({
                success: true,
                isMatch: true,
                mock: true
            });
        }
        // --- END MOCK RESPONSE ---

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
