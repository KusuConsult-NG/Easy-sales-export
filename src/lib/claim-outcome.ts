/**
 * What a LOST payment claim actually means — one answer.
 *
 *   #695 #259 AND #531 ARE EACH RIGHT AND TOGETHER THEY TAKE THE MONEY AND
 *        FULFIL NOTHING.
 *
 *   #259 established the rule four verify paths follow today, in its own words:
 *
 *       "a claim that loses means the payment was ALREADY APPLIED — by the
 *        webhook, or by an earlier delivery of the same callback. The money
 *        moved."
 *
 *   That was true when it was written, and telling a charged buyer "Payment
 *   already processed" as an ERROR is the outcome it rightly removed.
 *
 *   #531 then gave the webhook — and the admin sync — a reason to claim a
 *   reference they could NOT apply: "a type this route does not handle still
 *   needs a record, or an unknown payment vanishes silently", recorded with
 *   status `unhandled_type`. Also right, on its own terms.
 *
 *   Between them the premise is gone. A lost claim no longer proves anybody
 *   fulfilled anything, and every one of the four paths still branches on
 *   `!claim.claimed` alone.
 *
 * ── THE DISCRIMINATOR HAS EXISTED SINCE THE DAY CLAIMING DID ────────────────
 *
 *   claim_payment_once does not return a boolean. Migration 009 states the
 *   second column's purpose in the function's own contract block:
 *
 *       status   the status recorded on the existing row when claimed is FALSE,
 *                so a caller can distinguish "already completed" from a row left
 *                behind in some other state.
 *
 *   Exactly this question, answered at the database, and read by nobody. The
 *   test doubles are narrower than the adapter in the same direction — the
 *   existing suites mock the loss as `{ claimed: false }` with no status field —
 *   so no test could have seen it either.
 *
 * ── WHY A DENYLIST AND NOT AN ALLOWLIST ─────────────────────────────────────
 *
 *   The statuses that mean "claimed and NOT fulfilled" are the platform's own
 *   two markers, both written by code in this repository and enumerable:
 *
 *       unhandled_type      payment-router — no processor claims this type
 *       fulfilment_failed   wallet-ledger/markFulfilmentFailed — it was claimed,
 *                           fulfilment then threw, "money was collected and
 *                           nothing was delivered"
 *
 *   Everything else is treated as fulfilled, deliberately, and that includes
 *   NULL. `processed_payments` rows written before the status field carried a
 *   value read back as null, and an allowlist would refuse every one of them —
 *   turning #259's defect back on for the oldest payments on the platform, which
 *   are precisely the ones most likely to be legitimate duplicates. It also
 *   includes module statuses that ARE fulfilments of an unusual shape, such as
 *   processExportInvestment's `overfunded_review`: the investment was recorded,
 *   the money is simply held out of revenue.
 *
 *   So the rule is narrow on purpose. It says "these two specific markers mean
 *   nobody fulfilled this" and changes nothing else about #259.
 */

/**
 * The statuses this platform writes onto a claimed-but-unfulfilled payment.
 *
 * Kept here rather than imported from the two modules that write them, because
 * importing payment-router from a verify path drags the whole processor graph
 * into a server action's module tree. The constant below is asserted against
 * both writers by test, so the two cannot drift.
 */
export const NON_FULFILMENT_CLAIM_STATUSES: readonly string[] = [
    "unhandled_type",
    "fulfilment_failed",
];

/**
 * Did the claim that beat us actually fulfil the payment?
 *
 * `status` is the second column of claim_payment_once — pass `claim.status`
 * straight in. See the header for why an unrecognised or absent status answers
 * TRUE: this narrows #259, it does not reverse it.
 */
export function lostClaimWasFulfilled(status: string | null | undefined): boolean {
    if (typeof status !== "string") return true;
    return !NON_FULFILMENT_CLAIM_STATUSES.includes(status.trim());
}

/**
 * What to tell somebody whose payment was claimed by something that did not
 * fulfil it.
 *
 * One sentence, used by every path, because the four of them would otherwise
 * each invent their own and the buyer's experience would depend on which module
 * they were in. It says the money is safe and that a person is involved, which
 * are the two things they need; it does not say "failed", because the payment
 * did not fail — it succeeded and the fulfilment did not happen.
 */
export const UNFULFILLED_CLAIM_MESSAGE =
    "Your payment went through, but we could not complete this order automatically. "
    + "Nothing further has been charged and our team has been alerted — please contact "
    + "support with your payment reference if you do not hear back shortly.";
