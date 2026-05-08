/**
 * Server Actions for Dispute Resolution System
 */

"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Dispute, Order, DisputeReason, DisputeResolution } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

/**
 * Create a new dispute for an order
 */
async function _createDisputeAction(params: {
    orderId: string;
    reason: DisputeReason;
    description: string;
    evidenceUrls?: string[];
}) {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { orderId, reason, description, evidenceUrls = [] } = params;

        if (description.length < 50) {
            return { success: false as const, error: "Description must be at least 50 characters" };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
        if (!orderDoc.exists) {
            return { success: false as const, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;
        if (order.buyerId !== userId) {
            return { success: false as const, error: "Not authorized" };
        }

        if (order.status === "completed" || order.status === "cancelled") {
            return { success: false as const, error: "Cannot dispute completed or cancelled orders" };
        }

        if (order.status === "pending_payment") {
            return { success: false as const, error: "Cannot dispute an unpaid order" };
        }

        if (order.status === "disputed") {
            return { success: false as const, error: "Order already has an active dispute" };
        }

        const existingDisputes = await db.collection(COLLECTIONS.DISPUTES)
            .where("orderId", "==", orderId)
            .where("status", "in", ["open", "under_review"])
            .get();

        if (!existingDisputes.empty) {
            return { success: false as const, error: "Active dispute already exists for this order" };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        await db.runTransaction(async (tx) => {
            const freshOrderDoc = await tx.get(orderRef);
            if (!freshOrderDoc.exists) throw new Error("Order not found");

            const freshOrder = freshOrderDoc.data() as Order;
            if (freshOrder.status === "disputed") {
                throw new Error("Order already has an active dispute");
            }
            if (freshOrder.status === "completed" || freshOrder.status === "cancelled") {
                throw new Error("Cannot dispute completed or cancelled orders");
            }

            const disputeData: Partial<Dispute> = {
                orderId,
                buyerId: userId,
                sellerId: freshOrder.sellerId,
                reason,
                description,
                evidenceUrls,
                status: "open",
                _version: 0,
                createdAt: FieldValue.serverTimestamp() as any,
                updatedAt: FieldValue.serverTimestamp() as any,
            };

            tx.set(disputeRef, disputeData);
            tx.update(orderRef, {
                status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            });
        });

        return { error: null, success: true as const, data: { disputeId: disputeRef.id } };
    } catch (error) {
        logger.error("Create dispute error:", {
            userId: sessionResult?.session?.user?.id,
            orderId: params.orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create dispute" };
    }
}
export const createDisputeAction = withFlexibleSafeAction("createDisputeAction", _createDisputeAction);

/**
 * Get buyer's disputes
 */
async function _getBuyerDisputesAction() {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                resolvedAt: (data.resolvedAt as Timestamp)?.toDate() || undefined,
            };
        }) as Dispute[];

        return { error: null, success: true as const, data: { disputes } };
    } catch (error) {
        logger.error("Get buyer disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes" };
    }
}
export const getBuyerDisputesAction = withFlexibleSafeAction("getBuyerDisputesAction", _getBuyerDisputesAction);

/**
 * Get seller's disputes
 */
async function _getSellerDisputesAction() {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("sellerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
                resolvedAt: (data.resolvedAt as Timestamp)?.toDate() || undefined,
            };
        }) as Dispute[];

        return { error: null, success: true as const, data: { disputes } };
    } catch (error) {
        logger.error("Get seller disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes" };
    }
}
export const getSellerDisputesAction = withFlexibleSafeAction("getSellerDisputesAction", _getSellerDisputesAction);

/**
 * Get all disputes (Admin only)
 */
async function _getAdminDisputesAction(options: {
    status?: "open" | "under_review" | "resolved" | "closed" | "all";
    escalated?: boolean;
    limit?: number;
    search?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc";
} = {}) {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false as const, error: "Not authorized as admin" };
        }

        const fetchLimit = options.search ? 2000 : (options.limit || 50);
        const sortDirection = options.sortOrder || "desc";
        let queryRef = db.collection(COLLECTIONS.DISPUTES).orderBy("createdAt", sortDirection);

        if (options.status && options.status !== "all") {
            queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("status", "==", options.status)
                .orderBy("createdAt", sortDirection);
        }

        if (options.escalated !== undefined) {
            queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("escalated", "==", options.escalated)
                .orderBy("createdAt", sortDirection);
        }

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.DISPUTES).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
        let disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                resolvedAt: data.resolvedAt ? (data.resolvedAt as Timestamp).toDate().toISOString() : null,
            };
        }) as any[];

        if (options.search) {
            const q = options.search.toLowerCase();
            disputes = disputes.filter(d => 
                d.id?.toLowerCase().includes(q) ||
                d.orderId?.toLowerCase().includes(q) ||
                d.reason?.toLowerCase().includes(q) ||
                d.description?.toLowerCase().includes(q)
            );
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            error: null, success: true as const, 
            data: {
                disputes,
                lastDocId: nextCursor,
                hasMore: !!nextCursor
            }
        };
    } catch (error) {
        logger.error("Get admin disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes for admin" };
    }
}
export const getAdminDisputesAction = withFlexibleSafeAction("getAdminDisputesAction", _getAdminDisputesAction);

/**
 * Get single dispute by ID
 */
async function _getDisputeByIdAction(disputeId: string) {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) {
            return { success: false as const, error: "Dispute not found" };
        }

        const dispute = disputeDoc.data() as Dispute;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        const isAdmin = hasRole(userData?.roles || [], "admin");
        const isBuyer = dispute.buyerId === userId;
        const isSeller = dispute.sellerId === userId;

        if (!isAdmin && !isBuyer && !isSeller) {
            return { success: false as const, error: "Not authorized to view this dispute" };
        }

        const disputeData: Dispute = {
            ...dispute,
            id: disputeDoc.id,
            createdAt: (dispute.createdAt as unknown as Timestamp)?.toDate ? (dispute.createdAt as unknown as Timestamp).toDate() : dispute.createdAt,
            updatedAt: (dispute.updatedAt as unknown as Timestamp)?.toDate ? (dispute.updatedAt as unknown as Timestamp).toDate() : dispute.updatedAt,
            resolvedAt: (dispute.resolvedAt as unknown as Timestamp)?.toDate ? (dispute.resolvedAt as unknown as Timestamp).toDate() : dispute.resolvedAt,
        } as Dispute;

        return { error: null, success: true as const, data: { dispute: disputeData } };
    } catch (error) {
        logger.error("Get dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch dispute details" };
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
) {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false as const, error: "Not authorized as admin" };
        }

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) {
            return { success: false as const, error: "Dispute not found" };
        }

        const dispute = disputeDoc.data() as Dispute;

        if (dispute.status === "resolved" || dispute.status === "closed") {
            return { success: false as const, error: `Dispute is already '${dispute.status}'` };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);

        await db.runTransaction(async (tx) => {
            const freshDisputeDoc = await tx.get(disputeRef);
            if (!freshDisputeDoc.exists) throw new Error("Dispute not found");

            const freshDispute = freshDisputeDoc.data() as Dispute;
            if (freshDispute.status === "resolved" || freshDispute.status === "closed") {
                throw new Error(`Dispute is already '${freshDispute.status}'`);
            }

            const updateData: Record<string, unknown> = {
                status: "resolved",
                resolution,
                adminId: userId,
                adminNotes,
                resolvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1),
            };

            if (refundAmount !== undefined) {
                updateData.refundAmount = refundAmount;
            }

            tx.update(disputeRef, updateData);

            if (freshDispute.orderId) {
                const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(freshDispute.orderId);
                let newOrderStatus: string;

                if (resolution === "refund_buyer") {
                    newOrderStatus = "cancelled";
                } else if (resolution === "release_seller") {
                    newOrderStatus = "completed";
                } else {
                    newOrderStatus = "completed";
                }

                tx.update(orderRef, {
                    status: newOrderStatus,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1),
                });
            }
        });

        // Invalidate Cache
        try {
            await invalidateAdminGlobalStats();
        } catch (err) {
            logger.error("Cache invalidation failed after dispute resolution", err);
        }

        return { error: null, success: true as const, data: { message: "Dispute status updated successfully" } };
    } catch (error) {
        logger.error("Update dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update dispute status" };
    }
}
export const updateDisputeStatusAction = withFlexibleSafeAction("updateDisputeStatusAction", _updateDisputeStatusAction);
