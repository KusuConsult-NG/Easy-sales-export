/**
 * Server-side Paystack Utilities
 * For payment verification and webhook processing
 */

import crypto from 'crypto';

/**
 * Convert Naira to Kobo (Paystack expects amounts in kobo)
 */
export const nairaToKobo = (naira: number | string): number => {
    const amount = typeof naira === 'string' ? parseFloat(naira) : naira;
    return Math.round(amount * 100);
};

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

export interface PaystackVerifyResponse {
    status: boolean;
    message: string;
    data: {
        id: number;
        domain: string;
        status: 'success' | 'failed' | 'abandoned';
        reference: string;
        amount: number; // in kobo
        message: string | null;
        gateway_response: string;
        paid_at: string;
        created_at: string;
        channel: string;
        currency: string;
        ip_address: string;
        metadata: Record<string, any>;
        customer: {
            id: number;
            email: string;
            customer_code: string;
        };
        authorization: {
            authorization_code: string;
            bin: string;
            last4: string;
            exp_month: string;
            exp_year: string;
            channel: string;
            card_type: string;
            bank: string;
            country_code: string;
            brand: string;
            reusable: boolean;
        };
    };
}

/**
 * Verify a Paystack payment on the server
 * @param reference - Payment reference from Paystack
 * @returns Verification response with payment details
 *
 * THE TEST MOCK THAT REAL REFERENCES MATCHED
 * ------------------------------------------
 * This function used to begin:
 *
 *     const isTestRef = reference.startsWith('TEST_E2E_REF_') ||
 *                       reference.startsWith('T') ||
 *                       reference.startsWith('E2E_') ||
 *                       reference === 'INVALID_REF' ||
 *                       process.env.NODE_ENV === 'test' ||
 *                       process.env.PLAYWRIGHT_TEST === 'true';
 *
 *     if (isTestRef) { ...return a fabricated successful payment... }
 *
 * `reference.startsWith('T')` is not a test-only shape. Paystack issues
 * references of the form T + fifteen digits, and production records carry them:
 *
 *     T457550806738035   T232223621495674   T750250345181632
 *
 * all three on cooperative membership records, alongside card-checkout
 * references in Paystack's other form (`583fq11y9g`, `9bvszibs1d`, …). Which
 * form a payment gets is Paystack's business and not ours, so no caller can
 * know whether its reference will be verified or fabricated. Every reference in
 * the first form was fabricated. The function returned, without contacting
 * anyone:
 *
 *     status: 'success', amount: 5000000 kobo (₦50,000),
 *     metadata: { userId: <the CALLER'S own session id>, type: 'academy_registration', amount: 50000 }
 *
 * Both halves of that are wrong in opposite directions. A caller who paid
 * ₦10,000 was recorded as having paid ₦50,000. A caller who paid nothing at
 * all got the same answer: invent any string beginning with T, hand it to any
 * of the dozen verify paths — cooperative contribution and registration,
 * academy enrolment, marketplace escrow, farm-nation purchase, export
 * investment — and the platform recorded a successful ₦50,000 payment and
 * fulfilled against it.
 *
 * The userId defeats the checks written to catch exactly this. Callers compare
 * `verification.data.metadata.userId` against the session — a real check
 * against a real Paystack response — but the mock read the session and echoed
 * it back, so the comparison was the caller against themselves. The amount
 * checks fare no better: metadata.amount is 50000 and data.amount is 5000000
 * kobo, so "does the charge match the metadata" agrees with itself.
 *
 * REMOVED RATHER THAN NARROWED, because nothing used it. No Playwright spec
 * sets PLAYWRIGHT_TEST, which appeared exactly once in the repository — in that
 * condition. No e2e spec sends a TEST_E2E_REF_, E2E_ or INVALID_REF reference;
 * the only payment assertion in e2e/ checks the redirect to Paystack's own
 * domain. Every unit test that touches a payment path already does
 * `jest.mock('@/lib/paystack-server')`, which is how the rest of the suite has
 * always stubbed this. So the block cost the verification on every money path
 * and bought nothing, which is the same argument #154 made for deleting
 * ADMIN_OVERRIDE.
 *
 * What remains fails closed: no PAYSTACK_SECRET_KEY throws rather than
 * returning a success, and Paystack's answer is the only source of a success.
 */
export async function verifyPaystackPayment(
    reference: string
): Promise<PaystackVerifyResponse> {
    const maxRetries = 3;
    let delay = 500;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const secretKey = process.env.PAYSTACK_SECRET_KEY;
            if (!secretKey) throw new Error("Payment service not configured");

            const response = await fetch(
                `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(reference)}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${secretKey}`,
                        'Content-Type': 'application/json',
                    },
                    signal: AbortSignal.timeout(5000),
                }
            );

            if (!response.ok) {
                throw new Error(`Paystack API error: ${response.statusText}`);
            }

            const data: PaystackVerifyResponse = await response.json();

            if (!data.status) {
                throw new Error(data.message || 'Payment verification failed');
            }

            return data;
        } catch (error: any) {
            const errMsg = error?.message || String(error);
            const isTransient = errMsg.includes("Premature close") || 
                                errMsg.includes("socket hang up") || 
                                errMsg.includes("ECONNRESET") ||
                                errMsg.includes("Client network socket disconnected") ||
                                errMsg.includes("FetchError") ||
                                errMsg.includes("fetch failed") ||
                                errMsg.includes("Connection closed") ||
                                errMsg.includes("Socket closed") ||
                                errMsg.includes("UNAVAILABLE") ||
                                errMsg.includes("stream terminated") ||
                                errMsg.includes("ERR_STREAM_PREMATURE_CLOSE") ||
                                errMsg.includes("timeout") ||
                                errMsg.includes("exceeded");
            if (isTransient && i < maxRetries - 1) {
                console.warn(`[Paystack Verify Retry] Transient error: ${errMsg}. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // exponential backoff
                continue;
            }
            console.error('Payment verification error:', error);
            throw new Error(`Failed to verify payment: ${error.message}`);
        }
    }
    throw new Error("Failed to verify payment after retries");
}

/**
 * Verify Paystack webhook signature
 * Ensures webhook requests are genuinely from Paystack
 * @param payload - Raw webhook request body (as string)
 * @param signature - X-Paystack-Signature header value
 * @returns True if signature is valid
 */
export function verifyPaystackWebhook(
    payload: string,
    signature: string
): boolean {
    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) {
            console.error('Webhook verification failed: PAYSTACK_SECRET_KEY is not set');
            return false;
        }

        const hash = crypto
            .createHmac('sha512', secretKey)
            .update(payload)
            .digest('hex');

        // Both must be hex strings of equal length for timingSafeEqual
        const signatureBuffer = Buffer.from(signature, 'hex');
        const hashBuffer = Buffer.from(hash, 'hex');

        if (signatureBuffer.length === 0 || signatureBuffer.length !== hashBuffer.length) {
            return false;
        }

        // Prevent timing attacks
        return crypto.timingSafeEqual(signatureBuffer, hashBuffer);
    } catch (error) {
        console.error('Webhook signature verification failed:', error);
        return false;
    }
}

/**
 * The base for the LAST-RESORT callback below, when no caller supplied one.
 *
 * It was `${process.env.NEXT_PUBLIC_APP_URL}`, read bare. Nothing requires that
 * variable — env-validator lists it as recommended — so on a deploy that never
 * set it the default callback became the literal string
 * "undefined/cooperatives/verify-payment", and a payer who reached this
 * fallback was redirected somewhere that does not resolve. This is the shared
 * initializer behind all eight payment modules, so it is the widest of the
 * three places that read it this way.
 *
 * getBaseUrl() prefers the request host and falls back to www rather than the
 * apex, which matters because the apex answers POST with 405. It reads
 * headers(), so it needs a request scope; every caller of
 * initializePaystackPayment is a server action, but a throw here would fail a
 * payment that was otherwise fine, so it degrades to the same www host instead.
 */
async function resolveDefaultBase(): Promise<string> {
    try {
        const { getBaseUrl } = await import("@/lib/server-utils");
        return await getBaseUrl();
    } catch {
        return process.env.NEXT_PUBLIC_APP_URL || "https://www.easysalesexport.com";
    }
}

/**
 * Initialize a Paystack payment (server-side)
 * @param email - Customer email
 * @param amount - Amount in kobo
 * @param metadata - Additional transaction metadata
 * @returns Payment authorization URL and reference
 */
export async function initializePaystackPayment(
    email: string,
    amount: number,
    metadata: Record<string, any> = {},
    callbackUrl?: string,
    channels: string[] = ["card", "bank_transfer", "bank", "ussd"]
): Promise<{
    authorizationUrl: string;
    accessCode: string;
    reference: string;
}> {
    const maxRetries = 3;
    let delay = 500;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const secretKey = process.env.PAYSTACK_SECRET_KEY;
            if (!secretKey) throw new Error("Payment service not configured");

            let finalEmail = email ? email.trim() : "";
            if (!finalEmail || !finalEmail.includes('@')) {
                const identifier = metadata.userId || metadata.phoneNumber || metadata.phone || `user_${Date.now()}`;
                finalEmail = `${identifier}@easysalesexport.com`.replace(/[^a-zA-Z0-9@._+-]/g, '');
            }

            const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${secretKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email: finalEmail,
                    amount,
                    channels,
                    metadata,
                    callback_url: callbackUrl || (metadata.callback_url as string) || `${await resolveDefaultBase()}/cooperatives/verify-payment`,
                }),
                signal: AbortSignal.timeout(5000),
            });

            if (!response.ok) {
                let errorMsg = `Paystack API error: ${response.statusText}`;
                try {
                    const errJson = await response.json();
                    if (errJson?.message) {
                        errorMsg = errJson.message;
                    }
                } catch (_e) {}
                throw new Error(errorMsg);
            }

            const data = await response.json();

            if (!data.status) {
                throw new Error(data.message || 'Payment initialization failed');
            }

            return {
                authorizationUrl: data.data.authorization_url,
                accessCode: data.data.access_code,
                reference: data.data.reference,
            };
        } catch (error: any) {
            const errMsg = error?.message || String(error);
            const isTransient = errMsg.includes("Premature close") || 
                                errMsg.includes("socket hang up") || 
                                errMsg.includes("ECONNRESET") ||
                                errMsg.includes("Client network socket disconnected") ||
                                errMsg.includes("FetchError") ||
                                errMsg.includes("fetch failed") ||
                                errMsg.includes("Connection closed") ||
                                errMsg.includes("Socket closed") ||
                                errMsg.includes("UNAVAILABLE") ||
                                errMsg.includes("stream terminated") ||
                                errMsg.includes("ERR_STREAM_PREMATURE_CLOSE") ||
                                errMsg.includes("timeout") ||
                                errMsg.includes("exceeded");
            if (isTransient && i < maxRetries - 1) {
                console.warn(`[Paystack Initialize Retry] Transient error: ${errMsg}. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2; // exponential backoff
                continue;
            }
            console.error('Payment initialization error:', error);
            throw new Error(`Failed to initialize payment: ${error.message}`);
        }
    }
    throw new Error("Failed to initialize payment after retries");
}
