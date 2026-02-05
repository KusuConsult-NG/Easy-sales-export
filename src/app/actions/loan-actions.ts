"use server";

import { z } from "zod";
import { collection, addDoc, updateDoc, doc, getDocs, query, where, orderBy, serverTimestamp, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
    loanApplicationSchema,
    loanApprovalSchema,
    type LoanApplicationData,
    type LoanApprovalData
} from "@/lib/validations/loan";
import { AuditActionType, LoanStatus, type LoanApplication } from "@/types/strict";
import { createAuditLog } from "@/lib/audit-logger";
import { auth } from "@/lib/auth";

/**
 * Submit a new loan application
 */
export async function submitLoanApplication(
    data: z.infer<typeof loanApplicationSchema>
) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized" };
    }

    try {
        const validated = loanApplicationSchema.parse(data);

        // Create loan application in Firestore
        const loanRef = await addDoc(collection(db, 'loan_applications'), {
            ...validated,
            userId: session.user.id,
            status: LoanStatus.PENDING,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            approvedBy: null,
            approvedAt: null,
            rejectionReason: null,
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.LOAN_APPROVE, // Will add LOAN_CREATE to enum if needed
            resourceId: loanRef.id,
            resourceType: 'loan_application',
            metadata: {
                amount: validated.amount,
                purpose: validated.purpose,
                repaymentPeriod: validated.repaymentPeriod,
            },
        });

        return {
            success: true,
            loanId: loanRef.id,
            userId: session.user.id,
        };
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
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", loans: [] };
    }

    try {
        const loansQuery = query(
            collection(db, 'loan_applications'),
            where('userId', '==', session.user.id),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(loansQuery);

        const loans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
            } as LoanApplication;
        });

        return {
            success: true,
            loans,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan applications", loans: [] };
    }
}

/**
 * Get a specific loan application by ID
 */
export async function getLoanApplication(loanId: string) {
    const session = await auth();
    if (!session) {
        return { success: false, error: "Unauthorized", loan: null };
    }

    try {
        const loanRef = doc(db, 'loan_applications', loanId);
        const loanDoc = await getDocs(query(collection(db, 'loan_applications'), where('__name__', '==', loanId)));

        if (loanDoc.empty) {
            return { success: false, error: "Loan application not found", loan: null };
        }

        const data = loanDoc.docs[0].data();

        // Check authorization - user can only view their own loans unless admin
        if (data.userId !== session.user.id && session.user.role !== 'admin') {
            return { success: false, error: "Unauthorized to view this loan", loan: null };
        }

        const loan: LoanApplication = {
            id: loanDoc.docs[0].id,
            ...data,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
        } as LoanApplication;

        return {
            success: true,
            loan,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan application", loan: null };
    }
}

/**
 * Get all pending loan applications (Admin only)
 */
export async function getPendingLoanApplications() {
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return { success: false, error: "Unauthorized - Admin only", loans: [] };
    }

    try {
        const loansQuery = query(
            collection(db, 'loan_applications'),
            where('status', '==', LoanStatus.PENDING),
            orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(loansQuery);

        const loans = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                approvedAt: data.approvedAt ? (data.approvedAt as Timestamp).toDate() : null,
            } as LoanApplication;
        });

        return {
            success: true,
            loans,
        };
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
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return { success: false, error: "Unauthorized - Admin only" };
    }

    try {
        const validated = loanApprovalSchema.parse(data);

        const updateData: Record<string, unknown> = {
            status: validated.approved ? LoanStatus.APPROVED : LoanStatus.REJECTED,
            approvedBy: session.user.id,
            approvedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        };

        if (validated.notes) {
            updateData.approvalNotes = validated.notes;
        }

        if (!validated.approved && validated.rejectionReason) {
            updateData.rejectionReason = validated.rejectionReason;
        }

        await updateDoc(doc(db, 'loan_applications', validated.loanId), updateData);

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: validated.approved ? AuditActionType.LOAN_APPROVE : AuditActionType.LOAN_REJECT,
            resourceId: validated.loanId,
            resourceType: 'loan_application',
            metadata: {
                approved: validated.approved,
                notes: validated.notes,
                rejectionReason: validated.rejectionReason,
            },
        });

        return { success: true, userId: session.user.id };
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
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return { success: false, error: "Unauthorized - Admin only" };
    }

    try {
        await updateDoc(doc(db, 'loan_applications', loanId), {
            status: LoanStatus.DISBURSED,
            disbursedAt: serverTimestamp(),
            disbursedBy: session.user.id,
            disbursementNotes,
            updatedAt: serverTimestamp(),
        });

        // Audit log
        await createAuditLog({
            userId: session.user.id,
            actionType: AuditActionType.LOAN_APPROVE, // Can add LOAN_DISBURSE to enum
            resourceId: loanId,
            resourceType: 'loan_application',
            metadata: {
                status: 'disbursed',
                notes: disbursementNotes,
            },
        });

        return { success: true, userId: session.user.id };
    } catch (error) {
        return { success: false, error: "Failed to disburse loan" };
    }
}

/**
 * Get loan statistics (Admin only)
 */
export async function getLoanStatistics() {
    const session = await auth();
    if (!session || session.user.role !== 'admin') {
        return {
            success: false,
            error: "Unauthorized - Admin only",
            stats: null
        };
    }

    try {
        const loansSnapshot = await getDocs(collection(db, 'loan_applications'));

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
            const amount = data.amount as number;

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

        return {
            success: true,
            stats,
        };
    } catch (error) {
        return { success: false, error: "Failed to fetch loan statistics", stats: null };
    }
}
