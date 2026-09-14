/**
 * What a cooperative member's savings SHOULD be, according to the ledger.
 *
 *   #726 THE RULE WAS WRITTEN ONCE AND REFERRED TO BY COMMENT TWICE.
 *
 *   forensics.ts held the two lists inline:
 *
 *       const CREDIT_TYPES = ["savings", "deposit", "contribution",
 *                             "loan_repayment_excess"];
 *       const DEBIT_TYPES  = ["withdrawal", "fixed_savings_lock"];
 *
 *   and two other files already carried comments asking to be kept in step with
 *   them — _coop_admin_money.ts and api/cooperative/create-fixed-savings, both
 *   quoting the list back rather than importing it. A rule maintained by
 *   comment is a rule that has already started drifting; this audit's single
 *   most frequent finding is two copies of one fact with the stale one
 *   deciding.
 *
 *   IT MATTERS MORE NOW THAN IT DID. #726 gives an admin a way to CREATE the
 *   membership row that the reconciliation check reports as missing, and that
 *   row carries a balance. If the tool derived it by one rule and the check
 *   verified it by another, the tool would create a row the check flags as
 *   mismatched the moment it is written — a repair that manufactures the next
 *   finding.
 *
 *   So the rule lives here and both read it.
 *
 * ── WHY A BALANCE IS DERIVED AND NEVER TYPED IN ─────────────────────────────
 *
 *   The reason this repair was deferred, recorded in the backfill cron, reads:
 *
 *       "2 COOPERATIVE MEMBERS WITH NO MEMBERSHIP ROW would need a tier and
 *        balances invented to satisfy the check."
 *
 *   The tier, sometimes. The BALANCE never — it is not a matter of opinion and
 *   nobody has to invent it. Every completed cooperative transaction for that
 *   member is already recorded, and the sum of them IS the balance. A member
 *   with no transactions has ₦0, which is a fact and not a guess.
 *
 *   Inventing a savings balance would be inventing money, which is the one
 *   thing no repair in this audit may do.
 */

/** Transaction types that ADD to a member's savings. */
export const SAVINGS_CREDIT_TYPES: readonly string[] = [
    "savings",
    "deposit",
    "contribution",
    "loan_repayment_excess",
];

/** Transaction types that TAKE FROM a member's savings. */
export const SAVINGS_DEBIT_TYPES: readonly string[] = [
    "withdrawal",
    "fixed_savings_lock",
];

/** Naira of slack, matching the tolerance the reconciliation check already allows. */
export const BALANCE_TOLERANCE = 1.0;

export interface LedgerRow {
    type?: unknown;
    amount?: unknown;
}

/**
 * The balance these transactions add up to.
 *
 * THE CALLER FILTERS TO COMPLETED ROWS. This deliberately does not look at
 * `status`: the reconciliation check queries `where("status","==","completed")`
 * at the database, and re-filtering here would let a caller pass unfiltered
 * rows and get a different answer from the one the check computes — which is
 * the disagreement this module exists to prevent.
 *
 * A type in neither list contributes NOTHING rather than defaulting to a
 * credit. An unrecognised type is a type nobody has classified, and guessing it
 * is a credit would inflate a member's savings on the strength of a spelling.
 */
export function ledgerBalanceOf(rows: LedgerRow[]): number {
    let balance = 0;
    for (const row of rows) {
        const type = typeof row?.type === "string" ? row.type : "";
        const amount = Number(row?.amount ?? 0);
        if (!Number.isFinite(amount)) continue;

        if (SAVINGS_CREDIT_TYPES.includes(type)) balance += amount;
        else if (SAVINGS_DEBIT_TYPES.includes(type)) balance -= amount;
    }
    return balance;
}

/** Do the held figure and the ledger agree, within the tolerance? */
export function balancesAgree(held: number, ledger: number): boolean {
    return Math.abs(ledger - held) <= BALANCE_TOLERANCE;
}
