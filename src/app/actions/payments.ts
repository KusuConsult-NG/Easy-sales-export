"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { logAdminFinancialAction, createAdminAuditLog } from "@/lib/audit-log";
import { serializeDocs, serializeDoc } from "@/lib/firestore-serialize";
import { requireSession, isAdmin } from "@/lib/session-guard";
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

        // The session was established and then never consulted. `userId`,
        // `amount`, `paymentReference` and `purpose` all arrived from the
        // caller, so any authenticated user could file a payment record against
        // anybody, for any amount — and the audit row below recorded it under
        // the named user rather than the actual one.
        //
        // This action currently has no caller, so nothing was exploited. It is
        // guarded rather than deleted because a payment writer that trusts a
        // caller-supplied identity is worth neutralising wherever it sits, and
        // the fix is smaller than the argument for removing it.
        //
        // Admins keep the ability to record a payment on someone's behalf —
        // that is the reconciliation case that submitRepaymentAction exists for.
        const callerId = sessionResult.session?.user?.id;
        const actingAsAdmin = isAdmin(sessionResult.session?.user?.roles);
        if (!callerId || (callerId !== data.userId && !actingAsAdmin)) {
            return { success: false, error: "Unauthorized", data: null };
        }

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
        // This returned a full PaymentRecord — userId, userEmail, amount,
        // purpose, metadata — to anyone holding a reference, with no session at
        // all. Payment references are not secrets: they appear in Paystack
        // callback URLs, in receipts, and in emails.
        //
        // The record is now returned only to the person it belongs to, or an
        // admin. A caller who is not entitled to it gets null rather than an
        // error, so the endpoint does not confirm which references exist.
        const sessionResult = await requireSession();
        const session = sessionResult.session;
        if (!session?.user?.id) return null;

        const snapshot = await db.collection(COLLECTIONS.PAYMENTS)
            .where("paymentReference", "==", paymentReference)
            .get();

        if (snapshot.empty) {
            return null;
        }

        const record = serializeDoc<PaymentRecord>(snapshot.docs[0].id, snapshot.docs[0].data());
        if (record?.userId !== session.user.id && !isAdmin(session.user.roles)) {
            return null;
        }

        return record;
    } catch (error) { logger.error("Failed to fetch payment:", error);
        return null;
    }
}
