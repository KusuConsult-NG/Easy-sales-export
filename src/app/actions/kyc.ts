"use server";

import { auth } from '@/lib/auth';
import { qoreIdService } from '@/lib/qoreid';
import { logger } from '@/lib/logger';

export async function verifyNinAction(nin: string, firstName: string, lastName: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: 'Unauthorized' };
        }

        if (!nin || !firstName || !lastName) {
            return { success: false, error: 'nin, firstName, and lastName are required' };
        }

        if (!/^\d{11}$/.test(nin)) {
            return { success: false, error: 'NIN must be exactly 11 digits' };
        }

        if (!process.env.QOREID_CLIENT_ID || !process.env.QOREID_SECRET_KEY) {
            logger.error('QOREID keys not found. Cannot verify NIN in production.');
            return { success: false, error: 'KYC service is currently unavailable.' };
        }

        const result = await qoreIdService.verifyNIN(nin, firstName, lastName);
        return result;
    } catch (error) {
        logger.error('Error in verifyNinAction:', error);
        return { success: false, error: 'Internal server error' };
    }
}
