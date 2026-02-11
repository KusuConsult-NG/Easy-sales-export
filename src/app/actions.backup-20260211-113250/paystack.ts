'use server';

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
            console.error('PAYSTACK_SECRET_KEY not configured');
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
        console.error('getBankList error:', error);
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
            return { success: false, error: 'Account number and bank code are required' };
        }

        if (!/^\d{10}$/.test(accountNumber)) {
            return { success: false, error: 'Account number must be 10 digits' };
        }

        const secretKey = process.env.PAYSTACK_SECRET_KEY;

        if (!secretKey) {
            console.error('PAYSTACK_SECRET_KEY not configured');
            return { success: false, error: 'Payment service not configured' };
        }

        // Call Paystack Resolve Account Number API
        const url = `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
            },
        });

        const data: VerifyAccountResponse = await response.json();

        // Handle API response
        if (!response.ok || !data.status) {
            // Common error: "Could not resolve account name"
            if (data.message?.toLowerCase().includes('could not resolve')) {
                return {
                    success: false,
                    error: 'Could not verify account. Please check account number and bank.'
                };
            }

            return {
                success: false,
                error: data.message || 'Failed to verify account'
            };
        }

        if (!data.data?.account_name) {
            return { success: false, error: 'Account name not found' };
        }

        return {
            success: true,
            accountName: data.data.account_name,
        };
    } catch (error) {
        console.error('verifyBankAccount error:', error);

        // Network or timeout errors
        if (error instanceof Error) {
            if (error.message.includes('fetch')) {
                return { success: false, error: 'Network error. Please try again.' };
            }
        }

        return {
            success: false,
            error: 'Failed to verify account. Please try again.',
        };
    }
}
