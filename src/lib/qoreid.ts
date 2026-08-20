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

/**
 * A lookup is a successful identity match when:
 *   - the OVERALL status.status == "id_verified" (not "id_mismatch"), AND
 *   - the inner *_check.status is "exact_match" (not "NO_MATCH").
 *
 * QoreID returns state="complete" even for mismatches — the top-level `state`
 * only means the request finished processing, NOT that the identity matched. So
 * `status.status` and the inner `*_check.status` are what decide.
 *
 * THE TOP-LEVEL STATUS IS AN ALLOWLIST NOW, NOT A DENYLIST.
 *
 * This hard-failed on four spellings — id_mismatch, not_found, failed, error —
 * and let every other value fall through to the checks below. So any status
 * QoreID returns that this list does not happen to name (a partial-match
 * spelling, a new value, a value from a different account plan) reached the
 * positive-check logic and could come back as a verified identity.
 *
 * For an identity check the unknown case has to fail closed. The comment at the
 * top of this function already names the success value — "The OVERALL
 * status.status == 'id_verified'" — so that is what is required.
 *
 * WHAT THIS COSTS, STATED PLAINLY: verification is now stricter, and if QoreID
 * ever returns a top-level status other than "id_verified" for a genuine match,
 * that member is asked to try again. That is the right direction to fail. The
 * other direction marks an unverified identity as verified, and the platform
 * grants module access and pays out on the strength of these flags.
 *
 * The legacy path is untouched: accounts that return no `status.status` at all
 * still fall through to the inner checks and the top-level `state` below.
 */
export function resolveMatch(data: any): boolean {
    const topStatus = normState(data?.status?.status);
    if (topStatus && topStatus !== 'id_verified') {
        return false;
    }

    // Require at least one inner identity check to return exact_match
    const summaryChecks = data?.summary || {};
    const checkStatuses = Object.values(summaryChecks)
        .map((v: any) => normState((v as any)?.status))
        .filter(Boolean);

    // NO_MATCH in any check = not a match
    const anyNoMatch = checkStatuses.some(s => s === 'no_match' || s === 'not_found');
    if (anyNoMatch) return false;

    /**
     * Need at least one positive check.
     *
     * 'complete' is NOT one of them, and used to be. This list and the
     * top-level list twenty lines down disagreed about the same token: the
     * top-level one excludes 'complete' with the note "'complete' alone is NOT
     * sufficient — 'complete' + 'id_mismatch' means failed", and the header of
     * this file says the same thing ("the top-level `state` only means the
     * request finished processing, NOT that the identity matched"). The inner
     * list accepted it anyway. One of the two had to be wrong; the two comments
     * say which.
     */
    const anyPositive = checkStatuses.some(
        s => s === 'exact_match' || s === 'verified' || s === 'found'
    );

    // Legacy: fall back to top-level state for accounts that don't return inner checks
    const topState = normState(data?.status?.state);
    const topStateOk =
        topState === 'exact_match' ||
        topState === 'verified' ||
        topState === 'found';
    // NOTE: 'complete' alone is NOT sufficient — 'complete' + 'id_mismatch' means failed

    return anyPositive || topStateOk;
}

/**
 * THE IDENTITY NUMBER IS A URL PATH SEGMENT, AND THE URL WAS LOGGED.
 *
 * QoreID takes the number as a path param — /v1/ng/identities/bvn-basic/{bvn} —
 * and this module logged the full URL on every lookup, at info level, together
 * with the request body, which carries the person's first and last name. So
 * every BVN, NIN, driver's licence, passport and voter's-card number submitted
 * to the platform was written to the application log in plaintext beside the
 * name it belongs to.
 *
 * The same numbers are SHA-256 hashed before they are allowed near the
 * database — kyc.ts, marketplace/_mp_seller_verification.ts and the WAVE
 * application all call hashData(bvn) / hashData(nin) precisely so the raw value
 * is never stored. Logging it defeats that completely, and log aggregators
 * retain and replicate far more freely than the users table does.
 *
 * The endpoint is kept, because knowing WHICH lookup failed is the whole
 * diagnostic value of the line. The number is not.
 */
function redactPath(path: string): string {
    return path.replace(/\/v1\/ng\/identities\/([^/]+)\/.*$/, '/v1/ng/identities/$1/[redacted]');
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
            logger.error('QoreID auth failed — check QOREID_CLIENT_ID / QOREID_SECRET_KEY', {
                status: response.status,
                message: err?.message || err?.error || 'Unknown error',
            });
            // The detail stays in the log line above. This message reaches the
            // BROWSER — api/kyc/verify-business returns the failed result whole —
            // and it named the platform's env vars and its hosting provider to
            // anyone who could make a verification fail.
            throw new Error('Verification service is unavailable. Please try again shortly.');
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
        // Never the number, and never the name. See redactPath.
        logger.info(`QoreID fetch: POST ${redactPath(path)}`);

        // 25-second timeout to prevent Railway/serverless function hangs
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25_000);

        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (fetchError: any) {
            clearTimeout(timeoutId);
            // Clear cached token on network errors — it may be stale
            this.accessToken = null;
            this.tokenExpiry = null;
            if (fetchError?.name === 'AbortError') {
                logger.error(`QoreID ${redactPath(path)} timed out after 25s`);
                return { success: false as const, error: 'Verification service timed out. Please try again.' };
            }
            logger.error(`QoreID ${redactPath(path)} network error`, fetchError);
            return { success: false as const, error: 'Could not reach verification service. Please check your connection and try again.' };
        } finally {
            clearTimeout(timeoutId);
        }

        const rawBody = await response.text();
        let data: any = {};
        try { data = JSON.parse(rawBody); } catch { data = { rawText: rawBody }; }

        if (response.status === 429) {
            return { success: false as const, error: 'Verification service is temporarily rate-limited. Please wait a moment and try again.' };
        }
        if (response.status === 401 || response.status === 403) {
            // Token may have been revoked; clear cache so next call re-authenticates
            this.accessToken = null;
            this.tokenExpiry = null;
            // rawBody is QoreID's full response about this person — on the
            // identity endpoints it carries date of birth, address, gender and a
            // photo URL. The status is what tells you the token was rejected.
            logger.error(`QoreID ${redactPath(path)} auth error`, { status: response.status });
            return { success: false as const, error: 'Verification service authentication failed. Please try again.' };
        }

        if (!response.ok) {
            const errMsg = data?.message || data?.error || `Verification failed (HTTP ${response.status})`;
            // The message, not the body — same reason as above.
            logger.error(`QoreID ${redactPath(path)} error`, { status: response.status, message: errMsg });
            return { success: false as const, error: errMsg };
        }

        logger.info(`QoreID ${redactPath(path)} success`, { state: data?.status?.state, status: data?.status?.status });
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

            /**
             * THIS DID THE ONE THING THIS FILE TWICE SAYS NOT TO DO.
             *
             * It was:
             *
             *     const state = normState(result.data?.status?.state);
             *     const isMatch = state === 'complete' || state === 'found'
             *                  || state === 'exact_match';
             *
             * — reading `status.state` and accepting 'complete'. The header of
             * this file says "QoreID returns state='complete' even for
             * mismatches — the top-level `state` only means the request finished
             * processing, NOT that the identity matched", and resolveMatch says
             * "'complete' alone is NOT sufficient — 'complete' + 'id_mismatch'
             * means failed".
             *
             * So a TIN lookup that came back {state: 'complete', status:
             * 'id_mismatch'} was reported as a match. It never read
             * `status.status` at all, which is the field the mismatch is
             * reported in — the one every sibling method checks by going through
             * resolveMatch. This was the only method that did not, and TIN feeds
             * `tinVerified`, which the admin user table renders as a verified
             * badge.
             *
             * On the same resolver as BVN, NIN, passport, licence, voter's card
             * and CAC now. There is nothing about a TIN that needs its own rule.
             */
            return { success: true as const, isMatch: resolveMatch(result.data), details: result.data };
        } catch (error: any) {
            logger.error('QoreID TIN verification exception', error);
            return { success: false as const, error: error?.message || 'An unexpected error occurred during TIN verification' };
        }
    }
}

export const qoreIdService = new QoreIdService();
