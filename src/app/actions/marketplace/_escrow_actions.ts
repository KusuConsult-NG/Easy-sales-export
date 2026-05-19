"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import type { EscrowStatus, EscrowTransaction } from "@/types/escrow";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { createNotificationAction } from "@/app/actions/notifications";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { serializeValue, serializeDocs } from "@/lib/firestore-serialize";

// Validation schemas
const escrowAmountSchema = z.number().min(100).max(100000000); // ₦100 to ₦100M
const escrowStatusSchema = z.enum(["pending", "funded", "in_transit", "delivered", "released", "refunded", "disputed", "cancelled"]);

/**
 * Get user's escrow transactions
 */
async function _getUserEscrowTransactions() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Query transactions where user is participant (buyer OR seller)
        const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("participants", "array-contains", userId)
            .orderBy("createdAt", "desc")
            .get();

        const transactions = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate(),
                paidAt: (data.paidAt as Timestamp)?.toDate(),
                releasedAt: (data.releasedAt as Timestamp)?.toDate(),
                refundedAt: (data.refundedAt as Timestamp)?.toDate(),
                releaseRequestedAt: (data.releaseRequestedAt as Timestamp)?.toDate() };
        });

        return { success: true as const, error: null, data: { transactions: transactions as any as EscrowTransaction[] } };
    } catch (error: any) { logger.error("Get escrow transactions error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getUserEscrowTransactions = withFlexibleSafeAction("getUserEscrowTransactions", _getUserEscrowTransactions);

/**
 * Get ALL escrow transactions (Admin only)
 * Used by the admin escrow management dashboard.
 */
async function _getAllEscrowTransactionsAdmin(options: { status?: EscrowStatus;
    limit?: number;
    lastDocId?: string;
    search?: string;
    sortOrder?: "asc" | "desc"; } = {}) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Live role re-validation
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];
        if (!callerRoles.includes("admin") && !callerRoles.includes("super_admin")) { return { success: false as const, error: "Admin access required", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
        const sortDirection = options.sortOrder || "desc";
        let q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).orderBy("createdAt", sortDirection);

        if (options.status) { q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", sortDirection);
        }

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        q = q.limit(fetchLimit);
        const snapshot = await q.get();

        let transactions = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                paidAt: data.paidAt ? (data.paidAt as Timestamp).toDate().toISOString() : null,
                releasedAt: data.releasedAt ? (data.releasedAt as Timestamp).toDate().toISOString() : null,
                refundedAt: data.refundedAt ? (data.refundedAt as Timestamp).toDate().toISOString() : null,
                releaseRequestedAt: data.releaseRequestedAt ? (data.releaseRequestedAt as Timestamp).toDate().toISOString() : null 
            } as any;
        });

        // 2. Batch fetch user profiles for bank details and contact info
        const participantIds = Array.from(new Set(transactions.flatMap((t: any) => [t.buyerId, t.sellerId].filter(Boolean))));
        const userProfiles: Record<string, any> = {};

        if (participantIds.length > 0) {
            const userPromises = [];
            for (let i = 0; i < participantIds.length; i += 30) {
                const chunk = participantIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(require("firebase-admin/firestore").FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(doc => {
                const data = doc.data();
                userProfiles[doc.id] = {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    email: data.email,
                    phoneNumber: data.phoneNumber || data.phone || "N/A",
                    bankDetails: data.bankDetails || {
                        bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                        accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                        accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName || "N/A",
                        bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                    }
                };
            }));
        }

        // 3. Inject profiles into transactions
        transactions = transactions.map((t: any) => ({
            ...t,
            buyerDetails: t.buyerId ? userProfiles[t.buyerId] : null,
            sellerDetails: t.sellerId ? userProfiles[t.sellerId] : null
        }));

        // Client-side search if specified
        if (options.search) { 
            const s = options.search.toLowerCase().trim();
            transactions = transactions.filter((t: any) => {
                const searchString = [
                    t.buyerEmail,
                    t.sellerEmail,
                    t.productName,
                    t.paymentReference,
                    t.buyerDetails?.email,
                    t.sellerDetails?.email,
                    t.buyerDetails?.phoneNumber,
                    t.sellerDetails?.phoneNumber,
                    t.buyerDetails?.firstName,
                    t.sellerDetails?.firstName
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            error: null, 
            data: { 
                transactions,
                lastDocId: nextCursor,
                hasMore: !!nextCursor
            } 
        };
    } catch (error: any) { logger.error("Get all escrow transactions admin error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getAllEscrowTransactionsAdmin = withFlexibleSafeAction("getAllEscrowTransactionsAdmin", _getAllEscrowTransactionsAdmin);

/**
 * Update escrow status
 */
async function _updateEscrowStatus(
    transactionId: string,
    status: EscrowStatus
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Validate status
        escrowStatusSchema.parse(status);

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        await db.runTransaction(async (tx) => { const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;

            // Verify user is participant
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to update this transaction");
            }

            // Validate state transitions
            const currentStatus = txData.status;
            const validTransitions: Record<string, string[]> = { pending: ["funded", "cancelled"],
                funded: ["in_transit", "disputed", "cancelled"],
                in_transit: ["delivered", "disputed"],
                delivered: ["completed", "disputed"],
                completed: [],
                disputed: ["completed", "cancelled"],
                cancelled: [] };

            if (!validTransitions[currentStatus]?.includes(status)) {
                throw new Error(`Invalid status transition from ${currentStatus} to ${status}`);
            }

            // Guard admin-only transitions
            if (
                (currentStatus === "disputed" || status === "completed") &&
                !session.user.roles?.includes("admin") &&
                !session.user.roles?.includes("super_admin")
            ) { throw new Error("Admin access required to perform this transition");
            }

            tx.update(txRef, {
                status,
                updatedAt: FieldValue.serverTimestamp(),
                [`${status}At`]: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        // Notifications
        const txDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId).get();
        if (txDoc.exists) { const txData = txDoc.data()!;
            const otherPartyId = txData.buyerId === userId ? txData.sellerId : txData.buyerId;
            const statusLabels: Record<string, string> = {
                funded: "Funded",
                in_transit: "In Transit",
                delivered: "Delivered",
                completed: "Completed",
                disputed: "Disputed",
                cancelled: "Cancelled" };
            await createNotificationAction({
                userId: otherPartyId,
                type: "escrow",
                title: `Escrow ${statusLabels[status] ?? status}`,
                message: `The escrow for "${txData.productName}" has been updated to status: ${statusLabels[status] ?? status}.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[updateEscrowStatus] Notification failed:", e));
        }

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Update escrow status error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });

        if (error instanceof z.ZodError) { return { success: false as const, error: "Invalid status value"};
        }

        return { success: false as const, error: error.message};
    }
}
export const updateEscrowStatus = withFlexibleSafeAction("updateEscrowStatus", _updateEscrowStatus);

/**
 * Create escrow dispute
 */
async function _createEscrowDispute(
    transactionId: string,
    reason: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        const userId = session.user.id;

        if (!reason.trim() || reason.length < 10 || reason.length > 1000) { return { success: false as const, error: "Dispute reason must be 10-1000 characters"};
        }

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();

        await db.runTransaction(async (tx) => { const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to dispute this transaction");
            }

            const disputeableStatuses = ["funded", "in_transit", "delivered"];
            if (!disputeableStatuses.includes(txData.status)) {
                throw new Error(`Cannot dispute transaction in ${txData.status} status`);
            }

            tx.set(disputeRef, { escrowId: transactionId,
                buyerId: txData.buyerId,
                sellerId: txData.sellerId,
                reason,
                description: reason,
                raisedBy: userId,
                status: "open",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 });

            tx.update(txRef, { status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Create escrow dispute error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message};
    }
}
export const createEscrowDispute = withFlexibleSafeAction("createEscrowDispute", _createEscrowDispute);

/**
 * Release escrow funds (Admin only)
 */
async function _releaseEscrowFunds(
    transactionId: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) { return { success: false as const, error: "Admin access required"};
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        let txData: any = null;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");
            const data = txDoc.data()!;

            if (data.status !== "delivered" && data.status !== "disputed" && data.status !== "funded") {
                throw new Error(`Cannot release escrow in ${data.status} status.`);
            }

            if (data.status === "released") throw new Error("Escrow already released");
            if (!data.amount || data.amount <= 0) throw new Error("Invalid transaction amount");

            txData = data;
            const paymentInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(paymentInstructionRef, {
                type: "escrow_release",
                escrowId: transactionId,
                recipientId: data.sellerId,
                recipientEmail: data.sellerEmail,
                amount: data.amount,
                status: "pending_admin_action",
                description: `Release escrow funds for ${data.productName}`,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: userId,
                _version: 0 });

            tx.update(txRef, { status: "released",
                releasedAt: FieldValue.serverTimestamp(),
                releasedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (txData) { await createAdminAuditLog({
                userId,
                action: 'escrow_released',
                targetId: transactionId,
                targetType: "escrow",
                metadata: { sellerId: txData.sellerId, amount: txData.amount }
            });

            await Promise.allSettled([
                createNotificationAction({
                    userId: txData.sellerId,
                    type: "escrow",
                    title: "Escrow Funds Released",
                    message: `₦${txData.amount.toLocaleString()} for "${txData.productName}" has been released.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
                createNotificationAction({
                    userId: txData.buyerId,
                    type: "escrow",
                    title: "Transaction Completed",
                    message: `Escrow for "${txData.productName}" completed and funds released.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
            ]).catch((e) => logger.error("[releaseEscrowFunds] Notifications failed:", e));
        }

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Release escrow funds error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message};
    }
}
export const releaseEscrowFunds = withFlexibleSafeAction("releaseEscrowFunds", _releaseEscrowFunds);

/**
 * Refund escrow to buyer (Admin only)
 */
async function _refundEscrowToBuyer(
    transactionId: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) { return { success: false as const, error: "Admin access required"};
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        let txData: any = null;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");
            const data = txDoc.data()!;

            if (!["funded", "in_transit", "disputed"].includes(data.status)) {
                throw new Error(`Cannot refund escrow in ${data.status} status`);
            }

            if (data.refundedAt) throw new Error("Escrow already refunded");

            txData = data;
            const refundInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(refundInstructionRef, {
                type: "escrow_refund",
                escrowId: transactionId,
                recipientId: data.buyerId,
                recipientEmail: data.buyerEmail,
                amount: data.amount,
                status: "pending_admin_action",
                description: `Refund escrow for ${data.productName}`,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: userId,
                _version: 0 });

            tx.update(txRef, { status: "cancelled",
                refundedAt: FieldValue.serverTimestamp(),
                refundedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (txData) { await createAdminAuditLog({
                userId,
                action: 'escrow_refunded',
                targetId: transactionId,
                targetType: "escrow",
                metadata: { buyerId: txData.buyerId, amount: txData.amount }
            });

            await Promise.allSettled([
                createNotificationAction({
                    userId: txData.buyerId,
                    type: "escrow",
                    title: "Escrow Refunded",
                    message: `Your escrow of ₦${txData.amount.toLocaleString()} for "${txData.productName}" has been refunded.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
                createNotificationAction({
                    userId: txData.sellerId,
                    type: "escrow",
                    title: "Escrow Cancelled",
                    message: `The escrow for "${txData.productName}" has been cancelled and funds returned to buyer.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
            ]).catch((e) => logger.error("[refundEscrowToBuyer] Notifications failed:", e));
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("Refund escrow error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const refundEscrowToBuyer = withFlexibleSafeAction("refundEscrowToBuyer", _refundEscrowToBuyer);

