"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { calculateRepaymentSchedule, isEligibleForLoan, getTierInterestRate } from "@/lib/cooperative-tiers";
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";

export interface LoanApplication {
    id?: string;
    userId: string;
    userEmail: string;
    fullName: string;
    amount: number;
    purpose: string;
    durationMonths: number;
    status: "pending" | "approved" | "rejected" | "disbursed" | "repaid";
    contributionAmount: number;
    tier: "Member";
    interestRate: number;
    totalRepayment: number;
    monthlyPayment: number;
    documents?: string[];
    appliedAt: FieldValue | Timestamp;
    reviewedAt?: FieldValue | Timestamp;
    reviewedBy?: string;
    rejectionReason?: string;
    disbursedAt?: FieldValue | Timestamp;
}

/**
 * Submit loan application
 */
export async function submitLoanApplicationAction(formData: {
    userId: string;
    userEmail: string;
    fullName: string;
    amount: number;
    purpose: string;
    durationMonths: number;
    contributionAmount: number;
    tier: "Member";
}): Promise<{ success: boolean; error?: string; applicationId?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== formData.userId) {
            return { success: false, error: "Unauthorized" };
        }

        // ===== TIER VALIDATION =====
        // Import tier functions
        const { calculateUserTier, COOPERATIVE_TIERS, getTierMaxDuration } = await import("@/lib/cooperative-tiers");

        // 1. Calculate actual tier based on contribution
        const actualTier = calculateUserTier(formData.contributionAmount);

        // 2. Verify submitted tier matches contribution level
        if (formData.tier !== actualTier) {
            return {
                success: false,
                error: `Tier mismatch: Your contribution of ₦${formData.contributionAmount.toLocaleString()} qualifies for ${actualTier} tier, not ${formData.tier} tier`,
            };
        }

        // 3. Validate loan amount against tier multiplier
        const tierInfo = COOPERATIVE_TIERS[actualTier];
        const maxLoanAmount = formData.contributionAmount * tierInfo.maxLoanMultiplier;

        if (formData.amount > maxLoanAmount) {
            return {
                success: false,
                error: `Loan amount exceeds ${actualTier} tier limit. Maximum: ₦${maxLoanAmount.toLocaleString()} (${tierInfo.maxLoanMultiplier}x your contribution)`,
            };
        }

        // 4. Validate duration against tier limits
        const maxDuration = getTierMaxDuration(actualTier);
        if (formData.durationMonths > maxDuration) {
            return {
                success: false,
                error: `Repayment duration exceeds ${actualTier} tier limit. Maximum: ${maxDuration} months`,
            };
        }

        // ===== STANDARD ELIGIBILITY =====
        // Check eligibility
        const activeLoansSnapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", formData.userId)
            .where("status", "in", ["approved", "disbursed"])
            .get();

        const currentLoanBalance = activeLoansSnapshot.docs.reduce((acc, doc) => {
            const data = doc.data();
            return acc + (data.amount || 0);
        }, 0);

        const eligibility = isEligibleForLoan(
            formData.contributionAmount,
            formData.amount,
            currentLoanBalance
        );

        if (!eligibility.eligible) {
            return { success: false, error: eligibility.reason };
        }

        // Calculate repayment
        const interestRate = getTierInterestRate(formData.tier);
        const schedule = calculateRepaymentSchedule(
            formData.amount,
            interestRate,
            formData.durationMonths
        );

        const totalInterest = schedule.reduce((sum, inst) => sum + inst.interestAmount, 0);
        const totalRepayment = formData.amount + totalInterest;
        const monthlyPayment = totalRepayment / formData.durationMonths;

        // Create application
        const application: Omit<LoanApplication, "id"> = {
            userId: formData.userId,
            userEmail: formData.userEmail,
            fullName: formData.fullName,
            amount: formData.amount,
            purpose: formData.purpose,
            durationMonths: formData.durationMonths,
            status: "pending",
            contributionAmount: formData.contributionAmount,
            tier: formData.tier,
            interestRate,
            totalRepayment,
            monthlyPayment,
            appliedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.LOAN_APPLICATIONS).add(application);

        await createAdminAuditLog({
            action: "loan_applied",
            userId: formData.userId,
            userEmail: formData.userEmail,
            targetId: docRef.id,
            targetType: "loan_application",
            metadata: {
                amount: formData.amount,
                purpose: formData.purpose,
                tier: formData.tier,
            },
        });

        return { success: true, applicationId: docRef.id };
    } catch (error) {
        logger.error("Loan application error:", error);
        return { success: false, error: "Failed to submit loan application" };
    }
}

/**
 * Get user loan applications
 */
export async function getUserLoanApplicationsAction(userId: string): Promise<LoanApplication[]> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")))) {
            return [];
        }

        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("userId", "==", userId)
            .get();

        return serializeDocs<LoanApplication>(snapshot.docs);
    } catch (error) {
        logger.error("Failed to fetch loan applications:", error);
        return [];
    }
}

/**
 * Admin: Get pending loan applications
 */
export async function getPendingLoanApplicationsAction(): Promise<LoanApplication[]> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return [];
        }

        const snapshot = await db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .where("status", "==", "pending")
            .get();

        return serializeDocs<LoanApplication>(snapshot.docs);
    } catch (error) {
        logger.error("Failed to fetch pending applications:", error);
        return [];
    }
}

/**
 * Admin: Get paginated loan applications
 */
export async function getAdminLoanApplicationsAction(options: {
    statusFilter?: "all" | "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
    limit?: number;
    lastDocId?: string;
} = {}): Promise<{
    success: boolean;
    data?: LoanApplication[];
    error?: string;
    lastDocId?: string;
    hasMore?: boolean;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const { session } = sessionResult;
        
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const fetchLimit = options.limit || 20;

        let query = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
            .orderBy("appliedAt", "desc");

        if (options.statusFilter && options.statusFilter !== "all") {
            query = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("status", "==", options.statusFilter)
                .orderBy("appliedAt", "desc");
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const snapshot = await query.limit(fetchLimit + 1).get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const applications = serializeDocs(docs) as unknown as LoanApplication[];
        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined;

        return { 
            success: true, 
            data: applications,
            lastDocId: nextCursor,
            hasMore
        };
    } catch (error: any) {
        logger.error("Failed to fetch admin loan applications:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Admin: Get loan applications with user details for export
 */
export async function getAdminLoanApplicationsExportAction(options: {
    statusFilter?: "all" | "pending" | "approved" | "rejected" | "disbursed" | "active" | "completed";
}): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const { session } = sessionResult;
        
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        let query = db.collection(COLLECTIONS.LOAN_APPLICATIONS).orderBy("appliedAt", "desc");

        if (options.statusFilter && options.statusFilter !== "all") {
            query = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("status", "==", options.statusFilter)
                .orderBy("appliedAt", "desc");
        }

        const snapshot = await query.limit(5000).get();
        const loans = serializeDocs(snapshot.docs) as any[];

        const userIds = [...new Set(loans.map(loan => loan.userId))];
        const userMap = new Map<string, any>();

        const userPromises = [];
        for (let i = 0; i < userIds.length; i += 100) {
            const batch = userIds.slice(i, i + 100);
            const refs = batch.map(id => db.collection(COLLECTIONS.USERS).doc(id));
            userPromises.push(
                db.getAll(...refs).then(userDocs => {
                    userDocs.forEach(doc => {
                        if (doc.exists) {
                            userMap.set(doc.id, doc.data());
                        }
                    });
                }).catch(err => logger.error("Failed to fetch batch users for loan export", err))
            );
        }
        await Promise.all(userPromises);

        const enrichedLoans = loans.map(loan => {
            const user = userMap.get(loan.userId) || {};
            return {
                ...loan,
                phone: user.phone || "",
                state: user.address?.state || user.stateOfOrigin || "",
                lga: user.address?.lga || user.lga || ""
            };
        });

        return { 
            success: true, 
            data: enrichedLoans
        };
    } catch (error: any) {
        logger.error("Failed to fetch admin loan applications for export:", error);
        return { success: false, error: error.message };
    }
}


/**
 * Admin: Server-side COUNT aggregations for the loan applications dashboard.
 * Returns accurate totals independent of pagination limits.
 */
export async function getAdminLoanStatsAction(): Promise<{
    success: boolean;
    stats?: { total: number; pending: number; approved: number; rejected: number };
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthorized" };
        const { session } = sessionResult;

        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const col = db.collection(COLLECTIONS.LOAN_APPLICATIONS);
        const [total, pending, approved, rejected] = await Promise.all([
            col.count().get(),
            col.where("status", "==", "pending").count().get(),
            col.where("status", "in", ["approved", "disbursed", "active"]).count().get(),
            col.where("status", "==", "rejected").count().get(),
        ]);

        return {
            success: true,
            stats: {
                total: total.data().count,
                pending: pending.data().count,
                approved: approved.data().count,
                rejected: rejected.data().count,
            },
        };
    } catch (error: any) {
        logger.error("getAdminLoanStatsAction error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Admin: Approve loan
 */
export async function approveLoanAction(
    applicationId: string,
    adminId: string // Deprecated, use session
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // Transactional Locking to prevent Double Lending
        await db.runTransaction(async (transaction) => {
            const appDoc = await transaction.get(appRef);

            if (!appDoc.exists) {
                throw new Error("Application not found");
            }

            const appData = appDoc.data() as LoanApplication;

            if (appData.status !== "pending") {
                throw new Error("Application is not pending");
            }

            // CRITICAL CHECK: Does this user already have an active loan?
            // We must query INSIDE the transaction or use a locking document.
            // Since we can't easily query across common fields in a transaction query unless indexed and specific,
            // we will check the 'loan_applications' for this user.
            // However, Firestore transactions require reads to come before writes.
            // We will query for "approved" or "disbursed" loans for this user.

            const activeLoansQuery = db.collection(COLLECTIONS.LOAN_APPLICATIONS)
                .where("userId", "==", appData.userId)
                .where("status", "in", ["approved", "disbursed"]);

            const activeLoansSnapshot = await transaction.get(activeLoansQuery);

            let currentLoanBalance = 0;
            activeLoansSnapshot.forEach(doc => {
                currentLoanBalance += (doc.data().amount || 0);
            });

            const { getMaxLoanAmount } = await import("@/lib/cooperative-tiers");
            const maxLoan = getMaxLoanAmount(appData.contributionAmount);

            if (currentLoanBalance + appData.amount > maxLoan) {
                throw new Error(`Total active loan balance plus this new loan exceeds maximum limit of ₦${maxLoan.toLocaleString()}.`);
            }

            // Approve the loan
            transaction.update(appRef, {
                status: "approved",
                reviewedAt: FieldValue.serverTimestamp(),
                reviewedBy: effectiveAdminId,
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        // Fetch fresh data for audit log
        const updatedAppDoc = await appRef.get();
        const appData = updatedAppDoc.data() as LoanApplication;

        await createAdminAuditLog({
            action: "loan_approved",
            userId: effectiveAdminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        return { success: true };
    } catch (error) {
        logger.error("Loan approval error:", error);
        return { success: false, error: "Failed to approve loan" };
    }
}

/**
 * Admin: Reject loan
 */
export async function rejectLoanAction(
    applicationId: string,
    adminId: string, // Deprecated, use session
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const effectiveAdminId = session.user.id;

        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);
        const appDoc = await appRef.get();

        if (!appDoc.exists) {
            return { success: false, error: "Application not found" };
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

        return { success: true };
    } catch (error) {
        logger.error("Loan rejection error:", error);
        return { success: false, error: "Failed to reject loan" };
    }
}

/**
 * Admin: Disburse loan
 */
export async function disburseLoanAction(
    applicationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
            return { success: false, error: "Unauthorized" };
        }

        const effectiveAdminId = session.user.id;
        const appRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(applicationId);

        // Transactional execution
        await db.runTransaction(async (transaction) => {
            const appDoc = await transaction.get(appRef);

            if (!appDoc.exists) {
                throw new Error("Application not found");
            }

            const appData = appDoc.data() as LoanApplication;

            if (appData.status !== "approved") {
                throw new Error(appData.status === "disbursed" ? "Loan already disbursed" : "Loan must be approved before disbursement");
            }

            transaction.update(appRef, {
                status: "disbursed",
                disbursedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

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
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: appData.userId,
            type: "success",
            title: "Funds Disbursed",
            message: `Your loan of ₦${appData.amount.toLocaleString()} has been disbursed.`,
            link: `/loans/${applicationId}`,
            linkText: "View Loan",
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Loan disbursement error:", error);
        return { success: false, error: error.message || "Failed to disburse loan" };
    }
}

/**
 * Repayment Installment Interface
 */
export interface RepaymentInstallment {
    id?: string;
    loanId: string;
    userId: string;
    installmentNumber: number;
    dueDate: Date;
    principalAmount: number;
    interestAmount: number;
    totalAmount: number;
    paidAmount: number;
    status: "pending" | "paid" | "overdue" | "partial";
    paidAt?: FieldValue | Timestamp;
    penaltyAmount?: number;
    daysOverdue?: number;
}

/**
 * Get loan repayment schedule
 */
export async function getRepaymentScheduleAction(
    loanId: string
): Promise<{ success: boolean; error?: string; schedule?: RepaymentInstallment[] }> {
    try {
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId);
        const loanDoc = await loanRef.get();

        if (!loanDoc.exists) {
            return { success: false, error: "Loan not found" };
        }

        const loanData = loanDoc.data() as LoanApplication;

        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== loanData.userId && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")))) {
            return { success: false, error: "Unauthorized" };
        }

        // Check if schedule exists
        const scheduleSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        if (!scheduleSnapshot.empty) {
            // Return existing schedule
            const schedule = serializeDocs<RepaymentInstallment>(scheduleSnapshot.docs);

            return { success: true, schedule };
        }

        // Generate schedule if not exists
        const schedule = calculateRepaymentSchedule(
            loanData.amount,
            loanData.interestRate,
            loanData.durationMonths
        );

        const startDate = (loanData.disbursedAt && 'toDate' in loanData.disbursedAt)
            ? loanData.disbursedAt.toDate()
            : new Date();
        const installments: RepaymentInstallment[] = [];

        for (let i = 0; i < schedule.length; i++) {
            const inst = schedule[i];
            const dueDate = new Date(startDate);
            dueDate.setMonth(dueDate.getMonth() + i + 1);

            const installmentRef = await db.collection(COLLECTIONS.LOAN_REPAYMENTS).add({
                loanId,
                userId: loanData.userId,
                installmentNumber: i + 1,
                dueDate: Timestamp.fromDate(dueDate),
                principalAmount: inst.principalAmount,
                interestAmount: inst.interestAmount,
                totalAmount: inst.totalAmount,
                paidAmount: 0,
                status: "pending",
            });

            installments.push({
                id: installmentRef.id,
                loanId,
                userId: loanData.userId,
                installmentNumber: i + 1,
                dueDate,
                principalAmount: inst.principalAmount,
                interestAmount: inst.interestAmount,
                totalAmount: inst.totalAmount,
                paidAmount: 0,
                status: "pending",
            });
        }

        return { success: true, schedule: installments };
    } catch (error) {
        logger.error("Failed to fetch repayment schedule:", error);
        return { success: false, error: "Failed to fetch repayment schedule" };
    }
}

/**
 * Calculate penalty for overdue payment (7-day grace period)
 */
function calculatePenalty(dueDate: Date, totalAmount: number): { penalty: number; daysOverdue: number } {
    const now = new Date();
    const gracePeriodDays = 7;
    const penaltyRatePerDay = 0.001; // 0.1% per day after grace period

    const daysDiff = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff <= gracePeriodDays) {
        return { penalty: 0, daysOverdue: 0 };
    }

    const daysOverdue = daysDiff - gracePeriodDays;
    const penalty = totalAmount * penaltyRatePerDay * daysOverdue;

    return { penalty: Math.round(penalty), daysOverdue };
}

/**
 * Submit loan repayment
 */
export async function submitRepaymentAction(data: {
    loanId: string;
    installmentId: string;
    userId: string;
    amount: number;
    paymentReference: string;
}): Promise<{ success: boolean; error?: string; penalty?: number }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== data.userId) {
            return { success: false, error: "Unauthorized" };
        }

        if (data.amount <= 0) {
            return { success: false, error: "Invalid repayment amount" };
        }

        const installmentRef = db.collection(COLLECTIONS.LOAN_REPAYMENTS).doc(data.installmentId);
        const loanRef = db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(data.loanId);

        let calculatedPenalty = 0;
        let calculatedStatus: "pending" | "paid" | "overdue" | "partial" = "pending";
        let finalInstallmentData: any = null;

        await db.runTransaction(async (transaction) => {
            const installmentDoc = await transaction.get(installmentRef);
            if (!installmentDoc.exists) {
                throw new Error("Installment not found");
            }

            const installmentData = installmentDoc.data() as Record<string, any>;
            const dueDate = (installmentData.dueDate as Timestamp).toDate();

            // Check if already paid inside transaction
            if (installmentData.status === "paid") {
                throw new Error("Installment already fully paid");
            }

            // Calculate penalty if overdue
            const { penalty, daysOverdue } = calculatePenalty(dueDate, installmentData.totalAmount);
            calculatedPenalty = penalty;

            const totalDue = installmentData.totalAmount + penalty;
            const newPaidAmount = (installmentData.paidAmount || 0) + data.amount;

            // Determine new status
            if (newPaidAmount >= totalDue) {
                calculatedStatus = "paid";
            } else if (newPaidAmount > 0) {
                calculatedStatus = "partial";
            } else if (new Date() > dueDate) {
                calculatedStatus = "overdue";
            }

            finalInstallmentData = {
                ...installmentData,
                paidAmount: newPaidAmount,
                status: calculatedStatus,
                penaltyAmount: penalty,
                daysOverdue
            };

            // Update installment
            transaction.update(installmentRef, {
                paidAmount: newPaidAmount,
                status: calculatedStatus,
                paidAt: calculatedStatus === "paid" ? FieldValue.serverTimestamp() : installmentData.paidAt || null,
                penaltyAmount: penalty,
                daysOverdue: daysOverdue,
            });

            // Create payment record (Atomic add)
            const paymentRef = db.collection(COLLECTIONS.LOAN_PAYMENTS).doc();
            transaction.set(paymentRef, {
                loanId: data.loanId,
                installmentId: data.installmentId,
                userId: data.userId,
                amount: data.amount,
                paymentReference: data.paymentReference,
                penaltyPaid: penalty > 0 ? Math.min(data.amount, penalty) : 0,
                paidAt: FieldValue.serverTimestamp(),
            });

            // Check if loan is fully repaid
            // This reads ALL siblings. It might be expensive but necessary for consistency.
            // Alternatively, we can check this OUTSIDE the transaction if we accept eventual consistency for "repaid" status,
            // but strict financial audits prefer strong consistency.
            // However, querying inside a transaction requires all reads before writes.
            // We can't query "all loan_repayments" easily inside this specific document lock unless we lock them all.
            // Compromise: We check for loan repayment completion AFTER this transaction in a separate check or optimistic update.
            // But waiting is safer. Let's do a simple check: if this was the LAST unpaid installment.

            // To properly handle "Locking the entire loan schedule", we would need to read all installments.
            // For now, updating the installment safely is the P0. Updating the Loan Status can be done optimistically or in a secondary step
            // as it doesn't risk "money loss", just "status lag".
        });

        // Post-transaction: Check if all installments are paid to update Loan Status
        // This is safe to run after because even if it races, the worst case is the loan status updates to 'repaid' twice.
        const allInstallmentsSnapshot = await db.collection(COLLECTIONS.LOAN_REPAYMENTS)
            .where("loanId", "==", data.loanId)
            .get();

        const allPaid = allInstallmentsSnapshot.docs.every((doc) => doc.data().status === "paid");

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
            },
        });

        // Notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: data.userId,
            type: "success",
            title: "Repayment Recorded",
            message: `Your payment of ₦${data.amount.toLocaleString()} has been recorded.${calculatedPenalty > 0 ? ` Penalty: ₦${calculatedPenalty.toLocaleString()}` : ""}`,
            link: `/loans/${data.loanId}`,
            linkText: "View Loan",
        });

        return { success: true, penalty: calculatedPenalty };
    } catch (error: any) {
        logger.error("Repayment submission error:", error);
        return { success: false, error: error.message || "Failed to submit repayment" };
    }
}

/**
 * Get repayment history for a loan
 */
export async function getRepaymentHistoryAction(
    loanId: string
): Promise<{ success: boolean; error?: string; payments?: any[] }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Note: For history, we should ideally check ownership of the loan first, 
        // but skipping for now or adding a quick check would be better.
        // Let's add a quick loan check.
        const loanDoc = await db.collection(COLLECTIONS.LOAN_APPLICATIONS).doc(loanId).get();
        if (loanDoc.exists) {
            const loanData = loanDoc.data();
            if (loanData && loanData.userId !== session.user.id && (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin"))) {
                return { success: false, error: "Unauthorized" };
            }
        }

        const paymentsSnapshot = await db.collection(COLLECTIONS.LOAN_PAYMENTS)
            .where("loanId", "==", loanId)
            .get();

        const payments = serializeDocs(paymentsSnapshot.docs);

        return { success: true, payments };
    } catch (error) {
        logger.error("Failed to fetch repayment history:", error);
        return { success: false, error: "Failed to fetch repayment history" };
    }
}
