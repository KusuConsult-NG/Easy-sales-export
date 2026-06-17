"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import type { EscrowStatus, EscrowTransaction } from "@/types/escrow";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog } from "@/lib/audit-log";
import { createNotificationAction } from "@/app/actions/notifications";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { serializeValue, serializeDocs } from "@/lib/firestore-serialize";
import { smsEscrowReleased } from "@/lib/africastalking";
import { pushEscrowReleased } from "@/lib/fcm";

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
                ...serializeValue(data),
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                paidAt: data.paidAt ? (data.paidAt as Timestamp).toDate().toISOString() : null,
                releasedAt: data.releasedAt ? (data.releasedAt as Timestamp).toDate().toISOString() : null,
                refundedAt: data.refundedAt ? (data.refundedAt as Timestamp).toDate().toISOString() : null,
                releaseRequestedAt: data.releaseRequestedAt ? (data.releaseRequestedAt as Timestamp).toDate().toISOString() : null };
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

        if (options.status && (options.status as string) !== "all") { q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
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
                // DISEASE 5 FIX: serializeValue catches ALL Timestamp fields (including any
                // future ones like disputedAt, completedAt) — not just the named ones below
                ...serializeValue(data),
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
        const txDoc = await txRef.get();
        if (!txDoc.exists) return { success: false as const, error: "Transaction not found" };
        const data = txDoc.data()!;

        if (data.status !== "delivered" && data.status !== "disputed" && data.status !== "funded") {
            return { success: false as const, error: `Cannot release escrow in ${data.status} status.` };
        }

        if (data.status === "released") return { success: false as const, error: "Escrow already released" };
        
        const escrowAmount = data.amount || data.grossAmount || 0;
        if (escrowAmount <= 0) return { success: false as const, error: "Invalid transaction amount" };

        const orderId = data.orderId;
        const orderEscrowsQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .get();

        await db.runTransaction(async (tx) => {
            // 1. Update Escrow status
            tx.update(txRef, { status: "released",
                releasedAt: FieldValue.serverTimestamp(),
                releasedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });

            // 2. Create payout instruction
            const paymentInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(paymentInstructionRef, {
                type: "escrow_release",
                escrowId: transactionId,
                recipientId: data.sellerId,
                recipientEmail: data.sellerEmail || "",
                amount: escrowAmount,
                status: "pending_admin_action",
                description: `Release escrow funds for ${data.productName}`,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: userId,
                _version: 0 });

            // 3. Credit Seller's Wallet directly
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(data.sellerId);
            const walletSnap = await tx.get(walletRef);
            let balanceBefore = 0;
            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: data.sellerId,
                    balance: escrowAmount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                balanceBefore = walletSnap.data()?.balance || 0;
                tx.update(walletRef, {
                    balance: FieldValue.increment(escrowAmount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // Record transaction in seller's wallet_transactions history
            const sellerTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            tx.set(sellerTxnRef, {
                id: sellerTxnRef.id,
                walletId: data.sellerId,
                userId: data.sellerId,
                type: "funding",
                amount: escrowAmount,
                balanceBefore,
                balanceAfter: balanceBefore + escrowAmount,
                reference: transactionId,
                description: `Payout for order #${data.orderId} (Escrow released)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 4. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${transactionId}`;
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(globalTxRef, {
                id: txId,
                userId: data.sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: escrowAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: transactionId,
                description: `Escrow Payout for "${data.productName}"`
            });

            // 5. Update Order Status if all escrows for this order are released
            const otherEscrows = orderEscrowsQuery.docs.filter(d => d.id !== transactionId);
            const allOthersReleased = otherEscrows.every(d => d.data().status === "released");
            if (allOthersReleased) {
                const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
                tx.update(orderRef, {
                    status: "completed",
                    paymentStatus: "paid_to_seller",
                    escrowReleased: true,
                    escrowReleasedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1)
                });
            }
        });

        await createAdminAuditLog({
            userId,
            action: 'escrow_released',
            targetId: transactionId,
            targetType: "escrow",
            metadata: { sellerId: data.sellerId, amount: escrowAmount }
        });

        await Promise.allSettled([
            createNotificationAction({
                userId: data.sellerId,
                type: "escrow",
                title: "Escrow Funds Released",
                message: `₦${escrowAmount.toLocaleString()} for "${data.productName}" has been released.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Details" }),
            createNotificationAction({
                userId: data.buyerId,
                type: "escrow",
                title: "Transaction Completed",
                message: `Escrow for "${data.productName}" completed and funds released.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Details" }),
        ]).catch((e) => logger.error("[releaseEscrowFunds] Notifications failed:", e));

        // Send SMS & Push notifications
        const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(data.sellerId).get();
        const sellerPhone: string | undefined = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
        const orderRef = data.orderId;

        await Promise.allSettled([
            sellerPhone ? smsEscrowReleased(sellerPhone, orderRef, escrowAmount) : Promise.resolve(),
            pushEscrowReleased(data.sellerId, orderRef, escrowAmount, transactionId),
        ]).catch((e) => logger.error("[releaseEscrowFunds] SMS/Push notifications failed:", e));

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
        let escrowAmount = 0;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");
            const data = txDoc.data()!;

            if (!["funded", "in_transit", "disputed"].includes(data.status)) {
                throw new Error(`Cannot refund escrow in ${data.status} status`);
            }

            if (data.refundedAt) throw new Error("Escrow already refunded");

            escrowAmount = data.amount || data.grossAmount || 0;
            if (escrowAmount <= 0) {
                throw new Error("Invalid transaction amount");
            }

            txData = data;
            const refundInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(refundInstructionRef, {
                type: "escrow_refund",
                escrowId: transactionId,
                recipientId: data.buyerId,
                recipientEmail: data.buyerEmail,
                amount: escrowAmount,
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
                metadata: { buyerId: txData.buyerId, amount: escrowAmount }
            });

            await Promise.allSettled([
                createNotificationAction({
                    userId: txData.buyerId,
                    type: "escrow",
                    title: "Escrow Refunded",
                    message: `Your escrow of ₦${escrowAmount.toLocaleString()} for "${txData.productName}" has been refunded.`,
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

