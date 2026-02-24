/**
 * Paystack Transfer Utility
 * Shared reusable module for automated bank payouts via Paystack Transfer API.
 * Used by: Marketplace escrow release, Cooperative withdrawals, Loan disbursement, WAVE withdrawals.
 *
 * IMPORTANT: Paystack Transfers must be enabled on your Paystack dashboard:
 * Dashboard → Settings → Transfers → Enable Transfers
 */

import { logger } from "@/lib/logger";

const PAYSTACK_BASE = "https://api.paystack.co";

function getPaystackSecret(): string {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    return key;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BankAccount {
    accountNumber: string;
    bankCode: string; // Paystack bank code e.g. "058" for GTBank
    accountName?: string;
}

export interface TransferResult {
    success: boolean;
    transferCode?: string;
    reference?: string;
    error?: string;
}

// ─── Step 1: Resolve account number (verify it exists) ───────────────────────

export async function resolveAccountNumber(
    accountNumber: string,
    bankCode: string
): Promise<{ success: boolean; accountName?: string; error?: string }> {
    try {
        const res = await fetch(
            `${PAYSTACK_BASE}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
            {
                headers: {
                    Authorization: `Bearer ${getPaystackSecret()}`,
                    "Content-Type": "application/json",
                },
            }
        );
        const data = await res.json();
        if (!res.ok || !data.status) {
            return { success: false, error: data.message || "Could not resolve account" };
        }
        return { success: true, accountName: data.data.account_name };
    } catch (err: any) {
        logger.error("[PaystackTransfer] resolveAccountNumber error:", err);
        return { success: false, error: err.message };
    }
}

// ─── Step 2: Create a transfer recipient ─────────────────────────────────────

export async function createTransferRecipient(
    name: string,
    accountNumber: string,
    bankCode: string
): Promise<{ success: boolean; recipientCode?: string; error?: string }> {
    try {
        const res = await fetch(`${PAYSTACK_BASE}/transferrecipient`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${getPaystackSecret()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "nuban",
                name,
                account_number: accountNumber,
                bank_code: bankCode,
                currency: "NGN",
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.status) {
            return { success: false, error: data.message || "Failed to create recipient" };
        }
        return { success: true, recipientCode: data.data.recipient_code };
    } catch (err: any) {
        logger.error("[PaystackTransfer] createTransferRecipient error:", err);
        return { success: false, error: err.message };
    }
}

// ─── Step 3: Initiate the transfer ───────────────────────────────────────────

export async function initiateTransfer(
    recipientCode: string,
    amountNaira: number,
    reason: string,
    reference?: string
): Promise<TransferResult> {
    try {
        const ref = reference || `ESE-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

        const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${getPaystackSecret()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "balance",
                amount: Math.round(amountNaira * 100), // Paystack uses kobo
                recipient: recipientCode,
                reason,
                reference: ref,
            }),
        });
        const data = await res.json();

        if (!res.ok || !data.status) {
            logger.error("[PaystackTransfer] Transfer failed:", data);
            return { success: false, error: data.message || "Transfer initiation failed" };
        }

        logger.info(`[PaystackTransfer] Transfer initiated: ${data.data.transfer_code} | ref: ${ref}`);
        return {
            success: true,
            transferCode: data.data.transfer_code,
            reference: ref,
        };
    } catch (err: any) {
        logger.error("[PaystackTransfer] initiateTransfer error:", err);
        return { success: false, error: err.message };
    }
}

// ─── Combined: resolve → create recipient → transfer ─────────────────────────

/**
 * Full payout pipeline: validate account, create recipient, send money.
 * @param account   { accountNumber, bankCode, accountName }
 * @param amountNaira  Amount in Naira (not kobo)
 * @param reason    Description e.g. "Marketplace escrow release - ORD-123"
 */
export async function paystackPayout(
    account: BankAccount,
    amountNaira: number,
    reason: string
): Promise<TransferResult> {
    // 1. Create recipient (Paystack deduplicates, so this is safe to call repeatedly)
    const recipientResult = await createTransferRecipient(
        account.accountName || "Recipient",
        account.accountNumber,
        account.bankCode
    );
    if (!recipientResult.success || !recipientResult.recipientCode) {
        return { success: false, error: recipientResult.error };
    }

    // 2. Initiate transfer
    return initiateTransfer(recipientResult.recipientCode, amountNaira, reason);
}
