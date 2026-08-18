"use server";

import { z } from "zod";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { loanApplicationSchema,
    loanApprovalSchema,
    type LoanApplicationData,
    type LoanApprovalData } from "@/lib/validations/loan";
import { AuditActionType, LoanStatus, type LoanApplication } from "@/types/strict";
import { calculateRepaymentTerms } from "@/lib/loan-terms";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { logger } from "@/lib/logger";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { creditWalletOnce, debitWalletLocked, claimSingleOpenLoanApplication } from "@/lib/wallet-ledger";
import {
    needsDualControl,
    guarantorBlocksApproval,
    GUARANTOR_UNVERIFIED_MESSAGE,
} from "@/lib/loan-approval-policy";

/**
 * Submit a new loan application
 */
export async function submitLoanApplication(
    data: z.infer<typeof loanApplicationSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const validated = loanApplicationSchema.parse(data);

        // The wrapper here claimed to make the side-effects atomic. It did not:
        // the adapter queues writes and flushes them one at a time after the
        // callback returns, with no isolation and no rollback.
        //
        // The double-lending check is now the insert itself.
        //
        // It used to be a pair of reads: query both loan collections for open
        // applications and refuse if either was non-empty. Neither read took a
        // lock — inside the wrapper or out of it — so two applications submitted
        // together both saw an empty result and both created a pending row.
        //
        // A row lock could not close it, because the thing being guarded is the
        // ABSENCE of rows: there is nothing to lock. Migration 021 does the
        // check and the insert together under a per-borrower advisory lock.
        const result = await (async () => {
            // Repayment terms are computed and stored at application time.
            //
            // Applications were previously saved with an amount and a term but
            // no rate and no schedule, so nothing recorded what the borrower
            // would actually owe. The rate is stored on the record rather than
            // read from config at display time, so a later rate change does not
            // silently rewrite the terms of loans already applied for.
            const terms = calculateRepaymentTerms(validated.amount, validated.repaymentPeriod);

            const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc();

            // Timestamps are literal ISO strings, not FieldValue sentinels: the
            // row goes to Postgres as JSONB and sentinels are not resolved there
            // — the same caveat claim_status_transition carries. It fails
            // silently by storing a plausible-looking object, so it is worth
            // stating. created_at/updated_at are set by the function.
            const nowIso = new Date().toISOString();

            const claim = await claimSingleOpenLoanApplication({
                userId: session.user.id,
                id: loanRef.id,
                table: "document_collections",
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                row: {
                    ...validated,
                    userId: session.user.id,
                    status: LoanStatus.PENDING,
                    guarantorVerified: true, // General loans have no guarantor and are pre-verified
                    // interestRate is a MONTHLY percentage. See src/lib/loan-terms.ts —
                    // treating it as annual is a defect this codebase has already had.
                    interestRate: terms.interestRate,
                    monthlyPayment: terms.monthlyPayment,
                    totalRepayment: terms.totalRepayment,
                    totalInterest: terms.totalInterest,
                    appliedAt: nowIso,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    approvedBy: null,
                    approvedAt: null,
                    rejectionReason: null,
                },
            });

            if (!claim.claimed) {
                throw new Error("Active or pending loan application already exists platform-wide.");
            }

            return { loanId: loanRef.id };
        })();

        const { loanId } = result;

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try { await createAdminAuditLog({
                userId: session.user.id,
                action: 'loan_approved', // Using existing enum or mapping
                targetId: loanId,
                targetType: 'loan_application',
                metadata: {
                    amount: validated.amount,
                    purpose: validated.purpose,
                    repaymentPeriod: validated.repaymentPeriod } });
        } catch (auditError) { console.error("Failed to log loan creation audit:", auditError);
        }

        return { error: null, success: true as const, data: { loanId } };
    } catch (error) { if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: (error as z.ZodError).issues.map(e => e.message), data: null };
        }
        return { success: false as const, error: "Failed to submit loan application", data: null };
    }
}

/**
 * Get all loan applications for current user
 */
export async function getUserLoanApplications() { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const loansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc');

        const snapshot = await loansQuery.get();
        const loans = serializeDocs<LoanApplication>(snapshot.docs);

        return { error: null, success: true as const, data: loans };
    } catch (error) { return { success: false as const, error: "Failed to fetch loan applications", data: null };
    }
}

/**
 * Get a specific loan application by ID
 */
export async function getLoanApplication(loanId: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { success: false as const, error: "Loan application not found", loan: null, data: null };
        }

        const data = loanDoc.data()!;

        // Check authorization - user can only view their own loans unless admin
        //
        // "cooperatives:approve_loans", not a hand-written ['admin',
        // 'super_admin'].
        //
        // This file is the THIRD door onto LOAN_APPLICATIONS — alongside
        // cooperative/_loans_decisions.ts and
        // api/admin/cooperative/approve-loan — and it was the only one still
        // naming roles instead of asking PERMISSION_MATRIX. The list it named
        // omits `cooperative_admin`, which is the role whose entire job this
        // is: the matrix grants it "cooperatives:approve_loans" and the other
        // two doors honour that. So a cooperative administrator could approve a
        // loan through two paths and was refused by the third, for the same
        // application in the same collection.
        //
        // Narrower than the matrix rather than wider, so this was a lockout
        // rather than a hole — but a rule that disagrees with the platform's
        // own answer is how the other five hand-written role sets in this
        // codebase went wrong. Five checks in this file, all the same
        // substitution; `admin` and `super_admin` both hold the permission, so
        // nobody who could act before loses the ability.
        if (data.userId !== session.user.id && !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized to view this loan", loan: null, data: null };
        }

        const loan = serializeDoc<LoanApplication>(loanDoc.id, data);

        return { error: null, success: true as const, data: loan };
    } catch (error) { return { success: false as const, error: "Failed to fetch loan application", data: null };
    }
}

/**
 * Get all pending loan applications (Admin only)
 */
export async function getPendingLoanApplications() { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    if (!session || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized - Admin only", loans: [], data: null };
    }

    try { const loansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where('status', '==', LoanStatus.PENDING)
            .orderBy('createdAt', 'desc');

        const snapshot = await loansQuery.get();
        const loans = serializeDocs<LoanApplication>(snapshot.docs);

        return { error: null, success: true as const, data: loans };
    } catch (error) { return { success: false as const, error: "Failed to fetch pending loans", data: null };
    }
}

/**
 * Approve or reject a loan application (Admin only)
 */
export async function approveLoanApplication(
    data: z.infer<typeof loanApprovalSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    if (!session || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized - Admin only", data: null };
    }

    try {
        const validated = loanApprovalSchema.parse(data);

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(validated.loanId);

        // WHAT WAS WRONG HERE
        // -------------------
        // This wrote `status: "approved"` to LOAN_APPLICATIONS behind nothing
        // but `roles.includes('admin')`. The same collection, reached through
        // admin.ts or cooperative/_loans.ts, needs two different admins above
        // MAKER_CHECKER_THRESHOLD — the control added when the dual-control
        // bypass was fixed. This function was never part of that change, so
        // /loans/approve remained a door that let one admin approve a loan of
        // any size on their own.
        //
        // It was also a check-then-write: read the status, compare it to
        // "pending", then update — inside runTransaction, which takes no lock.
        // Two admins approving together both read "pending" and both wrote.
        //
        // Both are fixed the same way as the other two paths: the status
        // transition is CLAIMED, so exactly one caller wins, and the maker
        // branch returns before anything is marked approved.
        const loanDoc = await loanRef.get();
        if (!loanDoc.exists) {
            return { success: false as const, error: "Loan application not found", data: null };
        }

        const loanData = loanDoc.data()!;
        const adminId = session.user.id;
        const adminName = session.user.name || session.user.email;
        const nowIso = new Date().toISOString();
        const approvalChain = loanData.approvalChain || {};

        if (!validated.approved) {
            // Rejection moves no money and needs no second signature, but it
            // still has to be claimed: two admins rejecting at once both wrote
            // before, and a rejection racing an approval could overwrite it.
            const rejectClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: validated.loanId,
                fromAny: [LoanStatus.PENDING, LoanStatus.REVIEWING, "partially_approved"],
                to: LoanStatus.REJECTED,
                patch: {
                    approvedBy: adminId,
                    approvedAt: nowIso,
                    updatedAt: nowIso,
                    ...(validated.notes ? { approvalNotes: validated.notes } : {}),
                    ...(validated.rejectionReason ? { rejectionReason: validated.rejectionReason } : {}),
                },
            });

            if (!rejectClaim.claimed) {
                return {
                    success: false as const,
                    error: rejectClaim.status === null
                        ? "Loan application not found"
                        : `Loan application is already ${rejectClaim.status}`,
                    data: null,
                };
            }

            try { await createAdminAuditLog({
                    userId: adminId,
                    action: 'loan_rejected',
                    targetId: validated.loanId,
                    targetType: 'loan_application',
                    metadata: {
                        approved: false,
                        notes: validated.notes,
                        rejectionReason: validated.rejectionReason } });
            } catch (auditError) { console.error("Failed to log loan rejection audit:", auditError);
            }

            return { error: null, success: true as const, data: null };
        }

        // A guarantor who has not been verified blocks approval — the third
        // door finally applying the control the other two already do.
        //
        // getPendingLoanApplications above filters on `status == PENDING` and
        // nothing else, so this queue contains EVERY pending row in
        // LOAN_APPLICATIONS — including cooperative applications, which record
        // a guarantor and require an admin to verify them through
        // /api/admin/cooperative/verify-guarantor.
        //
        // cooperative/_loans_decisions.ts and api/admin/cooperative/approve-loan
        // both call guarantorBlocksApproval. This one did not. So the same
        // application, with the same unverified guarantor, was refused on two
        // screens and approved on the third — and /loans/approve is the screen
        // an admin reaches from the "Loan Application" notification that
        // admin/_loans.ts sends.
        //
        // Safe for the business-loan product this file was written for:
        // guarantorBlocksApproval is false when no guarantor is recorded, and
        // the schema /loans/apply validates against has no guarantor fields at
        // all. Only an unverified-guarantor cooperative application is newly
        // refused, which is precisely the control being restored.
        if (guarantorBlocksApproval(loanData)) {
            return { success: false as const, error: GUARANTOR_UNVERIFIED_MESSAGE, data: null };
        }

        const requiresDualControl = needsDualControl(loanData.amount);

        if (requiresDualControl && !approvalChain.firstApprover) {
            // First approval. Claiming the transition is what stops two admins
            // both becoming the maker and one approval silently replacing the
            // other.
            const makerClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: validated.loanId,
                fromAny: [LoanStatus.PENDING, LoanStatus.REVIEWING],
                to: "partially_approved",
                patch: {
                    // Written whole because the CAS patch shallow-merges.
                    approvalChain: {
                        firstApprover: adminId,
                        firstApprovalAt: nowIso,
                        firstApproverName: adminName,
                    },
                    ...(validated.notes ? { approvalNotes: validated.notes } : {}),
                    updatedAt: nowIso,
                },
            });

            if (!makerClaim.claimed) {
                return {
                    success: false as const,
                    error: makerClaim.status === null
                        ? "Loan application not found"
                        : `Loan application is already ${makerClaim.status}`,
                    data: null,
                };
            }

            try {
                await createAdminAuditLog({
                    userId: adminId,
                    action: 'loan_approved',
                    targetId: validated.loanId,
                    targetType: 'loan_application',
                    metadata: { approved: true, role: "Maker", notes: validated.notes },
                });
            } catch (auditError) { console.error("Failed to log loan first-approval audit:", auditError);
            }

            // The loan must NOT become approved on a first signature. Nothing
            // downstream may treat this as a disbursable loan.
            return {
                success: true as const,
                error: null,
                data: null,
                message: "First approval recorded. A second admin must approve before this loan can be disbursed.",
            };
        }

        if (requiresDualControl && approvalChain.firstApprover === adminId) {
            return {
                success: false as const,
                error: "You cannot verify your own approval. Another admin is required.",
                data: null,
            };
        }

        const finalClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LOAN_APPLICATIONS,
            id: validated.loanId,
            fromAny: requiresDualControl
                ? ["partially_approved"]
                : [LoanStatus.PENDING, LoanStatus.REVIEWING],
            to: LoanStatus.APPROVED,
            patch: {
                approvedBy: adminId,
                approvedAt: nowIso,
                updatedAt: nowIso,
                ...(validated.notes ? { approvalNotes: validated.notes } : {}),
                ...(requiresDualControl
                    ? {
                        approvalChain: {
                            ...approvalChain,
                            secondApprover: adminId,
                            secondApprovalAt: nowIso,
                            secondApproverName: adminName,
                        },
                    }
                    : {}),
            },
        });

        if (!finalClaim.claimed) {
            return {
                success: false as const,
                error: finalClaim.status === null
                    ? "Loan application not found"
                    : `Loan application is already ${finalClaim.status}`,
                data: null,
            };
        }

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try { await createAdminAuditLog({
                userId: adminId,
                action: 'loan_approved',
                targetId: validated.loanId,
                targetType: 'loan_application',
                metadata: {
                    approved: true,
                    role: requiresDualControl ? "Checker" : "Approver",
                    notes: validated.notes } });
        } catch (auditError) { console.error("Failed to log loan approval audit:", auditError);
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { if (error instanceof z.ZodError) {
            return { success: false as const, error: "Validation error", details: (error as z.ZodError).issues.map(e => e.message)};
        }
        return { success: false as const, error: "Failed to process loan approval"};
    }
}

/**
 * Update loan status to DISBURSED (Admin only)
 */
export async function disburseLoan(loanId: string, disbursementNotes?: string) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;
    if (!session || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized - Admin only"};
    }

    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);

        // WHAT WAS WRONG HERE
        // -------------------
        // This read the status, compared it to APPROVED, and then credited the
        // borrower's wallet — inside runTransaction, which takes no lock. Two
        // disbursements of the same loan arriving together both read APPROVED,
        // both passed, and both credited. The borrower was paid twice and the
        // loan record showed one disbursement.
        //
        // Two claims replace it, in this order:
        //
        //   1. The status transition approved → disbursed. Exactly one caller
        //      wins it, so exactly one reaches the credit below.
        //   2. creditWalletOnce, keyed on the loan id. Even if step 1 were
        //      somehow bypassed, the reference is already claimed and the
        //      second credit is a no-op.
        //
        // Status first, money second: a crash between them leaves a loan marked
        // disbursed that was never paid, which an admin can see and fix. The
        // reverse — money out with the loan still APPROVED — invites a second
        // disbursement of a loan that was already paid.
        const loanDoc = await loanRef.get();
        if (!loanDoc.exists) {
            return { success: false as const, error: "Loan application not found", data: null };
        }

        const loanData = loanDoc.data()!;
        const userId = loanData.userId;
        const amount = loanData.amount || 0;

        if (!userId) {
            return { success: false as const, error: "Loan application has no borrower", data: null };
        }
        if (!(amount > 0)) {
            return { success: false as const, error: "Loan application has no amount to disburse", data: null };
        }

        const nowIso = new Date().toISOString();

        const disburseClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LOAN_APPLICATIONS,
            id: loanId,
            fromAny: [LoanStatus.APPROVED],
            to: LoanStatus.DISBURSED,
            patch: {
                disbursedAt: nowIso,
                disbursedBy: session.user.id,
                ...(disbursementNotes ? { disbursementNotes } : {}),
                updatedAt: nowIso,
            },
        });

        if (!disburseClaim.claimed) {
            return {
                success: false as const,
                error: disburseClaim.status === null
                    ? "Loan application not found"
                    : disburseClaim.status === LoanStatus.DISBURSED
                        ? "Loan has already been disbursed"
                        : `Loan must be APPROVED before disbursement. Current status: ${disburseClaim.status}`,
                data: null,
            };
        }

        // ── CREDIT USER WALLET ──────
        //
        // The reference is derived from the loan id, so it is stable across
        // retries — a fresh random reference per attempt would defeat the
        // idempotency entirely.
        //
        // status "disbursement", NOT "completed": platform_revenue_totals()
        // sums processed_payments rows whose status is "completed", and money
        // paid OUT to a borrower is the opposite of revenue. Recording it as
        // completed would inflate reported revenue by every loan disbursed.
        const credit = await creditWalletOnce({
            reference: `LOAN-DISB-${loanId}`,
            userId,
            amount,
            paymentType: "loan_disbursement",
            source: "loans",
            status: "disbursement",
            metadata: { loanId, disbursedBy: session.user.id },
        });

        // claimed: false means the credit already landed — a success, not an
        // error. See the rules in src/lib/wallet-ledger.ts.
        const balanceAfter = credit.balance;
        const balanceBefore = credit.claimed ? balanceAfter - amount : balanceAfter;

        // ── RECORD IN WALLET TRANSACTIONS ──────
        // Ledger rows last, and only for the caller that actually moved money.
        if (credit.claimed) {
            const walletTxRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            await walletTxRef.set({
                id: walletTxRef.id,
                walletId: userId,
                userId,
                type: "funding",
                amount,
                balanceBefore,
                balanceAfter,
                reference: loanId,
                description: `Loan Disbursement for Application #${loanId.substring(0, 8)}`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // ── RECORD IN GLOBAL LEDGER ──────
            // The id is derived from the whole loan id rather than its first 8
            // characters, so two loans sharing a prefix cannot overwrite each
            // other's ledger row.
            const txId = `LOAN-DISB-${loanId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            await txRef.set({
                id: txId,
                userId,
                type: "loan_disbursement",
                module: "loans",
                amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: loanId,
                description: `Loan Disbursement for Application #${loanId.substring(0, 8)}`
            });
        } else {
            logger.warn("[disburseLoan] wallet credit was already claimed; ledger rows left untouched", {
                loanId,
                userId,
            });
        }

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try { await createAdminAuditLog({
                userId: session.user.id,
                action: 'loan_approved', // Using existing mapping
                targetId: loanId,
                targetType: 'loan_application',
                metadata: {
                    status: 'disbursed',
                    notes: disbursementNotes } });
        } catch (auditError) { console.error("Failed to log loan disbursement audit:", auditError);
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { return { success: false as const, error: "Failed to disburse loan", data: null };
    }
}

/**
 * Get loan statistics (Admin only)
 */
export async function getLoanStatistics() { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    if (!session || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) { return { success: false as const, error: "Unauthorized - Admin only", stats: null, data: null };
    }

    try { // Optimization: Select only necessary fields to reduce bandwidth
        // Ideally, use Distributed Counters or Firestore Aggregation queries for 100k+ scale
        const loansSnapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .select('status', 'amount')
            .get();

        const stats = {
            total: loansSnapshot.size,
            pending: 0,
            approved: 0,
            rejected: 0,
            disbursed: 0,
            repaid: 0,
            totalAmount: 0,
            approvedAmount: 0 };

        loansSnapshot.docs.forEach(doc => { const data = doc.data();
            const status = data.status as LoanStatus;
            const amount = data.amount as number || 0;

            stats.totalAmount += amount;

            if (status === LoanStatus.PENDING) stats.pending++;
            else if (status === LoanStatus.APPROVED) {
                stats.approved++;
                stats.approvedAmount += amount;
            }
            else if (status === LoanStatus.REJECTED) stats.rejected++;
            else if (status === LoanStatus.DISBURSED) { stats.disbursed++;
                stats.approvedAmount += amount;
            }
            else if (status === LoanStatus.REPAID) { stats.repaid++;
                stats.approvedAmount += amount;
            }
        });

        return { error: null, success: true as const, data: stats };
    } catch (error) { return { success: false as const, error: "Failed to fetch loan statistics", data: null };
    }
}

/**
 * Process a loan repayment from the user's wallet
 */
export async function processLoanRepaymentAction(loanId: string, amount: number) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
    const { session } = sessionResult;

    try {
        if (!Number.isFinite(amount) || amount <= 0) {
            return { success: false as const, error: "Repayment amount must be positive" };
        }

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);

        // WHAT WAS WRONG HERE
        // -------------------
        // This read the wallet balance, compared it to the amount, and then
        // decremented — inside runTransaction, which takes no lock. Two
        // repayments submitted together both read the same balance, both passed
        // the sufficiency check, and both debited. The wallet went negative.
        //
        // Same shape as the cooperative savings and WAVE earnings overdrafts,
        // and the same fix. This balance is the wallets table's own `balance`
        // column, so debitWalletLocked reaches it directly.
        //
        // debitWalletLocked, not debitWalletOnce: a repayment has no stable
        // key. A borrower may legitimately pay ₦5,000 twice, and inventing a
        // reference per attempt would either block the second payment or
        // defeat the idempotency it pretends to provide. The row lock is what
        // this needs; there is nothing to be idempotent about.
        const loanDoc = await loanRef.get();
        if (!loanDoc.exists) throw new Error("Loan application not found");

        const loanData = loanDoc.data()!;

        // Authorisation before money moves, not alongside it.
        if (loanData.userId !== session.user.id) throw new Error("Unauthorized repayment");
        if (loanData.status !== LoanStatus.DISBURSED) throw new Error("Loan is not in a repayable state");

        const debit = await debitWalletLocked({ userId: session.user.id, amount });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient wallet balance for repayment"
                    : "User wallet not found",
            };
        }

        // ── UPDATE LOAN STATUS ──────
        // Completion is measured against everything repaid so far, not against
        // this payment alone. The old check compared a single instalment to the
        // loan total, so a loan settled in two half payments stayed DISBURSED
        // for ever even though repaidAmount had reached the full amount.
        const repaidBefore = Number(loanData.repaidAmount) || 0;
        const isFullRepayment = repaidBefore + amount >= (Number(loanData.amount) || 0);

        await loanRef.update({
            status: isFullRepayment ? LoanStatus.REPAID : LoanStatus.DISBURSED,
            repaidAmount: FieldValue.increment(amount),
            ...(isFullRepayment ? { repaidAt: FieldValue.serverTimestamp() } : {}),
            updatedAt: FieldValue.serverTimestamp()
        });

        // ── RECORD IN GLOBAL LEDGER ──────
        // Ledger row last: a crash here leaves money moved and the loan
        // credited, with a missing receipt — recoverable. Writing it first
        // would leave a receipt for a repayment that never happened.
        const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc();
        await txRef.set({
            id: txRef.id,
            userId: session.user.id,
            type: "loan_repayment",
            module: "loans",
            amount,
            currency: "NGN",
            status: "completed",
            date: FieldValue.serverTimestamp(),
            reference: loanId,
            description: `Loan Repayment for Application #${loanId.substring(0, 8)}`
        });

        return { error: null, success: true as const, data: null };
    } catch (error: any) {
        return { success: false as const, error: error.message || "Failed to process loan repayment" };
    }
}
