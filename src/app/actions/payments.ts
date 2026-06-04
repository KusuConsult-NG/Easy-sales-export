"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logAdminFinancialAction, createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { requireSession } from "@/lib/session-guard";
import { ActionResponse } from "@/lib/safe-action";

/**
 * Payment Tracking & Verification System
 * MIGRATED TO FIREBASE-ADMIN for server-side security
 */

export interface PaymentRecord { id?: string;
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
    paystackResponse?: any; }

/**
 * Create payment record
 */
export async function createPaymentRecordAction(data: { userId: string;
    userEmail: string;
    amount: number;
    currency: string;
    paymentReference: string;
    paymentMethod: "paystack" | "bank_transfer" | "cash";
    purpose: "loan_repayment" | "escrow_payment" | "cooperative_contribution" | "export_slot" | "training_fee";
    relatedId?: string;
    metadata?: Record<string, any>; }): Promise<ActionResponse<any>> { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const payment: Omit<PaymentRecord, "id"> = { ...data,
            status: "pending",
            paymentMethod: data.paymentMethod,
            purpose: data.purpose,
            initiatedAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.PAYMENTS).add(payment);

        await createAdminAuditLog({ action: "payment_initiated",
            userId: data.userId,
            userEmail: data.userEmail,
            targetId: docRef.id,
            targetType: "payment",
            metadata: {
                amount: data.amount,
                purpose: data.purpose,
                reference: data.paymentReference } });

        return { success: true, error: null, data: { paymentId: docRef.id } };
    } catch (error) { logger.error("Payment record creation error:", error);
        return { success: false, error: "Failed to create payment record", data: null };
    }
}


/**
 * Get user payment history
 */
export async function getUserPaymentHistoryAction(userId: string): Promise<PaymentRecord[]> { try {
        const sessionResult = await requireSession();
        if (sessionResult.error) return [];

        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("userId", "==", userId)
            .get();

        return serializeDocs<PaymentRecord>(snapshot.docs);
    } catch (error) { logger.error("Failed to fetch payment history:", error);
        return [];
    }
}

/**
 * Get payment by reference
 */
export async function getPaymentByReferenceAction(
    paymentReference: string
): Promise<PaymentRecord | null> { try {
        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("paymentReference", "==", paymentReference)
            .get();

        if (snapshot.empty) {
            return null;
        }

        return serializeDoc<PaymentRecord>(snapshot.docs[0].id, snapshot.docs[0].data());
    } catch (error) { logger.error("Failed to fetch payment:", error);
        return null;
    }
}
