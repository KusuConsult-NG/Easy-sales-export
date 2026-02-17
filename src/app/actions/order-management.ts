"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * Get all orders for a seller
 */
export async function getSellerOrdersAction(filters?: {
    status?: OrderStatus;
}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Verify user is a seller
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) {
            return { success: false, error: "Not authorized as seller" };
        }

        // Build query
        let query = db.collection(COLLECTIONS.ORDERS)
            .where("sellerId", "==", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) {
            query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders: Order[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        logger.error("Get seller orders error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update order status (seller only)
 */
export async function updateOrderStatusAction(
    orderId: string,
    newStatus: OrderStatus,
    trackingNumber?: string
) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Get order
        const orderRef = db.collection(COLLECTIONS.ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify seller owns this order
        if (order.sellerId !== userId) {
            return { success: false, error: "Not authorized to update this order" };
        }

        // 🔒 SECURITY FIX: Restrict Allowed Statuses for Sellers
        // Sellers cannot mark order as 'completed' (Buyer only) or 'disputed' (System)
        const allowedStatuses: OrderStatus[] = ["processing", "shipped", "delivered", "cancelled"];
        if (!allowedStatuses.includes(newStatus)) {
            return { success: false, error: `Sellers cannot set status to '${newStatus}'. Authorized statuses: ${allowedStatuses.join(", ")}` };
        }

        // 🔒 SECURITY FIX: Enforce Tracking Number for Shipments
        if (newStatus === "shipped" && !trackingNumber) {
            return { success: false, error: "Tracking number is required when marking order as shipped." };
        }

        // Update order
        const updateData: any = {
            status: newStatus,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (trackingNumber) {
            updateData.trackingNumber = trackingNumber;
        }

        if (newStatus === "shipped") {
            // Estimated delivery: 7 days from now
            const estimatedDate = new Date();
            estimatedDate.setDate(estimatedDate.getDate() + 7);
            updateData.estimatedDeliveryDate = estimatedDate;
        }

        if (newStatus === "delivered") {
            updateData.deliveredAt = FieldValue.serverTimestamp();
        }

        await orderRef.update(updateData);

        return { success: true };
    } catch (error: any) {
        logger.error("Update order status error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get all orders for a buyer
 */
export async function getBuyerOrdersAction(filters?: {
    status?: OrderStatus;
}) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Build query
        let query = db.collection(COLLECTIONS.ORDERS)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) {
            query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders: Order[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                id: doc.id,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        logger.error("Get buyer orders error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Confirm delivery (buyer only)
 */
export async function confirmDeliveryAction(orderId: string) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Get order
        const orderRef = db.collection(COLLECTIONS.ORDERS).doc(orderId);
        const orderDoc = await orderRef.get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify buyer owns this order
        if (order.buyerId !== userId) {
            return { success: false, error: "Not authorized" };
        }

        // Verify order is delivered
        if (order.status !== "delivered") {
            return { success: false, error: "Order must be delivered first" };
        }

        // Update order
        await orderRef.update({
            buyerConfirmed: true,
            buyerConfirmedAt: FieldValue.serverTimestamp(),
            status: "completed",
            updatedAt: FieldValue.serverTimestamp(),
        });

        // In production, trigger escrow release here

        return { success: true };
    } catch (error: any) {
        logger.error("Confirm delivery error:", error);
        return { success: false, error: error.message };
    }
}
