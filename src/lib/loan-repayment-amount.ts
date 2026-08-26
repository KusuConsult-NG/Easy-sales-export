import { calculatePenalty } from "@/lib/calculatePenalty";

/**
 * What an instalment still owes, and whether a repayment may be that large.
 *
 *   #286 A LOAN REPAYMENT HAD NO UPPER BOUND, SO OVERPAYING DESTROYED THE
 *        EXCESS.
 *
 *        Both repayment paths checked that the amount was POSITIVE and nothing
 *        else:
 *
 *          submitRepaymentAction        `if (data.amount <= 0) refuse`
 *          repayLoanFromSavingsAction   the same, plus the savings floor
 *
 *        Neither compared it to what the instalment actually owed. The credit
 *        is `paidAmount: FieldValue.increment(amount)` and the status is
 *        `newPaidAmount >= totalDue ? "paid" : ...`, so an amount larger than
 *        the balance marks the instalment paid and leaves paidAmount above
 *        totalAmount. Nothing carries the excess to the next instalment,
 *        credits it anywhere, or refunds it. It is simply gone.
 *
 *        THE SAVINGS PATH MAKES THAT REAL MONEY. repayLoanFromSavingsAction
 *        DEBITS the member's savings by the amount first and credits the
 *        instalment afterwards, so a repayment of 500,000 against an instalment
 *        owing 50,000 takes 500,000 out of savings and puts 50,000 of value
 *        back. Its own comment already notes that a failure between the two is
 *        "DELIBERATELY NOT COMPENSATED", which is exactly why the bound has to
 *        be checked BEFORE the debit rather than at the credit.
 *
 *        RecordRepaymentModal computes and DISPLAYS the outstanding figure —
 *        `Math.max(0, totalAmount - paidAmount)` — beside the input, and then
 *        validates only `> 0`. So the screen knows the number it is not
 *        enforcing, which is the same shape as #272's order ceiling.
 *
 * ONE EXPRESSION, ONE PLACE
 * -------------------------
 * The owed figure is computed here and nowhere else. Writing it out in both
 * actions would make two expressions for one quantity, and the penalty term
 * makes them easy to drift apart — that is #270 and #271's shape, and it is
 * why this is a module rather than two `if` statements.
 */

/** An instalment as the repayment paths read it. */
export interface RepayableInstallment {
    totalAmount?: number;
    paidAmount?: number;
    dueDate?: { toDate?: () => Date } | string | Date | null;
    status?: string;
}

/** The due date in whatever shape the row happens to carry. */
function dueDateOf(installment: RepayableInstallment): Date | null {
    const raw = installment.dueDate;
    if (!raw) return null;
    if (typeof raw === "object" && "toDate" in raw && typeof raw.toDate === "function") {
        return raw.toDate();
    }
    const parsed = new Date(raw as string | Date);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Everything still payable on this instalment: the principal plus any penalty
 * that has accrued, less what has already been paid.
 *
 * The penalty is included because submitRepaymentAction marks the instalment
 * "paid" against `totalAmount + penalty`. A bound that ignored the penalty
 * would refuse the very payment that settles an overdue instalment.
 */
export function amountOwedOn(installment: RepayableInstallment): number {
    const totalAmount = Number(installment.totalAmount ?? 0);
    const paidAmount = Number(installment.paidAmount ?? 0);

    if (!Number.isFinite(totalAmount) || totalAmount <= 0) return 0;

    const due = dueDateOf(installment);
    const { penalty } = due
        ? calculatePenalty(due, totalAmount)
        : { penalty: 0 };

    const owed = totalAmount + penalty - (Number.isFinite(paidAmount) ? paidAmount : 0);
    return owed > 0 ? owed : 0;
}

export type RepaymentVerdict =
    | { ok: true; owed: number }
    | { ok: false; owed: number; reason: "not_a_number" | "not_positive" | "over_owed" | "already_settled"; message: string };

/**
 * May this repayment be made against this instalment?
 *
 * Refuses rather than capping. Silently reducing what somebody asked to pay is
 * its own surprise, and on the savings path the caller has to know the figure
 * BEFORE any money moves.
 */
export function checkRepaymentAmount(
    amount: unknown,
    installment: RepayableInstallment,
): RepaymentVerdict {
    const owed = amountOwedOn(installment);
    const value = Number(amount);

    if (!Number.isFinite(value)) {
        return { ok: false, owed, reason: "not_a_number", message: "Enter a valid repayment amount." };
    }

    if (value <= 0) {
        return { ok: false, owed, reason: "not_positive", message: "Repayment amount must be greater than zero." };
    }

    if (owed <= 0) {
        return {
            ok: false,
            owed,
            reason: "already_settled",
            message: "This instalment has nothing outstanding.",
        };
    }

    if (value > owed) {
        return {
            ok: false,
            owed,
            reason: "over_owed",
            message: `That is more than this instalment owes. Outstanding: ₦${owed.toLocaleString()}.`,
        };
    }

    return { ok: true, owed };
}
