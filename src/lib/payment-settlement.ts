/**
 * WHEN DID THIS MONEY ACTUALLY MOVE? — one answer, separate from when we wrote
 * the row down.
 *
 *   THE OWNER, after reconciling every Academy payment against api.paystack.co:
 *   six of nine dated ledger rows disagreed with Paystack, and FIVE OF THEM SAT
 *   ON THE SAME DAY — 2026-07-06 — while Paystack spread the same five across
 *   February to May:
 *
 *       reference     ledger        Paystack       gap
 *       bl9tqf24ts    2026-07-06    2026-05-05     62 days
 *       a3croruf0m    2026-07-06    2026-02-28    128 days
 *       y6c3who31k    2026-07-06    2026-04-04     93 days
 *       h7ee5dkxvg    2026-07-06    2026-03-02    126 days
 *       4z0brfa7xb    2026-07-06    2026-04-13     84 days
 *
 *   Five payments on one day is not a busy Monday. It is an import stamp. The
 *   amounts and references survived whatever backfill wrote them; the dates did
 *   not, because there was no date to survive.
 *
 * ── THE CAUSE ───────────────────────────────────────────────────────────────
 *
 *   A ledger row has never carried a settlement date. `processed_payments` is
 *   written by claim_payment_once, whose signature is
 *
 *       p_reference, p_user_id, p_amount, p_type, p_source, p_raw_data, p_status
 *
 *   — no slot for one. So `created_at` is the moment the INSERT ran, which
 *   equals settlement only when a webhook is processed live. For anything
 *   replayed, imported or backfilled it is the date of the replay.
 *
 *   Every fulfilment path ALREADY RECEIVES Paystack's `paid_at`: each
 *   process*(…, paidAt?: Date) takes it and writes it to the user document and
 *   the application. Only the ledger row was left without it.
 *
 * ── WHY THIS NEEDS NO MIGRATION ─────────────────────────────────────────────
 *
 *   009_claim_payment_once.sql builds the row's raw_data as
 *
 *       COALESCE(p_raw_data, '{}') || jsonb_build_object('reference', …,
 *           'userId', …, 'amount', …, 'type', …, 'source', …, 'status', …)
 *
 *   so any key in the caller's metadata that the overlay does not name survives
 *   into raw_data. `paidAt` is such a key. The column list does not change, the
 *   function does not change, and a row written before today simply has no
 *   `paidAt` — which is what `settledAt` below is built to handle.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 *   IT DOES NOT REPAIR THE FIVE ROWS. Their settlement dates exist only at
 *   Paystack, and writing them back is a data change against live money that
 *   belongs to whoever can see the Paystack dashboard beside the table.
 *   scripts/reconcile-paystack-ledger.ts is how that is found and fixed.
 *   From today forward a new row carries its own date.
 */

/** Where the settlement date lives on a ledger row's raw_data. */
export const SETTLEMENT_DATE_KEY = "paidAt";

/**
 * The metadata a caller folds into claimPaymentOnce so the row records when the
 * money moved.
 *
 *   Returns `{}` for an unusable date rather than a key holding `null`, so a
 *   row either has a settlement date or plainly does not have one. A key
 *   present-but-null would read as "settled at the epoch" to anything that
 *   coerces it.
 */
export function settlementMetadata(paidAt: unknown): Record<string, string> {
    const iso = toIso(paidAt);
    return iso ? { [SETTLEMENT_DATE_KEY]: iso } : {};
}

function toIso(value: unknown): string | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return new Date(value).toISOString();
    }
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
    }
    return null;
}

/** A Firestore-ish timestamp, an ISO string, a Date, or epoch millis. */
type Timestampish = { toDate?: () => Date } | Date | string | number | null | undefined;

function coerce(value: Timestampish): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "object" && typeof value.toDate === "function") {
        try {
            const d = value.toDate();
            return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
        } catch {
            return null;
        }
    }
    const iso = toIso(value as unknown);
    return iso ? new Date(iso) : null;
}

/**
 * When this payment settled — the date any revenue figure should be bucketed by.
 *
 *   `paidAt` first, because it is Paystack's own answer. `createdAt` second,
 *   because for a live webhook the two are seconds apart and for an older row
 *   it is the only date there is. Null when neither can be read, so a caller
 *   can leave such a row out of a monthly total rather than silently counting
 *   it as today.
 *
 *   THE ORDER IS THE ENTIRE POINT. Reading createdAt first would keep the five
 *   rows above on 2026-07-06 for ever, even once their real date is restored.
 */
export function settledAt(row: {
    paidAt?: Timestampish;
    createdAt?: Timestampish;
    created_at?: Timestampish;
    raw_data?: { paidAt?: Timestampish } | null;
} | null | undefined): Date | null {
    if (!row) return null;

    return coerce(row.paidAt)
        ?? coerce(row.raw_data?.paidAt)
        ?? coerce(row.createdAt)
        ?? coerce(row.created_at)
        ?? null;
}

/**
 * Does this payment fall in [from, to)? Rows with no readable date are OUT.
 *
 *   Excluded rather than included, because a monthly revenue figure that
 *   quietly absorbs every undated row is wrong in a way nobody can see. A
 *   missing row in a total prompts the question; a wrong total does not.
 */
export function settledWithin(row: Parameters<typeof settledAt>[0], from: Date, to: Date): boolean {
    const when = settledAt(row);
    if (!when) return false;
    return when >= from && when < to;
}
