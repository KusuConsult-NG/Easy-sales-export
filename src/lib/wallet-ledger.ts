/**
 * Atomic wallet money movement.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every money path in this codebase used supabaseDb.runTransaction, which is
 * not a transaction — it runs the callback, then replays queued writes, with
 * no lock, no rollback and no retry. Balances were read into JavaScript,
 * incremented there, and written back as absolute values, so two concurrent
 * operations on one wallet lost an update; two concurrent debits could both
 * pass a sufficiency check and overdraw.
 *
 * These two calls push the whole operation into Postgres, where the reference
 * claim and the balance change happen in one statement inside one transaction.
 * See supabase/migrations/005_atomic_wallet_operations.sql.
 *
 * RULES
 * -----
 * 1. Never read a balance, adjust it, and write it back. Use these functions.
 * 2. The reference is the idempotency key and must be stable for a given
 *    payment — a Paystack reference, or an id derived from the order. Never
 *    generate a fresh random reference per attempt, or retries will double-pay.
 * 3. A `claimed: false` result is a SUCCESS, not an error. It means the payment
 *    was already applied and this delivery was a duplicate.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { logger } from "@/lib/logger";

export interface CreditResult {
    /** True when this call applied the credit; false when already processed. */
    claimed: boolean;
    /** Wallet balance after the call. */
    balance: number;
}

export type DebitFailure = "already_processed" | "insufficient_funds" | "no_wallet";

export interface DebitResult {
    ok: boolean;
    balance: number;
    reason: DebitFailure | null;
}

/**
 * Credit a wallet exactly once for a payment reference.
 *
 * Safe to call repeatedly with the same reference — the second and later calls
 * return `claimed: false` and change nothing.
 */
export async function creditWalletOnce(params: {
    reference: string;
    userId: string;
    amount: number;
    paymentType?: string;
    source?: string;
    metadata?: Record<string, any>;
}): Promise<CreditResult> {
    const { reference, userId, amount, paymentType, source, metadata } = params;

    if (!reference) throw new Error("creditWalletOnce: reference is required");
    if (!userId) throw new Error("creditWalletOnce: userId is required");
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`creditWalletOnce: amount must be positive, got ${amount}`);
    }

    const { data, error } = await supabaseAdmin.rpc("credit_wallet_once", {
        p_reference: reference,
        p_user_id: userId,
        p_amount: amount,
        p_payment_type: paymentType ?? null,
        p_source: source ?? null,
        p_raw_data: metadata ?? {},
    });

    if (error) {
        logger.error("[wallet-ledger] credit_wallet_once failed", { reference, userId, error });
        throw new Error(`Wallet credit failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
        throw new Error("Wallet credit returned no result");
    }

    return { claimed: Boolean(row.claimed), balance: Number(row.balance ?? 0) };
}

/**
 * Debit a wallet exactly once for a reference, refusing when funds are short.
 *
 * The wallet row is locked before the sufficiency check, so concurrent debits
 * cannot both succeed against the same balance.
 */
export async function debitWalletOnce(params: {
    reference: string;
    userId: string;
    amount: number;
    purpose?: string;
    metadata?: Record<string, any>;
}): Promise<DebitResult> {
    const { reference, userId, amount, purpose, metadata } = params;

    if (!reference) throw new Error("debitWalletOnce: reference is required");
    if (!userId) throw new Error("debitWalletOnce: userId is required");
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`debitWalletOnce: amount must be positive, got ${amount}`);
    }

    const { data, error } = await supabaseAdmin.rpc("debit_wallet_once", {
        p_reference: reference,
        p_user_id: userId,
        p_amount: amount,
        p_purpose: purpose ?? null,
        p_raw_data: metadata ?? {},
    });

    if (error) {
        logger.error("[wallet-ledger] debit_wallet_once failed", { reference, userId, error });
        throw new Error(`Wallet debit failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
        throw new Error("Wallet debit returned no result");
    }

    return {
        ok: Boolean(row.ok),
        balance: Number(row.balance ?? 0),
        reason: (row.reason ?? null) as DebitFailure | null,
    };
}
