"use server";

import { versionedUpdate } from "@/lib/optimistic-locking";
import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { filterByLoanProduct } from "@/lib/loan-product";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { needsDualControl } from "@/lib/loan-approval-policy";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { LoanApplicationReviewSchema } from "@/lib/schemas";
import { hasAdminPermission } from "@/lib/admin-permissions";

// ============================================
// Loan Application Management (Admin)
// ============================================

async function _getPendingLoanApplications(limit = 50, lastDocId?: string): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false as const, data: null };
        }

        const loanCol = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
        let loanQuery: import("@/lib/supabase-db").SupabaseQuery = loanCol
            .where("status", "==", "pending")
            .orderBy("appliedAt", "desc")
            .limit(limit + 1);

        if (lastDocId) {
            const cursor = await loanCol.doc(lastDocId).get();
            if (cursor.exists) loanQuery = loanQuery.startAfter(cursor);
        }

        const snapshot = await loanQuery.get();

        // The cooperative door. Same split as /loans/approve, opposite side:
        // this queue is reached from the cooperative loan notification and its
        // approval applies the membership, savings-cap and guarantor rules, so
        // a business application listed here would be judged by rules it was
        // never written against. Filtered in memory — see lib/loan-product.ts.
        const cooperativeDocs = filterByLoanProduct(snapshot.docs, 'cooperative');
        const pageDocs = cooperativeDocs.slice(0, limit);
        const hasMore = cooperativeDocs.length > limit;
        const nextCursor = hasMore ? pageDocs[pageDocs.length - 1]?.id ?? null : null;

        const applications = serializeDocs(pageDocs);

        // HYDRATION: Batch-resolve user bank details
        const userIds = [...new Set(applications.map((app: any) => app.userId).filter(Boolean))];
        const userMap: Record<string, any> = {};

        if (userIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < userIds.length; i += 30) {
                chunks.push(userIds.slice(i, i + 30));
            }

            const userSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            userSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    userMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: {
                            bankName: data.bankName || data.bankAccount?.bankName || "",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                        }
                    };
                });
            });
        }

        const enrichedApplications = applications.map((app: any) => ({
            ...app,
            user: userMap[app.userId] || null,
            // Fallback for UI components expecting root bankDetails
            bankDetails: userMap[app.userId]?.bankDetails || {
                bankName: app.bankName || "",
                accountNumber: app.accountNumber || "",
                accountName: app.accountName || (userMap[app.userId]?.name || ""),
                bankCode: app.bankCode || ""
            }
        }));

        return {
            error: null,
            success: true as const,
            data: enrichedApplications,
            hasMore,
            lastDocId: nextCursor,
        };
    } catch (error: any) {
        logger.error("Get pending loan applications error:", error);
        return { error: "Failed to fetch loan applications", success: false as const, data: null };
    }
}

async function _approveLoanApplication(
    applicationId: string,
    /**
     * Kept for the existing call signature, no longer used.
     *
     * It fed an optimistic-lock check that re-read the document inside
     * runTransaction — which takes no lock, so two callers read the same
     * version and both passed. The status claim below enforces the same thing
     * for real.
     */
    version?: number
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "cooperatives:approve_loans")) {
            return { error: "Unauthorized: Permission required - cooperatives:approve_loans", success: false as const };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "approved" });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // ATOMIC TRANSACTION: State Verification and Transition
        const txResult = await db.runTransaction(async (transaction) => {
            const loanSnap = await transaction.get(loanRef);
            if (!loanSnap.exists) {
                throw new Error("Loan application not found");
            }
            const loanData = loanSnap.data()!;
            // Prevent double-processing
            if (loanData.status === "approved" || loanData.status === "disbursed") {
                return { error: null, success: true as const, alreadyProcessed: true, loanData };
            }

            // Double-lending verification: Check for other active/pending loans platform-wide
            const borrowerId = loanData.userId;
            const otherGeneralLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", borrowerId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherGeneralLoansSnap = await transaction.get(otherGeneralLoansQuery);

            const otherCoopLoansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", borrowerId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherCoopLoansSnap = await transaction.get(otherCoopLoansQuery);

            const otherGeneralLoansCount = otherGeneralLoansSnap.docs.filter(doc => doc.id !== applicationId).length;
            const otherCoopLoansCount = otherCoopLoansSnap.docs.filter(doc => doc.id !== applicationId).length;

            if (otherGeneralLoansCount > 0 || otherCoopLoansCount > 0) {
                throw new Error("Active or pending loan application already exists platform-wide for this user.");
            }

            // Validate tier eligibility
            const tierMultiplier = 2.0; 
            const maxLoanAmount = (loanData.contributionAmount || 0) * tierMultiplier;

            if (loanData.amount > maxLoanAmount) {
                throw new Error(`Loan amount exceeds maximum for Member tier (₦${maxLoanAmount.toLocaleString()})`);
            }

            return { error: null, success: true as const, checksPassed: true, loanData };
        });

        if (txResult.alreadyProcessed) {
            return { success: true as const, message: "Loan application already processed", error: null };
        }

        const { loanData } = txResult;
        const approvalChain = loanData.approvalChain || {};
        const adminId = session.user.id;
        const adminName = session.user.name || session.user.email;
        const nowIso = new Date().toISOString();

        // ── APPROVAL ─────────────────────────────────────────────────────────
        //
        // Every path below claims the status transition, so exactly one caller
        // proceeds to disbursement. The checks above ran inside runTransaction,
        // which takes no lock, and are advisory only.
        //
        // WHAT WAS WRONG HERE
        // -------------------
        // Two separate defects, and the first is the serious one.
        //
        // 1. The maker's approval fell straight through to disbursement. The
        //    maker branch returned `makerApproval: true` and NOTHING checked it
        //    before the Paystack payout below — the `return` that should have
        //    stopped it was missing (the orphaned indentation on the audit log
        //    is where it used to be). So a single admin approving a ≥₦1m loan
        //    paid it out on their own, and the status then became "disbursed",
        //    which made the second approver's attempt return "already
        //    processed". Dual control never happened, and the threshold was
        //    decorative.
        //
        // 2. `if (!approvalChain.firstApprover)` and the self-approval check
        //    both ran inside runTransaction, which holds no lock. Two admins
        //    approving together both read an empty chain, so one approval was
        //    silently overwritten; two checkers both passed and BOTH reached
        //    the payout.
        // The threshold used to be declared here, and again in
        // cooperative/_loans.ts, and not at all in loan-actions.ts — which is
        // how /loans/approve ended up approving ₦10m loans on one signature.
        // It lives in src/lib/loan-approval-policy.ts now.
        const requiresDualControl = needsDualControl(loanData.amount);

        if (requiresDualControl && !approvalChain.firstApprover) {
            // First approval. Claiming the transition is what stops two admins
            // both becoming the maker.
            const makerClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: applicationId,
                fromAny: ["pending", "reviewing"],
                to: "partially_approved",
                patch: {
                    approvalChain: {
                        firstApprover: adminId,
                        firstApprovalAt: nowIso,
                        firstApproverName: adminName,
                    },
                    updatedAt: nowIso,
                },
            });

            if (!makerClaim.claimed) {
                return {
                    success: false as const,
                    error: makerClaim.status === null
                        ? "Loan application not found"
                        : `This application is already ${makerClaim.status}.`,
                };
            }

            await createAdminAuditLog({
                action: "loan_partially_approved",
                userId: adminId,
                targetId: applicationId,
                targetType: "application",
                metadata: { amount: loanData.amount, role: "Maker" },
            });

            // The money must NOT move on a first approval. This return is the
            // one that was missing.
            return {
                success: true as const,
                error: null,
                message: "First approval recorded. A second admin must approve before this loan is disbursed.",
            };
        }

        if (requiresDualControl) {
            // Second approval. The self-approval check is safe to read here:
            // firstApprover is only ever written by the claim above, which also
            // moved the status to partially_approved, so it cannot change under
            // us now.
            if (approvalChain.firstApprover === adminId) {
                return {
                    success: false as const,
                    error: "You cannot verify your own approval. Another admin is required.",
                };
            }
        }

        // Claiming this is what stops two checkers — or two approvers of a
        // low-value loan — both reaching the payout below.
        const finalClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LOAN_APPLICATIONS,
            id: applicationId,
            fromAny: requiresDualControl ? ["partially_approved"] : ["pending", "reviewing"],
            to: "approved",
            patch: {
                reviewedBy: adminId,
                reviewedAt: nowIso,
                updatedAt: nowIso,
                ...(requiresDualControl
                    ? {
                        // Written whole because the CAS patch shallow-merges,
                        // so a nested update would drop the maker's record.
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
                    : `This application is already ${finalClaim.status}.`,
            };
        }

        await createAdminAuditLog({
            action: "loan_approved",
            userId: adminId,
            targetId: applicationId,
            targetType: "application",
            metadata: { amount: loanData.amount, role: requiresDualControl ? "Checker" : "Approver" },
        });

        // --- DISBURSEMENT (Outside Transaction) ---
        let disbursementTransferCode: string | undefined;
        let disbursementError: string | undefined;

        try {
            const { paystackPayout } = await import("@/lib/paystack-transfer");
            const borrowerDoc = await db.collection(COLLECTIONS.USERS).doc(loanData.userId).get();
            const borrowerData = borrowerDoc.data();

            if (borrowerData?.bankAccountNumber && borrowerData?.bankCode) {
                const disbResult = await paystackPayout(
                    {
                        accountNumber: borrowerData.bankAccountNumber,
                        bankCode: borrowerData.bankCode,
                        accountName: borrowerData.bankAccountName || borrowerData.name,
                    },
                    loanData.amount,
                    `Cooperative loan disbursement - ${applicationId}`
                );

                if (disbResult.success) {
                    disbursementTransferCode = disbResult.transferCode;
                    await loanRef.update({
                        disbursed: true,
                        disbursedAt: FieldValue.serverTimestamp(),
                        disbursementTransferCode: disbResult.transferCode,
                        status: "disbursed",
                    });
                } else {
                    disbursementError = disbResult.error;
                    await loanRef.update({
                        disbursed: false,
                        disbursementError: disbResult.error,
                        pendingManualDisbursement: true,
                    });
                }
            } else {
                disbursementError = "Borrower bank details not configured";
                await loanRef.update({ pendingManualDisbursement: true, disbursementNote: disbursementError });
            }
        } catch (disbErr: any) {
            disbursementError = disbErr.message;
            await loanRef.update({ pendingManualDisbursement: true, disbursementError: disbErr.message });
        }

        // --- SIDE EFFECTS (Email, Notifications, Cache) ---
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
        } catch (e) { logger.error('[admin] cache invalidation failed silently:', e); }

        if (process.env.RESEND_API_KEY && loanData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
                    to: loanData.userEmail,
                    subject: "Loan Application Approved!",
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #10b981;">Congratulations! Your Loan is Approved</h2>
                            <p>Great news! Your loan application has been approved by our admin team.</p>
                            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0;">
                                <h3 style="color: #059669; margin-top: 0;">Loan Details:</h3>
                                <p><strong>Amount:</strong> ₦${loanData.amount.toLocaleString()}</p>
                                <p><strong>Duration:</strong> ${loanData.durationMonths} months</p>
                                <p><strong>Interest Rate:</strong> ${loanData.interestRate}% per month</p>
                                <p><strong>Monthly Payment:</strong> ₦${Math.round(loanData.monthlyPayment).toLocaleString()}</p>
                                <p><strong>Total Repayment:</strong> ₦${Math.round(loanData.totalRepayment).toLocaleString()}</p>
                            </div>
                            <p><strong>Next Steps:</strong></p>
                            <ul>
                                <li>${disbursementTransferCode ? 'Your funds have been transferred to your bank account.' : 'Funds will be disbursed to your account shortly.'}</li>
                                <li>Your first repayment is due 30 days from disbursement</li>
                                <li>You can track your repayment schedule in your dashboard</li>
                            </ul>
                            <p>Thank you for being a valued member of our cooperative!</p>
                        </div>
                    `,
                });
            } catch (e) { logger.error('[admin] loan approval email failed silently:', e); }
        }

        await createNotificationAction({
            userId: loanData.userId,
            type: "success",
            title: "Loan Approved!",
            message: disbursementTransferCode
                ? `Your loan of ₦${loanData.amount.toLocaleString()} has been approved and disbursed to your bank account!`
                : `Your loan application for ₦${loanData.amount.toLocaleString()} has been approved. Disbursement will follow shortly.`,
            link: "/loans",
            linkText: "View Loans",
        });

        await createAdminAuditLog({
            action: "loan_approved",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { amount: loanData.amount, role: "Checker/Final", disbursed: !!disbursementTransferCode },
        });

        // Clear cache
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Loan Approval Cache] Cache clear error:', cacheError);
        }

        return {
            error: null,
            success: true as const,
            message: disbursementTransferCode ? "Loan approved and disbursed successfully" : `Loan approved. ${disbursementError ? `Disbursement pending: ${disbursementError}` : "Disbursement pending."}`,
        };
    } catch (error: any) {
        logger.error("Approve loan application error:", error);
        return { error: error.message || "Failed to approve loan application", success: false as const };
    }
}

async function _rejectLoanApplication(
    applicationId: string,
    reason: string,
    version?: number
): Promise<ActionState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false as const };
        }

        const valid = LoanApplicationReviewSchema.safeParse({ applicationId, status: "rejected", reason });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // ATOMIC TRANSACTION: Update loan status
        const txResult = await db.runTransaction(async (transaction) => {
            const loanSnap = await transaction.get(loanRef);
            if (!loanSnap.exists) {
                throw new Error("Loan application not found");
            }
            const loanData = loanSnap.data()!;

            await versionedUpdate(transaction, loanRef, version, {
                status: "rejected",
                rejectionReason: reason,
                reviewedBy: session.user.id,
                reviewedAt: FieldValue.serverTimestamp(),
            });

            return { loanData };
        });

        const { loanData } = txResult;

        // SIDE EFFECTS (Post-Commit)
        if (process.env.RESEND_API_KEY && loanData.userEmail) {
            try {
                const { Resend } = await import("resend");
                const resend = new Resend(process.env.RESEND_API_KEY);
                await resend.emails.send({
                    from: process.env.EMAIL_FROM || "Easy Sales Export <info@easysalesexport.com>",
                    to: loanData.userEmail,
                    subject: "Loan Application Update",
                    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
                        <h2 style="color:#dc2626">Loan Application Update</h2>
                        <div style="background:#fef2f2;padding:16px;border-radius:8px;margin:20px 0">
                            <p>Unfortunately, we are unable to approve your loan application at this time.</p>
                            <p><strong>Reason:</strong> ${reason}</p>
                        </div>
                    </div>`
                });
            } catch (e) { logger.error('[admin] loan rejection email failed silently:', e); }
        }

        await createNotificationAction({
            userId: loanData.userId,
            type: "warning",
            title: "Loan Application Declined",
            message: `Your loan application for ₦${loanData.amount.toLocaleString()} was not approved.`,
            link: "/loans",
            linkText: "View Details",
        });

        await createAdminAuditLog({
            action: "loan_rejected",
            userId: session.user.id,
            targetId: applicationId,
            targetType: "application",
            metadata: { reason },
        });

        // Clear cache
        try {
            const { invalidateCooperativeCache } = await import('@/lib/cache-invalidation');
            await invalidateCooperativeCache(loanData.userId);
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Loan Rejection Cache] Cache clear error:', cacheError);
        }

        return { error: null, success: true as const, message: "Loan application rejected" };
    } catch (error: any) {
        logger.error("Reject loan application error:", error);
        return { error: error.message || "Failed to reject loan application", success: false as const };
    }
}

export const getPendingLoanApplications = withFlexibleSafeAction("getPendingLoanApplications", _getPendingLoanApplications);

export const approveLoanApplication = withFlexibleSafeAction("approveLoanApplication", _approveLoanApplication);

export const rejectLoanApplication = withFlexibleSafeAction("rejectLoanApplication", _rejectLoanApplication);
