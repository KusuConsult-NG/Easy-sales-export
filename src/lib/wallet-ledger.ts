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

export type DebitFailure = "already_processed" | "insufficient_funds" | "no_wallet" | "not_found";

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
    /**
     * Payment status recorded on the processed_payments row.
     *
     * Leave as "completed" for real money in. Use anything else when the credit
     * is not revenue, because platform_revenue_totals() sums rows whose
     * raw_data->>'status' is 'completed':
     *
     *   - "refund"       — money returned to a user
     *   - "disbursement" — platform money paid OUT to a user, e.g. a loan.
     *                      It credits their wallet, so it is a credit; it is
     *                      the opposite of income, so it must not be summed.
     *
     * The column is free TEXT, so adding a value here needs no migration.
     */
    status?: "completed" | "refund" | "disbursement";
}): Promise<CreditResult> {
    const { reference, userId, amount, paymentType, source, metadata, status } = params;

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
        p_status: status ?? "completed",
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

export interface ClaimResult {
    /** True when this call claimed the reference and should do the work. */
    claimed: boolean;
    /** Status on the existing row when `claimed` is false. */
    status: string | null;
}

/**
 * Claim a payment reference without moving any money.
 *
 * For fulfilment that marks an order paid, creates escrow rows or writes a
 * ledger entry — work that must happen exactly once per payment, but changes no
 * balance. Paystack retries webhooks, so a duplicate delivery is expected
 * behaviour rather than a rare race.
 *
 * Claim FIRST, then fulfil. On `claimed: false`, return early and do nothing.
 *
 * This is not a transaction around the fulfilment that follows it. If the work
 * fails after a successful claim, the reference stays claimed and the payment
 * will not retry — deliberately, because for money a stuck payment somebody has
 * to look at beats one that silently fulfils twice. Log loudly so it is findable.
 */
export async function claimPaymentOnce(params: {
    reference: string;
    userId: string;
    amount: number;
    type?: string;
    source?: string;
    metadata?: Record<string, any>;
    /** Anything that is not money in must not be "completed" — see creditWalletOnce. */
    status?: string;
}): Promise<ClaimResult> {
    const { reference, userId, amount, type, source, metadata, status } = params;

    if (!reference) throw new Error("claimPaymentOnce: reference is required");

    const { data, error } = await supabaseAdmin.rpc("claim_payment_once", {
        p_reference: reference,
        p_user_id: userId ?? null,
        p_amount: amount ?? null,
        p_type: type ?? null,
        p_source: source ?? null,
        p_raw_data: metadata ?? {},
        p_status: status ?? "completed",
    });

    if (error) {
        logger.error("[wallet-ledger] claim_payment_once failed", { reference, userId, error });
        throw new Error(`Payment claim failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
        throw new Error("Payment claim returned no result");
    }

    return { claimed: Boolean(row.claimed), status: row.status ?? null };
}

/**
 * Debit a wallet atomically without claiming an idempotency reference.
 *
 * For debits that have no stable key — a withdrawal request is a fresh intent
 * each time, and two genuine requests should both succeed. This still takes the
 * row lock, so concurrent debits cannot both pass the sufficiency check and
 * overdraw the wallet.
 *
 * Prefer `debitWalletOnce` whenever a stable reference exists; it protects
 * against duplicate submission as well as concurrency.
 */
export async function debitWalletLocked(params: {
    userId: string;
    amount: number;
}): Promise<DebitResult> {
    const { userId, amount } = params;

    if (!userId) throw new Error("debitWalletLocked: userId is required");
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`debitWalletLocked: amount must be positive, got ${amount}`);
    }

    const { data, error } = await supabaseAdmin.rpc("debit_wallet_locked", {
        p_user_id: userId,
        p_amount: amount,
    });

    if (error) {
        logger.error("[wallet-ledger] debit_wallet_locked failed", { userId, error });
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

/**
 * Debit a numeric field held inside raw_data, under a row lock.
 *
 * For balances that are not the wallet's own: cooperative savings, locked
 * balances, WAVE earnings. Those live in the JSONB blob rather than a native
 * column, so `debitWalletOnce` does not reach them.
 *
 * Locks the row, re-reads the balance under that lock, refuses if funds are
 * short, then decrements. The read-check-write it replaces let two concurrent
 * debits both pass the sufficiency check and take a balance negative.
 *
 * See supabase/migrations/013_debit_jsonb_balance.sql.
 */
export async function debitJsonbBalance(params: {
    /** Firestore-style collection name; mapped to its table by the caller's COLLECTIONS constant. */
    table: string;
    id: string;
    field: string;
    amount: number;
    /** Required when the collection lives in document_collections. */
    collection?: string;
}): Promise<DebitResult> {
    const { table, id, field, amount, collection } = params;

    if (!id) throw new Error("debitJsonbBalance: id is required");
    if (!field) throw new Error("debitJsonbBalance: field is required");
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`debitJsonbBalance: amount must be positive, got ${amount}`);
    }

    const { data, error } = await supabaseAdmin.rpc("debit_jsonb_balance", {
        p_table: table,
        p_id: id,
        p_field: field,
        p_amount: amount,
        p_collection: collection ?? null,
    });

    if (error) {
        logger.error("[wallet-ledger] debit_jsonb_balance failed", { table, id, field, error });
        throw new Error(`Balance debit failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Balance debit returned no result");

    return {
        ok: Boolean(row.ok),
        balance: Number(row.balance ?? 0),
        reason: (row.reason ?? null) as DebitFailure | null,
    };
}

export interface BoundedCounterResult {
    ok: boolean;
    /** The counter after the call, where one counter was changed. */
    value?: number;
    /** For a multi-item decrement, the item that could not afford the change. */
    failedId?: string | null;
    reason: string | null;
}

/**
 * Decrements several counters, or none of them.
 *
 * For marketplace stock, where one order spans several products. Every row is
 * locked and checked before any is written, so a shortfall on the last item
 * leaves the earlier ones untouched — which a per-item loop would not.
 *
 * Rows are locked in id order inside the function, so two orders containing the
 * same products in different sequences cannot deadlock.
 *
 * See supabase/migrations/015_bounded_counters.sql.
 */
export async function decrementManyOrFail(
    items: Array<{ collection: string; id: string; field: string; amount: number }>
): Promise<BoundedCounterResult> {
    if (items.length === 0) return { ok: true, failedId: null, reason: null };

    for (const item of items) {
        if (!Number.isFinite(item.amount) || item.amount <= 0) {
            throw new Error(`decrementManyOrFail: amount must be positive for ${item.id}`);
        }
    }

    const { data, error } = await supabaseAdmin.rpc("decrement_many_or_fail", { p_items: items });

    if (error) {
        logger.error("[wallet-ledger] decrement_many_or_fail failed", { count: items.length, error });
        throw new Error(`Stock decrement failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Stock decrement returned no result");

    return {
        ok: Boolean(row.ok),
        failedId: row.failed_id ?? null,
        reason: row.reason ?? null,
    };
}

/**
 * Raises a counter only while it stays within a ceiling held on the same record.
 *
 * For capacity: `currentParticipants` may rise only within `maxParticipants`.
 * A record with no ceiling recorded is treated as unbounded, so events without
 * a cap keep working.
 */
export async function incrementWithinCeiling(params: {
    collection: string;
    id: string;
    field: string;
    amount: number;
    ceilingField: string;
}): Promise<BoundedCounterResult> {
    const { collection, id, field, amount, ceilingField } = params;

    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`incrementWithinCeiling: amount must be positive, got ${amount}`);
    }

    const { data, error } = await supabaseAdmin.rpc("increment_within_ceiling", {
        p_collection: collection,
        p_id: id,
        p_field: field,
        p_amount: amount,
        p_ceiling_field: ceilingField,
    });

    if (error) {
        logger.error("[wallet-ledger] increment_within_ceiling failed", { collection, id, error });
        throw new Error(`Capacity increment failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Capacity increment returned no result");

    return { ok: Boolean(row.ok), value: Number(row.value ?? 0), reason: row.reason ?? null };
}

export interface IdempotencyClaim {
    /** True when this call claimed the key and should do the work. */
    claimed: boolean;
    /** When the winning caller claimed it; null when unknown. */
    heldAt: string | null;
}

/**
 * Claim a client-supplied idempotency key, exactly once.
 *
 * For actions that take an `idempotencyKey` from a form and must not run twice
 * for it — a withdrawal request, creating an export window. The pattern this
 * replaces read the key, did the work, then wrote the key LAST, so two
 * submissions carrying the same key both read "absent" and both proceeded.
 *
 * Claim FIRST, then do the work. On `claimed: false`, stop.
 *
 * This is not a transaction around what follows. A caller that claims and then
 * fails leaves the key held and cannot retry with it — deliberate, and the same
 * trade-off `claimPaymentOnce` documents. Clients generate a fresh key per
 * attempt, so a genuine retry is unaffected.
 *
 * See supabase/migrations/019_claim_idempotency_key.sql.
 */
export async function claimIdempotencyKey(params: {
    key: string;
    userId?: string;
    action?: string;
    /** Defaults to the idempotency_keys collection. */
    collection?: string;
}): Promise<IdempotencyClaim> {
    const { key, userId, action, collection } = params;

    if (!key) throw new Error("claimIdempotencyKey: key is required");

    const { data, error } = await supabaseAdmin.rpc("claim_idempotency_key", {
        p_key: key,
        p_user_id: userId ?? null,
        p_action: action ?? null,
        p_collection: collection ?? "idempotency_keys",
    });

    if (error) {
        logger.error("[wallet-ledger] claim_idempotency_key failed", { key, action, error });
        throw new Error(`Idempotency claim failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Idempotency claim returned no result");

    return { claimed: Boolean(row.claimed), heldAt: row.held_at ?? null };
}
