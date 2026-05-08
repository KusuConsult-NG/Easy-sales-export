"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAdminFinancialAction, createAdminAuditLog } from "@/lib/audit-log-admin";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { requireSession } from "@/lib/session-guard";

/**
 * Payment Tracking & Verification System
 * MIGRATED TO FIREBASE-ADMIN for server-side security
 */

export interface PaymentRecord {
    id?: string;
    userId: string;
    userEmail: string;
    amount: number;
    currency: string;
    paymentReference: string;
    status: "pending" | "success" | "failed" | "cancelled";
    paymentMethod: "paystack" | "bank_transfer" | "cash";
    purpose: "loan_repayment" | "escrow_payment" | "cooperative_contribution" | "export_slot" | "training_fee";
    relatedId?: string; // ID of related record (loan, escrow, etc.)
    metadata?: Record<string, any>;
    initiatedAt: FieldValue | Timestamp;
    completedAt?: FieldValue | Timestamp;
    paystackResponse?: any;
}

/**
 * Create payment record
 */
export async function createPaymentRecordAction(data: {
    userId: string;
    userEmail: string;
    amount: number;
    currency: string;
    paymentReference: string;
    paymentMethod: "paystack" | "bank_transfer" | "cash";
    purpose: "loan_repayment" | "escrow_payment" | "cooperative_contribution" | "export_slot" | "training_fee";
    relatedId?: string;
    metadata?: Record<string, any>;
}): Promise<{ error: string | null, success: true | false; paymentId?: string }> {
    try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false as const, error: sessionResult.error.error };

        const payment: Omit<PaymentRecord, "id"> = {
            ...data,
            status: "pending",
            paymentMethod: data.paymentMethod,
            purpose: data.purpose,
            initiatedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.PAYMENTS).add(payment);

        await createAdminAuditLog({
            action: "payment_initiated",
            userId: data.userId,
            userEmail: data.userEmail,
            targetId: docRef.id,
            targetType: "payment",
            metadata: {
                amount: data.amount,
                purpose: data.purpose,
                reference: data.paymentReference,
            },
        });

        return { error: null, success: true as const, paymentId: docRef.id };
    } catch (error) {
        logger.error("Payment record creation error:", error);
        return { success: false as const, error: "Failed to create payment record" };
    }
}

/**
 * Verify and update payment status
 */
export async function verifyPaymentAction(
    paymentReference: string,
    paystackResponse: any
): Promise<{ error: string | null, success: true | false;  }> {
    try {
        // Find payment by reference
        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("paymentReference", "==", paymentReference)
            .get();

        if (snapshot.empty) {
            return { success: false as const, error: "Payment not found" };
        }

        const paymentDoc = snapshot.docs[0];
        const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentDoc.id);

        await paymentRef.update({
            status: "success",
            completedAt: FieldValue.serverTimestamp(),
            paystackResponse,
        });

        const paymentData = paymentDoc.data() as PaymentRecord;

        await logAdminFinancialAction(
            "payment_completed",
            paymentData.userId,
            paymentData.amount,
            paymentDoc.id,
            {
                purpose: paymentData.purpose,
                reference: paymentReference,
            }
        );

        // Handle post-payment actions based on purpose
        await handlePostPaymentActions(paymentData, paymentDoc.id);

        return { error: null, success: true };
    } catch (error) {
        logger.error("Payment verification error:", error);
        return { success: false as const, error: "Failed to verify payment" };
    }
}

/**
 * Handle post-payment actions
 */
async function handlePostPaymentActions(payment: PaymentRecord, paymentId: string) {
    try {
        switch (payment.purpose) {
            case "escrow_payment":
                if (payment.relatedId) {
                    // Update escrow status to "held"
                    const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(payment.relatedId);
                    await escrowRef.update({
                        status: "held",
                        paymentReference: payment.paymentReference,
                        paidAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            case "export_slot":
                if (payment.relatedId) {
                    // Update slot status to "paid"
                    const slotRef = db.collection(COLLECTIONS.EXPORT_SLOTS).doc(payment.relatedId);
                    await slotRef.update({
                        status: "paid",
                        paidAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            case "loan_repayment":
                if (payment.relatedId) {
                    // Record the installment
                    await db.collection(COLLECTIONS.LOAN_REPAYMENTS).add({
                        loanId: payment.relatedId,
                        userId: payment.userId,
                        amount: payment.amount,
                        paymentReference: payment.paymentReference,
                        paymentId,
                        paidAt: FieldValue.serverTimestamp(),
                    });
                    // Update the parent loan's amountRepaid and status
                    const loanRef = db.collection(COLLECTIONS.COOPERATIVE_LOANS).doc(payment.relatedId);
                    const loanSnap = await loanRef.get();
                    if (loanSnap.exists) {
                        const loanData = loanSnap.data()!;
                        const newRepaid = (loanData.amountRepaid || 0) + payment.amount;
                        const isFullyRepaid = newRepaid >= (loanData.amount || 0);
                        await loanRef.update({
                            amountRepaid: newRepaid,
                            status: isFullyRepaid ? "repaid" : "active",
                            lastRepaymentAt: FieldValue.serverTimestamp(),
                        });
                    }
                }
                break;

            case "cooperative_contribution":
                if (payment.relatedId) {
                    // Log the contribution record
                    await db.collection(COLLECTIONS.COOPERATIVE_CONTRIBUTIONS).add({
                        memberId: payment.relatedId,
                        userId: payment.userId,
                        amount: payment.amount,
                        paymentReference: payment.paymentReference,
                        paymentId,
                        contributedAt: FieldValue.serverTimestamp(),
                        type: "monthly",
                    });
                    // Increment member's totalContributions in cooperative_members
                    const memberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(payment.relatedId);
                    await memberRef.update({
                        totalContributions: FieldValue.increment(payment.amount),
                        lastContributionAt: FieldValue.serverTimestamp(),
                    });
                }
                break;

            default:
                break;
        }
    } catch (error) {
        logger.error("Post-payment action error:", error);
    }
}

/**
 * Get user payment history
 */
export async function getUserPaymentHistoryAction(userId: string): Promise<PaymentRecord[]> {
    try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return [];

        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("userId", "==", userId)
            .get();

        return serializeDocs<PaymentRecord>(snapshot.docs);
    } catch (error) {
        logger.error("Failed to fetch payment history:", error);
        return [];
    }
}

/**
 * Get payment by reference
 */
export async function getPaymentByReferenceAction(
    paymentReference: string
): Promise<PaymentRecord | null> {
    try {
        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("paymentReference", "==", paymentReference)
            .get();

        if (snapshot.empty) {
            return null;
        }

        return serializeDoc<PaymentRecord>(snapshot.docs[0].id, snapshot.docs[0].data());
    } catch (error) {
        logger.error("Failed to fetch payment:", error);
        return null;
    }
}
