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
 */
export async function verifyPaystackPayment(
    reference: string
): Promise<PaystackVerifyResponse> {
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
        console.error('Payment verification error:', error);
        throw new Error(`Failed to verify payment: ${error.message}`);
    }
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
    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        if (!secretKey) throw new Error("Payment service not configured");

        const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                amount,
                channels,
                metadata,
                callback_url: callbackUrl || (metadata.callback_url as string) || `${process.env.NEXT_PUBLIC_APP_URL}/cooperatives/verify-payment`,
            }),
        });

        if (!response.ok) {
            throw new Error(`Paystack API error: ${response.statusText}`);
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
        console.error('Payment initialization error:', error);
        throw new Error(`Failed to initialize payment: ${error.message}`);
    }
}
