import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { idType, idNumber, firstName, lastName } = body;

        if (!idType || !idNumber) {
            return NextResponse.json({ error: 'ID Type and ID Number are required' }, { status: 400 });
        }

        const validIdTypes = ['nin', 'drivers_license', 'international_passport', 'voters_card'];
        if (!validIdTypes.includes(idType)) {
            return NextResponse.json({ error: 'Invalid ID type provided' }, { status: 400 });
        }

        // --- MOCK RESPONSE FOR LOCAL DEVELOPMENT IF NO API KEYS ---
        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.warn('QOREID_CLIENT_ID or KEY not found. Returning MOCK success response for document ID verification.');

            // Allow bypassing mock check with an intentional error string for testing UI error states
            if (idNumber === '00000000000') {
                return NextResponse.json({
                    success: false,
                    isMatch: false,
                    error: "Mock: The ID Number is a known invalid blocklist ID."
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

        switch (idType) {
            case 'nin':
                result = await qoreIdService.verifyNIN(idNumber, firstName, lastName);
                break;
            case 'drivers_license':
                result = await qoreIdService.verifyDrivingLicense(idNumber, firstName, lastName);
                break;
            case 'voters_card':
                result = await qoreIdService.verifyVotersCard(idNumber, firstName, lastName);
                break;
            case 'international_passport':
                result = await qoreIdService.verifyPassport(idNumber, firstName, lastName);
                break;
            default:
                return NextResponse.json({ error: 'Unsupported ID Type' }, { status: 400 });
        }

        return NextResponse.json(result);
    } catch (error) {
        logger.error('Error in verify-id route:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
