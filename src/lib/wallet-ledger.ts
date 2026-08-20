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
 * Record that fulfilment FAILED after the payment was already claimed.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * claim_payment_once writes `status` at claim time, and its default is
 * 'completed' (migration 009, `p_status TEXT DEFAULT 'completed'`). Claiming
 * before fulfilling is deliberate — for money, a stuck payment somebody has to
 * look at beats one that silently fulfils twice — but it means the row says
 * "completed" from the instant of the claim, BEFORE any work has happened.
 *
 * So when the work then throws, the outcome is the worst of both worlds:
 *
 *   - the money was collected
 *   - nothing was delivered
 *   - processed_payments says `completed`
 *   - reconcilePendingFulfillments only looks for `pending_fulfilment`, so it
 *     never finds these
 *
 * A defect that leaves no trace is the one nobody fixes. This is the same
 * category the savings-balance repair had to label STRANDED and refuse to
 * touch, because a claim with no fulfilment cannot be safely guessed at.
 *
 * Measured across the codebase: of nineteen claim sites, fifteen take the
 * default status, and six of those have throw paths after the claim — eleven in
 * total, spanning Farm Nation escrow, cooperative contributions (both paths),
 * loan repayments, export investments and WAVE registration.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT
 * ------------------------------------------------
 * It marks the row `fulfilment_failed` and records the reason and the time. It
 * does NOT release the claim: releasing it would let a webhook retry fulfil a
 * payment whose failure might be non-deterministic, and double-fulfilment is
 * the thing claiming exists to prevent. It does NOT refund, and it does NOT
 * retry. It makes the payment FINDABLE:
 *
 *     SELECT id, raw_data->>'type', raw_data->>'fulfilmentError'
 *     FROM processed_payments
 *     WHERE raw_data->>'status' = 'fulfilment_failed';
 *
 * Never throws. It is called from a catch block on the way to re-raising the
 * original error, and an error while recording an error must not replace it —
 * that would lose the reason the payment failed in the first place.
 */
export async function markFulfilmentFailed(reference: string, reason: string): Promise<void> {
    try {
        const { error } = await supabaseAdmin.rpc("apply_document_patch", {
            p_table: "processed_payments",
            p_id: reference,
            p_collection: null,
            p_patch: {
                status: "fulfilment_failed",
                fulfilmentError: String(reason).slice(0, 500),
                fulfilmentFailedAt: new Date().toISOString(),
            },
            p_paths: {},
            p_deletes: [],
        });

        if (error) {
            logger.error(
                `[wallet-ledger] Payment ${reference} was claimed, fulfilment FAILED, and the ` +
                `failure could not be recorded: ${error.message}. This payment is now invisible ` +
                `to reconciliation — money was taken and nothing was delivered.`
            );
            return;
        }

        logger.error(
            `[wallet-ledger] Payment ${reference} claimed but fulfilment FAILED: ${reason}. ` +
            `Marked fulfilment_failed. Money was collected and nothing was delivered — this ` +
            `needs a person.`
        );
    } catch (err: any) {
        // Swallowed on purpose. See the note above: the caller is mid-catch and
        // about to rethrow the real error.
        logger.error(
            `[wallet-ledger] Could not mark ${reference} fulfilment_failed: ${err?.message ?? err}`
        );
    }
}

/**
 * The `type` written onto a claimed payment, for events with more than one
 * confirmation path.
 *
 * WHY THIS EXISTS
 * ---------------
 * A cooperative contribution can be confirmed two ways, and each passed its own
 * literal:
 *
 *   infrastructure/payments/service.ts   the Paystack webhook   "contribution"
 *   actions/cooperative/_payment.ts      the browser redirect   "cooperative_contribution"
 *
 * One business event, two names, decided by which of the two won a race. Every
 * other claim type in this codebase has exactly one spelling; this was the only
 * one that did not.
 *
 * Found by querying production: processed_payments holds rows of
 * type='contribution' and NOT ONE of 'cooperative_contribution', which is how
 * the second spelling stayed invisible — the browser path has never won a claim
 * race in production, so nothing has yet been filed under a name the rest of the
 * system does not use.
 *
 * "contribution" is the surviving spelling because it is the one already in the
 * database, the one both writers use for the cooperative LEDGER row
 * (_payment.ts, `type: "contribution"`), and the one every consumer matches on.
 *
 * Only the divergent type is defined here. The rest are unambiguous and adding
 * them would be churn without a defect behind it.
 */
export const CLAIM_TYPE = {
    /** A cooperative savings contribution, whichever path confirms it. */
    COOPERATIVE_CONTRIBUTION: "contribution",
} as const;

/**
 * The spelling the browser-redirect path used before CLAIM_TYPE existed.
 *
 * Kept ONLY so repairs can still find historical rows. Nothing may write it —
 * src/__tests__/unit/claim-type-single-spelling.test.ts enforces that. A repair
 * script that stopped recognising the old name would silently report "nothing to
 * do" for exactly the rows it was written to fix, which is the worst possible
 * failure mode for a money repair.
 */
export const LEGACY_COOPERATIVE_CONTRIBUTION_CLAIM_TYPE = "cooperative_contribution";

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

/**
 * Puts a debited amount back when the work that followed it failed.
 *
 * THE WINDOW THIS EXISTS FOR
 * --------------------------
 * debitJsonbBalance takes the money under a row lock, and that part is sound.
 * What follows it is not one operation but several separate round trips — move
 * the amount into lockedBalance, write the request row, write the audit entry —
 * and the Firestore-compat adapter flushes them one at a time. The comment in
 * cooperative/_coop_money.ts says so outright: "the adapter flushes them one by
 * one regardless".
 *
 * So a timeout or a dropped connection after the debit leaves the member's
 * savings reduced with nothing to show for it: no locked balance, no pending
 * request, nothing for an admin to approve or reject, and no error the member
 * can act on beyond "Failed to submit withdrawal request". The money is simply
 * gone from their balance.
 *
 * Every one of the nine debit sites had a bare `catch` that logged and
 * returned. None put the money back.
 *
 * WHY A CREDIT AND NOT A TRANSACTION
 * ----------------------------------
 * The writes span the RPC and the adapter, which do not share a transaction, so
 * there is nothing to roll back. A compensating credit is what is available.
 *
 * It is safe here in a way it was NOT for the WAVE payout: there the rollback
 * followed a completed external transfer, and undoing it locally allowed a
 * second payout. Everything between a debit and its record is internal database
 * writes with no external side effect, so putting the money back is exactly
 * correct.
 *
 * WHEN THE COMPENSATION ITSELF FAILS
 * ----------------------------------
 * That is the irreducible case, and it is logged at error level with every
 * identifier needed to settle it by hand. It does not throw: the caller is
 * already handling a failure, and masking that with a second one helps nobody.
 * forensics.ts reconciles maintained balances against the ledger and will
 * surface the discrepancy.
 */
export async function compensateJsonbDebit(params: {
    table: string;
    id: string;
    field: string;
    amount: number;
    /** What this was reversing, for the log. */
    reason: string;
    /**
     * Other counters to move in the same write — typically
     * `{ lockedBalance: -amount }` when the debit had already been reserved.
     * Omit any the failing work never got as far as changing.
     */
    also?: Record<string, number>;
    collection?: string;
}): Promise<void> {
    const { table, id, field, amount, reason, also, collection } = params;

    try {
        // Through the compat adapter, so the credit uses the very mechanism the
        // reject path already uses to restore a balance —
        // `FieldValue.increment`, which migration 010 applies in SQL via
        // apply_increments. Writing a second, parallel way to move the same
        // number is how two paths come to disagree.
        //
        // Imported lazily: wallet-ledger is imported by much of the money layer,
        // and this keeps the dependency off the module-initialisation path.
        const { supabaseDb } = await import("./supabase-db");
        const { FieldValue } = await import("./firestore-compat");

        const patch: Record<string, unknown> = {
            [field]: FieldValue.increment(amount),
            updatedAt: FieldValue.serverTimestamp(),
        };
        for (const [otherField, delta] of Object.entries(also ?? {})) {
            patch[otherField] = FieldValue.increment(delta);
        }

        await supabaseDb.collection(collection ?? table).doc(id).update(patch);

        logger.warn("[wallet-ledger] debit compensated", { table, id, field, amount, reason });
    } catch (err) {
        // The one case that cannot be resolved in code. Everything needed to
        // settle it by hand is here.
        logger.error(
            "[wallet-ledger] COMPENSATION FAILED — balance debited and not restored. "
            + "Needs manual reconciliation.",
            { table, id, field, amount, reason, also, error: err instanceof Error ? err.message : String(err) }
        );
    }
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

/** Reason a floored debit was refused. `below_floor` is not `insufficient_funds`. */
export type FlooredDebitFailure = DebitFailure | "below_floor";

export interface FlooredDebitResult {
    ok: boolean;
    /** Balance AFTER a successful debit; the current balance on refusal. */
    balance: number;
    reason: FlooredDebitFailure | null;
}

/**
 * Debit a raw_data balance under a row lock, refusing to take it below a floor.
 *
 * `debitJsonbBalance` enforces "not negative" and nothing more, which is the
 * right rule where there is no policy minimum. Where there IS one, checking it
 * with a plain read leaves a race: two withdrawals that each leave the floor
 * intact can together dip under it. This applies the floor under the same lock
 * as the debit.
 *
 * `below_floor` is deliberately distinct from `insufficient_funds`: the member
 * has the money, they are just not allowed to take all of it, and telling them
 * "insufficient funds" would be false.
 *
 * Requires migration 020.
 */
export async function debitJsonbBalanceWithFloor(params: {
    table: string;
    id: string;
    field: string;
    amount: number;
    floor: number;
    /** Required when the collection lives in document_collections. */
    collection?: string;
}): Promise<FlooredDebitResult> {
    const { table, id, field, amount, floor, collection } = params;

    if (!id) throw new Error("debitJsonbBalanceWithFloor: id is required");
    if (!field) throw new Error("debitJsonbBalanceWithFloor: field is required");
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`debitJsonbBalanceWithFloor: amount must be positive, got ${amount}`);
    }
    if (!Number.isFinite(floor) || floor < 0) {
        throw new Error(`debitJsonbBalanceWithFloor: floor must be >= 0, got ${floor}`);
    }

    const { data, error } = await supabaseAdmin.rpc("debit_jsonb_balance_with_floor", {
        p_table: table,
        p_id: id,
        p_field: field,
        p_amount: amount,
        p_floor: floor,
        p_collection: collection ?? null,
    });

    if (error) {
        logger.error("[wallet-ledger] debit_jsonb_balance_with_floor failed", { table, id, field, error });
        throw new Error(`Floored balance debit failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Floored balance debit returned no result");

    return {
        ok: Boolean(row.ok),
        balance: Number(row.balance ?? 0),
        reason: (row.reason ?? null) as FlooredDebitFailure | null,
    };
}

export interface VersionClaimResult {
    /** True when this caller made the change. */
    claimed: boolean;
    /**
     * The version now on the row: the NEW one on success, the CURRENT one on a
     * lost claim, and `null` when the record does not exist.
     *
     * `null` is a DIFFERENT failure from a lost claim. Confusing the two turns a
     * missing record into a spurious "someone else edited this".
     */
    version: number | null;
}

/**
 * Compare-and-swap on `_version` — optimistic locking that actually locks.
 *
 * `versionedUpdate` in src/lib/optimistic-locking.ts reads the version inside
 * `runTransaction`, compares it and writes. That wrapper takes no lock, so two
 * callers read the same version, both pass the comparison and both write — the
 * exact failure optimistic locking exists to prevent.
 *
 * The patch is applied as JSONB and FieldValue sentinels are NOT resolved, the
 * same caveat `claimStatusTransition` carries: an increment placed in the patch
 * is stored as an object rather than applied. Issue those separately after a
 * successful claim.
 *
 * Requires migration 020.
 */
export async function claimVersionedUpdate(params: {
    table: string;
    id: string;
    /** The version the caller expects. `undefined`/`null` asserts nothing but still locks. */
    expectedVersion?: number | null;
    patch?: Record<string, any>;
    /** Required when the collection lives in document_collections. */
    collection?: string;
}): Promise<VersionClaimResult> {
    const { table, id, expectedVersion, patch, collection } = params;

    if (!id) throw new Error("claimVersionedUpdate: id is required");

    const { data, error } = await supabaseAdmin.rpc("claim_versioned_update", {
        p_table: table,
        p_id: id,
        p_expected: expectedVersion ?? null,
        p_patch: patch ?? {},
        p_collection: collection ?? null,
    });

    if (error) {
        logger.error("[wallet-ledger] claim_versioned_update failed", { table, id, error });
        throw new Error(`Versioned update failed: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Versioned update returned no result");

    return {
        claimed: Boolean(row.claimed),
        version: row.version === null || row.version === undefined ? null : Number(row.version),
    };
}

export interface LoanApplicationClaim {
    /** True when the application row was inserted. */
    claimed: boolean;
    /** The open application that blocked it, when `claimed` is false. */
    existingId: string | null;
}

/**
 * Insert a loan application only if the borrower has no open one, anywhere.
 *
 * The check this replaces read both loan collections and refused if either was
 * non-empty — with no lock, so two applications submitted together both saw an
 * empty result and both inserted.
 *
 * It could not be fixed with a row lock, because the thing being guarded is the
 * ABSENCE of rows: there is nothing to lock. `claim_single_open_loan_application`
 * takes a per-borrower advisory lock and does the check AND the insert inside
 * one transaction, so a second caller for the same borrower blocks and then
 * sees the row the first one wrote. Different borrowers never contend.
 *
 * The guard spans BOTH collections in both directions: an open cooperative loan
 * blocks a general application and vice versa, which is what the original reads
 * intended.
 *
 * Requires migration 021.
 */
export async function claimSingleOpenLoanApplication(params: {
    userId: string;
    /** Document id for the new application row. */
    id: string;
    /** 'cooperative_loans' or 'document_collections'. */
    table: string;
    /** The application row, as it should be stored. */
    row: Record<string, any>;
    /** Required when `table` is 'document_collections'. */
    collection?: string;
}): Promise<LoanApplicationClaim> {
    const { userId, id, table, row, collection } = params;

    if (!userId) throw new Error("claimSingleOpenLoanApplication: userId is required");
    if (!id) throw new Error("claimSingleOpenLoanApplication: id is required");

    const { data, error } = await supabaseAdmin.rpc("claim_single_open_loan_application", {
        p_user_id: userId,
        p_id: id,
        p_target_table: table,
        p_row: row,
        p_target_collection: collection ?? null,
    });

    if (error) {
        logger.error("[wallet-ledger] claim_single_open_loan_application failed", { userId, id, table, error });
        throw new Error(`Loan application claim failed: ${error.message}`);
    }

    const r = Array.isArray(data) ? data[0] : data;
    if (!r) throw new Error("Loan application claim returned no result");

    return { claimed: Boolean(r.claimed), existingId: r.existing_id ?? null };
}
