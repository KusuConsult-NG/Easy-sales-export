import { logger } from './logger';

// QoreID API base URL
// Both production and sandbox use the same base: https://api.qoreid.com
// Sandbox accounts are identified by sandbox credentials (sk_test_ prefix).
const QOREID_API_URL = 'https://api.qoreid.com';

interface QoreIdAuthResponse {
    accessToken: string;
    expiresIn: number;
}

// ─── Response normalisation ──────────────────────────────────────────────────
// QoreID returns state values in UPPERCASE in production ("COMPLETE", "EXACT_MATCH")
// Normalise to lowercase for consistent comparison.
function normState(state?: string): string {
    return (state || '').toLowerCase();
}

// A lookup is considered a successful identity match when:
//  - status.state is "complete" or "exact_match"
//  - AND (where available) summary.exactMatch is not explicitly false
function resolveMatch(data: any): boolean {
    // Check top-level status.state
    const topState = normState(data?.status?.state);
    const stateOk = topState === 'complete' || topState === 'exact_match' || topState === 'verified' || topState === 'found';

    // Check nested nin_check / bvn_check status (inside summary)
    const summaryChecks = data?.summary || {};
    const checkStatuses = Object.values(summaryChecks)
        .map((v: any) => normState(v?.status))
        .filter(Boolean);
    const anyCheckExactMatch = checkStatuses.some(s => s === 'exact_match' || s === 'complete' || s === 'verified' || s === 'found');

    const nameMatch = data?.summary?.exactMatch !== false;
    return (stateOk || anyCheckExactMatch) && nameMatch;
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
            // QoreID auth body: { clientId, secret }
            body: JSON.stringify({ clientId, secret: secretKey }),
        });

        if (response.status === 429) {
            throw new Error('RATE_LIMIT: QoreID authentication rate-limited. Please retry later.');
        }
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            logger.error('QoreID auth failed', { status: response.status, body: JSON.stringify(err) });
            throw new Error(`QoreID Authentication failed (${response.status}): ${err?.message || err?.error || 'Unknown error'}. Check QOREID_CLIENT_ID and QOREID_SECRET_KEY in Vercel env vars.`);
        }

        const data: QoreIdAuthResponse = await response.json();
        const token = data.accessToken || (data as any).data?.accessToken;
        const expiresIn = data.expiresIn || (data as any).data?.expiresIn || 3600;

        if (!token) throw new Error('Received empty access token from QoreID');

        this.accessToken = String(token);
        this.tokenExpiry = Date.now() + (expiresIn * 1000) - 300_000; // 5-min safety margin
        return this.accessToken;
    }

    // ── Common fetch helper ─────────────────────────────────────────────────
    // QoreID endpoints take the ID number as a URL path param.
    // The request body carries optional name fields (firstname, lastname — LOWERCASE).
    private async qoreIdFetch(path: string, body: Record<string, string>) {
        const token = await this.getAuthToken();
        const url = `${QOREID_API_URL}${path}`;
        logger.info(`QoreID fetch: POST ${url}`, { body });

        const response = await fetch(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const rawBody = await response.text();
        let data: any = {};
        try { data = JSON.parse(rawBody); } catch { data = { rawText: rawBody }; }

        if (response.status === 429) {
            return { success: false as const, error: 'RATE_LIMIT: Verification service is temporarily rate-limited. Please wait a moment and try again.' };
        }
        if (response.status === 401 || response.status === 403) {
            // Token may have been revoked; clear cache so next call re-authenticates
            this.accessToken = null;
            this.tokenExpiry = null;
            logger.error(`QoreID ${path} auth error`, { status: response.status, body: rawBody });
            return { success: false as const, error: 'Verification service authentication failed. Please try again.' };
        }

        if (!response.ok) {
            const errMsg = data?.message || data?.error || `Verification failed (HTTP ${response.status})`;
            logger.error(`QoreID ${path} error`, { status: response.status, body: rawBody });
            return { success: false as const, error: errMsg };
        }

        logger.info(`QoreID ${path} success`, { state: data?.status?.state });
        return { success: true as const, data };
    }

    // ── BVN ─────────────────────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/bvn-basic/{bvn}
    // Body: { firstname, lastname }
    async verifyBVN(bvn: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/bvn-basic/${bvn}`, {
                firstname: firstName,
                lastname: lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID BVN verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during BVN verification' };
        }
    }

    // ── NIN ─────────────────────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/nin-premium/{nin}
    // Body: { firstname, lastname }  (lowercase — QoreID spec)
    // Note: /nin-premium/ is the accessible endpoint on this account plan;
    //       /nin/ returns 403 Forbidden.
    async verifyNIN(nin: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/nin-premium/${nin}`, {
                firstname: firstName,
                lastname: lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID NIN verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during NIN verification' };
        }
    }

    // ── Driver's Licence ────────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/drivers-license/{licenseNumber}
    // Body: { firstname, lastname }
    async verifyDrivingLicense(licenseNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/drivers-license/${licenseNumber}`, {
                firstname: firstName,
                lastname: lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID Driver Licence verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during Driver Licence verification' };
        }
    }

    // ── Voter's Card (PVC) ───────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/voters-card/{vin}
    // Body: { firstname, lastname }
    async verifyVotersCard(votersNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/voters-card/${votersNumber}`, {
                firstname: firstName,
                lastname: lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID Voter Card verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during Voter Card verification' };
        }
    }

    // ── Passport ────────────────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/passport/{passportNumber}
    // Body: { firstname, lastname }
    async verifyPassport(passportNumber: string, firstName: string, lastName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/passport/${passportNumber}`, {
                firstname: firstName,
                lastname: lastName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID Passport verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during Passport verification' };
        }
    }

    // ── CAC (Business Registration) ─────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/cac-basic/{rcNumber}
    // Body: { companyName }
    async verifyCAC(rcNumber: string, companyName: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/cac-basic/${rcNumber}`, {
                companyName,
            });
            if (!result.success) return result;
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID CAC verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during CAC verification' };
        }
    }

    // ── TIN ─────────────────────────────────────────────────────────────────
    // Endpoint: POST /v1/ng/identities/tin/{tin}
    // Body: {} (no name fields needed for TIN)
    async verifyTIN(tin: string) {
        try {
            const result = await this.qoreIdFetch(`/v1/ng/identities/tin/${tin}`, {});
            if (!result.success) return result;

            // TIN is "matched" when the API successfully resolved the TIN to a known entity
            const state = normState(result.data?.status?.state);
            const isMatch = state === 'complete' || state === 'found' || state === 'exact_match';

            return { success: true as const, isMatch, details: result.data };
        } catch (error: any) {
            logger.error('QoreID TIN verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during TIN verification' };
        }
    }
}

export const qoreIdService = new QoreIdService();
