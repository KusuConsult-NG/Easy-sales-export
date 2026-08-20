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

/**
 * WHETHER A GUARANTOR MUST BE VERIFIED BEFORE APPROVAL — three answers, one rule
 * =============================================================================
 * Four writers create loan applications, and they record guarantors differently:
 *
 *   submitLoanApplicationAction        guarantorName (required by validation),
 *   (the wizard → loan_applications)   tier: "Member", guarantorVerified: false
 *
 *   /api/cooperative/apply-loan        guarantorName (required by the handler),
 *   (→ loan_applications)              guarantorVerified: false, NO tier
 *
 *   loan-actions.ts                    guarantorVerified: true outright, with
 *   (→ loan_applications)              the comment "General loans have no
 *                                      guarantor and are pre-verified"
 *
 *   _applyForLoanAction                neither field — the member loan page
 *   (→ cooperative_loans)              collects no guarantor at all
 *
 * The two approval doors then disagreed about what to do with that:
 *
 *   /api/admin/cooperative/approve-loan   `if (appData.tier && !guarantorVerified)`
 *   cooperative/_loans_decisions.ts       `if (!appData.guarantorVerified) throw`
 *
 * Both are wrong, in opposite directions.
 *
 * The route keys the check on `tier`, which only the wizard writes. Every
 * application filed through /api/cooperative/apply-loan carries a guarantor and
 * `guarantorVerified: false` and NO tier — so the check was skipped for exactly
 * the applications that had recorded an unverified guarantor. The control was
 * enforced on one writer's rows and silently absent on another's.
 *
 * The action demands `guarantorVerified` unconditionally. A cooperative_loans
 * row has no such field and never will, because that path collects no guarantor,
 * so once the action learned to resolve those applications it would refuse every
 * one of them permanently.
 *
 * The rule that fits all four writers is the obvious one, and it is about the
 * guarantor rather than about a tier: an application that RECORDED a guarantor
 * must have that guarantor verified before it is approved. One that recorded
 * none has nothing to verify.
 */
export interface GuarantorFields {
    guarantorName?: unknown;
    guarantorVerified?: unknown;
}

/** True when this application recorded a guarantor at all. */
export function recordsAGuarantor(app: GuarantorFields | null | undefined): boolean {
    return String(app?.guarantorName ?? "").trim().length > 0;
}

/**
 * True when approval must be refused because the recorded guarantor is
 * unverified.
 *
 * `guarantorVerified` is compared to true rather than tested for truthiness, so
 * a string "false" — which the JSONB writer will happily store — does not read
 * as verified.
 */
export function guarantorBlocksApproval(app: GuarantorFields | null | undefined): boolean {
    return recordsAGuarantor(app) && app?.guarantorVerified !== true;
}

export const GUARANTOR_UNVERIFIED_MESSAGE =
    "Guarantor verification required before loan approval.";

/**
 * The statuses a loan application may be rejected FROM.
 *
 * Rejection was a blind `update({ status: "rejected" })` in both doors — the
 * server action and /api/admin/cooperative/reject-loan — with no status check of
 * any kind, while approval and disbursement beside them both claim the
 * transition. So an already-disbursed loan could be marked rejected after the
 * money had left, and a rejected one could be rejected again with a new reason
 * and a new timestamp overwriting the record of the first.
 *
 * "approved" is deliberately NOT here. /api/admin/cooperative/approve-loan
 * increments the member's `loanBalance` on the winning approval; rejecting after
 * that would need a compensating decrement, and inventing one inside a rejection
 * path is how a balance ends up moved twice. An approved loan that should not
 * proceed is a reversal, not a rejection, and that is a separate decision.
 */
export const LOAN_REJECTABLE_STATUSES = [
    "pending",
    "reviewing",
    "partially_approved",
] as const;
