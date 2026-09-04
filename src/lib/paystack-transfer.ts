/**
 * Paystack Transfer Utility
 * Shared reusable module for automated bank payouts via Paystack Transfer API.
 * Used by: Marketplace escrow release, Cooperative withdrawals, Loan disbursement, WAVE withdrawals.
 *
 * IMPORTANT: Paystack Transfers must be enabled on your Paystack dashboard:
 * Dashboard → Settings → Transfers → Enable Transfers
 */

import { logger } from "@/lib/logger";
import {
    isResolvedBankAccount,
    UNRESOLVED_ACCOUNT_REFUSAL,
    type MaybeResolvedBankAccount,
} from "@/lib/bank-account-provenance";

const PAYSTACK_BASE = paystackBaseUrl();

function getPaystackSecret(): string {
    const key = process.env.PAYSTACK_SECRET_KEY;
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
    return key;
}

// ─── Types ────────────────────────────────────────────────────────────────────

import { bankAccountSchema } from "./validations/shared";
import { paystackBaseUrl } from "@/lib/paystack-host";

export type BankAccount = import("zod").infer<typeof bankAccountSchema>;

export interface TransferResult {
    success: boolean;
    transferCode?: string;
    reference?: string;
    error?: string;
    /**
     * We do not know whether Paystack accepted this transfer (#250).
     *
     * A connection reset, a timeout or a 5xx means the request may have arrived
     * and been honoured — the money may already be gone. A caller MUST NOT
     * return the record to a state it can be paid from again; park it for
     * reconciliation instead. Only an ordinary 4xx refusal is proof nothing was
     * sent.
     */
    indeterminate?: boolean;
    /**
     * Paystack already holds a transfer with this reference (#249).
     *
     * That is proof the FIRST attempt went through: this is the retry, and the
     * payee has been paid. Treat it as done, not as a failure to retry.
     */
    duplicate?: boolean;
}

/**
 * A payout reference that is the same every time for the same thing.
 *
 *   #249 EVERY PAYOUT WENT OUT WITH A RANDOM REFERENCE.
 *
 *        Paystack's `reference` IS the idempotency key for a transfer: send the
 *        same one twice and the second is refused. initiateTransfer invented
 *        `ESE-${Date.now()}-${Math.random()...}` whenever the caller passed
 *        none, and paystackPayout never passed one — so there was no
 *        idempotency anywhere, and the same withdrawal retried after an
 *        ambiguous failure was a SECOND transfer.
 *
 *        Every caller had a natural key to hand: the wallet transaction id, the
 *        withdrawal id, the loan application id, the order id. None could pass
 *        it, because the parameter was optional and unused.
 *
 * Paystack accepts alphanumerics and -._= in a reference, so anything else in
 * an entity id is replaced rather than dropped — dropping would let "ORD/1" and
 * "ORD1" collapse onto one reference and silently block the second payout.
 */
export function payoutReference(prefix: string, entityId: string): string {
    const safe = String(entityId).replace(/[^A-Za-z0-9\-._=]/g, "-");
    return `${prefix}-${safe}`;
}

/** Is this Paystack telling us the reference has already been used? */
function isDuplicateReference(message: string): boolean {
    return /reference/i.test(message) && /(unique|duplicate|already|exist)/i.test(message);
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

/**
 * @param reference REQUIRED, and the same value on every retry of the same
 *                  payout — see payoutReference and #249. It used to be
 *                  optional, with a random fallback, which meant no payout on
 *                  this platform was idempotent.
 */
export async function initiateTransfer(
    recipientCode: string,
    amountNaira: number,
    reason: string,
    reference: string
): Promise<TransferResult> {
    const ref = String(reference ?? "").trim();
    if (!ref) {
        // Refusing beats inventing one. An invented reference is indistinguishable
        // from a correct one until the day a retry pays somebody twice.
        return { success: false, error: "A payout reference is required" };
    }

    /**
     *   #251 NOTHING CHECKED THE AMOUNT BEFORE SENDING IT.
     *
     *        The body was `Math.round(amountNaira * 100)` with no guard. NaN —
     *        which is what Math.abs(undefined) or a missing stored field
     *        produces — serialises to `null` in the JSON body; a negative
     *        amount serialises to negative kobo; Infinity to null again. Every
     *        one of those is a request to move money built from a value nobody
     *        looked at, and the amount arrives here from five different stored
     *        documents, so no single caller can be relied on to have checked.
     */
    const kobo = Math.round(amountNaira * 100);
    if (!Number.isFinite(amountNaira) || amountNaira <= 0 || kobo < 1) {
        logger.error(`[PaystackTransfer] refusing an invalid amount: ${amountNaira}`);
        return { success: false, error: `Refusing to transfer an invalid amount: ${amountNaira}` };
    }

    try {
        const res = await fetch(`${PAYSTACK_BASE}/transfer`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${getPaystackSecret()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                source: "balance",
                amount: kobo, // Paystack uses kobo
                recipient: recipientCode,
                reason,
                reference: ref,
            }),
        });
        const data = await res.json();

        if (!res.ok || !data.status) {
            const message = data.message || "Transfer initiation failed";

            // Paystack already holds this reference, so the FIRST attempt went
            // through and the payee has been paid (#249). Reporting it as an
            // ordinary failure is what makes a caller try again.
            if (isDuplicateReference(message)) {
                logger.warn(
                    `[PaystackTransfer] reference ${ref} already used — the original transfer stands`);
                return { success: false, duplicate: true, reference: ref, error: message };
            }

            // A 5xx means Paystack may have accepted it and failed to tell us.
            const indeterminate = res.status >= 500;
            logger.error("[PaystackTransfer] Transfer failed:", data);
            return { success: false, error: message, reference: ref, indeterminate };
        }

        logger.info(`[PaystackTransfer] Transfer initiated: ${data.data.transfer_code} | ref: ${ref}`);
        return {
            success: true,
            transferCode: data.data.transfer_code,
            reference: ref,
        };
    } catch (err: any) {
        // The request may have reached Paystack (#250). We cannot say it failed.
        logger.error("[PaystackTransfer] initiateTransfer error:", err);
        return { success: false, error: err.message, reference: ref, indeterminate: true };
    }
}

// ─── Combined: resolve → create recipient → transfer ─────────────────────────

/**
 * Full payout pipeline: create a recipient, send money.
 *
 * (The docstring used to promise "validate account" as a first step. It never
 * did that — resolveAccountNumber is exported and this never called it.
 * Creating the recipient is itself the validation: Paystack refuses an account
 * number that does not resolve.)
 *
 * @param account      { accountNumber, bankCode, accountName }
 * @param amountNaira  Amount in Naira (not kobo). Validated before anything is
 *                     sent — see #251.
 * @param reason       Description e.g. "Marketplace escrow release - ORD-123"
 * @param reference    REQUIRED idempotency key, stable across retries of the
 *                     same payout. Build it with payoutReference(). See #249:
 *                     this used to be absent, and a random one was invented per
 *                     attempt, so a retry paid the payee a second time.
 *
 * @param source       The STORED bank record the account was built from. Its
 *                     resolution stamp is checked before anything is sent —
 *                     see #208 below.
 *
 * On failure, read `indeterminate` before deciding what to do. `false` means
 * nothing was sent and the record may safely be reopened; `true` means the
 * money may already have moved and it MUST NOT be. A refusal for an
 * unconfirmed account is never indeterminate: it happens before any request.
 */
export async function paystackPayout(
    account: BankAccount,
    amountNaira: number,
    reason: string,
    reference: string,
    /**
     * #208. The STORED bank record this `account` was built from, so the
     * provenance of its holder name can be checked.
     *
     * REQUIRED, and required on purpose: a payout path that forgot it would be
     * a payout path with no check, and this parameter makes that a compile
     * error rather than a silent hole. It is the stored record rather than a
     * boolean for the same reason — a boolean would be computed at five call
     * sites, and five copies of one rule is the shape this codebase keeps
     * having to unpick.
     */
    source: MaybeResolvedBankAccount,
): Promise<TransferResult> {
    // Checked before the recipient call, so an invalid amount costs no round
    // trip and creates no recipient — initiateTransfer checks it again because
    // it is exported and callable on its own.
    const kobo = Math.round(amountNaira * 100);
    if (!Number.isFinite(amountNaira) || amountNaira <= 0 || kobo < 1) {
        logger.error(`[PaystackTransfer] refusing an invalid amount: ${amountNaira}`);
        return { success: false, error: `Refusing to transfer an invalid amount: ${amountNaira}` };
    }
    if (!String(reference ?? "").trim()) {
        return { success: false, error: "A payout reference is required" };
    }

    /**
     * #208 THE ACCOUNT MUST HAVE BEEN CONFIRMED AGAINST THE BANK.
     *
     * AFTER the amount and reference checks and before anything is sent. Those
     * two are caller bugs and deserve their own precise diagnostic (#249, #251
     * pin the messages); this one is an operational state an admin must act on,
     * and it is the last gate before the network.
     *
     * Both onboarding flows used to SIMULATE verification, storing whatever the
     * applicant typed as the confirmed holder name over an account number
     * nobody resolved (#284). A record from that era is byte-identical to a
     * properly resolved one — both say `verified: true` — so the only honest
     * test is the stamp lib/bank-account-provenance.ts writes when the
     * resolution actually happens.
     *
     * Paystack will happily pay a real account number belonging to somebody
     * else. That is exactly what the simulated flow allowed to be entered, and
     * it is why this refuses rather than trying and hoping.
     *
     * THE CHECK IS HERE, NOT AT THE FIVE CALL SITES. Every payout in the
     * platform — withdrawals, loan disbursement, order release, WAVE
     * withdrawals, wallet — comes through this function, and a sixth one added
     * later gets the check without anybody remembering to add it.
     */
    if (!isResolvedBankAccount(source)) {
        logger.error(
            `[PaystackTransfer] refusing a payout to an unconfirmed account (ref ${reference})`,
        );
        return { success: false, error: UNRESOLVED_ACCOUNT_REFUSAL };
    }

    // 1. Create recipient (Paystack deduplicates, so this is safe to call repeatedly)
    const recipientResult = await createTransferRecipient(
        account.accountName || "Recipient",
        account.accountNumber,
        account.bankCode
    );
    if (!recipientResult.success || !recipientResult.recipientCode) {
        // No transfer was attempted, so this is never indeterminate however the
        // recipient call failed.
        return { success: false, error: recipientResult.error };
    }

    // 2. Initiate transfer
    return initiateTransfer(recipientResult.recipientCode, amountNaira, reason, reference);
}
