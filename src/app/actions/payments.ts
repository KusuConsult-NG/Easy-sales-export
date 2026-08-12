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

        // `amount` was written exactly as supplied. Nothing aggregates this
        // collection today — every other reader fetches a single document by id
        // — so a negative or NaN row is a data-quality problem rather than a
        // money one. It is still a payments writer, and the check is one line.
        const amount = Number(data.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            return { success: false, error: "Amount must be a positive number", data: null };
        }
        if (!String(data.paymentReference ?? "").trim()) {
            return { success: false, error: "A payment reference is required", data: null };
        }

        // userEmail arrived from the caller alongside userId, and both the record
        // and the audit row below were written from it. So a caller could file
        // their own payment under somebody else's email address, and the audit
        // entry would agree with it — the same caller-supplied-identity shape as
        // #103, #122 and #137, one field further along.
        //
        // The address is now read from the account the payment is being recorded
        // against, which is the only place it can be trusted from. The extra read
        // only happens on the admin-on-behalf path; a self-call uses the session.
        let userEmail: string;
        if (callerId === data.userId) {
            userEmail = sessionResult.session?.user?.email ?? "";
        } else {
            const targetSnap = await db.collection(COLLECTIONS.USERS).doc(data.userId).get();
            if (!targetSnap.exists) {
                return { success: false, error: "User not found", data: null };
            }
            userEmail = String(targetSnap.data()?.email ?? "");
        }

        const payment: Omit<PaymentRecord, "id"> = { ...data,
            // After the spread, so the caller's copies of these are recorded
            // nowhere.
            amount,
            userEmail,
            status: "pending",
            paymentMethod: data.paymentMethod,
            purpose: data.purpose,
            initiatedAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.PAYMENTS).add(payment);

        await createAdminAuditLog({ action: "payment_initiated",
            userId: data.userId,
            userEmail,
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
        // The sibling that was left behind.
        //
        // The other two actions in this file were both closed in an earlier
        // pass — createPaymentRecordAction stopped trusting a caller-supplied
        // userId, and getPaymentByReferenceAction stopped serving a record to
        // anyone holding a reference. This one kept the exact shape both of them
        // were fixed for: requireSession() was called, only `error` was
        // inspected, and the query then ran on the caller's own `userId`
        // argument. The session was fetched and never consulted.
        //
        // So any authenticated user could read anybody's payment history. The
        // `payments` collection is live and populated — farm-nation-payment.ts,
        // marketplace/_payment.ts and infrastructure/payments/service.ts all
        // write real rows carrying userEmail, amount, purpose, relatedId,
        // sellerId and participants. A user id is enough to harvest another
        // person's purchase history, and user ids are not secret.
        //
        // Two of three fixed and the third left is the pattern this audit keeps
        // meeting. It is why the read half of ownership-scan.ts was blind here:
        // the scanner treated `.where("userId", "==", userId)` as evidence that
        // ownership had been checked, when the value being scoped came from the
        // caller rather than the session — in which case that clause IS the
        // vulnerability, not the defence.
        const sessionResult = await requireSession();
        const session = sessionResult.session;
        if (!session?.user?.id) return [];

        // An empty list rather than an error, matching
        // getPaymentByReferenceAction: the endpoint does not confirm whose
        // history exists.
        if (session.user.id !== userId && !isAdmin(session.user.roles)) {
            return [];
        }

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
