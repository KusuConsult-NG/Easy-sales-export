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

    /**
     * Verifies a Driver's License
     */
    async verifyDrivingLicense(licenseNumber: string, firstName: string, lastName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/drivers-license`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: licenseNumber,
                    firstName: firstName,
                    lastName: lastName
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('QoreID Driver License Verification Error', data);
                return { success: false, error: data.message || 'Failed to verify Driver License' };
            }

            // A successful response where identity matches
            const isMatch = data.status?.state === 'exact_match' || data.summary?.nid_match;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };
        } catch (error) {
            logger.error('Exception during QoreID Driver License verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }

    /**
     * Verifies a Voter's Card (PVC)
     */
    async verifyVotersCard(votersNumber: string, firstName: string, lastName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/voters-card`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: votersNumber,
                    firstName: firstName,
                    lastName: lastName
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('QoreID Voters Card Verification Error', data);
                return { success: false, error: data.message || 'Failed to verify Voters Card' };
            }

            const isMatch = data.status?.state === 'exact_match' || data.summary?.nid_match;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };
        } catch (error) {
            logger.error('Exception during QoreID Voters Card verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }

    /**
     * Verifies an International Passport
     */
    async verifyPassport(passportNumber: string, firstName: string, lastName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/passport`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: passportNumber,
                    firstName: firstName,
                    lastName: lastName
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('QoreID Passport Verification Error', data);
                return { success: false, error: data.message || 'Failed to verify Passport' };
            }

            const isMatch = data.status?.state === 'exact_match' || data.summary?.nid_match;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };
        } catch (error) {
            logger.error('Exception during QoreID Passport verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }

    /**
     * Verifies a Corporate Affairs Commission (CAC) Business Registration
     */
    async verifyCAC(rcNumber: string, companyName: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/cac-basic`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: rcNumber,
                    companyName: companyName
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('QoreID CAC Verification Error', data);
                return { success: false, error: data.message || 'Failed to verify CAC Registration' };
            }

            // A successful response where identity matches
            const isMatch = data.status?.state === 'exact_match' || data.summary?.nid_match;

            return {
                success: true,
                isMatch: isMatch,
                details: data
            };
        } catch (error) {
            logger.error('Exception during QoreID CAC verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }

    /**
     * Verifies a Tax Identification Number (TIN)
     */
    async verifyTIN(tin: string) {
        try {
            const token = await this.getAuthToken();

            const response = await fetch(`${QOREID_API_URL}/v1/ng/identities/tin`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    idNumber: tin
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                logger.error('QoreID TIN Verification Error', data);
                return { success: false, error: data.message || 'Failed to verify TIN' };
            }

            return {
                success: true,
                isMatch: true, // If it resolves the organization successfully
                details: data
            };
        } catch (error) {
            logger.error('Exception during QoreID TIN verification', error);
            return { success: false, error: 'An unexpected error occurred during verification' };
        }
    }
}

export const qoreIdService = new QoreIdService();
