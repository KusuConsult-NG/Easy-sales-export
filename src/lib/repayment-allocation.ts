import { checkRepaymentAmount, type RepayableInstallment } from "@/lib/loan-repayment-amount";

/**
 * Splitting ONE bank transfer across more than one instalment.
 *
 *   #212 (from #286) A SINGLE TRANSFER COVERING TWO INSTALMENTS COULD NOT BE
 *        RECORDED.
 *
 *        submitRepaymentAction claims the bank reference through
 *        claimPaymentOnce, which is keyed on the reference ALONE. So a transfer
 *        of ₦120,000 covering instalment 3 (₦100,000) and part of instalment 4
 *        (₦20,000) could be recorded exactly once.
 *
 *        Before #286 the admin's only move was to record the whole ₦120,000
 *        against instalment 3: the credit is `increment(amount)` and the status
 *        is `newPaidAmount >= totalDue ? "paid"`, so instalment 3 went to paid
 *        with paidAmount ₦20,000 above what it owed and NOTHING carried the
 *        excess to instalment 4. The money was gone. #286 stopped that — the
 *        amount is now bounded by what the instalment owes and the attempt is
 *        refused with the outstanding figure named — which is correct and left
 *        the admin with no way to record the transfer at all.
 *
 *   THE DECISION, AND WHY NOT THE TWO OPTIONS THE FINDING NAMED
 *
 *        A SUFFIXED REFERENCE — TRF12345-1, TRF12345-2 — was the obvious move
 *        and is the wrong one. Each suffix is a distinct claim, so nothing ties
 *        the parts to one transfer and nothing bounds their total: an admin can
 *        invent -3, -4, -5 and credit as much as the instalments will absorb.
 *        It is exactly as unbounded as recording the whole amount against one
 *        instalment, while LOOKING controlled. That is finding class (n) —
 *        a security-shaped mechanism that gates nothing.
 *
 *        A CREDIT NOTE introduces a second money concept to solve a
 *        bookkeeping-shaped problem, and this codebase's recurring defect is
 *        already too many concepts for one quantity (#270, #271, #336).
 *
 *        WHAT IS ACTUALLY WRONG IS THE UNIT. The operation is not "apply a
 *        reference"; it is "reconcile a transfer, allocating it across
 *        instalments". So the reference is claimed ONCE, for the WHOLE transfer,
 *        and the allocation happens inside that one claim. Nothing about
 *        claimPaymentOnce's guarantee changes: one reference, one claim, ever.
 *
 *   THE SUM MUST EQUAL THE TRANSFER, NOT MERELY FIT INSIDE IT
 *
 *        Allowing a shortfall would let an admin record ₦100,000 of a ₦120,000
 *        transfer and spend the reference, leaving ₦20,000 that can never be
 *        allocated — which is the defect again, one step further along. Making
 *        the sum exact is what "reconciled" means: every naira of the transfer
 *        is accounted for, or it is not recorded yet.
 *
 *   WHAT THIS DOES NOT DO, STATED RATHER THAN IMPLIED
 *
 *        It does not support coming back later to re-allocate a transfer that
 *        has already been recorded. The reference is spent, deliberately, and
 *        that is the guarantee that stops a transfer being credited twice. An
 *        admin who allocated wrongly is in the same position as any other
 *        posting error and needs a correcting entry, which is a bookkeeping
 *        decision this module does not invent.
 *
 * This module's only import is the owed-amount rule it must not restate.
 */

/** One line of a split: this much of the transfer, against this instalment. */
export interface RepaymentAllocation {
    installmentId: string;
    amount: number;
}

/** An instalment, as the allocation check reads it. */
export interface AllocatableInstallment extends RepayableInstallment {
    id: string;
}

export type AllocationRefusal =
    | "none"
    | "duplicate_installment"
    | "unknown_installment"
    | "line_refused"
    | "sum_mismatch";

export type AllocationVerdict =
    | { ok: true; total: number }
    | { ok: false; reason: AllocationRefusal; message: string; installmentId?: string };

/** The most instalments one transfer may be split across. */
export const MAX_ALLOCATIONS_PER_TRANSFER = 24;

/**
 * May this transfer be recorded, split this way?
 *
 * Checked as a WHOLE before anything is written. A per-line check that credited
 * as it went would leave a half-applied transfer behind on the first refusal,
 * and the reference would already be spent.
 */
export function checkRepaymentAllocations(
    allocations: readonly RepaymentAllocation[],
    installmentsById: Readonly<Record<string, AllocatableInstallment | undefined>>,
    transferAmount: unknown,
): AllocationVerdict {
    const total = Number(transferAmount);

    if (!Array.isArray(allocations) || allocations.length === 0) {
        return { ok: false, reason: "none", message: "Allocate the transfer to at least one instalment." };
    }

    if (allocations.length > MAX_ALLOCATIONS_PER_TRANSFER) {
        return {
            ok: false,
            reason: "none",
            message: `A transfer may be split across at most ${MAX_ALLOCATIONS_PER_TRANSFER} instalments.`,
        };
    }

    // Two lines against one instalment is ambiguous, and worse: each would be
    // bounded separately against the same outstanding figure, so together they
    // could exceed it.
    const seen = new Set<string>();
    for (const line of allocations) {
        const id = String(line?.installmentId ?? "").trim();
        if (!id) {
            return { ok: false, reason: "unknown_installment", message: "Choose an instalment for every line." };
        }
        if (seen.has(id)) {
            return {
                ok: false,
                reason: "duplicate_installment",
                installmentId: id,
                message: "Each instalment may appear once. Combine the two lines into one.",
            };
        }
        seen.add(id);
    }

    let allocated = 0;
    for (const line of allocations) {
        const id = String(line.installmentId).trim();
        const installment = installmentsById[id];

        if (!installment) {
            return {
                ok: false,
                reason: "unknown_installment",
                installmentId: id,
                message: "That instalment is not on this loan's schedule.",
            };
        }

        // The SAME bound #286 applies to a single repayment, per line. An
        // allocation is a repayment; splitting one transfer does not make any
        // part of it exempt from what its instalment owes.
        const bound = checkRepaymentAmount(line.amount, installment);
        if (!bound.ok) {
            return { ok: false, reason: "line_refused", installmentId: id, message: bound.message };
        }

        allocated += Number(line.amount);
    }

    if (!Number.isFinite(total) || total <= 0) {
        return { ok: false, reason: "sum_mismatch", message: "Enter the amount of the bank transfer." };
    }

    // Compared in kobo. Naira amounts are entered to two decimal places and
    // floating-point addition of them does not land exactly — 100000.10 +
    // 20000.20 is not 120000.30 — so an exact comparison on the raw sum would
    // refuse a correct allocation for a reason nobody could see.
    const allocatedKobo = Math.round(allocated * 100);
    const totalKobo = Math.round(total * 100);

    if (allocatedKobo !== totalKobo) {
        const difference = Math.abs(totalKobo - allocatedKobo) / 100;
        return {
            ok: false,
            reason: "sum_mismatch",
            message: allocatedKobo < totalKobo
                ? `₦${difference.toLocaleString()} of this transfer is unallocated. `
                    + "Every naira has to be accounted for before it can be recorded."
                : `The allocations come to ₦${difference.toLocaleString()} more than the transfer.`,
        };
    }

    return { ok: true, total: allocated };
}

/**
 * The allocations a single-instalment repayment amounts to.
 *
 * submitRepaymentAction's original shape — one instalment, one amount — is the
 * one-line case of the same operation, and it goes through the same checks
 * rather than keeping a second path beside them. Two paths that both credit an
 * instalment is the shape this codebase keeps having to unpick.
 */
export function singleAllocation(installmentId: string, amount: number): RepaymentAllocation[] {
    return [{ installmentId, amount }];
}
