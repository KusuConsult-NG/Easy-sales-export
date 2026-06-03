/**
 * Server Actions for Dispute Resolution System
 */

"use server";

import { requireSession, isAdmin } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Dispute, Order, DisputeReason, DisputeResolution } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { smsDisputeResolved } from "@/lib/africastalking";
import { pushDisputeResolved } from "@/lib/fcm";


/**
 * Create a new dispute for an order
 */
async function _createDisputeAction(params: { orderId: string;
    reason: DisputeReason;
    description: string;
    evidenceUrls?: string[]; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { orderId, reason, description, evidenceUrls = [] } = params;

        if (description.length < 50) { return { success: false as const, error: "Description must be at least 50 characters", data: null };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const order = orderDoc.data() as Order;
        if (order.buyerId !== userId) { return { success: false as const, error: "Not authorized", data: null };
        }

        if (order.status === "completed" || order.status === "cancelled") { return { success: false as const, error: "Cannot dispute completed or cancelled orders", data: null };
        }

        if (order.status === "pending_payment") { return { success: false as const, error: "Cannot dispute an unpaid order", data: null };
        }

        if (order.status === "disputed") { return { success: false as const, error: "Order already has an active dispute", data: null };
        }

        const existingDisputes = await db.collection(COLLECTIONS.DISPUTES)
            .where("orderId", "==", orderId)
            .where("status", "in", ["open", "under_review"])
            .get();

        if (!existingDisputes.empty) { return { success: false as const, error: "Active dispute already exists for this order", data: null };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        await db.runTransaction(async (tx) => { const freshOrderDoc = await tx.get(orderRef);
            if (!freshOrderDoc.exists) throw new Error("Order not found");

            const freshOrder = freshOrderDoc.data() as Order;
            if (freshOrder.status === "disputed") {
                throw new Error("Order already has an active dispute");
            }
            if (freshOrder.status === "completed" || freshOrder.status === "cancelled") { throw new Error("Cannot dispute completed or cancelled orders");
            }

            const disputeData: Partial<Dispute> = { orderId,
                buyerId: userId,
                sellerId: freshOrder.sellerId,
                reason,
                description,
                evidenceUrls,
                status: "open",
                _version: 0,
                createdAt: FieldValue.serverTimestamp() as any,
                updatedAt: FieldValue.serverTimestamp() as any };

            tx.set(disputeRef, disputeData);
            tx.update(orderRef, { status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Create dispute error:", {
            userId: sessionResult?.session?.user?.id,
            orderId: params.orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create dispute", data: null };
    }
}
export const createDisputeAction = withFlexibleSafeAction("createDisputeAction", _createDisputeAction);

/**
 * Get buyer's disputes
 */
async function _getBuyerDisputesAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => { const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                resolvedAt: (data.resolvedAt as Timestamp)?.toDate() || undefined };
        }) as Dispute[];

        return { error: null, success: true as const, data: disputes };
    } catch (error) { logger.error("Get buyer disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes", data: null };
    }
}
export const getBuyerDisputesAction = withFlexibleSafeAction("getBuyerDisputesAction", _getBuyerDisputesAction);

/**
 * Get seller's disputes
 */
async function _getSellerDisputesAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("sellerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => { const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                resolvedAt: (data.resolvedAt as Timestamp)?.toDate() || undefined };
        }) as Dispute[];

        return { error: null, success: true as const, data: disputes };
    } catch (error) { logger.error("Get seller disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes", data: null };
    }
}
export const getSellerDisputesAction = withFlexibleSafeAction("getSellerDisputesAction", _getSellerDisputesAction);

/**
 * Get all disputes (Admin only)
 */
async function _getAdminDisputesAction(options: { status?: "open" | "under_review" | "resolved" | "closed" | "all";
    escalated?: boolean;
    limit?: number;
    search?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; } = {}) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) { return { success: false as const, error: "Not authorized as admin", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
        const sortDirection = options.sortOrder || "desc";
        let queryRef = db.collection(COLLECTIONS.DISPUTES).orderBy("createdAt", sortDirection);

        if (options.status && options.status !== "all") { queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("status", "==", options.status)
                .orderBy("createdAt", sortDirection);
        }

        if (options.escalated !== undefined) { queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("escalated", "==", options.escalated)
                .orderBy("createdAt", sortDirection);
        }

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.DISPUTES).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
        let disputes: (Dispute & { buyerDetails?: any; sellerDetails?: any })[] = snapshot.docs.map(doc => { const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                resolvedAt: data.resolvedAt ? (data.resolvedAt as Timestamp).toDate().toISOString() : null };
        }) as any[];

        // 2. Batch fetch user profiles for bank details and contact info
        const participantIds = Array.from(new Set(disputes.flatMap((d: any) => [d.buyerId, d.sellerId].filter(Boolean))));
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

        // 3. Inject profiles into disputes
        disputes = disputes.map((d: any) => ({
            ...d,
            buyerDetails: d.buyerId ? userProfiles[d.buyerId] : null,
            sellerDetails: d.sellerId ? userProfiles[d.sellerId] : null
        }));

        if (options.search) { 
            const q = options.search.toLowerCase().trim();
            disputes = disputes.filter(d => {
                const searchString = [
                    d.id,
                    d.orderId,
                    d.reason,
                    d.description,
                    d.buyerDetails?.email,
                    d.sellerDetails?.email
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            error: null, 
            data: disputes,
            disputes,
            lastDocId: nextCursor, 
            hasMore: !!nextCursor 
        };
    } catch (error) { logger.error("Get admin disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes for admin", data: null };
    }
}
export const getAdminDisputesAction = withFlexibleSafeAction("getAdminDisputesAction", _getAdminDisputesAction);

/**
 * Get single dispute by ID
 */
async function _getDisputeByIdAction(disputeId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) { return { success: false as const, error: "Dispute not found", data: null };
        }

        const dispute = disputeDoc.data() as Dispute;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        const isAdminUser = isAdmin(userData?.roles);
        const isBuyer = dispute.buyerId === userId;
        const isSeller = dispute.sellerId === userId;

        if (!isAdminUser && !isBuyer && !isSeller) { return { success: false as const, error: "Not authorized to view this dispute", data: null };
        }

        const disputeData: Dispute & { buyerDetails?: any; sellerDetails?: any } = { ...dispute,
            id: disputeDoc.id,
            createdAt: (dispute.createdAt as unknown as Timestamp)?.toDate ? (dispute.createdAt as unknown as Timestamp).toDate() : dispute.createdAt,
            updatedAt: (dispute.updatedAt as unknown as Timestamp)?.toDate ? (dispute.updatedAt as unknown as Timestamp).toDate() : dispute.updatedAt,
            resolvedAt: (dispute.resolvedAt as unknown as Timestamp)?.toDate ? (dispute.resolvedAt as unknown as Timestamp).toDate() : dispute.resolvedAt } as any;

        // Fetch profiles for detail view
        if (dispute.buyerId) {
            const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(dispute.buyerId).get();
            if (buyerDoc.exists) {
                const bData = buyerDoc.data()!;
                disputeData.buyerDetails = {
                    firstName: bData.firstName,
                    lastName: bData.lastName,
                    email: bData.email,
                    phoneNumber: bData.phoneNumber || bData.phone || "N/A",
                    bankDetails: bData.bankDetails || {
                        bankName: bData.bankName || bData.bankAccount?.bankName || "N/A",
                        accountNumber: bData.accountNumber || bData.bankAccount?.accountNumber || "N/A",
                        accountName: bData.accountName || bData.bankAccountName || bData.bankAccount?.accountName || "N/A",
                        bankCode: bData.bankCode || bData.bankAccount?.bankCode || "N/A"
                    }
                };
            }
        }

        if (dispute.sellerId) {
            const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(dispute.sellerId).get();
            if (sellerDoc.exists) {
                const sData = sellerDoc.data()!;
                disputeData.sellerDetails = {
                    firstName: sData.firstName,
                    lastName: sData.lastName,
                    email: sData.email,
                    phoneNumber: sData.phoneNumber || sData.phone || "N/A",
                    bankDetails: sData.bankDetails || {
                        bankName: sData.bankName || sData.bankAccount?.bankName || "N/A",
                        accountNumber: sData.accountNumber || sData.bankAccountNumber || sData.bankAccount?.accountNumber || "N/A",
                        accountName: sData.accountName || sData.bankAccountName || sData.bankAccount?.accountName || "N/A",
                        bankCode: sData.bankCode || sData.bankAccount?.bankCode || "N/A"
                    }
                };
            }
        }

        return { success: true as const, error: null, data: { dispute: disputeData } };
    } catch (error) { logger.error("Get dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch dispute details", data: null };
    }
}
export const getDisputeByIdAction = withFlexibleSafeAction("getDisputeByIdAction", _getDisputeByIdAction);

/**
 * Update dispute status and resolve (Admin only)
 */
async function _updateDisputeStatusAction(
    disputeId: string,
    resolution: DisputeResolution,
    adminNotes: string,
    refundAmount?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) { return { success: false as const, error: "Not authorized as admin", data: null };
        }

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) { return { success: false as const, error: "Dispute not found", data: null };
        }

        const dispute = disputeDoc.data() as Dispute;

        if (dispute.status === "resolved" || dispute.status === "closed") { return { success: false as const, error: `Dispute is already '${dispute.status}'` };
        }

        // Query the active escrow transaction prior to transaction block
        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", dispute.orderId)
            .get();

        if (escrowQuery.empty) {
            return { success: false as const, error: "Associated escrow transaction not found for this dispute", data: null };
        }

        // Find the active escrow transaction (funded or disputed or pending)
        const escrowDocSnap = escrowQuery.docs.find(doc => {
            const status = doc.data().status;
            return status === "funded" || status === "disputed" || status === "pending";
        }) || escrowQuery.docs[0];
        const escrowId = escrowDocSnap.id;
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);

        await db.runTransaction(async (tx) => {
            const freshDisputeDoc = await tx.get(disputeRef);
            if (!freshDisputeDoc.exists) throw new Error("Dispute not found");

            const freshDispute = freshDisputeDoc.data() as Dispute;
            if (freshDispute.status === "resolved" || freshDispute.status === "closed") {
                throw new Error(`Dispute is already '${freshDispute.status}'`);
            }

            const freshEscrowDoc = await tx.get(escrowRef);
            if (!freshEscrowDoc.exists) throw new Error("Escrow transaction not found");
            const freshEscrow = freshEscrowDoc.data();
            if (!freshEscrow) throw new Error("Escrow transaction data not found");

            const updateData: Record<string, unknown> = { status: "resolved",
                resolution,
                adminId: userId,
                adminNotes,
                resolvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (refundAmount !== undefined) { updateData.refundAmount = refundAmount;
            }

            tx.update(disputeRef, updateData);

            if (freshDispute.orderId) { const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(freshDispute.orderId);
                let newOrderStatus: string;

                if (resolution === "refund_buyer") {
                    newOrderStatus = "cancelled";
                } else if (resolution === "release_seller") { newOrderStatus = "completed";
                } else { newOrderStatus = "completed";
                }

                tx.update(orderRef, { status: newOrderStatus,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1) });
            }

            // Update Escrow status atomically
            const finalEscrowStatus = resolution === "release_seller" ? "released" : "refunded";
            tx.update(escrowRef, {
                status: finalEscrowStatus,
                releasedBy: userId,
                [resolution === "release_seller" ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1)
            });

            // Credit the target user's wallet balance atomically
            const targetId = resolution === "release_seller" ? freshDispute.sellerId : freshDispute.buyerId;
            if (!targetId) throw new Error("Target beneficiary ID not found on dispute");

            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(targetId);
            const walletSnap = await tx.get(walletRef);
            const escrowAmount = freshEscrow.amount ?? dispute.refundAmount ?? freshDispute.refundAmount ?? 0;

            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: targetId,
                    balance: escrowAmount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                tx.update(walletRef, {
                    balance: FieldValue.increment(escrowAmount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // Write the global ledger record under DISPUTE-RES-${disputeId.substring(0, 8)}
            const txId = `DISPUTE-RES-${disputeId.substring(0, 8)}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: targetId,
                type: resolution === "release_seller" ? "dispute_payout" : "dispute_refund",
                module: "escrow",
                amount: escrowAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Dispute Resolution (${resolution}) for "${freshEscrow.productName || 'Marketplace Order'}"`
            });
        });

        // Post-transaction notifications (non-fatal)
        try {
            if (dispute.buyerId && dispute.sellerId) {
                const buyerIdStr = dispute.buyerId;
                const sellerIdStr = dispute.sellerId;
                const [buyerDoc, sellerDoc] = await Promise.all([
                    db.collection(COLLECTIONS.USERS).doc(buyerIdStr).get(),
                    db.collection(COLLECTIONS.USERS).doc(sellerIdStr).get(),
                ]);
                const buyerPhone = buyerDoc.data()?.phone ?? buyerDoc.data()?.phoneNumber;
                const sellerPhone = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
                
                await Promise.allSettled([
                    buyerPhone ? smsDisputeResolved(buyerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
                    sellerPhone ? smsDisputeResolved(sellerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
                    pushDisputeResolved(buyerIdStr, sellerIdStr, dispute.orderId || disputeId)
                ]);
            }
        } catch (notifErr) {
            logger.error("Failed to send post-transaction notifications:", notifErr);
        }

        // Invalidate Cache
        try { await invalidateAdminGlobalStats();
        } catch (err) { logger.error("Cache invalidation failed after dispute resolution", err);
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Update dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update dispute status", data: null };
    }
}
export const updateDisputeStatusAction = withFlexibleSafeAction("updateDisputeStatusAction", _updateDisputeStatusAction);
