/**
 * Server Actions for Dispute Resolution System
 */

"use server";

import { auth } from "@/lib/auth";
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
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
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

        // Create dispute
        const disputeData: Partial<Dispute> = {
            orderId,
            buyerId: userId,
            sellerId: order.sellerId,
            reason,
            description,
            evidenceUrls,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const disputeRef = await db.collection(COLLECTIONS.DISPUTES).add(disputeData);

        // Update order status
        await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
            status: "disputed",
            disputeId: disputeRef.id,
            updatedAt: new Date(),
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
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
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
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
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
}) {
    try {
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
        const userId = session.user.id;

        // Verify admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        let query = db.collection(COLLECTIONS.DISPUTES).orderBy("createdAt", "desc");

        if (filters?.status) {
            query = db.collection(COLLECTIONS.DISPUTES)
                .where("status", "==", filters.status)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await query.get();
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
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
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
            createdAt: (dispute.createdAt as any)?.toDate ? (dispute.createdAt as any).toDate() : dispute.createdAt,
            updatedAt: (dispute.updatedAt as any)?.toDate ? (dispute.updatedAt as any).toDate() : dispute.updatedAt,
            resolvedAt: (dispute.resolvedAt as any)?.toDate ? (dispute.resolvedAt as any).toDate() : dispute.resolvedAt,
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
        const session = await auth();
        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }
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

        // Update dispute
        const updateData: any = {
            status: "resolved",
            resolution,
            adminId: userId,
            adminNotes,
            resolvedAt: new Date(),
            updatedAt: new Date(),
        };

        if (refundAmount !== undefined) {
            updateData.refundAmount = refundAmount;
        }

        await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).update(updateData);

        // Update order status based on resolution
        const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(dispute.orderId).get();
        if (orderDoc.exists) {
            let newOrderStatus: string;

            if (resolution === "refund_buyer") {
                newOrderStatus = "cancelled";
            } else if (resolution === "release_seller") {
                newOrderStatus = "completed";
            } else {
                newOrderStatus = "completed"; // partial refund still completes order
            }

            await db.collection(COLLECTIONS.ORDERS).doc(dispute.orderId).update({
                status: newOrderStatus,
                updatedAt: new Date(),
            });
        }

        // In production, trigger escrow freeze/hold when dispute is created
        // This is already handled by escrow status change to \"disputed\" above
        // Additional actions: notify both parties, freeze fund release, assign to dispute handler
        // - refund_buyer: Refund full amount to buyer
        // - release_seller: Release full amount to seller
        // - partial_refund: Split based on refundAmount

        return { success: true };
    } catch (error: any) {
        logger.error("Update dispute error:", error);
        return { success: false, error: error.message };
    }
}
