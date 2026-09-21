/**
 * The ledger against Paystack, both directions — the arithmetic, with no
 * database and no network in it.
 *
 *   THE OWNER, after reconciling the Academy cohort against api.paystack.co,
 *   found three separate things wrong with `processed_payments`:
 *
 *     1. MONEY PAYSTACK HAS AND THE LEDGER DOES NOT. Maryam Muhammad settled
 *        ₦50,000 on 2026-04-03 against reference `j559i4zu6j`. There is no row.
 *        The platform took her money and never wrote it down.
 *
 *     2. ROWS PAYSTACK HAS NEVER HEARD OF. The live sweep found THREE, all
 *        ₦50,000 `academy_registration`, all written on 2026-07-10 while the
 *        isTestRef mock removed in cc50b3b8 was still fabricating successes
 *        and the e2e suite was pointed at production:
 *
 *            TEST_E2E_REF_123456   academyuser02@gmail.com
 *            T1783690499905        e2e.user@easysalesexport.com
 *            T1783698149704        e2e.user@easysalesexport.com
 *
 *        THE LAST TWO ARE WHY THE T-FORM IS NOT ACTUALLY AMBIGUOUS. The mock
 *        matched `reference.startsWith('T')`, and Paystack really does issue
 *        T-references — but its are T + FIFTEEN digits, and these are T +
 *        THIRTEEN: a JavaScript `Date.now()`, minted by
 *        tests/e2e/financial-workflow.spec.ts. Decoded, they give 13:34:59
 *        and 15:42:29 against created_at of 13:35 and 15:42. A reference that
 *        encodes the moment OUR INSERT ran cannot have come from Paystack, so
 *        this is a proof of provenance rather than a guess about shape.
 *
 *     3. ROWS WHOSE DATES DISAGREE. Five references spanning February to May
 *        all stamped 2026-07-06, because a ledger row never carried a
 *        settlement date and `created_at` is whenever the INSERT ran.
 *
 *   One comparison finds all three, because they are the three ways a row and a
 *   transaction can fail to line up: theirs-not-ours, ours-not-theirs, and both
 *   but disagreeing.
 *
 * ── WHY THIS FILE HAS NO I/O ────────────────────────────────────────────────
 *
 *   Same reason academy-enrolment-tally keeps its arithmetic out of its runner:
 *   a reconciliation that can only be exercised by pointing it at live money is
 *   a reconciliation nobody tests. Everything here is a pure function over two
 *   arrays. scripts/reconcile-paystack-ledger.ts fetches them.
 *
 * ── WHAT COUNTS AS A MATCH ──────────────────────────────────────────────────
 *
 *   The reference, normalised for case and surrounding space. Not the amount,
 *   not the date, not the customer — those are what the comparison is FOR, and
 *   matching on them would hide the disagreements it exists to surface.
 *
 * ── THE ROWS THAT ARE MEANT TO HAVE NO TRANSACTION ──────────────────────────
 *
 *   A payment an admin verified by hand writes `admin-verified:<id>` (see
 *   academy/_ac_admin_review). Nobody charged a card, so Paystack has nothing
 *   and never will. Reporting those as "ours-not-theirs" every run would bury
 *   the one row that genuinely is fabricated, so they are classified apart —
 *   and by the prefix the code writes, never by guessing at shape.
 */

/** A transaction as the Paystack list endpoint reports it. */
export interface PaystackTransaction {
    reference: string;
    /** Kobo, as Paystack sends it. */
    amount: number;
    status: string;
    paid_at?: string | null;
    created_at?: string | null;
    customer?: { email?: string | null } | null;
}

/** A row of processed_payments, as the adapter returns it. */
export interface LedgerRow {
    reference: string;
    /** Naira. The ledger stores naira; Paystack sends kobo. */
    amount: number;
    created_at?: string | null;
    raw_data?: {
        type?: string | null;
        status?: string | null;
        source?: string | null;
        paidAt?: string | null;
    } | null;
}

/** What the admin-verified fallback writes, and why it is never "fabricated". */
export const ADMIN_VERIFIED_PREFIX = "admin-verified:";

/** A day, in milliseconds — the slack allowed before two dates "disagree". */
export const DATE_DRIFT_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export interface MissingFromLedger {
    reference: string;
    /** Naira, converted from Paystack's kobo. */
    amount: number;
    settledAt: string | null;
    email: string | null;
}

export interface MissingFromPaystack {
    reference: string;
    amount: number;
    type: string | null;
    /** True when the row says an admin recorded it, so no transaction is expected. */
    adminVerified: boolean;
}

export interface DateDisagreement {
    reference: string;
    ledgerDate: string;
    paystackDate: string;
    driftDays: number;
}

export interface Reconciliation {
    missingFromLedger: MissingFromLedger[];
    missingFromPaystack: MissingFromPaystack[];
    dateDisagreements: DateDisagreement[];
    /** Rows written by the admin fallback — expected to have no transaction. */
    adminVerified: MissingFromPaystack[];
    counts: { paystack: number; ledger: number; matched: number };
}

const key = (reference: unknown): string =>
    typeof reference === "string" ? reference.trim().toLowerCase() : "";

const parse = (value: unknown): number | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const t = Date.parse(value);
    return Number.isNaN(t) ? null : t;
};

/** Kobo to naira. Paystack is the only place kobo appears. */
export const koboToNaira = (kobo: unknown): number => {
    const n = Number(kobo);
    return Number.isFinite(n) ? n / 100 : 0;
};

/**
 * Which of these two dates does the LEDGER believe? `paidAt` if it has one,
 * otherwise `created_at` — the same order lib/payment-settlement uses, because
 * a reconciliation that ranked them differently from the application would
 * report drift the application does not see.
 */
function ledgerDateOf(row: LedgerRow): number | null {
    return parse(row.raw_data?.paidAt) ?? parse(row.created_at);
}

/** And which does PAYSTACK? `paid_at` is settlement; `created_at` is initiation. */
function paystackDateOf(tx: PaystackTransaction): number | null {
    return parse(tx.paid_at) ?? parse(tx.created_at);
}

/**
 * Compare the two, both ways.
 *
 *   ONLY SUCCESSFUL TRANSACTIONS COUNT as money Paystack has. An abandoned or
 *   failed attempt is not a payment the ledger is missing — three of the six
 *   admin-approved Academy accounts have exactly that, and reporting them as
 *   unrecorded money would be an accusation about nothing.
 */
export function reconcile(
    transactions: readonly PaystackTransaction[],
    ledger: readonly LedgerRow[],
): Reconciliation {
    const settled = transactions.filter((t) => key(t.status) === "success");

    const byRefPaystack = new Map<string, PaystackTransaction>();
    for (const t of settled) {
        const k = key(t.reference);
        if (k) byRefPaystack.set(k, t);
    }

    const byRefLedger = new Map<string, LedgerRow>();
    for (const r of ledger) {
        const k = key(r.reference);
        if (k) byRefLedger.set(k, r);
    }

    const missingFromLedger: MissingFromLedger[] = [];
    const dateDisagreements: DateDisagreement[] = [];
    let matched = 0;

    for (const [k, tx] of byRefPaystack) {
        const row = byRefLedger.get(k);
        if (!row) {
            missingFromLedger.push({
                reference: tx.reference,
                amount: koboToNaira(tx.amount),
                settledAt: tx.paid_at ?? tx.created_at ?? null,
                email: tx.customer?.email ?? null,
            });
            continue;
        }

        matched++;

        const ours = ledgerDateOf(row);
        const theirs = paystackDateOf(tx);
        if (ours !== null && theirs !== null) {
            const drift = Math.abs(ours - theirs);
            if (drift > DATE_DRIFT_TOLERANCE_MS) {
                dateDisagreements.push({
                    reference: tx.reference,
                    ledgerDate: new Date(ours).toISOString(),
                    paystackDate: new Date(theirs).toISOString(),
                    driftDays: Math.round(drift / DATE_DRIFT_TOLERANCE_MS),
                });
            }
        }
    }

    const missingFromPaystack: MissingFromPaystack[] = [];
    const adminVerified: MissingFromPaystack[] = [];

    for (const [k, row] of byRefLedger) {
        if (byRefPaystack.has(k)) continue;

        const entry: MissingFromPaystack = {
            reference: row.reference,
            amount: Number(row.amount) || 0,
            type: row.raw_data?.type ?? null,
            adminVerified: k.startsWith(ADMIN_VERIFIED_PREFIX),
        };

        (entry.adminVerified ? adminVerified : missingFromPaystack).push(entry);
    }

    const byReference = (a: { reference: string }, b: { reference: string }) =>
        a.reference.localeCompare(b.reference);

    return {
        missingFromLedger: missingFromLedger.sort(byReference),
        missingFromPaystack: missingFromPaystack.sort(byReference),
        dateDisagreements: dateDisagreements.sort((a, b) => b.driftDays - a.driftDays),
        adminVerified: adminVerified.sort(byReference),
        counts: { paystack: settled.length, ledger: byRefLedger.size, matched },
    };
}

/**
 * The only repair this tooling performs by itself: give a matched row the
 * settlement date Paystack already knows.
 *
 *   ADDITIVE AND REVERSIBLE. It writes one key into raw_data. No amount
 *   changes, no row is created, nothing is deleted, and a row that already
 *   agrees is left alone.
 *
 *   THE OTHER TWO ARE NOT AUTOMATED, AND THAT IS THE POINT. Creating a ledger
 *   row for money Paystack has means deciding what somebody bought; deleting
 *   one means revoking whatever was fulfilled against it, possibly months ago.
 *   Both are decisions about a person, and they are reported for a human with
 *   the Paystack dashboard open beside them.
 */
export function dateRepairs(result: Reconciliation): Array<{ reference: string; paidAt: string }> {
    return result.dateDisagreements.map((d) => ({
        reference: d.reference,
        paidAt: d.paystackDate,
    }));
}
