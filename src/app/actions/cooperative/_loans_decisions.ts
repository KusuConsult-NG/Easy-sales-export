"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { needsDualControl } from "@/lib/loan-approval-policy";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import type { LoanApplication } from "@/lib/types/cooperative-loans";

/**
 * Admin: Approve loan
 */
export async function approveLoanAction(
    applicationId: string,
    adminId: string // Deprecated, use session
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // "Transactional Locking to prevent Double Lending" was the label, and
        // it locked nothing. These are pre-checks, and the comment below the
        // block already said they are advisory — the wrapper only made them
        // look protected. What prevents a double approval is the claim further
        // down, not this.
        const txResult = await (async () => {
            const appDoc = await appRef.get();

            if (!appDoc.exists) {
                throw new Error("Application not found");
            }

            const appData = appDoc.data() as LoanApplication;

            if (!appData.guarantorVerified) {
                throw new Error("Guarantor verification required before loan approval.");
            }

            if (appData.status !== "pending" && appData.status !== "partially_approved") {
                throw new Error("Application is not pending or partially approved");
            }

            // Double-lending verification: Check for other active/pending loans platform-wide
            const otherGeneralLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", appData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherGeneralLoansSnap = await otherGeneralLoansQuery.get();

            const otherCoopLoansQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS)
                .where("memberId", "==", appData.userId)
                .where("status", "in", ["pending", "reviewing", "approved", "partially_approved", "disbursed"]);
            const otherCoopLoansSnap = await otherCoopLoansQuery.get();

            const otherGeneralLoansCount = otherGeneralLoansSnap.docs.filter(doc => doc.id !== applicationId).length;
            const otherCoopLoansCount = otherCoopLoansSnap.docs.filter(doc => doc.id !== applicationId).length;

            if (otherGeneralLoansCount > 0 || otherCoopLoansCount > 0) {
                throw new Error("Active or pending loan application already exists platform-wide for this user.");
            }

            const { getMaxLoanAmount } = await import("@/lib/cooperative-tiers");
            const maxLoan = getMaxLoanAmount(appData.contributionAmount);

            if (appData.amount > maxLoan) {
                throw new Error(`This loan exceeds maximum limit of ₦${maxLoan.toLocaleString()}.`);
            }

            return { appData };
        })();

        // ── APPROVAL ─────────────────────────────────────────────────────────
        //
        // The checks above ran inside runTransaction, which takes no lock, so
        // they are advisory. The transition itself is claimed, which is what
        // makes dual control hold:
        //
        //   - `if (!approvalChain.firstApprover)` let two admins approving at
        //     the same moment both become the maker, and the second write
        //     silently replaced the first — one admin's approval simply vanished
        //     from the record.
        //   - the self-approval check let two checkers both pass and both write
        //     `approved`.
        //
        // Same defect as admin.ts, minus the disbursement — no money moves in
        // this function, which is the only reason it was less severe.
        const loan = txResult.appData as any;
        const approvalChain = loan.approvalChain || {};
        const adminName = session.user.name || session.user.email;
        const nowIso = new Date().toISOString();

        // Shared with admin.ts and loan-actions.ts — see
        // src/lib/loan-approval-policy.ts for why it is not declared here.
        const requiresDualControl = needsDualControl(loan.amount);

        if (requiresDualControl && !approvalChain.firstApprover) {
            const makerClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: applicationId,
                fromAny: ["pending", "reviewing"],
                to: "partially_approved",
                patch: {
                    approvalChain: {
                        firstApprover: effectiveAdminId,
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
                    data: null,
                };
            }
        } else {
            if (requiresDualControl && approvalChain.firstApprover === effectiveAdminId) {
                return {
                    success: false as const,
                    error: "You cannot verify your own approval. Another admin is required.",
                    data: null,
                };
            }

            const finalClaim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LOAN_APPLICATIONS,
                id: applicationId,
                fromAny: requiresDualControl ? ["partially_approved"] : ["pending", "reviewing"],
                to: "approved",
                patch: {
                    reviewedBy: effectiveAdminId,
                    reviewedAt: nowIso,
                    updatedAt: nowIso,
                    ...(requiresDualControl
                        ? {
                            // Written whole because the CAS patch shallow-merges.
                            approvalChain: {
                                ...approvalChain,
                                secondApprover: effectiveAdminId,
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
                    data: null,
                };
            }
        }

        // Fetch fresh data for audit log
        const updatedAppDoc = await appRef.get();
        const appData = updatedAppDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: appData.status === "partially_approved" ? "loan_partially_approved" : "loan_approved",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Loan approval error:", error);
        return { success: false as const, error: "Failed to approve loan", data: null };
    }
}


/**
 * Admin: Reject loan
 */
export async function rejectLoanAction(
    applicationId: string,
    adminId: string, // Deprecated, use session
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;

        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { success: false as const, error: "Application not found", data: null };
        }

        await appRef.update({
            status: "rejected",
            reviewedAt: FieldValue.serverTimestamp(),
            reviewedBy: effectiveAdminId,
            rejectionReason: reason,
        });

        const appData = appDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: "loan_rejected",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
                reason,
            },
        });

        return { error: null, success: true as const , data: null };
    } catch (error) {
        logger.error("Loan rejection error:", error);
        return { success: false as const, error: "Failed to reject loan", data: null };
    }
}


/**
 * Admin: Disburse loan
 */
export async function disburseLoanAction(
    applicationId: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null as any };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // Read the status, compare it to "approved", write "disbursed" — inside
        // runTransaction, which takes no lock. Two admins clicking Disburse
        // together both read "approved" and both wrote, producing two audit
        // entries and two "Funds Disbursed" notifications for one loan.
        //
        // Claimed now, so exactly one wins.
        //
        // NOTE: this function moves no money, and that is not an oversight of
        // this change — it never did. See the note in
        // docs/audit/atomic-money-migration.md about the three ways this
        // codebase disburses a loan, which do not agree with one another.
        const disburseClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LOAN_APPLICATIONS,
            id: applicationId,
            fromAny: ["approved"],
            to: "disbursed",
            patch: {
                disbursedAt: new Date().toISOString(),
                disbursedBy: effectiveAdminId,
                updatedAt: new Date().toISOString(),
            },
        });

        if (!disburseClaim.claimed) {
            return {
                success: false as const,
                error: disburseClaim.status === null
                    ? "Application not found"
                    : disburseClaim.status === "disbursed"
                        ? "Loan already disbursed"
                        : "Loan must be approved before disbursement",
                data: null,
            };
        }

        // Audit & Notification (Outside transaction to avoid side effects if transaction retries, though strictly audit should be ideally consistent. 
        // For Firestore, it's okay to do this after success since we can't easily roll back external API calls, but Audit Log is another DB write.
        // We will keep Audit Log separate for simplicity, or we could include it in transaction if audit log is in same DB.)

        // Fetch fresh data for logging
        const appDoc = await appRef.get();
        const appData = appDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: "loan_disbursed",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        // Notification
        const { createNotificationAction } = await import('../notifications');
        await createNotificationAction({
            userId: appData.userId,
            type: "success",
            title: "Funds Disbursed",
            message: `Your loan of ₦${appData.amount.toLocaleString()} has been disbursed.`,
            link: `/loans/${applicationId}`,
            linkText: "View Loan",
        });

        return { error: null,  success: true as const , data: null };
    } catch (error: any) {
        logger.error("Loan disbursement error:", error);
        return { success: false as const, error: error.message || "Failed to disburse loan", data: null };
    }
}
