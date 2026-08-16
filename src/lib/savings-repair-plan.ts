/**
 * Decides which cooperative members are owed a savingsBalance correction, and
 * how much.
 *
 * WHY THIS IS A LIBRARY AND NOT PART OF THE SCRIPT
 * -----------------------------------------------
 * scripts/repair-savings-balance.ts is the only caller. It changes real
 * balances and cannot be run without a database, so the part of it that decides
 * WHETHER TO CHANGE A BALANCE lives here, where it can be tested without one.
 * The script keeps the I/O: reading rows, calling the RPCs, printing.
 *
 * THE DEFECT BEING REPAIRED
 * -------------------------
 * A cooperative contribution has two confirmation paths, and they credited
 * different fields:
 *
 *   processCooperativeContribution (the Paystack webhook) — credited
 *     totalContributions AND savingsBalance.
 *   verifyContributionPaymentAction (the browser redirect) — credited ONLY
 *     totalContributions.
 *
 * claim_payment_once is keyed on the reference alone, so exactly one of them
 * ran for any given payment. Whether a member's SPENDABLE balance went up was
 * decided by a race between their browser and Paystack's webhook.
 *
 * claim_payment_once stamps `source` onto processed_payments.raw_data, so the
 * affected payments are exactly those with
 * type='cooperative_contribution' AND source='client_verify'. No estimation and
 * no ledger-vs-balance diffing: the record says which path ran.
 */

/** One contribution that credited the lifetime total but not the balance. */
export interface AffectedPayment {
    reference: string;
    userId: string;
    amount: number;
    processedAt: string | null;
}

/** The shape of a processed_payments row as PostgREST returns it. */
export interface ProcessedPaymentRow {
    id: unknown;
    user_id: unknown;
    amount: unknown;
    raw_data: unknown;
}

/**
 * Turn one processed_payments row into a repair candidate, or reject it.
 * `null` means skip — either already repaired, or not usable.
 *
 * raw_data wins over the native columns because claim_payment_once writes the
 * authoritative copy there; the columns are a denormalised convenience and a
 * legacy row may have only one of the two populated.
 */
export function parseAffectedRow(row: ProcessedPaymentRow): AffectedPayment | null {
    const raw = (row.raw_data ?? {}) as Record<string, any>;

    // Already repaired by an earlier run. Checked FIRST, so a stamped row is
    // never counted and the totals reported are the work still outstanding.
    // This is the whole of the idempotency guarantee — without it a second
    // --apply run credits every member twice.
    if (raw.savingsBalanceRepairedAt) return null;

    const amount = Number(raw.amount ?? row.amount);
    const userId = String(raw.userId ?? row.user_id ?? '');

    // A zero or negative "contribution" is not something to credit, and NaN
    // would propagate into the increment and corrupt the balance outright.
    if (!Number.isFinite(amount) || amount <= 0) return null;
    if (!userId || userId === 'null' || userId === 'undefined') return null;

    return {
        reference: String(row.id),
        userId,
        amount,
        processedAt: typeof raw.processedAt === 'string' ? raw.processedAt : null,
    };
}

export interface RepairPlan {
    /** Ledger row present — the credit ran, savingsBalance is short. Safe to fix. */
    repairable: AffectedPayment[];
    /** No ledger row — fulfilment never completed. Needs a person, not a script. */
    stranded: AffectedPayment[];
    /** One increment per member rather than one per payment. */
    byMember: Map<string, AffectedPayment[]>;
    /** Sum of the repairable amounts only. Stranded money is not counted. */
    totalOwed: number;
}

/**
 * Split candidates by whether the ledger proves the contribution was credited,
 * and group the repairable ones by member.
 *
 * THE SPLIT IS THE LOAD-BEARING PART. The claim is taken BEFORE the credit —
 * migration 009 documents that trade deliberately — so a fulfilment that failed
 * after claiming leaves a row with NEITHER field credited. Crediting
 * savingsBalance there would leave totalContributions short: one inconsistency
 * traded for another, and a quieter one, since nothing downstream compares the
 * two.
 *
 * The unified `transactions` row is written with id = reference inside the same
 * block as the totalContributions increment and AFTER it, so the row existing
 * proves the increment ran. That is the only reliable signal available, and it
 * is why stranded rows are reported rather than repaired.
 */
export function buildRepairPlan(
    affected: AffectedPayment[],
    withLedgerRow: Set<string>,
): RepairPlan {
    const repairable: AffectedPayment[] = [];
    const stranded: AffectedPayment[] = [];

    for (const payment of affected) {
        (withLedgerRow.has(payment.reference) ? repairable : stranded).push(payment);
    }

    const byMember = new Map<string, AffectedPayment[]>();
    for (const payment of repairable) {
        const list = byMember.get(payment.userId) ?? [];
        list.push(payment);
        byMember.set(payment.userId, list);
    }

    return {
        repairable,
        stranded,
        byMember,
        totalOwed: repairable.reduce((sum, p) => sum + p.amount, 0),
    };
}
