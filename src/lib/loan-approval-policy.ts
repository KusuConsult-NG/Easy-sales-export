/**
 * Where the maker-checker rule for loan approval lives.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three separate actions approve a loan by writing `status: "approved"` to
 * COLLECTIONS.LOAN_APPLICATIONS:
 *
 *   - admin.ts            → _approveLoanApplication   (also pays out)
 *   - cooperative/_loans.ts → approveLoanAction
 *   - loan-actions.ts     → approveLoanApplication    (the /loans/approve page)
 *
 * The dual-control fix went into the first two and each declared its own
 * `const MAKER_CHECKER_THRESHOLD = 1000000`. The third was never touched, so a
 * single admin could approve a ₦10,000,000 loan through /loans/approve while
 * the same loan needed two admins through either of the others. A control that
 * exists in two of three doors is not a control.
 *
 * Duplicating the threshold is what let them drift. It is defined once, here,
 * and every approval path imports it.
 *
 * NOT a substitute for claiming the transition. This module decides *whether*
 * dual control applies; `claimStatusTransition` is what makes it hold under
 * concurrency. Both are needed — see src/lib/status-transition.ts.
 */

/**
 * Loans at or above this amount (NGN) require two different admins: one to
 * record the first approval, a second to confirm it.
 */
export const MAKER_CHECKER_THRESHOLD = 1_000_000;

/**
 * True when this amount may not be approved by one admin alone.
 *
 * A missing or unparseable amount is treated as requiring dual control. An
 * approval path that cannot tell how much money is involved is the last place
 * to assume the cheaper answer.
 */
export function needsDualControl(amount: unknown): boolean {
    const value = typeof amount === "number" ? amount : Number(amount);
    if (!Number.isFinite(value)) return true;
    return value >= MAKER_CHECKER_THRESHOLD;
}
