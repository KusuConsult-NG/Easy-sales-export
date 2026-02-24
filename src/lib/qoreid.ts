import { logger } from './logger';

const QOREID_API_URL = process.env.NODE_ENV === 'production'
    ? 'https://api.qoreid.com'
    : 'https://api.sandbox.qoreid.com';

interface QoreIdAuthResponse {
    accessToken: string;
    expiresIn: number;
}

// ─── Response normalisation ──────────────────────────────────────────────────
// QoreID returns state values in UPPERCASE in production ("COMPLETE", "EXACT_MATCH")
// and lowercase in sandbox ("complete", "exact_match"). We normalise to lowercase.
function normState(state?: string): string {
    return (state || '').toLowerCase();
}

// A lookup is considered a successful identity match when:
//  - state is "complete" or "exact_match"
//  - AND (where available) summary.exactMatch is not explicitly false
function resolveMatch(data: any): boolean {
    const state = normState(data?.status?.state);
    const stateOk = state === 'complete' || state === 'exact_match';
    // summary.exactMatch may be undefined (entity found but name not compared) — treat as true
    const nameMatch = data?.summary?.exactMatch !== false;
    return stateOk && nameMatch;
}

// ─── QoreID Service ──────────────────────────────────────────────────────────
class QoreIdService {
    private accessToken: string | null = null;
    private tokenExpiry: number | null = null;

    private async getAuthToken(): Promise<string> {
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const clientId = process.env.QOREID_CLIENT_ID;
        const secretKey = process.env.QOREID_SECRET_KEY;

        if (!clientId || !secretKey) {
            throw new Error('QOREID_CLIENT_ID or QOREID_SECRET_KEY is missing');
        }

        const response = await fetch(`${QOREID_API_URL}/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, secret: secretKey }),
        });

        if (response.status === 429) {
            throw new Error('RATE_LIMIT: QoreID authentication rate-limited. Please retry later.');
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            logger.error('QoreID auth failed', { status: response.status, err });
            throw new Error(`QoreID Authentication failed: ${response.status}`);
        }

        const data = await response.json();
        const token = data.accessToken || data.data?.accessToken;
        const expiresIn = data.expiresIn || data.data?.expiresIn || 3600;

        if (!token) throw new Error('Received empty access token from QoreID');

        this.accessToken = String(token);
        this.tokenExpiry = Date.now() + (expiresIn * 1000) - 300_000; // 5-min safety margin
        return this.accessToken;
    }

    // ── Common fetch helper ─────────────────────────────────────────────────
    private async qoreIdFetch(path: string, body: Record<string, string>) {
        const token = await this.getAuthToken();
        const response = await fetch(`${QOREID_API_URL}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (response.status === 429) {
            return { success: false as const, error: 'RATE_LIMIT: Verification service is temporarily rate-limited. Please wait a moment and try again.' };
        }
        if (response.status === 401 || response.status === 403) {
            // Token may have been revoked; clear cache so next call re-authenticates
            this.accessToken = null;
            this.tokenExpiry = null;
            return { success: false as const, error: 'Verification service authentication failed. Please try again.' };
        }

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const errMsg = data?.message || data?.error || 'Verification failed or service unavailable';
            return { success: false as const, error: errMsg };
        }

        return { success: true as const, data };
    }

    // ── BVN ─────────────────────────────────────────────────────────────────
    async verifyBVN(bvn: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/bvn-basic', {
                idNumber: bvn, firstName, lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID BVN verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during BVN verification' };
        }
    }

    // ── NIN ─────────────────────────────────────────────────────────────────
    async verifyNIN(nin: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/nin', {
                idNumber: nin, firstName, lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID NIN verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during NIN verification' };
        }
    }

    // ── Driver's Licence ────────────────────────────────────────────────────
    async verifyDrivingLicense(licenseNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/drivers-license', {
                idNumber: licenseNumber, firstName, lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID Driver Licence verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during Driver Licence verification' };
        }
    }

    // ── Voter's Card (PVC) ───────────────────────────────────────────────────
    async verifyVotersCard(votersNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/voters-card', {
                idNumber: votersNumber, firstName, lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID Voter Card verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during Voter Card verification' };
        }
    }

    // ── Passport ────────────────────────────────────────────────────────────
    async verifyPassport(passportNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/passport', {
                idNumber: passportNumber, firstName, lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID Passport verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during Passport verification' };
        }
    }

    // ── CAC (Business Registration) ─────────────────────────────────────────
    async verifyCAC(rcNumber: string, companyName: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/cac-basic', {
                idNumber: rcNumber, companyName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error) {
            logger.error('QoreID CAC verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during CAC verification' };
        }
    }

    // ── TIN ─────────────────────────────────────────────────────────────────
    // Previously hardcoded isMatch: true regardless of the API response.
    // Now properly checks whether the TIN resolves a real registered entity.
    // TIN responses don't include a name comparison (no firstName/lastName submitted),
    // so isMatch = true iff the API found a record (state === complete/found).
    async verifyTIN(tin: string) {
        try {
            const result = await this.qoreIdFetch('/v1/ng/identities/tin', {
                idNumber: tin,
            });
            if (!result.success) return result;

            // TIN is "matched" when the API successfully resolved the TIN to a known entity
            const state = normState(result.data?.status?.state);
            const isMatch = state === 'complete' || state === 'found' || state === 'exact_match';

            return { success: true as const, isMatch, details: result.data };
        } catch (error) {
            logger.error('QoreID TIN verification exception', error);
            return { success: false as const, error: 'An unexpected error occurred during TIN verification' };
        }
    }
}

export const qoreIdService = new QoreIdService();
