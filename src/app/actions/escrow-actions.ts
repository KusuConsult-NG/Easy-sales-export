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

// Validation schemas
const escrowAmountSchema = z.number().min(100).max(100000000); // ₦100 to ₦100M
const escrowStatusSchema = z.enum(["pending", "funded", "in_transit", "delivered", "completed", "disputed", "cancelled"]);

/** Structured unauthorised response */
function sessionError(sessionResult: { error: unknown }) {
    return { success: false, error: (sessionResult.error as any)?.error ?? "Session expired" };
}

/**
 * Get user's escrow transactions
 */
export async function getUserEscrowTransactions(): Promise<{ success: boolean; transactions?: EscrowTransaction[]; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        const userId = session.user.id;

        // Query transactions where user is buyer OR seller
        const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("participants", "array-contains", userId)
            .orderBy("createdAt", "desc")
            .get();

        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                buyerId: data.buyerId,
                buyerEmail: data.buyerEmail,
                sellerId: data.sellerId,
                sellerEmail: data.sellerEmail,
                amount: data.amount,
                productName: data.productName,
                productDescription: data.productDescription,
                status: data.status,
                paymentReference: data.paymentReference,
                releaseRequestedBy: data.releaseRequestedBy,
                releasedBy: data.releasedBy,
                participants: data.participants ?? [data.buyerId, data.sellerId].filter(Boolean),
                createdAt: (data.createdAt as Timestamp)?.toDate(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate(),
                paidAt: (data.paidAt as Timestamp)?.toDate(),
                releasedAt: (data.releasedAt as Timestamp)?.toDate(),
                refundedAt: (data.refundedAt as Timestamp)?.toDate(),
                releaseRequestedAt: (data.releaseRequestedAt as Timestamp)?.toDate(),
            } as EscrowTransaction;
        });

        return { success: true, transactions };
    } catch (error: any) {
        logger.error("Get escrow transactions error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get ALL escrow transactions (Admin only)
 * Used by the admin escrow management dashboard.
 */
export async function getAllEscrowTransactionsAdmin(options: {
    status?: EscrowStatus;
    limit?: number;
    lastDocId?: string;
    search?: string;
} = {}): Promise<{ success: boolean; transactions?: EscrowTransaction[]; error?: string; hasMore?: boolean; lastDocId?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        // Enforce admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const fetchLimit = options.limit || 50;
        let q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).orderBy("createdAt", "desc");

        if (options.status) {
            q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("status", "==", options.status)
                .orderBy("createdAt", "desc");
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        q = q.limit(fetchLimit);
        const snapshot = await q.get();

        let transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                buyerId: data.buyerId,
                buyerEmail: data.buyerEmail,
                sellerId: data.sellerId,
                sellerEmail: data.sellerEmail,
                amount: data.amount,
                productName: data.productName,
                productDescription: data.productDescription,
                status: data.status,
                paymentReference: data.paymentReference,
                releaseRequestedBy: data.releaseRequestedBy,
                releasedBy: data.releasedBy,
                participants: data.participants ?? [data.buyerId, data.sellerId].filter(Boolean),
                createdAt: (data.createdAt as Timestamp)?.toDate(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate(),
                paidAt: (data.paidAt as Timestamp)?.toDate(),
                releasedAt: (data.releasedAt as Timestamp)?.toDate(),
                refundedAt: (data.refundedAt as Timestamp)?.toDate(),
                releaseRequestedAt: (data.releaseRequestedAt as Timestamp)?.toDate(),
            } as EscrowTransaction;
        });

        // Client-side search if specified
        if (options.search) {
            const s = options.search.toLowerCase();
            transactions = transactions.filter(t => 
                t.buyerEmail?.toLowerCase().includes(s) || 
                t.sellerEmail?.toLowerCase().includes(s) || 
                t.productName?.toLowerCase().includes(s) ||
                t.paymentReference?.toLowerCase().includes(s)
            );
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true, 
            transactions,
            lastDocId: nextCursor,
            hasMore: !!nextCursor
        };
    } catch (error: any) {
        logger.error("Get all escrow transactions admin error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update escrow status — Guarded by a Firestore transaction to prevent
 * race conditions on state machine transitions.
 */
export async function updateEscrowStatus(
    transactionId: string,
    status: EscrowStatus
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        const userId = session.user.id;

        // Validate status
        escrowStatusSchema.parse(status);

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;

            // Verify user is participant (buyer or seller)
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to update this transaction");
            }

            // Validate state transitions
            const currentStatus = txData.status;
            const validTransitions: Record<string, string[]> = {
                pending: ["funded", "cancelled"],
                funded: ["in_transit", "disputed", "cancelled"],
                in_transit: ["delivered", "disputed"],
                delivered: ["completed", "disputed"],
                completed: [], // Terminal state
                disputed: ["completed", "cancelled"], // Admin only
                cancelled: [], // Terminal state
            };

            if (!validTransitions[currentStatus]?.includes(status)) {
                throw new Error(`Invalid status transition from ${currentStatus} to ${status}`);
            }

            // "disputed" and "completed" from disputed should be admin-only
            if (
                (currentStatus === "disputed" || status === "completed") &&
                !session.user.roles?.includes("admin") &&
                !session.user.roles?.includes("super_admin")
            ) {
                throw new Error("Admin access required to perform this transition");
            }

            tx.update(txRef, {
                status,
                updatedAt: FieldValue.serverTimestamp(),
                [`${status}At`]: FieldValue.serverTimestamp(),
            });
        });

        // Dispatch in-app notification to the other participant
        const txDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId).get();
        if (txDoc.exists) {
            const txData = txDoc.data()!;
            const otherPartyId = txData.buyerId === userId ? txData.sellerId : txData.buyerId;
            const statusLabels: Record<string, string> = {
                funded: "Funded",
                in_transit: "In Transit",
                delivered: "Delivered",
                completed: "Completed",
                disputed: "Disputed",
                cancelled: "Cancelled",
            };
            await createNotificationAction({
                userId: otherPartyId,
                type: "escrow",
                title: `Escrow ${statusLabels[status] ?? status}`,
                message: `The escrow for "${txData.productName}" has been updated to status: ${statusLabels[status] ?? status}.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Escrow",
            }).catch((e) => logger.error("[updateEscrowStatus] Notification failed:", e));
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Update escrow status error:", error);

        if (error instanceof z.ZodError) {
            return { success: false, error: "Invalid status value" };
        }

        return { success: false, error: error.message };
    }
}

/**
 * Create escrow dispute — atomically marks transaction as disputed.
 */
export async function createEscrowDispute(
    transactionId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        const userId = session.user.id;

        // Validate reason
        if (!reason.trim() || reason.length < 10 || reason.length > 1000) {
            return { success: false, error: "Dispute reason must be 10-1000 characters" };
        }

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        // Check for existing active dispute before entering transaction (read-only guard)
        const existingDisputes = await db.collection(COLLECTIONS.DISPUTES)
            .where("orderId", "==", transactionId)
            .where("status", "in", ["open", "under_review"])
            .get();

        if (!existingDisputes.empty) {
            return { success: false, error: "An active dispute already exists" };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(); // auto-ID

        // Use transaction to atomically create dispute + mark transaction as disputed
        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;

            // Verify user is participant
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to dispute this transaction");
            }

            // Validate disputeable statuses
            const disputeableStatuses = ["funded", "in_transit", "delivered"];
            if (!disputeableStatuses.includes(txData.status)) {
                throw new Error(`Cannot dispute transaction in ${txData.status} status`);
            }

            const disputeData = {
                orderId: transactionId,
                buyerId: txData.buyerId,
                sellerId: txData.sellerId,
                reason,
                description: reason,
                raisedBy: userId,
                status: "open",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };

            tx.set(disputeRef, disputeData);
            tx.update(txRef, {
                status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Create escrow dispute error:", error);
        return { success: false, error: error.message };
    }
}

// Re-read after transaction to get participant IDs for notifications
async function notifyEscrowParticipants(
    transactionId: string,
    initiatorId: string,
    initiatorMessage: { title: string; message: string },
    otherMessage: { title: string; message: string }
) {
    try {
        const txDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId).get();
        if (!txDoc.exists) return;
        const txData = txDoc.data()!;
        const otherPartyId = txData.buyerId === initiatorId ? txData.sellerId : txData.buyerId;

        await Promise.allSettled([
            createNotificationAction({ userId: initiatorId, type: "dispute", link: `/escrow/${transactionId}`, linkText: "View", ...initiatorMessage }),
            createNotificationAction({ userId: otherPartyId, type: "dispute", link: `/escrow/${transactionId}`, linkText: "View", ...otherMessage }),
        ]);
    } catch (e) {
        logger.error("[notifyEscrowParticipants] Failed:", e);
    }
}

/**
 * Release escrow funds (Admin only) — runs in a Firestore transaction to 
 * prevent double-release race conditions.
 */
export async function releaseEscrowFunds(
    transactionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        let txData: FirebaseFirestore.DocumentData | null = null;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const data = txDoc.data()!;

            // Validate current status
            if (data.status !== "delivered" && data.status !== "disputed") {
                throw new Error(
                    `Cannot release escrow in ${data.status} status. Must be 'delivered' or 'disputed'.`
                );
            }

            // Prevent double-release (should be caught by status check, but explicit guard)
            if (data.status === "completed") {
                throw new Error("Escrow already released");
            }

            // Validate amount
            if (!data.amount || data.amount <= 0) {
                throw new Error("Invalid transaction amount");
            }

            txData = data;

            // Create payment instruction atomically within the same transaction
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
                metadata: {
                    buyerId: data.buyerId,
                    productName: data.productName,
                    paymentReference: data.paymentReference,
                },
            });

            tx.update(txRef, {
                status: "completed",
                releasedAt: FieldValue.serverTimestamp(),
                releasedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // Audit log outside transaction (non-critical, informational)
        if (txData) {
            await createAdminAuditLog({
                userId,
                action: 'escrow_released',
                targetId: transactionId,
                targetType: "escrow",
                metadata: {
                    sellerId: (txData as any).sellerId,
                    amount: (txData as any).amount,
                    productName: (txData as any).productName,
                }
            });

            const d = txData as any;
            await Promise.allSettled([
                createNotificationAction({
                    userId: d.sellerId,
                    type: "escrow",
                    title: "Escrow Funds Released",
                    message: `₦${(d.amount as number).toLocaleString()} for "${d.productName}" has been released to your account.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details",
                }),
                createNotificationAction({
                    userId: d.buyerId,
                    type: "escrow",
                    title: "Transaction Completed",
                    message: `The escrow for "${d.productName}" has been completed and funds released to the seller.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details",
                }),
            ]).catch((e) => logger.error("[releaseEscrowFunds] Notifications failed:", e));
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Release escrow funds error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Refund escrow to buyer (Admin only) — runs in a Firestore transaction to
 * prevent double-refund race conditions.
 */
export async function refundEscrowToBuyer(
    transactionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionError(sessionResult);
        const { session } = sessionResult;

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        let txData: FirebaseFirestore.DocumentData | null = null;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const data = txDoc.data()!;

            // Validate current status (can only refund if in these states)
            if (!["funded", "in_transit", "disputed"].includes(data.status)) {
                throw new Error(`Cannot refund escrow in ${data.status} status`);
            }

            // Prevent double-refund
            if (data.refundedAt) {
                throw new Error("Escrow already refunded");
            }

            txData = data;

            // Create refund instruction atomically
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
                metadata: {
                    sellerId: data.sellerId,
                    productName: data.productName,
                    paymentReference: data.paymentReference,
                    reason: "Escrow cancelled/disputed",
                },
            });

            tx.update(txRef, {
                status: "cancelled",
                refundedAt: FieldValue.serverTimestamp(),
                refundedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        // Audit log outside transaction (non-critical)
        if (txData) {
            await createAdminAuditLog({
                userId,
                action: 'escrow_refunded',
                targetId: transactionId,
                targetType: "escrow",
                metadata: {
                    buyerId: (txData as any).buyerId,
                    amount: (txData as any).amount,
                    productName: (txData as any).productName,
                }
            });

            const d = txData as any;
            await Promise.allSettled([
                createNotificationAction({
                    userId: d.buyerId,
                    type: "escrow",
                    title: "Escrow Refunded",
                    message: `Your escrow of ₦${(d.amount as number).toLocaleString()} for "${d.productName}" has been refunded.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details",
                }),
                createNotificationAction({
                    userId: d.sellerId,
                    type: "escrow",
                    title: "Escrow Cancelled",
                    message: `The escrow for "${d.productName}" has been cancelled and funds returned to the buyer.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details",
                }),
            ]).catch((e) => logger.error("[refundEscrowToBuyer] Notifications failed:", e));
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Refund escrow error:", error);
        return { success: false, error: error.message };
    }
}
