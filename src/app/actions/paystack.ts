"use server";

import { logger } from '@/lib/logger';
import { requireSession } from '@/lib/session-guard';
import { ActionResponse } from '@/lib/safe-action';
import { paystackBaseUrl } from "@/lib/paystack-host";
import { resolveBankAccount } from "@/lib/bank-account-resolve";
//   #642 One counter, shared with /api/kyc/verify-bank-account — which asks
//   Paystack for the same answer and carried only the generic 200/minute
//   wrapper. Two instances of one config would be two budgets.
import { bankVerifyLimiter, BANK_VERIFY_RATE_LIMITED } from '@/lib/bank-verify-rate-limit';

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
                return { success: false, error: BANK_VERIFY_RATE_LIMITED, data: null };
            }
        }

        /**
         *   #646 ONE RESOLVER, TWO VOICES.
         *
         *   This wrote its own fetch to /bank/resolve while
         *   lib/bank-account-resolve existed for exactly that call — #346 built
         *   it so callers would stop writing their own, and reached the route
         *   and not this action. Two implementations of one third-party call,
         *   which is how they come to disagree about what a failure means.
         *
         *   The resolution moves; THE WORDING STAYS. The shared module answers
         *   with a machine-readable `code`, and everything below turns that into
         *   the sentence a member can act on — "Account not found. Please verify
         *   your account number and selected bank are correct." is worth more
         *   than Paystack's "Could not resolve account name", and consolidating
         *   by adopting the blunter message would have been a regression wearing
         *   the clothes of a cleanup.
         *
         *   Branching on `code` rather than on the message text is the other
         *   half: this used to test `data.message?.toLowerCase().includes('could
         *   not resolve')`, a branch that breaks silently when a third party
         *   improves its prose.
         */
        const resolution = await resolveBankAccount(accountNumber, bankCode);

        if (!resolution.ok) {
            logger.warn('verifyBankAccount: refused', {
                accountNumber: maskAccount(String(accountNumber)),
                bankCode,
                code: resolution.code,
                status: resolution.status,
            });

            switch (resolution.code) {
                case 'missing_fields':
                    return { success: false as const, error: 'Account number and bank code are required', data: null };
                case 'bad_account_number':
                    return { success: false as const, error: 'Account number must be exactly 10 digits', data: null };
                case 'bad_bank_code':
                    return { success: false as const, error: 'Invalid bank selected. Please choose your bank from the dropdown list.', data: null };
                case 'not_configured':
                    return { success: false as const, error: 'Payment service not configured. Please contact support.', data: null };
                case 'unreachable':
                    return { success: false as const, error: 'Network error. Please check your connection and try again.', data: null };
                case 'unresolvable':
                    return { success: false as const, error: 'Account not found. Please verify your account number and selected bank are correct.', data: null };
                case 'provider_error':
                default: {
                    //   Paystack answered and refused. Its status says which of
                    //   three very different things happened, and the member can
                    //   act on only one of them.
                    if (resolution.status === 401 || resolution.status === 403) {
                        return { success: false as const, error: 'Payment service authentication error. Please contact support.', data: null };
                    }
                    if (resolution.status === 429) {
                        return { success: false as const, error: 'Too many verification attempts. Please wait a moment and try again.', data: null };
                    }
                    //   A 404 from the resolve endpoint IS "no such account",
                    //   which is the commonest refusal a member sees and the one
                    //   they can fix themselves.
                    if (resolution.status === 404 || resolution.status === 422) {
                        return { success: false as const, error: 'Account not found. Please verify your account number and selected bank are correct.', data: null };
                    }
                    return { success: false as const, error: resolution.reason || 'Failed to verify account. Please try again.', data: null };
                }
            }
        }

        // The masked number and NOT the resolved name: the pair is exactly the
        // PII the #151 sweep took out of admin lists, and a log aggregator is a
        // wider audience than any admin screen.
        logger.info('verifyBankAccount: Success', { accountNumber: maskAccount(String(accountNumber)) });

        return { success: true, error: null, data: { accountName: resolution.accountName! } };
    } catch (error) {
        logger.error('verifyBankAccount: Unexpected error', error);
        return { success: false as const, error: 'An unexpected error occurred. Please try again.', data: null };
    }
}

