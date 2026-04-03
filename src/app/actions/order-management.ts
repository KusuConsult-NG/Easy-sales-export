"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { paystackPayout } from "@/lib/paystack-transfer";

/**
 * Get all orders for a seller
 */
export async function getSellerOrdersAction(filters?: {
    status?: OrderStatus;
}) {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

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
        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Get order
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
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

        // 🔒 RESTORE INVENTORY IF CANCELLED
        if (newStatus === "cancelled" && order.status !== "cancelled") {
            await db.runTransaction(async (transaction) => {
                // Ensure order hasn't changed flag in the meantime
                const currentOrder = await transaction.get(orderRef);
                if (!currentOrder.exists || currentOrder.data()?.status === "cancelled") {
                    return; // Already cancelled or deleted
                }

                const items = order.items || [];
                
                // Read all product docs first to avoid write-before-read lock issues
                const productRefs = items.map(item => db.collection(COLLECTIONS.PRODUCTS).doc(item.productId));
                await Promise.all(productRefs.map(ref => transaction.get(ref)));

                // Restore quantities
                for (const item of items) {
                    const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                    transaction.update(productRef, {
                        availableQuantity: FieldValue.increment(item.quantity),
                        orders: FieldValue.increment(-1)
                    });
                }

                // Finally update order status
                transaction.update(orderRef, updateData);
            });
        } else {
            await orderRef.update(updateData);
        }

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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Build query
        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // Get order
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
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

        // ══════════════════════════════════════════
        // ESCROW RELEASE — Trigger Paystack Transfer
        // ══════════════════════════════════════════
        try {
            // Get seller's bank details from Firestore
            const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(order.sellerId).get();
            const sellerData = sellerDoc.data();

            if (sellerData?.bankAccountNumber && sellerData?.bankCode) {
                // Platform takes 2.5% commission; seller receives 97.5%
                const platformCommissionRate = 0.025;
                const sellerAmount = Math.floor(order.totalAmount * (1 - platformCommissionRate));

                const payoutResult = await paystackPayout(
                    {
                        accountNumber: sellerData.bankAccountNumber,
                        bankCode: sellerData.bankCode,
                        accountName: sellerData.bankAccountName || sellerData.name,
                    },
                    sellerAmount, // in Naira (paystackPayout converts to kobo internally)
                    `Escrow release for order ${orderId}`
                );

                if (payoutResult.success) {
                    await orderRef.update({
                        escrowReleased: true,
                        escrowReleasedAt: FieldValue.serverTimestamp(),
                        paystackTransferCode: payoutResult.transferCode,
                        sellerAmountPaid: sellerAmount,
                    });
                    logger.info(`Escrow released for order ${orderId}: ₦${sellerAmount} to ${order.sellerId}`);
                } else {
                    // Log failure and flag for manual processing
                    await orderRef.update({
                        escrowReleased: false,
                        escrowReleaseError: payoutResult.error,
                        escrowPendingManualRelease: true,
                    });
                    logger.error(`Escrow release FAILED for order ${orderId}: ${payoutResult.error}`);
                }
            } else {
                // Seller hasn't set up bank details — flag for manual release
                await orderRef.update({
                    escrowPendingManualRelease: true,
                    escrowReleaseNote: "Seller bank details not configured",
                });
                logger.warn(`Escrow release PENDING for order ${orderId}: seller ${order.sellerId} has no bank details`);
            }
        } catch (payoutError: any) {
            // Never block the order completion due to payout failure
            logger.error(`Escrow payout error for order ${orderId}:`, payoutError);
            await orderRef.update({ escrowPendingManualRelease: true });
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Confirm delivery error:", error);
        return { success: false, error: error.message };
    }
}

