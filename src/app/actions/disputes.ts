/**
 * Server Actions for Dispute Resolution System
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    getDoc,
    addDoc,
    updateDoc,
    doc,
    orderBy,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Dispute, Order, DisputeReason, DisputeResolution } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";

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
        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));
        if (!orderDoc.exists()) {
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
        const existingDisputeQuery = query(
            collection(db, COLLECTIONS.DISPUTES),
            where("orderId", "==", orderId),
            where("status", "in", ["open", "under_review"])
        );
        const existingDisputes = await getDocs(existingDisputeQuery);
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

        const disputeRef = await addDoc(collection(db, COLLECTIONS.DISPUTES), disputeData);

        // Update order status
        await updateDoc(doc(db, COLLECTIONS.ORDERS, orderId), {
            status: "disputed",
            disputeId: disputeRef.id,
            updatedAt: new Date(),
        });

        return { success: true, disputeId: disputeRef.id };
    } catch (error: any) {
        console.error("Create dispute error:", error);
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

        const q = query(
            collection(db, COLLECTIONS.DISPUTES),
            where("buyerId", "==", userId),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        const disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt instanceof Date ? data.createdAt : data.createdAt?.toDate(),
                updatedAt: data.updatedAt instanceof Date ? data.updatedAt : data.updatedAt?.toDate(),
                resolvedAt: data.resolvedAt instanceof Date ? data.resolvedAt : data.resolvedAt?.toDate(),
            };
        }) as Dispute[];

        return { success: true, disputes };
    } catch (error: any) {
        console.error("Get buyer disputes error:", error);
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

        const q = query(
            collection(db, COLLECTIONS.DISPUTES),
            where("sellerId", "==", userId),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);
        const disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt instanceof Date ? data.createdAt : data.createdAt?.toDate(),
                updatedAt: data.updatedAt instanceof Date ? data.updatedAt : data.updatedAt?.toDate(),
                resolvedAt: data.resolvedAt instanceof Date ? data.resolvedAt : data.resolvedAt?.toDate(),
            };
        }) as Dispute[];

        return { success: true, disputes };
    } catch (error: any) {
        console.error("Get seller disputes error:", error);
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
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        let q = query(
            collection(db, COLLECTIONS.DISPUTES),
            orderBy("createdAt", "desc")
        );

        if (filters?.status) {
            q = query(
                collection(db, COLLECTIONS.DISPUTES),
                where("status", "==", filters.status),
                orderBy("createdAt", "desc")
            );
        }

        const snapshot = await getDocs(q);
        const disputes: Dispute[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: data.createdAt instanceof Date ? data.createdAt : data.createdAt?.toDate(),
                updatedAt: data.updatedAt instanceof Date ? data.updatedAt : data.updatedAt?.toDate(),
                resolvedAt: data.resolvedAt instanceof Date ? data.resolvedAt : data.resolvedAt?.toDate(),
            };
        }) as Dispute[];

        return { success: true, disputes };
    } catch (error: any) {
        console.error("Get admin disputes error:", error);
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

        const disputeDoc = await getDoc(doc(db, COLLECTIONS.DISPUTES, disputeId));
        if (!disputeDoc.exists()) {
            return { success: false, error: "Dispute not found" };
        }

        const dispute = disputeDoc.data() as Dispute;

        // Check authorization
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
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
            createdAt: dispute.createdAt instanceof Date ? dispute.createdAt : (dispute.createdAt as any)?.toDate(),
            updatedAt: dispute.updatedAt instanceof Date ? dispute.updatedAt : (dispute.updatedAt as any)?.toDate(),
            resolvedAt: dispute.resolvedAt instanceof Date ? dispute.resolvedAt : (dispute.resolvedAt as any)?.toDate(),
        } as Dispute;

        return { success: true, dispute: disputeData };
    } catch (error: any) {
        console.error("Get dispute error:", error);
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
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const userData = userDoc.data();
        if (!hasRole(userData?.roles || [], "admin")) {
            return { success: false, error: "Not authorized as admin" };
        }

        // Get dispute
        const disputeDoc = await getDoc(doc(db, COLLECTIONS.DISPUTES, disputeId));
        if (!disputeDoc.exists()) {
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

        await updateDoc(doc(db, COLLECTIONS.DISPUTES, disputeId), updateData);

        // Update order status based on resolution
        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, dispute.orderId));
        if (orderDoc.exists()) {
            let newOrderStatus: string;

            if (resolution === "refund_buyer") {
                newOrderStatus = "cancelled";
            } else if (resolution === "release_seller") {
                newOrderStatus = "completed";
            } else {
                newOrderStatus = "completed"; // partial refund still completes order
            }

            await updateDoc(doc(db, COLLECTIONS.ORDERS, dispute.orderId), {
                status: newOrderStatus,
                updatedAt: new Date(),
            });
        }

        // TODO: In production, trigger escrow actions here
        // - refund_buyer: Refund full amount to buyer
        // - release_seller: Release full amount to seller
        // - partial_refund: Split based on refundAmount

        return { success: true };
    } catch (error: any) {
        console.error("Update dispute error:", error);
        return { success: false, error: error.message };
    }
}
