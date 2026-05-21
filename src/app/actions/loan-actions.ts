"use server";

import { z } from "zod";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { loanApplicationSchema,
    loanApprovalSchema,
    type LoanApplicationData,
    type LoanApprovalData } from "@/lib/validations/loan";
import { AuditActionType, LoanStatus, type LoanApplication } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

/**
 * Submit a new loan application
 */
export async function submitLoanApplication(
    data: z.infer<typeof loanApplicationSchema>
) { const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { const validated = loanApplicationSchema.parse(data);

        // Create loan application in Firestore via transaction to ensure side-effects are atomic
        const result = await db.runTransaction(async (transaction) => {
            const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc();
            transaction.set(loanRef, {
                ...validated,
                userId: session.user.id,
                status: LoanStatus.PENDING,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                approvedBy: null,
                approvedAt: null,
                rejectionReason: null });
            return { loanId: loanRef.id };
        });

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
        if (data.userId !== session.user.id && !session.user.roles?.includes('admin')) { return { success: false as const, error: "Unauthorized to view this loan", loan: null, data: null };
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
    if (!session || !session.user.roles?.includes('admin')) { return { success: false as const, error: "Unauthorized - Admin only", loans: [], data: null };
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
    if (!session || !session.user.roles?.includes('admin')) { return { success: false as const, error: "Unauthorized - Admin only", data: null };
    }

    try {
        const validated = loanApprovalSchema.parse(data);

        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(validated.loanId);

        await db.runTransaction(async (transaction) => {
            const loanDoc = await transaction.get(loanRef);
            if (!loanDoc.exists) throw new Error("Loan application not found");
            
            const currentStatus = loanDoc.data()?.status;
            if (currentStatus !== LoanStatus.PENDING) {
                throw new Error(`Loan application is already ${currentStatus}`);
            }

            const updateData: Record<string, unknown> = { status: validated.approved ? LoanStatus.APPROVED : LoanStatus.REJECTED,
                approvedBy: session.user.id,
                approvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() };

            if (validated.notes) { updateData.approvalNotes = validated.notes;
            }

            if (!validated.approved && validated.rejectionReason) { updateData.rejectionReason = validated.rejectionReason;
            }

            transaction.update(loanRef, updateData);
        });

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try { await createAdminAuditLog({
                userId: session.user.id,
                action: validated.approved ? 'loan_approved' : 'loan_rejected',
                targetId: validated.loanId,
                targetType: 'loan_application',
                metadata: {
                    approved: validated.approved,
                    notes: validated.notes,
                    rejectionReason: validated.rejectionReason } });
        } catch (auditError) { console.error("Failed to log loan approval/rejection audit:", auditError);
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
    if (!session || !session.user.roles?.includes('admin')) { return { success: false as const, error: "Unauthorized - Admin only"};
    }

    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);

        await db.runTransaction(async (transaction) => {
            const loanDoc = await transaction.get(loanRef);
            if (!loanDoc.exists) throw new Error("Loan application not found");

            const loanData = loanDoc.data();
            const currentStatus = loanData?.status;
            if (currentStatus !== LoanStatus.APPROVED) {
                throw new Error(`Loan must be APPROVED before disbursement. Current status: ${currentStatus}`);
            }

            const userId = loanData?.userId;
            const amount = loanData?.amount || 0;

            // ── UPDATE LOAN RECORD ──────
            transaction.update(loanRef, { status: LoanStatus.DISBURSED,
                disbursedAt: FieldValue.serverTimestamp(),
                disbursedBy: session.user.id,
                disbursementNotes,
                updatedAt: FieldValue.serverTimestamp() });

            // ── CREDIT USER WALLET ──────
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(userId);
            const walletDoc = await transaction.get(walletRef);
            
            if (!walletDoc.exists) {
                transaction.set(walletRef, {
                    userId,
                    balance: amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                transaction.update(walletRef, {
                    balance: FieldValue.increment(amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // ── RECORD IN GLOBAL LEDGER ──────
            const txId = `LOAN-DISB-${loanId.substring(0, 8)}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            transaction.set(txRef, {
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
        });

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
    if (!session || !session.user.roles?.includes('admin')) { return { success: false as const, error: "Unauthorized - Admin only", stats: null, data: null };
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
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);
        const walletRef = db.collection(COLLECTIONS.WALLETS).doc(session.user.id);

        await db.runTransaction(async (transaction) => {
            const [loanDoc, walletDoc] = await Promise.all([
                transaction.get(loanRef),
                transaction.get(walletRef)
            ]);

            if (!loanDoc.exists) throw new Error("Loan application not found");
            if (!walletDoc.exists) throw new Error("User wallet not found");

            const loanData = loanDoc.data();
            const walletData = walletDoc.data();

            if (loanData?.userId !== session.user.id) throw new Error("Unauthorized repayment");
            if (loanData?.status !== LoanStatus.DISBURSED) throw new Error("Loan is not in a repayable state");
            
            if ((walletData?.balance || 0) < amount) throw new Error("Insufficient wallet balance for repayment");

            // ── DEBIT WALLET ──────
            transaction.update(walletRef, {
                balance: FieldValue.increment(-amount),
                updatedAt: FieldValue.serverTimestamp()
            });

            // ── UPDATE LOAN STATUS ──────
            // For simplicity, we mark as REPAID if it's the full amount. 
            // In a complex system, we'd track balance.
            const isFullRepayment = amount >= (loanData?.amount || 0);
            transaction.update(loanRef, {
                status: isFullRepayment ? LoanStatus.REPAID : LoanStatus.DISBURSED,
                repaidAmount: FieldValue.increment(amount),
                repaidAt: isFullRepayment ? FieldValue.serverTimestamp() : null,
                updatedAt: FieldValue.serverTimestamp()
            });

            // ── RECORD IN GLOBAL LEDGER ──────
            const txId = `LOAN-REPAY-${Date.now()}-${session.user.id.substring(0, 5)}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            transaction.set(txRef, {
                id: txId,
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
        });

        return { error: null, success: true as const, data: null };
    } catch (error: any) {
        return { success: false as const, error: error.message || "Failed to process loan repayment" };
    }
}
