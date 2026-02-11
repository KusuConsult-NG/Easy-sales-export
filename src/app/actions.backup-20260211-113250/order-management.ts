/**
 * Server Actions for Order Management (Seller & Buyer)
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    updateDoc,
    doc,
    orderBy,
    getDoc,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";

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
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const userData = userDoc.data();

        if (!hasRole(userData?.roles || [], "seller")) {
            return { success: false, error: "Not authorized as seller" };
        }

        // Build query
        let q = query(
            collection(db, COLLECTIONS.ORDERS),
            where("sellerId", "==", userId),
            orderBy("createdAt", "desc")
        );

        if (filters?.status) {
            q = query(q, where("status", "==", filters.status));
        }

        const snapshot = await getDocs(q);
        const orders: Order[] = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
        })) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        console.error("Get seller orders error:", error);
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
        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));

        if (!orderDoc.exists()) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify seller owns this order
        if (order.sellerId !== userId) {
            return { success: false, error: "Not authorized to update this order" };
        }

        // Update order
        const updateData: any = {
            status: newStatus,
            updatedAt: new Date(),
        };

        if (trackingNumber) {
            updateData.trackingNumber = trackingNumber;
        }

        if (newStatus === "shipped") {
            updateData.estimatedDeliveryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
        }

        if (newStatus === "delivered") {
            updateData.deliveredAt = new Date();
        }

        await updateDoc(doc(db, COLLECTIONS.ORDERS, orderId), updateData);

        return { success: true };
    } catch (error: any) {
        console.error("Update order status error:", error);
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
        let q = query(
            collection(db, COLLECTIONS.ORDERS),
            where("buyerId", "==", userId),
            orderBy("createdAt", "desc")
        );

        if (filters?.status) {
            q = query(q, where("status", "==", filters.status));
        }

        const snapshot = await getDocs(q);
        const orders: Order[] = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id,
            createdAt: doc.data().createdAt?.toDate(),
            updatedAt: doc.data().updatedAt?.toDate(),
        })) as Order[];

        return { success: true, orders };
    } catch (error: any) {
        console.error("Get buyer orders error:", error);
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
        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));

        if (!orderDoc.exists()) {
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
        await updateDoc(doc(db, COLLECTIONS.ORDERS, orderId), {
            buyerConfirmed: true,
            buyerConfirmedAt: new Date(),
            status: "completed",
            updatedAt: new Date(),
        });

        // In production, trigger escrow release here

        return { success: true };
    } catch (error: any) {
        console.error("Confirm delivery error:", error);
        return { success: false, error: error.message };
    }
}
