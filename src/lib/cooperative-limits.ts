/**
 * Cooperative balance rules that more than one path has to agree on.
 *
 * The minimum balance lived as a local `const MINIMUM_BALANCE = 5000` inside
 * the withdrawal route. That was fine while withdrawal was the only thing that
 * could reduce savings. Repaying a loan from savings is a second such path, and
 * two copies of a money rule in two files is how the copies come to disagree —
 * the recurring shape in this codebase is a rule applied to one path and not to
 * its sibling.
 *
 * It is exported as a value rather than read from configuration because both
 * call sites also render it in the message shown to the member, and the number
 * they are told must be the number that was enforced.
 */

import { COOPERATIVE_CONFIG } from "@/lib/constants";

/** Naira that must remain in a member's savings after any reduction. */
export const COOPERATIVE_MINIMUM_BALANCE = 5000;

/** "₦5,000" — for the message that explains a refused debit. */
export function formatMinimumBalance(): string {
    return `₦${COOPERATIVE_MINIMUM_BALANCE.toLocaleString()}`;
}

/**
 * The smallest withdrawal a member may request.
 *
 * /api/cooperative/withdraw enforced `amount < 1000` and the two server actions
 * did not: withdrawalSchema asks only for `positive()`, and
 * submitWithdrawalAction only for `> 0`. So a ₦1 withdrawal request was refused
 * by the route and accepted by both actions — each one creating a pending
 * request an admin has to action, and locking the amount out of the member's
 * savings until they do.
 *
 * 1,000 is not invented here; it is the route's own figure, and the one the
 * member withdraw page already validates against client-side.
 */
export const COOPERATIVE_MINIMUM_WITHDRAWAL = 1000;

/** "₦1,000" — for the message that explains a refused request. */
export function formatMinimumWithdrawal(): string {
    return `₦${COOPERATIVE_MINIMUM_WITHDRAWAL.toLocaleString()}`;
}

/**
 * What a member may actually take out, given a balance.
 *
 * Never negative: a member already at or under the floor has nothing available,
 * and a negative "available" figure rendered into a sentence reads as a debt.
 */
export function availableAboveFloor(balance: number): number {
    return Math.max(0, Number(balance || 0) - COOPERATIVE_MINIMUM_BALANCE);
}

/**
 *   #807 THE REGISTRATION FEE IS A RULE THREE PATHS HAVE TO AGREE ON, AND THE
 *        ONE PAYSTACK CALLS CARRIED ITS OWN COPY.
 *
 *        Two of the three read lib/constants:
 *
 *          api/cooperatives/register        COOPERATIVE_CONFIG.registrationFee
 *          api/cooperative/verify-payment   COOPERATIVE_CONFIG.registrationFee
 *          payments/service.ts (webhook)    const expectedAmount = 10000;
 *
 *        register/route.ts says in as many words why its own copy was removed:
 *        "Two registration paths charging from two sources means changing the
 *        fee moves one of them, and the one left behind keeps charging the old
 *        price with nothing to say so." The third was never brought in.
 *
 *        IT FAILS TOWARDS THE MEMBER. Lower the fee in constants — ₦10,000 to
 *        ₦5,000, say — and the member is charged ₦5,000, Paystack confirms it,
 *        and the webhook compares it to a literal 10,000 and throws. The
 *        payment succeeded and the membership is never fulfilled.
 *
 *   AND THE UNREADABLE AMOUNT, WHICH IS THE WORSE HALF
 *
 *        The check compared `amount` against `expectedAmount - 1` with a bare
 *        `<`. The webhook builds
 *        that figure as `data.amount / 100` with no guard on the success path,
 *        so an absent amount arrives as NaN — and `NaN < 9999` is FALSE. The
 *        comparison passes and the membership is fulfilled on a payment whose
 *        amount could not be read.
 *
 *        That is the platform's standing rule about NaN, applied here at last:
 *        _wallet_consolidation uses `isPositiveAmount` rather than
 *        `balance > 0` for exactly this reason, and both sibling handlers in
 *        this same webhook already refuse it — checkAcademyPayment and
 *        checkOrderPaymentAmount each open with `!Number.isFinite(paid)`.
 *        Cooperative was the one payment type in the file still deciding with
 *        a bare comparison against a literal.
 */

/** Naira of rounding slack, matching what the webhook already allowed. */
export const COOPERATIVE_FEE_TOLERANCE = 1;

export type CooperativeRegistrationPaymentVerdict =
    | { ok: true; fee: number; overpaidBy: number }
    | { ok: false; reason: "underpaid"; fee: number; paid: number; shortfall: number; message: string }
    | { ok: false; reason: "unreadable_amount"; fee: number; message: string };

/**
 * Was this enough to register a cooperative member?
 *
 * Deliberately the same shape as `checkAcademyPayment`, because it answers the
 * same question for the neighbouring payment type in the same webhook:
 *
 *   UNDERPAYMENT IS REFUSED. The webhook already refused it, and a membership
 *   nobody paid for is the case the check exists for.
 *
 *   OVERPAYMENT IS ACCEPTED and reported. Refusing leaves a member who has been
 *   charged with no membership and an error, which is the outcome this codebase
 *   treats as the worst one wherever it appears.
 *
 *   AN UNREADABLE AMOUNT IS REFUSED, and this is the direction the old
 *   comparison had backwards.
 *
 * The fee is read, never passed in: a caller that could name the expected
 * amount is a caller that can get it wrong, which is the whole defect above.
 */
export function checkCooperativeRegistrationPayment(
    amountPaid: unknown,
): CooperativeRegistrationPaymentVerdict {
    const fee = COOPERATIVE_CONFIG.registrationFee;
    const paid = Number(amountPaid);

    if (!Number.isFinite(paid) || paid <= 0) {
        return {
            ok: false,
            reason: "unreadable_amount",
            fee,
            message: "No payment amount could be read for this registration.",
        };
    }

    if (paid + COOPERATIVE_FEE_TOLERANCE < fee) {
        return {
            ok: false,
            reason: "underpaid",
            fee,
            paid,
            shortfall: Number((fee - paid).toFixed(2)),
            message: "The amount paid is less than the cooperative registration fee.",
        };
    }

    const surplus = paid - fee;
    return {
        ok: true,
        fee,
        overpaidBy: surplus > COOPERATIVE_FEE_TOLERANCE ? Number(surplus.toFixed(2)) : 0,
    };
}
