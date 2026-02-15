'use server';

import { logger } from '@/lib/logger';

/**
 * Paystack Integration Server Actions
 * Handles bank verification and related Paystack API calls
 */

interface Bank {
    id: number;
    name: string;
    code: string;
    slug: string;
}

interface BankListResponse {
    status: boolean;
    message: string;
    data: Bank[];
}

interface VerifyAccountResponse {
    status: boolean;
    message: string;
    data?: {
        account_number: string;
        account_name: string;
        bank_id: number;
    };
}

export interface BankVerificationResult {
    success: boolean;
    accountName?: string;
    error?: string;
}

/**
 * Fetch list of Nigerian banks supported by Paystack
 */
export async function getBankList(): Promise<{ success: boolean; banks?: Bank[]; error?: string }> {
    try {
        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) {
            logger.error('PAYSTACK_SECRET_KEY not configured');
            return { success: false, error: 'Payment service not configured' };
        }

        const response = await fetch('https://api.paystack.co/bank?country=nigeria', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            throw new Error(`Paystack API error: ${response.status}`);
        }

        const data: BankListResponse = await response.json();

        if (!data.status || !data.data) {
            return { success: false, error: 'Failed to fetch bank list' };
        }

        return {
            success: true,
            banks: data.data,
        };
    } catch (error) {
        logger.error('getBankList error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch banks',
        };
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
): Promise<BankVerificationResult> {
    try {
        // Validation
        if (!accountNumber || !bankCode) {
            logger.warn('verifyBankAccount: Missing required parameters', { accountNumber: !!accountNumber, bankCode: !!bankCode });
            return { success: false, error: 'Account number and bank code are required' };
        }

        // Validate account number format
        if (!/^\d{10}$/.test(accountNumber)) {
            logger.warn('verifyBankAccount: Invalid account number format', { accountNumber });
            return { success: false, error: 'Account number must be exactly 10 digits' };
        }

        // Validate bank code format (Paystack bank codes are typically 3-6 digits)
        if (!/^\d{3,6}$/.test(bankCode)) {
            logger.warn('verifyBankAccount: Invalid bank code format', { bankCode });
            return { success: false, error: 'Invalid bank code. Please select a valid bank from the dropdown.' };
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) {
            logger.error('PAYSTACK_SECRET_KEY not configured in environment variables');
            return { success: false, error: 'Payment service not configured. Please contact support.' };
        }

        // Call Paystack Resolve Account Number API
        const url = `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

        logger.info('verifyBankAccount: Calling Paystack API', { accountNumber, bankCode });

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
        });

        const data: VerifyAccountResponse = await response.json();

        logger.info('verifyBankAccount: Paystack response', {
            status: response.status,
            success: data.status,
            message: data.message
        });

        // Handle API response
        if (!response.ok || !data.status) {
            // Common error: "Could not resolve account name"
            if (data.message?.toLowerCase().includes('could not resolve')) {
                logger.warn('verifyBankAccount: Account not found', { accountNumber, bankCode });
                return {
                    success: false,
                    error: 'Account not found. Please verify your account number and selected bank are correct.'
                };
            }

            // Invalid bank code error
            if (data.message?.toLowerCase().includes('bank') && data.message?.toLowerCase().includes('invalid')) {
                logger.warn('verifyBankAccount: Invalid bank code', { bankCode });
                return {
                    success: false,
                    error: 'Invalid bank selected. Please choose your bank from the dropdown list.'
                };
            }

            // API key error
            if (response.status === 401 || response.status === 403) {
                logger.error('verifyBankAccount: Authentication failed', { status: response.status });
                return {
                    success: false,
                    error: 'Payment service authentication error. Please contact support.'
                };
            }

            // Rate limiting
            if (response.status === 429) {
                logger.warn('verifyBankAccount: Rate limited');
                return {
                    success: false,
                    error: 'Too many verification attempts. Please wait a moment and try again.'
                };
            }

            logger.error('verifyBankAccount: API error', {
                status: response.status,
                message: data.message
            });

            return {
                success: false,
                error: data.message || 'Failed to verify account. Please try again.'
            };
        }

        if (!data.data?.account_name) {
            logger.error('verifyBankAccount: No account name in response', { data });
            return { success: false, error: 'Account verification incomplete. Please try again.' };
        }

        logger.info('verifyBankAccount: Success', {
            accountNumber,
            accountName: data.data.account_name
        });

        return {
            success: true,
            accountName: data.data.account_name,
        };
    } catch (error) {
        logger.error('verifyBankAccount: Unexpected error', error);

        // Network or timeout errors
        if (error instanceof Error) {
            if (error.message.includes('fetch') || error.message.includes('network')) {
                return { success: false, error: 'Network error. Please check your connection and try again.' };
            }

            if (error.message.includes('timeout')) {
                return { success: false, error: 'Request timeout. Please try again.' };
            }
        }

        return {
            success: false,
            error: 'An unexpected error occurred. Please try again.',
        };
    }
}
