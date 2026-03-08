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

/**
 * Create a new dispute for an order
 */
export async function createDisputeAction(params: {
    orderId: string;
    reason: DisputeReason;
    description: string;
    evidenceUrls?: string[];
}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        const { orderId, reason, description, evidenceUrls = [] } = params;

        // Validate description length
        if (description.length < 50) {
            return { success: false, error: "Description must be at least 50 characters" };
        }

        // Get order and verify ownership
        const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();
        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;
        if (order.buyerId !== userId) {
            return { success: false, error: "Not authorized" };
        }

        // Check order is eligible for dispute
        if (order.status === "completed" || order.status === "cancelled") {
            return { success: false, error: "Cannot dispute completed or cancelled orders" };
        }

        if (order.status === "pending_payment") {
            return { success: false, error: "Cannot dispute an unpaid order" };
        }

        if (order.status === "disputed") {
            return { success: false, error: "Order already has an active dispute" };
        }

        // Check if dispute already exists for this order
        const existingDisputes = await db.collection(COLLECTIONS.DISPUTES)
            .where("orderId", "==", orderId)
            .where("status", "in", ["open", "under_review"])
            .get();

        if (!existingDisputes.empty) {
            return { success: false, error: "Active dispute already exists for this order" };
        }

        // Atomically create dispute AND update order status in a single transaction.
        // Previously two separate writes could leave the order in 'disputed' status
        // with no corresponding dispute document if the second write failed.
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(); // pre-allocate ID
        const orderRef = db.collection(COLLECTIONS.ORDERS).doc(orderId);

        await db.runTransaction(async (tx) => {
            // Re-read order inside transaction to prevent TOCTOU
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
                createdAt: FieldValue.serverTimestamp() as any,
                updatedAt: FieldValue.serverTimestamp() as any,
            };

            tx.set(disputeRef, disputeData);
            tx.update(orderRef, {
                status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return { success: true, disputeId: disputeRef.id };
    } catch (error: any) {
        logger.error("Create dispute error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get buyer's disputes
 */
export async function getBuyerDisputesAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
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

        return { success: true, disputes };
    } catch (error: any) {
        logger.error("Get buyer disputes error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get seller's disputes
 */
export async function getSellerDisputesAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
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

        return { success: true, disputes };
    } catch (error: any) {
        logger.error("Get seller disputes error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get all disputes (Admin only)
 */
export async function getAdminDisputesAction(filters?: {
    status?: "open" | "under_review" | "resolved" | "closed";
    escalated?: boolean;
}) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        let queryRef: FirebaseFirestore.Query = db.collection(COLLECTIONS.DISPUTES).orderBy("createdAt", "desc");

        if (filters?.status) {
            queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("status", "==", filters.status)
                .orderBy("createdAt", "desc");
        }

        if (filters?.escalated !== undefined) {
            queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("escalated", "==", filters.escalated)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await queryRef.get();
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

        return { success: true, disputes };
    } catch (error: any) {
        logger.error("Get admin disputes error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get single dispute by ID
 */
export async function getDisputeByIdAction(disputeId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) {
            return { success: false, error: "Dispute not found" };
        }

        const dispute = disputeDoc.data() as Dispute;

        // Check authorization
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        const isAdmin = hasRole(userData?.roles || [], "admin");
        const isBuyer = dispute.buyerId === userId;
        const isSeller = dispute.sellerId === userId;

        if (!isAdmin && !isBuyer && !isSeller) {
            return { success: false, error: "Not authorized to view this dispute" };
        }

        const disputeData: Dispute = {
            ...dispute,
            id: disputeDoc.id,
            createdAt: (dispute.createdAt as unknown as Timestamp)?.toDate ? (dispute.createdAt as unknown as Timestamp).toDate() : dispute.createdAt,
            updatedAt: (dispute.updatedAt as unknown as Timestamp)?.toDate ? (dispute.updatedAt as unknown as Timestamp).toDate() : dispute.updatedAt,
            resolvedAt: (dispute.resolvedAt as unknown as Timestamp)?.toDate ? (dispute.resolvedAt as unknown as Timestamp).toDate() : dispute.resolvedAt,
        } as Dispute;

        return { success: true, dispute: disputeData };
    } catch (error: any) {
        logger.error("Get dispute error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update dispute status and resolve (Admin only)
 */
export async function updateDisputeStatusAction(
    disputeId: string,
    resolution: DisputeResolution,
    adminNotes: string,
    refundAmount?: number
) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        // Get dispute
        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) {
            return { success: false, error: "Dispute not found" };
        }

        const dispute = disputeDoc.data() as Dispute;

        if (dispute.status === "resolved" || dispute.status === "closed") {
            return { success: false, error: `Dispute is already '${dispute.status}'` };
        }

        // Atomically update dispute + order in a single transaction.
        // Previously two separate writes could leave the dispute as 'resolved'
        // while the order remained stuck in 'disputed' status.
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
            };

            if (refundAmount !== undefined) {
                updateData.refundAmount = refundAmount;
            }

            tx.update(disputeRef, updateData);

            // Update linked order status
            if (freshDispute.orderId) {
                const orderRef = db.collection(COLLECTIONS.ORDERS).doc(freshDispute.orderId);
                let newOrderStatus: string;

                if (resolution === "refund_buyer") {
                    newOrderStatus = "cancelled";
                } else if (resolution === "release_seller") {
                    newOrderStatus = "completed";
                } else {
                    newOrderStatus = "completed"; // partial_refund still closes the order
                }

                tx.update(orderRef, {
                    status: newOrderStatus,
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update dispute error:", error);
        return { success: false, error: error.message };
    }
}
