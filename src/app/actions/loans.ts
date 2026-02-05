"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createAuditLog } from "@/lib/audit-log";
import { calculateRepaymentSchedule, isEligibleForLoan, getTierInterestRate } from "@/lib/cooperative-tiers";

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
    tier: "Basic" | "Premium";
    interestRate: number;
    totalRepayment: number;
    monthlyPayment: number;
    documents?: string[];
    appliedAt: Timestamp;
    reviewedAt?: Timestamp;
    reviewedBy?: string;
    rejectionReason?: string;
    disbursedAt?: Timestamp;
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
    tier: "Basic" | "Premium";
}): Promise<{ success: boolean; error?: string; applicationId?: string }> {
    try {
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
        const hasActiveQuery = query(
            collection(db, "loan_applications"),
            where("userId", "==", formData.userId),
            where("status", "in", ["approved", "disbursed"])
        );
        const activeLoans = await getDocs(hasActiveQuery);
        const hasActiveLoan = !activeLoans.empty;

        const eligibility = isEligibleForLoan(
            formData.contributionAmount,
            formData.amount,
            hasActiveLoan
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
            appliedAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "loan_applications"), application);

        await createAuditLog({
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
        console.error("Loan application error:", error);
        return { success: false, error: "Failed to submit loan application" };
    }
}

/**
 * Get user loan applications
 */
export async function getUserLoanApplicationsAction(userId: string): Promise<LoanApplication[]> {
    try {
        const q = query(
            collection(db, "loan_applications"),
            where("userId", "==", userId)
        );
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LoanApplication[];
    } catch (error) {
        console.error("Failed to fetch loan applications:", error);
        return [];
    }
}

/**
 * Admin: Get pending loan applications
 */
export async function getPendingLoanApplicationsAction(): Promise<LoanApplication[]> {
    try {
        const q = query(
            collection(db, "loan_applications"),
            where("status", "==", "pending")
        );
        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LoanApplication[];
    } catch (error) {
        console.error("Failed to fetch pending applications:", error);
        return [];
    }
}

/**
 * Admin: Approve loan
 */
export async function approveLoanAction(
    applicationId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const appRef = doc(db, "loan_applications", applicationId);
        const appDoc = await getDoc(appRef);

        if (!appDoc.exists()) {
            return { success: false, error: "Application not found" };
        }

        await updateDoc(appRef, {
            status: "approved",
            reviewedAt: Timestamp.now(),
            reviewedBy: adminId,
        });

        const appData = appDoc.data() as LoanApplication;

        await createAuditLog({
            action: "loan_approved",
            userId: adminId,
            targetId: applicationId,
            targetType: "loan_application",
            metadata: {
                applicantId: appData.userId,
                amount: appData.amount,
            },
        });

        return { success: true };
    } catch (error) {
        console.error("Loan approval error:", error);
        return { success: false, error: "Failed to approve loan" };
    }
}

/**
 * Admin: Reject loan
 */
export async function rejectLoanAction(
    applicationId: string,
    adminId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const appRef = doc(db, "loan_applications", applicationId);
        const appDoc = await getDoc(appRef);

        if (!appDoc.exists()) {
            return { success: false, error: "Application not found" };
        }

        await updateDoc(appRef, {
            status: "rejected",
            reviewedAt: Timestamp.now(),
            reviewedBy: adminId,
            rejectionReason: reason,
        });

        const appData = appDoc.data() as LoanApplication;

        await createAuditLog({
            action: "loan_rejected",
            userId: adminId,
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
        console.error("Loan rejection error:", error);
        return { success: false, error: "Failed to reject loan" };
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
    paidAt?: Timestamp;
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
        const loanRef = doc(db, "loan_applications", loanId);
        const loanDoc = await getDoc(loanRef);

        if (!loanDoc.exists()) {
            return { success: false, error: "Loan not found" };
        }

        const loanData = loanDoc.data() as LoanApplication;

        // Check if schedule exists
        const scheduleQuery = query(
            collection(db, "loan_repayments"),
            where("loanId", "==", loanId)
        );
        const scheduleSnapshot = await getDocs(scheduleQuery);

        if (!scheduleSnapshot.empty) {
            // Return existing schedule
            const schedule = scheduleSnapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
                dueDate: (doc.data().dueDate as Timestamp).toDate(),
            })) as RepaymentInstallment[];

            return { success: true, schedule };
        }

        // Generate schedule if not exists
        const schedule = calculateRepaymentSchedule(
            loanData.amount,
            loanData.interestRate,
            loanData.durationMonths
        );

        const startDate = loanData.disbursedAt?.toDate() || new Date();
        const installments: RepaymentInstallment[] = [];

        for (let i = 0; i < schedule.length; i++) {
            const inst = schedule[i];
            const dueDate = new Date(startDate);
            dueDate.setMonth(dueDate.getMonth() + i + 1);

            const installmentRef = await addDoc(collection(db, "loan_repayments"), {
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
        console.error("Failed to fetch repayment schedule:", error);
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
        const installmentRef = doc(db, "loan_repayments", data.installmentId);
        const installmentDoc = await getDoc(installmentRef);

        if (!installmentDoc.exists()) {
            return { success: false, error: "Installment not found" };
        }

        const installmentData = installmentDoc.data() as any;
        const dueDate = (installmentData.dueDate as Timestamp).toDate();

        // Calculate penalty if overdue
        const { penalty, daysOverdue } = calculatePenalty(dueDate, installmentData.totalAmount);

        const totalDue = installmentData.totalAmount + penalty;
        const newPaidAmount = installmentData.paidAmount + data.amount;

        let status: "pending" | "paid" | "overdue" | "partial" = "pending";
        if (newPaidAmount >= totalDue) {
            status = "paid";
        } else if (newPaidAmount > 0) {
            status = "partial";
        } else if (new Date() > dueDate) {
            status = "overdue";
        }

        // Update installment
        await updateDoc(installmentRef, {
            paidAmount: newPaidAmount,
            status,
            paidAt: status === "paid" ? Timestamp.now() : installmentData.paidAt,
            penaltyAmount: penalty,
            daysOverdue,
        });

        // Create payment record
        await addDoc(collection(db, "loan_payments"), {
            loanId: data.loanId,
            installmentId: data.installmentId,
            userId: data.userId,
            amount: data.amount,
            paymentReference: data.paymentReference,
            penaltyPaid: penalty > 0 ? Math.min(data.amount, penalty) : 0,
            paidAt: Timestamp.now(),
        });

        // Check if all installments paid -> mark loan as repaid
        const allInstallmentsQuery = query(
            collection(db, "loan_repayments"),
            where("loanId", "==", data.loanId)
        );
        const allInstallments = await getDocs(allInstallmentsQuery);
        const allPaid = allInstallments.docs.every((doc) => doc.data().status === "paid");

        if (allPaid) {
            const loanRef = doc(db, "loan_applications", data.loanId);
            await updateDoc(loanRef, {
                status: "repaid",
            });
        }

        // Audit log
        await createAuditLog({
            action: "user_update",
            userId: data.userId,
            targetId: data.loanId,
            targetType: "loan",
            metadata: {
                installmentNumber: installmentData.installmentNumber,
                amount: data.amount,
                penalty,
                status,
            },
        });

        // Notification
        const { createNotificationAction } = await import('./notifications');
        await createNotificationAction({
            userId: data.userId,
            type: "success",
            title: "Repayment Recorded",
            message: `Your payment of ₦${data.amount.toLocaleString()} has been recorded.${penalty > 0 ? ` Penalty: ₦${penalty.toLocaleString()}` : ""}`,
            link: `/loans/${data.loanId}`,
            linkText: "View Loan",
        });

        return { success: true, penalty };
    } catch (error) {
        console.error("Repayment submission error:", error);
        return { success: false, error: "Failed to submit repayment" };
    }
}

/**
 * Get repayment history for a loan
 */
export async function getRepaymentHistoryAction(
    loanId: string
): Promise<{ success: boolean; error?: string; payments?: any[] }> {
    try {
        const paymentsQuery = query(
            collection(db, "loan_payments"),
            where("loanId", "==", loanId)
        );
        const paymentsSnapshot = await getDocs(paymentsQuery);

        const payments = paymentsSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
            paidAt: (doc.data().paidAt as Timestamp).toDate(),
        }));

        return { success: true, payments };
    } catch (error) {
        console.error("Failed to fetch repayment history:", error);
        return { success: false, error: "Failed to fetch repayment history" };
    }
}
