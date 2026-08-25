"use server";

import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { ActionResponse } from '@/lib/safe-action';
import { paystackBaseUrl } from "@/lib/paystack-host";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const bankVerifyLimiter = rateLimit(rateLimitConfig.bankVerification);

/** Last four digits only — a full NUBAN in an application log is a leak. */
function maskAccount(accountNumber: string): string {
    return `******${String(accountNumber).slice(-4)}`;
}

/**
 * Paystack Integration Server Actions
 * Handles bank verification and related Paystack API calls
 */

interface Bank { id: number;
    name: string;
    code: string;
    slug: string; }

interface BankListResponse { status: boolean;
    message: string;
    data: Bank[]; }

interface VerifyAccountResponse { status: boolean;
    message: string;
    data?: {
        account_number: string;
        account_name: string;
        bank_id: number;
    };
}

export type BankVerificationResult = ActionResponse<{ accountName: string }>;

/**
 * Fetch list of Nigerian banks supported by Paystack
 */
export async function getBankList(): Promise<ActionResponse<any>> { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) { logger.error('PAYSTACK_SECRET_KEY not configured');
            return { success: false, error: 'Payment service not configured', data: null };
        }

        const response = await fetch(`${paystackBaseUrl()}/bank?country=nigeria`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json' } });

        if (!response.ok) {
            throw new Error(`Paystack API error: ${response.status}`);
        }

        const data: BankListResponse = await response.json();

        if (!data.status || !data.data) { return { success: false, error: 'Failed to fetch bank list', data: null };
        }

        return { success: true, error: null, data: { banks: data.data } };
    } catch (error) { logger.error('getBankList error:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to fetch banks', data: null };
    }
}

/**
 * Verify a Nigerian bank account using Paystack's Resolve Account Number API
 * @param accountNumber - The 10-digit NUBAN account number
 * @param bankCode - The bank's unique code (from getBankList)
 */
export async function verifyBankAccount(
    accountNumber: string,
    bankCode: string
): Promise<BankVerificationResult> { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        // THE ORACLE HAD NO METER (#243).
        //
        // This resolves ANY 10-digit account number to its holder's real name
        // through the platform's Paystack key, and nothing limited how often a
        // signed-in caller could ask. Ownership cannot be checked before
        // resolving — verifying your own account is the feature — so the rate
        // limit is the control. Keyed on the account, not the IP, for the
        // reason rate-limits.config.ts records: Nigerian carriers NAT heavily.
        const sessionUserId = sessionResult.session?.user?.id;
        if (sessionUserId) {
            const rl = await bankVerifyLimiter.check(sessionUserId);
            if (!rl.success) {
                return { success: false, error: 'Too many account verification attempts. Please try again later.', data: null };
            }
        }

        // Validation
        if (!accountNumber || !bankCode) { logger.warn('verifyBankAccount: Missing required parameters', { accountNumber: !!accountNumber, bankCode: !!bankCode });
            return { success: false, error: 'Account number and bank code are required', data: null };
        }

        // Validate account number format
        if (!/^\d{10}$/.test(accountNumber)) { logger.warn('verifyBankAccount: Invalid account number format');
            return { success: false, error: 'Account number must be exactly 10 digits', data: null };
        }

        // Validate bank code format (Paystack bank codes are typically 3-6 digits)
        if (!/^\d{3,6}$/.test(bankCode)) { logger.warn('verifyBankAccount: Invalid bank code format', { bankCode });
            return { success: false, error: 'Invalid bank code. Please select a valid bank from the dropdown.', data: null };
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) { logger.error('PAYSTACK_SECRET_KEY not configured in environment variables');
            return { success: false, error: 'Payment service not configured. Please contact support.', data: null };
        }

        // Call Paystack Resolve Account Number API
        const url = `${paystackBaseUrl()}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

        logger.info('verifyBankAccount: Calling Paystack API', { accountNumber: maskAccount(accountNumber), bankCode });

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json' } });

        const data: VerifyAccountResponse = await response.json();

        logger.info('verifyBankAccount: Paystack response', { status: response.status,
            success: data.status,
            message: data.message
        });

        // Handle API response
        if (!response.ok || !data.status) { // Common error: "Could not resolve account name"
            if (data.message?.toLowerCase().includes('could not resolve')) {
                logger.warn('verifyBankAccount: Account not found', { accountNumber: maskAccount(accountNumber), bankCode });
                return { success: false as const, error: 'Account not found. Please verify your account number and selected bank are correct.', data: null };
            }

            // Invalid bank code error
            if (data.message?.toLowerCase().includes('bank') && data.message?.toLowerCase().includes('invalid')) { logger.warn('verifyBankAccount: Invalid bank code', { bankCode });
                return { success: false as const, error: 'Invalid bank selected. Please choose your bank from the dropdown list.', data: null };
            }

            // API key error
            if (response.status === 401 || response.status === 403) { logger.error('verifyBankAccount: Authentication failed', { status: response.status });
                return { success: false as const, error: 'Payment service authentication error. Please contact support.', data: null };
            }

            // Rate limiting
            if (response.status === 429) { logger.warn('verifyBankAccount: Rate limited');
                return { success: false as const, error: 'Too many verification attempts. Please wait a moment and try again.', data: null };
            }

            logger.error('verifyBankAccount: API error', { status: response.status,
                message: data.message
            });

            return { success: false as const, error: data.message || 'Failed to verify account. Please try again.', data: null };
        }

        if (!data.data?.account_name) { logger.error('verifyBankAccount: No account name in response', { message: data.message });
            return { success: false as const, error: 'Account verification incomplete. Please try again.', data: null };
        }

        // The masked number and NOT the resolved name: the pair is exactly the
        // PII the #151 sweep took out of admin lists, and a log aggregator is a
        // wider audience than any admin screen.
        logger.info('verifyBankAccount: Success', { accountNumber: maskAccount(accountNumber) });

        return { success: true, error: null, data: { accountName: data.data.account_name } };
    } catch (error) { logger.error('verifyBankAccount: Unexpected error', error);

        // Network or timeout errors
        if (error instanceof Error) {
            if (error.message.includes('fetch') || error.message.includes('network')) {
                return { success: false as const, error: 'Network error. Please check your connection and try again.', data: null };
            }

            if (error.message.includes('timeout')) { return { success: false as const, error: 'Request timeout. Please try again.', data: null };
            }
        }

        return { success: false as const, error: 'An unexpected error occurred. Please try again.', data: null };
    }
}
