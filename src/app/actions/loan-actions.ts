"use server";

import { z } from "zod";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
    loanApplicationSchema,
    loanApprovalSchema,
    type LoanApplicationData,
    type LoanApprovalData
} from "@/lib/validations/loan";
import { AuditActionType, LoanStatus, type LoanApplication } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

/**
 * Submit a new loan application
 */
export async function submitLoanApplication(
    data: z.infer<typeof loanApplicationSchema>
) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const validated = loanApplicationSchema.parse(data);

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
                rejectionReason: null,
            });
            return { loanId: loanRef.id };
        });

        const { loanId } = result;

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            await createAdminAuditLog({
                userId: session.user.id,
                action: 'loan_approved', // Using existing enum or mapping
                targetId: loanId,
                targetType: 'loan_application',
                metadata: {
                    amount: validated.amount,
                    purpose: validated.purpose,
                    repaymentPeriod: validated.repaymentPeriod,
                },
            });
        } catch (auditError) {
            console.error("Failed to log loan creation audit:", auditError);
        }

        return { success: true, data: { loanId, userId: session.user.id } };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: (error as z.ZodError).issues.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to submit loan application" };
    }
}

/**
 * Get all loan applications for current user
 */
export async function getUserLoanApplications() {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const loansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where('userId', '==', session.user.id)
            .orderBy('createdAt', 'desc');

        const snapshot = await loansQuery.get();
        const loans = serializeDocs<LoanApplication>(snapshot.docs);

        return { success: true, data: { loans, } };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan applications", loans: [] };
    }
}

/**
 * Get a specific loan application by ID
 */
export async function getLoanApplication(loanId: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { success: false, error: "Loan application not found", loan: null };
        }

        const data = loanDoc.data()!;

        // Check authorization - user can only view their own loans unless admin
        if (data.userId !== session.user.id && !session.user.roles?.includes('admin')) {
            return { success: false, error: "Unauthorized to view this loan", loan: null };
        }

        const loan = serializeDoc<LoanApplication>(loanDoc.id, data);

        return { success: true, data: { loan, } };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan application", loan: null };
    }
}

/**
 * Get all pending loan applications (Admin only)
 */
export async function getPendingLoanApplications() {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
    if (!session || !session.user.roles?.includes('admin')) {
        return { success: false, error: "Unauthorized - Admin only", loans: [] };
    }

    try {
        const loansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where('status', '==', LoanStatus.PENDING)
            .orderBy('createdAt', 'desc');

        const snapshot = await loansQuery.get();
        const loans = serializeDocs<LoanApplication>(snapshot.docs);

        return { success: true, data: { loans, } };
    } catch (error) {
        return { success: false, error: "Failed to fetch pending loans", loans: [] };
    }
}

/**
 * Approve or reject a loan application (Admin only)
 */
export async function approveLoanApplication(
    data: z.infer<typeof loanApprovalSchema>
) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
    if (!session || !session.user.roles?.includes('admin')) {
        return { success: false, error: "Unauthorized - Admin only" };
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

            const updateData: Record<string, unknown> = {
                status: validated.approved ? LoanStatus.APPROVED : LoanStatus.REJECTED,
                approvedBy: session.user.id,
                approvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            if (validated.notes) {
                updateData.approvalNotes = validated.notes;
            }

            if (!validated.approved && validated.rejectionReason) {
                updateData.rejectionReason = validated.rejectionReason;
            }

            transaction.update(loanRef, updateData);
        });

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            await createAdminAuditLog({
                userId: session.user.id,
                action: validated.approved ? 'loan_approved' : 'loan_rejected',
                targetId: validated.loanId,
                targetType: 'loan_application',
                metadata: {
                    approved: validated.approved,
                    notes: validated.notes,
                    rejectionReason: validated.rejectionReason,
                },
            });
        } catch (auditError) {
            console.error("Failed to log loan approval/rejection audit:", auditError);
        }

        return { success: true, data: { userId: session.user.id } };
    } catch (error) {
        if (error instanceof z.ZodError) {
            return {
                success: false,
                error: "Validation error",
                details: (error as z.ZodError).issues.map(e => e.message),
            };
        }
        return { success: false, error: "Failed to process loan approval" };
    }
}

/**
 * Update loan status to DISBURSED (Admin only)
 */
export async function disburseLoan(loanId: string, disbursementNotes?: string) {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
    if (!session || !session.user.roles?.includes('admin')) {
        return { success: false, error: "Unauthorized - Admin only" };
    }

    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);

        await db.runTransaction(async (transaction) => {
            const loanDoc = await transaction.get(loanRef);
            if (!loanDoc.exists) throw new Error("Loan application not found");

            const currentStatus = loanDoc.data()?.status;
            if (currentStatus !== LoanStatus.APPROVED) {
                throw new Error(`Loan must be APPROVED before disbursement. Current status: ${currentStatus}`);
            }

            transaction.update(loanRef, {
                status: LoanStatus.DISBURSED,
                disbursedAt: FieldValue.serverTimestamp(),
                disbursedBy: session.user.id,
                disbursementNotes,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            await createAdminAuditLog({
                userId: session.user.id,
                action: 'loan_approved', // Using existing mapping
                targetId: loanId,
                targetType: 'loan_application',
                metadata: {
                    status: 'disbursed',
                    notes: disbursementNotes,
                },
            });
        } catch (auditError) {
            console.error("Failed to log loan disbursement audit:", auditError);
        }

        return { success: true, data: { userId: session.user.id } };
    } catch (error) {
        return { success: false, error: "Failed to disburse loan" };
    }
}

/**
 * Get loan statistics (Admin only)
 */
export async function getLoanStatistics() {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
    if (!session || !session.user.roles?.includes('admin')) {
        return {
            success: false,
            error: "Unauthorized - Admin only",
            stats: null
        };
    }

    try {
        // Optimization: Select only necessary fields to reduce bandwidth
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
            approvedAmount: 0,
        };

        loansSnapshot.docs.forEach(doc => {
            const data = doc.data();
            const status = data.status as LoanStatus;
            const amount = data.amount as number || 0;

            stats.totalAmount += amount;

            if (status === LoanStatus.PENDING) stats.pending++;
            else if (status === LoanStatus.APPROVED) {
                stats.approved++;
                stats.approvedAmount += amount;
            }
            else if (status === LoanStatus.REJECTED) stats.rejected++;
            else if (status === LoanStatus.DISBURSED) {
                stats.disbursed++;
                stats.approvedAmount += amount;
            }
            else if (status === LoanStatus.REPAID) {
                stats.repaid++;
                stats.approvedAmount += amount;
            }
        });

        return { success: true, data: { stats, } };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan statistics", stats: null };
    }
}
