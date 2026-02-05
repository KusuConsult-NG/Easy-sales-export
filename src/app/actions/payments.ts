"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { logFinancialAction, createAuditLog } from "@/lib/audit-log";

/**
 * Payment Tracking & Verification System
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
    initiatedAt: Timestamp;
    completedAt?: Timestamp;
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
    paymentMethod: string;
    purpose: string;
    relatedId?: string;
    metadata?: Record<string, any>;
}): Promise<{ success: boolean; error?: string; paymentId?: string }> {
    try {
        const payment: Omit<PaymentRecord, "id"> = {
            ...data,
            status: "pending",
            paymentMethod: data.paymentMethod as any,
            purpose: data.purpose as any,
            initiatedAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "payments"), payment);

        await createAuditLog({
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

        return { success: true, paymentId: docRef.id };
    } catch (error) {
        console.error("Payment record creation error:", error);
        return { success: false, error: "Failed to create payment record" };
    }
}

/**
 * Verify and update payment status
 */
export async function verifyPaymentAction(
    paymentReference: string,
    paystackResponse: any
): Promise<{ success: boolean; error?: string }> {
    try {
        // Find payment by reference
        const q = query(
            collection(db, "payments"),
            where("paymentReference", "==", paymentReference)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return { success: false, error: "Payment not found" };
        }

        const paymentDoc = snapshot.docs[0];
        const paymentRef = doc(db, "payments", paymentDoc.id);

        await updateDoc(paymentRef, {
            status: "success",
            completedAt: Timestamp.now(),
            paystackResponse,
        });

        const paymentData = paymentDoc.data() as PaymentRecord;

        await logFinancialAction(
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

        return { success: true };
    } catch (error) {
        console.error("Payment verification error:", error);
        return { success: false, error: "Failed to verify payment" };
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
                    const escrowRef = doc(db, "escrow_transactions", payment.relatedId);
                    await updateDoc(escrowRef, {
                        status: "held",
                        paymentReference: payment.paymentReference,
                        paidAt: Timestamp.now(),
                    });
                }
                break;

            case "export_slot":
                if (payment.relatedId) {
                    // Update slot status to "paid"
                    const slotRef = doc(db, "export_slots", payment.relatedId);
                    await updateDoc(slotRef, {
                        status: "paid",
                        paidAt: Timestamp.now(),
                    });
                }
                break;

            case "loan_repayment":
                // Track loan repayment installment
                // This would update loan repayment records
                break;

            case "cooperative_contribution":
                // Update user's cooperative contribution
                break;

            default:
                break;
        }
    } catch (error) {
        console.error("Post-payment action error:", error);
    }
}

/**
 * Get user payment history
 */
export async function getUserPaymentHistoryAction(userId: string): Promise<PaymentRecord[]> {
    try {
        const q = query(
            collection(db, "payments"),
            where("userId", "==", userId)
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as PaymentRecord[];
    } catch (error) {
        console.error("Failed to fetch payment history:", error);
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
        const q = query(
            collection(db, "payments"),
            where("paymentReference", "==", paymentReference)
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        return {
            id: snapshot.docs[0].id,
            ...snapshot.docs[0].data(),
        } as PaymentRecord;
    } catch (error) {
        console.error("Failed to fetch payment:", error);
        return null;
    }
}
