import { logger } from './logger';

const QOREID_API_URL = process.env.NODE_ENV === 'production'
    ? 'https://api.qoreid.com'
    : 'https://api.sandbox.qoreid.com'; // Using sandbox for dev/test

interface QoreIdAuthResponse {
    accessToken: string;
    expiresIn: number;
}

class QoreIdService {
    private accessToken: string | null = null;
    private tokenExpiry: number | null = null;

    /**
     * Get an access token using Client ID and Secret Key
     */
    private async getAuthToken(): Promise<string> {
        // Return cached token if valid
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken as string;
        }

        const clientId = process.env.QOREID_CLIENT_ID;
        const secretKey = process.env.QOREID_SECRET_KEY;

        if (!clientId || !secretKey) {
            throw new Error('QOREID_CLIENT_ID or QOREID_SECRET_KEY is missing');
        }

        try {
            const response = await fetch(`${QOREID_API_URL}/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    clientId,
                    secret: secretKey,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                logger.error('Failed to authenticate with QoreID', { status: response.status, error: errorData });
                throw new Error(`QoreID Authentication failed: ${response.status}`);
            }

            const data = await response.json();

            // Accommodate structure differences based on QoreID API version
            const token = data.accessToken || data.data?.accessToken;
            const expiresIn = data.expiresIn || data.data?.expiresIn || 3600; // Default 1 hour

            if (!token) {
                throw new Error('Received empty access token from QoreID');
            }

            this.accessToken = String(token);
            // Subtract 5 minutes from expiry for safety margin
            this.tokenExpiry = Date.now() + (expiresIn * 1000) - 300000;

            return this.accessToken;
        } catch (error) {
            logger.error('Error fetching QoreID token', error);
            throw error;
        }
    }

    /**
     * Verify a BVN
     */
    async verifyBVN(bvn: string, firstName: string, lastName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/bvn-basic`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: bvn,
                    firstName: firstName,
                    lastName: lastName
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                logger.error('QoreID BVN Verification Failed', { status: response.status, error: errorData });
                return { success: false, error: 'Verification failed or service unavailable' };
            }

            const data = await response.json();

            // Analyze the response to determine mathematical match
            // Typically QoreID returns status and matching fields
            // Assuming QoreID structure: data.summary.exactMatch or data.status.state === "complete"
            const isMatch = data.status?.state === "complete" || data.summary?.exactMatch;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };

        } catch (error) {
            logger.error('Exception during QoreID BVN verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }

    /**
     * Verify a NIN
     */
    async verifyNIN(nin: string, firstName: string, lastName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/nin`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: nin,
                    firstName: firstName,
                    lastName: lastName
                }),
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                logger.error('QoreID NIN Verification Failed', { status: response.status, error: errorData });
                return { success: false, error: 'Verification failed or service unavailable' };
            }

            const data = await response.json();

            // Check status for completed match
            const isMatch = data.status?.state === "complete" || data.summary?.exactMatch;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };

        } catch (error) {
            logger.error('Exception during QoreID NIN verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }
}

export const qoreIdService = new QoreIdService();
