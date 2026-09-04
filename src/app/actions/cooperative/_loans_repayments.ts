"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { claimPaymentOnce, claimIdempotencyKey, debitJsonbBalanceWithFloor , markFulfilmentFailed } from "@/lib/wallet-ledger";
import {
    COOPERATIVE_MINIMUM_BALANCE,
    formatMinimumBalance,
    availableAboveFloor,
} from "@/lib/cooperative-limits";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { canTransactAsMember, NOT_A_TRANSACTING_MEMBER_MESSAGE } from "@/lib/cooperative-membership-status";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withSafeAction, type ActionResponse } from "@/lib/safe-action";
import { isAdmin } from "@/lib/admin-permissions";
import { checkRepaymentAmount } from "@/lib/loan-repayment-amount";
import { checkRepaymentAllocations, singleAllocation } from "@/lib/repayment-allocation";
import { calculatePenalty } from "@/lib/calculatePenalty";
import type { LoanApplication, RepaymentInstallment } from "@/lib/types/cooperative-loans";
import { resolveLoanApplication, normaliseLoanApplication } from "@/lib/loan-application-location";

/**
 * Get loan repayment schedule
 */
async function _getRepaymentScheduleAction(
    loanId: string
): Promise<ActionResponse<{ schedule: RepaymentInstallment[] }>> { 
    try {
        // Resolved rather than assumed, and the borrower read through the same
        // normalisation the admin queue uses: cooperative_loans keys them as
        // `memberId`, so an un-normalised `loanData.userId` is undefined and the
        // ownership comparison below would refuse the borrower their own loan.
        // See lib/loan-application-location.ts.
        const resolved = await resolveLoanApplication(loanId);

        if (!resolved) {
            return { success: false as const, error: "Loan not found", data: null };
        }

        const loanData = normaliseLoanApplication(
            resolved.snap.data() as Record<string, any>,
            resolved.collection,
        ) as unknown as LoanApplication;

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== loanData.userId && !isAdmin(session.user.roles))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        // Check if schedule exists
        const scheduleSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        if (!scheduleSnapshot.empty) {
            // Return existing schedule
            const schedule = serializeDocs<RepaymentInstallment>(scheduleSnapshot.docs);

            return { error: null, success: true as const, data: { schedule } };
        }

        // Generate schedule in kobo to eliminate floating-point drift.
        //
        // interestRate is a MONTHLY percentage (see cooperative-tiers.ts).
        //
        // Refuse to build a schedule from missing inputs. Loans created through
        // /loans/apply record neither field, which made `n` undefined, so the
        // loop condition `1 <= undefined` was false and the borrower received a
        // schedule with no instalments at all — nothing to repay against, and no
        // overdue payments could ever be detected. Failing loudly surfaces the
        // loan as needing terms rather than silently producing an empty one.
        const interestRate = Number(loanData.interestRate);
        const n = Number(loanData.durationMonths ?? (loanData as any).repaymentPeriod);

        if (!Number.isFinite(interestRate) || !Number.isFinite(n) || n < 1) {
            logger.error("[getRepaymentSchedule] loan is missing repayment terms", {
                loanId,
                interestRate: loanData.interestRate,
                durationMonths: loanData.durationMonths,
            });
            return {
                success: false as const,
                error: "This loan has no interest rate or repayment period recorded, so a schedule cannot be generated. Please contact support.",
                data: null,
            };
        }

        const amountKobo = Math.round(loanData.amount * 100);
        const r = interestRate / 100;
        const monthlyPaymentKobo = r === 0
            ? Math.round(amountKobo / n)
            : Math.round((amountKobo * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1));

        const startDate = (loanData.disbursedAt && 'toDate' in loanData.disbursedAt)
            ? loanData.disbursedAt.toDate()
            : new Date();
        const installments: RepaymentInstallment[] = [];
        let remainingPrincipalKobo = amountKobo;

        for (let i = 1; i <= n; i++) {
            const interestAmountKobo = Math.round(remainingPrincipalKobo * r);
            let principalAmountKobo = monthlyPaymentKobo - interestAmountKobo;

            if (i === n) {
                principalAmountKobo = remainingPrincipalKobo;
            }

            const totalAmountKobo = principalAmountKobo + interestAmountKobo;
            remainingPrincipalKobo -= principalAmountKobo;

            const principalAmount = principalAmountKobo / 100;
            const interestAmount = interestAmountKobo / 100;
            const totalAmount = totalAmountKobo / 100;

            const dueDate = new Date(startDate);
            dueDate.setMonth(dueDate.getMonth() + i);

            const installmentRef = await db.collection(COLLECTIONS.LOAN_REPAYMENTS).add({
                loanId,
                userId: loanData.userId,
                installmentNumber: i,
                dueDate: Timestamp.fromDate(dueDate),
                principalAmount,
                interestAmount,
                totalAmount,
                paidAmount: 0,
                status: "pending",
            });

            installments.push({
                id: installmentRef.id,
                loanId,
                userId: loanData.userId,
                installmentNumber: i,
                dueDate: dueDate.toISOString() as any,
                principalAmount,
                interestAmount,
                totalAmount,
                paidAmount: 0,
                status: "pending",
            });
        }

        return { error: null, success: true as const, data: { schedule: installments } };
    } catch (error) { 
        logger.error("Failed to fetch repayment schedule:", error);
        return { success: false as const, error: "Failed to fetch repayment schedule", data: null };
    }
}


export const getRepaymentScheduleAction = withSafeAction("getRepaymentScheduleAction", _getRepaymentScheduleAction);


/**
 * Calculate penalty for overdue payment (7-day grace period)
 */
// The penalty maths lives in @/lib/calculatePenalty and is imported at the top
// of this file.
//
// It used to live here too — an identical private copy — while
// src/lib/calculatePenalty.ts carried the header "Extracted from loans.ts for
// testing" and a full suite in src/__tests__/lib/penalty.test.ts.
//
// The extraction happened and the original was never replaced with an import,
// so THE TESTED IMPLEMENTATION WAS NOT THE ONE THAT RAN. Ten assertions about
// grace periods, rounding and large amounts covered a function no production
// path called, and a fix to either copy would have left the other alone.
//
// The two were byte-identical in behaviour, so nothing was wrong yet. That is
// the point: this is the state a duplicate sits in right up until somebody
// changes one of them.
//
// UNCAPPED, AND WORTH A DECISION
// ------------------------------
// The penalty is 0.1% of the instalment per day after a seven-day grace period,
// with no ceiling, and it is real money: submitRepaymentAction adds it to
// `totalDue` and an instalment is not marked paid until paidAmount covers it.
//
//     1,000 days overdue  =  100% of the instalment, on top of the instalment
//     2,000 days overdue  =  200%
//
// It simply keeps going. Whether a cap exists, and where, is a lending policy
// decision rather than something to infer from the code — the same reason the
// business loan rate in loan-terms.ts records who confirmed it. Reported rather
// than invented.

/**
 * Record a loan repayment that arrived as a bank transfer.
 *
 *   #212 (from #286) ONE TRANSFER COVERING TWO INSTALMENTS COULD NOT BE
 *        RECORDED AT ALL.
 *
 *        claimPaymentOnce is keyed on the bank reference ALONE, so a transfer
 *        of ₦120,000 covering instalment 3 (₦100,000) and part of instalment 4
 *        (₦20,000) could be recorded exactly once. Before #286 the admin's only
 *        move was to record the whole ₦120,000 against instalment 3, which
 *        marked it paid with ₦20,000 above what it owed and destroyed the
 *        excess. #286 refuses that — correctly — and left the transfer
 *        unrecordable.
 *
 *        THE UNIT WAS WRONG, NOT THE GUARANTEE. The operation is "reconcile a
 *        transfer, allocating it across instalments", so the reference is
 *        claimed ONCE for the WHOLE transfer and the split happens inside that
 *        claim. Nothing about claimPaymentOnce changes: one reference, one
 *        claim, ever. See lib/repayment-allocation.ts for why a suffixed
 *        reference was the wrong answer.
 *
 *        `amount` is the TRANSFER total. With no `allocations` it is also the
 *        single line, which is the shape every existing caller sends and why
 *        their behaviour is unchanged.
 */
export async function submitRepaymentAction(data: {
    loanId: string;
    /** The single-line case. Ignored when `allocations` is given. */
    installmentId?: string;
    userId: string;
    /** The amount of the BANK TRANSFER, which the allocations must sum to. */
    amount: number;
    paymentReference: string;
    /** How the transfer is split. Omit for a one-instalment repayment. */
    allocations?: Array<{ installmentId: string; amount: number }>;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        // Self OR admin, matching _getRepaymentScheduleAction above and the rest
        // of this file.
        //
        // It was self-only, which meant nobody could record a repayment except
        // the borrower — and repayments arrive as bank transfers that an admin
        // reconciles by hand. The action existed, was hardened, and could not be
        // reached by the only person who needed it.
        //
        // The borrower check is kept, not replaced: a member submitting their
        // own reference still works, and a member cannot record a repayment
        // against somebody else's loan.
        const isActingAdmin = isAdmin(session?.user?.roles);
        if (!session?.user?.id || (session.user.id !== data.userId && !isActingAdmin)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        if (data.amount <= 0) {
            return { success: false as const, error: "Invalid repayment amount", data: null };
        }

        /**
         * #212. The transfer, as lines. A caller sending the original
         * single-instalment shape produces one line whose amount IS the
         * transfer, so the sum check below holds trivially for them and their
         * behaviour is unchanged.
         */
        const allocations = data.allocations && data.allocations.length > 0
            ? data.allocations
            : (data.installmentId ? singleAllocation(data.installmentId, data.amount) : []);

        // NO SECOND STATEMENT OF "AT LEAST ONE LINE" HERE. There was one, and
        // mutation testing showed it could be deleted without a test noticing —
        // because checkRepaymentAllocations below already refuses an empty
        // allocation, with a message that tells the admin what to do. Two
        // statements of one rule is what this codebase keeps having to unpick,
        // and the redundant one is the copy that drifts.

        /**
         *   #286 BOUNDED BEFORE THE REFERENCE IS CLAIMED, and #212 makes that
         *        structural rather than a convenience.
         *
         * Every line is read and the WHOLE allocation is checked here, before
         * claimPaymentOnce. #286 put a fast path here for one reason and #212
         * makes it structural:
         *
         *   A REFUSAL AFTER THE CLAIM BURNS THE BANK REFERENCE. The admin
         *   correcting a mistyped figure would resubmit the real reference, hit
         *   the duplicate branch, and be told the repayment succeeded when
         *   nothing was credited.
         *
         * With a split it is worse than a burnt reference: crediting line one
         * and refusing line two would leave a HALF-APPLIED transfer that no
         * second attempt can finish. So the set is validated together and
         * nothing is written until all of it passes.
         *
         * This is not the only check. The authoritative per-line bound runs
         * again below on the read the credit itself is computed from, because
         * claimPaymentOnce serialises on the REFERENCE and not on the
         * instalment — two different references against one instalment could
         * both clear this.
         */
        const preflightRows: Record<string, Record<string, any> | undefined> = {};
        for (const line of allocations) {
            const snap = await db.collection(COLLECTIONS.LOAN_REPAYMENTS).doc(line.installmentId).get();
            preflightRows[line.installmentId] = snap.exists
                ? { id: line.installmentId, ...(snap.data() as Record<string, any>) }
                : undefined;
        }

        {
            const verdict = checkRepaymentAllocations(
                allocations,
                preflightRows as Record<string, any>,
                data.amount,
            );
            if (!verdict.ok) {
                return { success: false as const, error: verdict.message, data: null };
            }
        }

        // Resolved rather than assumed — a loan filed through the member loan
        // page lives in cooperative_loans, and the admin queue offers Record
        // Repayment on exactly those rows. See lib/loan-application-location.ts.
        const resolvedLoan = await resolveLoanApplication(data.loanId);

        if (!resolvedLoan) {
            return { success: false as const, error: "Loan not found", data: null };
        }

        const loanRef = resolvedLoan.ref;

        // Summed across the allocated lines (#212).
        let calculatedPenalty = 0;
        let calculatedStatus: "pending" | "paid" | "overdue" | "partial" = "pending";
        let finalInstallmentData: any = null;
        // #212 — what the transfer actually paid, line by line. The audit log
        // used to name ONE instalment number; with a split, naming the last one
        // it happened to process would describe the transfer wrongly.
        const credited: Array<{ installmentId: string; installmentNumber: any; amount: number }> = [];

        // WHAT WAS WRONG HERE
        // -------------------
        // Two defects, both about money rather than status.
        //
        // 1. LOST UPDATE. `newPaidAmount = (paidAmount || 0) + amount` was
        //    computed in JavaScript and written back as an absolute value,
        //    inside runTransaction, which takes no lock. Two repayments landing
        //    together both read the same paidAmount and the second write
        //    overwrote the first: the member paid twice and was credited once.
        //    This is the exact shape migration 010 exists for.
        //
        // 2. NO IDEMPOTENCY. Nothing claimed data.paymentReference, so
        //    submitting the same Paystack reference twice — a retried webhook,
        //    a double-clicked form, a reloaded confirmation page — recorded the
        //    payment twice and credited the instalment twice.
        //
        // The reference is claimed first, then the instalment is credited with
        // FieldValue.increment, which applies the addition in SQL.
        const claim = await claimPaymentOnce({
            reference: data.paymentReference,
            userId: data.userId,
            amount: data.amount,
            type: "loan_repayment",
            source: "cooperative",
            // NOT "completed": platform_revenue_totals() sums completed rows as
            // revenue, and these rows never used to exist at all. Recording them
            // as completed would change reported revenue as a side effect of an
            // idempotency fix, which is not this change's business.
            status: "loan_repayment",
            // #212 — the allocation is derived, not `data.installmentId`, which
            // is undefined whenever the caller sent a split. A claim whose
            // metadata named no instalment would be the one record of a
            // reference that cannot be traced back to what it paid.
            metadata: {
                loanId: data.loanId,
                installmentId: allocations[0].installmentId,
                installmentIds: allocations.map((line) => line.installmentId),
            },
        });

        if (!claim.claimed) {
            // Already applied. A success, not an error — see the rules in
            // src/lib/wallet-ledger.ts.
            logger.warn("[submitRepaymentAction] duplicate payment reference ignored", {
                reference: data.paymentReference,
                loanId: data.loanId,
            });
            return { error: null, success: true as const, penalty: 0, data: null };
        }

        /**
         * #212. One pass per allocated line. Everything the single-instalment
         * version did — the two ownership bindings, the authoritative bound,
         * the penalty, the increment, the LOAN_PAYMENTS row — happens per line,
         * because a line IS a repayment and splitting a transfer does not make
         * any part of it exempt.
         */
        for (const line of allocations) {
            const installmentRef = db.collection(COLLECTIONS.LOAN_REPAYMENTS).doc(line.installmentId);
            const installmentDoc = await installmentRef.get();
            if (!installmentDoc.exists) {
                throw new Error("Installment not found");
            }

            const installmentData = installmentDoc.data() as Record<string, any>;

            // THE INSTALMENT WAS NEVER CHECKED TO BELONG TO THE LOAN.
            //
            // loanId and installmentId arrive as two independent caller-supplied
            // ids, and the only authorisation above is `session.user.id ===
            // data.userId` — the caller asserting who they are, which is true.
            // Nothing tied the instalment to the loan or to the borrower.
            //
            // The damage is not the credit itself but the sweep below it: it
            // asks LOAN_REPAYMENTS for every instalment of data.loanId and marks
            // the loan "repaid" if all of them are paid. Point loanId at a loan
            // with NO instalment rows — which _getRepaymentScheduleAction
            // deliberately refuses to generate for a loan missing its terms, so
            // such loans exist — and `[].every()` is true. One payment against
            // an unrelated instalment marked somebody's loan fully repaid
            // without a naira of it being paid.
            //
            // Both bindings are checked, not just the loan one: an instalment
            // belonging to a different borrower of the SAME loan is equally not
            // this caller's to pay.
            if (installmentData.loanId !== data.loanId) {
                logger.error("[submitRepaymentAction] installment does not belong to the loan", {
                    installmentId: line.installmentId,
                    claimedLoanId: data.loanId,
                    actualLoanId: installmentData.loanId,
                });
                throw new Error("That instalment does not belong to this loan");
            }

            if (installmentData.userId && installmentData.userId !== data.userId) {
                logger.error("[submitRepaymentAction] installment belongs to another borrower", {
                    installmentId: line.installmentId,
                    claimedUserId: data.userId,
                });
                throw new Error("That instalment does not belong to this borrower");
            }

            const dueDate = (installmentData.dueDate as Timestamp).toDate();

            /**
             *   #286 THE AMOUNT WAS NEVER COMPARED TO WHAT THE INSTALMENT OWED.
             *
             *        Only `data.amount <= 0` was checked. The credit below is
             *        `paidAmount: FieldValue.increment(amount)` and the status
             *        is `newPaidAmount >= totalDue ? "paid"`, so a larger
             *        amount marked the instalment paid and left paidAmount
             *        above totalAmount — with nothing carrying the excess
             *        forward, crediting it, or refunding it.
             *
             *        RecordRepaymentModal displays the outstanding figure right
             *        beside the input and validated only `> 0`, which is #272's
             *        shape: the screen knew the number it was not enforcing.
             *
             *        THIS IS THE AUTHORITATIVE CHECK, on the same read the
             *        credit below is computed from. The identical call before
             *        claimPaymentOnce is a whole-allocation preflight that keeps
             *        a mistyped amount from spending the bank reference; it
             *        cannot be the guard, because claimPaymentOnce serialises on
             *        the REFERENCE and not on the instalment, so two different
             *        references against one instalment could both clear it.
             *        Failing here throws into the catch, which calls
             *        markFulfilmentFailed — a claimed payment that was not
             *        credited is recorded rather than lost.
             */
            const bound = checkRepaymentAmount(line.amount, installmentData);
            if (!bound.ok) {
                throw new Error(bound.message);
            }

            if (installmentData.status === "paid") {
                throw new Error("Installment already fully paid");
            }

            // Calculate penalty if overdue
            const { penalty, daysOverdue } = calculatePenalty(dueDate, installmentData.totalAmount);
            calculatedPenalty += penalty;

            const totalDue = installmentData.totalAmount + penalty;
            const newPaidAmount = (installmentData.paidAmount || 0) + line.amount;

            // Determine new status
            let lineStatus: "pending" | "paid" | "overdue" | "partial" = "pending";
            if (newPaidAmount >= totalDue) {
                lineStatus = "paid";
            } else if (newPaidAmount > 0) {
                lineStatus = "partial";
            } else if (new Date() > dueDate) {
                lineStatus = "overdue";
            }
            calculatedStatus = lineStatus;

            finalInstallmentData = {
                ...installmentData,
                paidAmount: newPaidAmount,
                status: lineStatus,
                penaltyAmount: penalty,
                daysOverdue
            };

            // paidAmount moves by increment, never by writing a total computed
            // in JavaScript. The status beside it IS still derived from a read,
            // so two DIFFERENT references paid at the same moment can leave it
            // one payment behind — the amount stays correct, and the next
            // payment or the sweep below corrects the label. Money first,
            // labels best-effort: the reverse is what lost the payment.
            await installmentRef.update({
                paidAmount: FieldValue.increment(line.amount),
                status: lineStatus,
                paidAt: lineStatus === "paid" ? FieldValue.serverTimestamp() : installmentData.paidAt || null,
                penaltyAmount: penalty,
                daysOverdue: daysOverdue,
            });

            // Create payment record
            const paymentRef = db.collection(COLLECTIONS.LOAN_PAYMENTS).doc();
            await paymentRef.set({
                loanId: data.loanId,
                installmentId: line.installmentId,
                userId: data.userId,
                amount: line.amount,
                paymentReference: data.paymentReference,
                // #212 — which part of the transfer this row is. One reference
                // now produces more than one LOAN_PAYMENTS row, and a reader
                // reconciling against a bank statement needs to be able to tell
                // that they are parts of one transfer rather than duplicates.
                transferAmount: data.amount,
                allocationCount: allocations.length,
                penaltyPaid: penalty > 0 ? Math.min(line.amount, penalty) : 0,
                paidAt: FieldValue.serverTimestamp(),
            });

            credited.push({
                installmentId: line.installmentId,
                installmentNumber: installmentData.installmentNumber,
                amount: line.amount,
            });
        }

        // Post-transaction: Check if all installments are paid to update Loan Status
        // This is safe to run after because even if it races, the worst case is the loan status updates to 'repaid' twice.
        const allInstallmentsSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", data.loanId)
            .get();

        // `.every()` on an empty array is TRUE, and that is how a loan with no
        // schedule at all was declared fully repaid. A loan with nothing to
        // repay against has not been repaid; it has no schedule, which is a
        // different problem and one _getRepaymentScheduleAction reports.
        const allPaid = !allInstallmentsSnapshot.empty
            && allInstallmentsSnapshot.docs.every((doc) => doc.data().status === "paid");

        if (allPaid) {
            await loanRef.update({
                status: "repaid",
            });
        }

        // Audit log
        await createAdminAuditLog({
            action: "user_update",
            userId: data.userId,
            targetId: data.loanId,
            targetType: "loan",
            metadata: {
                installmentNumber: finalInstallmentData?.installmentNumber,
                amount: data.amount,
                penalty: calculatedPenalty,
                status: calculatedStatus,
                // #212 — the whole split, so a reader of the log can see which
                // instalments one transfer settled and by how much.
                allocations: credited,
            },
        });

        // Notification
        const { createNotificationAction } = await import('../notifications');
        await createNotificationAction({
            userId: data.userId,
            type: "success",
            title: "Repayment Recorded",
            message: `Your payment of ₦${data.amount.toLocaleString()} has been recorded.${calculatedPenalty > 0 ? ` Penalty: ₦${calculatedPenalty.toLocaleString()}` : ""}`,
            // `/loans/${id}` had no route behind it. /loans exists, with apply,
            // approve and success beneath it, and no [id] segment — so every
            // notification telling a borrower about their loan led to a 404.
            // /cooperatives/my-loans is the member's loan list, which is where
            // the platform actually shows a borrower their loans.
            link: "/cooperatives/my-loans",
            linkText: "View Loan",
        });

        return { error: null,  success: true as const, penalty: calculatedPenalty , data: null };
    } catch (error: any) {
        // Reaching here means the payment was CLAIMED and then fulfilment failed:
        // the function returns early when the claim is lost, so every path to
        // this catch is past that point. Two things throw in that window —
        // installment not found, and installment already fully paid.
        //
        // Milder here than at the sites that take the default status: this claim
        // sets `status: "loan_repayment"` on purpose, so the row never pretends to
        // be a completed payment. But nothing looks for a claimed repayment that
        // was never credited either, so it is still invisible. Marking makes it
        // findable alongside the rest.
        await markFulfilmentFailed(data.paymentReference, error?.message ?? String(error));
        logger.error("Repayment submission error:", error);
        return { success: false as const, error: error.message || "Failed to submit repayment" , data: null };
    }
}


/**
 * Repay a loan instalment out of cooperative savings.
 *
 * The other two repayment routes take money from somewhere else:
 * `submitRepaymentAction` records a bank transfer that already arrived, and
 * `processLoanRepaymentAction` debits the WALLET. Cooperative savings is
 * `savingsBalance` on `cooperative_members` — a third pot, and until now no
 * path reduced it for a loan.
 *
 * THE MINIMUM BALANCE APPLIES
 * ---------------------------
 * A member may not repay themselves below the ₦5,000 floor, the same rule the
 * withdrawal route enforces. Both now read it from `cooperative-limits.ts`
 * rather than each declaring its own 5000, because a floor that exists twice is
 * a floor that will eventually differ in one place.
 *
 * WHY THE STEPS ARE IN THIS ORDER
 * -------------------------------
 * There is no transaction spanning "take from savings" and "credit the loan" —
 * `runTransaction` in this codebase takes no lock. So the order is the design,
 * and the two orders fail differently:
 *
 *   debit, then claim   two concurrent submissions BOTH debit and only one
 *                       credits. The member pays twice for one instalment.
 *
 *   claim, then debit   the second submission loses the claim and returns
 *                       before touching the money. Nobody is charged twice.
 *
 * So the idempotency key is claimed first, and it gates everything after it.
 *
 * The cost of that choice: if the debit then fails, the key is spent and no
 * primitive here releases it. That failure is almost entirely "you would go
 * below the floor", so the floor is checked by an ordinary read BEFORE anything
 * is claimed. That read is not the guard — `debitJsonbBalanceWithFloor` applies
 * the real one under a row lock — it exists so the ordinary refusal happens
 * while the operation is still free to retry.
 *
 * If a member does hit the narrow race, an admin can still record the payment
 * through the Record Repayment modal with a different reference.
 */
export async function repayLoanFromSavingsAction(data: {
    loanId: string;
    installmentId: string;
    userId: string;
    amount: number;
}): Promise<
    | { success: true; error: null; data: { debited: number; savingsBalance: number } | null }
    | { success: false; error: string; data: null }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Authentication required", data: null };
        }
        const { session } = sessionResult;

        // Self OR admin, the same idiom as submitRepaymentAction. The borrower
        // check is kept: a member must not spend somebody else's savings.
        const isActingAdmin = isAdmin(session?.user?.roles);
        if (!session?.user?.id || (session.user.id !== data.userId && !isActingAdmin)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        if (!Number.isFinite(data.amount) || data.amount <= 0) {
            return { success: false as const, error: "Invalid repayment amount", data: null };
        }

        // Pre-flight, not a guard. See the note above on why this read exists.
        const memberDoc = await db
            .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .doc(data.userId)
            .get();

        if (!memberDoc.exists) {
            return { success: false as const, error: "You must be a cooperative member", data: null };
        }

        // #276 Existing is not the same as may transact, and this moves savings.
        // Found by the DERIVED door list rather than by anyone remembering it —
        // the hand-written list in cooperative-transacting-membership.test.ts
        // named four doors and there were seven.
        if (!canTransactAsMember(memberDoc.data())) {
            return { success: false as const, error: NOT_A_TRANSACTING_MEMBER_MESSAGE, data: null };
        }

        const currentBalance = Number(memberDoc.data()?.savingsBalance || 0);
        if (currentBalance - data.amount < COOPERATIVE_MINIMUM_BALANCE) {
            return {
                success: false as const,
                error: `You must keep a minimum balance of ${formatMinimumBalance()}. Available for repayment: ₦${availableAboveFloor(currentBalance).toLocaleString()}`,
                data: null,
            };
        }

        /**
         *   #286 BOUNDED BEFORE THE MONEY MOVES, NOT AT THE CREDIT.
         *
         *        This path DEBITS savings and credits the instalment
         *        afterwards, and the comment further down says a failure
         *        between the two is "DELIBERATELY NOT COMPENSATED". So checking
         *        the amount at the credit step would leave the member's savings
         *        short by exactly the overpayment it refused.
         *
         *        Same shared rule as submitRepaymentAction, applied earlier.
         *        The instalment is read here for that purpose and for nothing
         *        else; submitRepaymentAction re-reads it inside its own
         *        transaction, which is where the authoritative check lives.
         */
        const boundDoc = await db.collection(COLLECTIONS.LOAN_REPAYMENTS).doc(data.installmentId).get();
        if (!boundDoc.exists) {
            return { success: false as const, error: "Installment not found", data: null };
        }

        const bound = checkRepaymentAmount(data.amount, boundDoc.data() as Record<string, any>);
        if (!bound.ok) {
            return { success: false as const, error: bound.message, data: null };
        }

        // Deterministic in the instalment and the amount, so a double-click or a
        // resubmitted form is the same key rather than a second repayment.
        // Rule 2 in wallet-ledger.ts: a reference that varies per attempt is not
        // an idempotency key.
        const reference = `SAV-${data.loanId}-${data.installmentId}-${Math.round(data.amount * 100)}`;

        const gate = await claimIdempotencyKey({
            key: reference,
            userId: data.userId,
            action: "loan_repayment_from_savings",
        });

        if (!gate.claimed) {
            // Already processed. A success, not an error — rule 3.
            logger.warn("[repayLoanFromSavingsAction] duplicate repayment ignored", {
                reference, loanId: data.loanId,
            });
            return { error: null, success: true as const, data: null };
        }

        const debit = await debitJsonbBalanceWithFloor({
            table: "cooperative_members",
            id: data.userId,
            field: "savingsBalance",
            amount: data.amount,
            floor: COOPERATIVE_MINIMUM_BALANCE,
        });

        if (!debit.ok) {
            // below_floor is not insufficient_funds. The member has the money and
            // is not permitted to use all of it; telling someone with a healthy
            // balance that they have insufficient funds would simply be false.
            const message =
                debit.reason === "below_floor"
                    ? `You must keep a minimum balance of ${formatMinimumBalance()}. Available for repayment: ₦${availableAboveFloor(Number(debit.balance)).toLocaleString()}`
                    : debit.reason === "insufficient_funds"
                        ? `Insufficient savings. Available: ₦${Number(debit.balance).toLocaleString()}`
                        : "You must be a cooperative member";

            logger.error("[repayLoanFromSavingsAction] debit refused after key was claimed", {
                reference, reason: debit.reason, loanId: data.loanId,
            });
            return { success: false as const, error: message, data: null };
        }

        // The money has left savings. Credit the instalment.
        //
        // submitRepaymentAction claims `reference` again through
        // claimPaymentOnce — a different table from the idempotency key, so this
        // is not a repeat of the gate above. It is what puts the repayment in
        // processed_payments where every other repayment is recorded, so the two
        // collection routes stay reconcilable against one another.
        const recorded = await submitRepaymentAction({
            loanId: data.loanId,
            installmentId: data.installmentId,
            userId: data.userId,
            amount: data.amount,
            paymentReference: reference,
        });

        if (!recorded.success) {
            // Savings were debited and the instalment was not credited.
            //
            // DELIBERATELY NOT COMPENSATED, unlike the six sibling debit sites.
            //
            // compensateJsonbDebit exists now and puts a debited amount back
            // when the work after it fails. It is correct at every site where
            // that work is purely local writes. This is the one site where it is
            // not: submitRepaymentAction claims `reference` through
            // claimPaymentOnce, so a failure here may have come AFTER the claim
            // landed. Crediting the savings back would then leave the member
            // with their money and a claimed repayment reference that
            // reconciliation can later treat as paid — the same double-credit
            // hazard that made the WAVE payout rollback a defect.
            //
            // So this stays a manual settlement, and the log carries everything
            // needed for one.
            logger.error("[repayLoanFromSavingsAction] SAVINGS DEBITED BUT INSTALMENT NOT CREDITED", {
                reference,
                loanId: data.loanId,
                installmentId: data.installmentId,
                userId: data.userId,
                amount: data.amount,
                cause: recorded.error,
            });
            return {
                success: false as const,
                error: "Your savings were debited but the repayment could not be recorded. Please contact support with reference " + reference,
                data: null,
            };
        }

        return {
            error: null,
            success: true as const,
            data: { debited: data.amount, savingsBalance: Number(debit.balance) },
        };
    } catch (error: any) {
        logger.error("Repay from savings error:", error);
        return { success: false as const, error: error.message || "Failed to repay from savings", data: null };
    }
}


/**
 * Get repayment history for a loan
 */
export async function getRepaymentHistoryAction(
    loanId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        // THE OWNERSHIP CHECK WAS SKIPPED WHENEVER THE LOOKUP MISSED.
        //
        // `if (loanDoc.exists)` meant a loan this reader could not find imposed
        // no check at all, and it looked in loan_applications only — so every
        // loan filed through the member loan page, which lives in
        // cooperative_loans, fell straight through it. Any signed-in user who
        // knew such a loan's id was served its full repayment history: amounts,
        // dates, payment references, the borrower's id.
        //
        // Both halves are closed. The loan is resolved across both collections,
        // and an unresolvable id is refused rather than waved through — the
        // check now fails closed.
        const resolvedLoan = await resolveLoanApplication(loanId);

        if (!resolvedLoan) {
            return { success: false as const, error: "Loan not found", data: null };
        }

        const loanOwner = normaliseLoanApplication(
            resolvedLoan.snap.data() as Record<string, any>,
            resolvedLoan.collection,
        ).userId;

        if (loanOwner !== session.user.id && !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const paymentsSnapshot = await db.collection(COLLECTIONS.LOAN_PAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        const payments = serializeDocs(paymentsSnapshot.docs);

        return { error: null, success: true as const, payments , data: null };
    } catch (error) {
        logger.error("Failed to fetch repayment history:", error);
        return { success: false as const, error: "Failed to fetch repayment history" , data: null };
    }
}
