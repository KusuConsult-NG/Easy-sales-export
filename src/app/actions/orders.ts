/**
 * Server Actions for Order Management
 */

"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, Product } from "@/lib/types/marketplace";

export interface CreateOrderState {
    success: boolean;
    error?: string;
    orderId?: string;
    paymentUrl?: string;
}

export interface OrderItem {
    productId: string;
    quantity: number;
    tierType: "retail" | "bulk" | "export";
}

/**
 * Create a new order
 */
/**
 * Create a new order with atomic inventory checking
 */
export async function createOrderAction(
    items: OrderItem[],
    deliveryAddress: {
        street: string;
        city: string;
        state: string;
        lga: string;
        phone: string;
    }
): Promise<CreateOrderState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        // 🔒 TRANSACTION: Prevent Overselling
        return await db.runTransaction(async (transaction) => {
            // 1. Read all products first (Concurrency requirement)
            const productRefs = items.map(item => db.collection(COLLECTIONS.PRODUCTS).doc(item.productId));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            const orderItems: any[] = [];
            let subtotal = 0;
            let sellerId = "";

            // 2. Validate Inventory & Calculate Logic
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const productDoc = productDocs[i];

                if (!productDoc.exists) {
                    throw new Error(`Product ${item.productId} not found`);
                }

                const product = productDoc.data() as Product;

                // 2a. Check Inventory Strictness
                if (product.availableQuantity < item.quantity) {
                    throw new Error(`OUT OF STOCK: "${product.title}" has only ${product.availableQuantity} units remaining.`);
                }

                const tier = product.pricingTiers.find(t => t.type === item.tierType);
                if (!tier) {
                    throw new Error(`Pricing tier ${item.tierType} not found for product ${product.title}`);
                }

                const totalPrice = tier.price * item.quantity;
                subtotal += totalPrice;
                if (i === 0) sellerId = product.sellerId; // Simple single-seller assumption for now

                // 2b. Decrement Inventory in Transaction
                transaction.update(productRefs[i], {
                    availableQuantity: product.availableQuantity - item.quantity,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                orderItems.push({
                    productId: item.productId,
                    productTitle: product.title,
                    quantity: item.quantity,
                    unitPrice: tier.price,
                    totalPrice: totalPrice,
                    tier: item.tierType,
                });
            }

            const deliveryFee = 5000;
            const total = subtotal + deliveryFee;

            // 3. Create Order
            const orderRef = db.collection(COLLECTIONS.ORDERS).doc();
            const orderId = orderRef.id;

            const orderData: Partial<Order> = {
                id: orderId,
                orderNumber: `ORD-${Date.now()}`,
                buyerId: userId,
                sellerId,
                items: orderItems,
                deliveryAddress: {
                    recipientName: session.user.name || "",
                    recipientPhone: deliveryAddress.phone,
                    street: deliveryAddress.street,
                    city: deliveryAddress.city,
                    state: deliveryAddress.state,
                    lga: deliveryAddress.lga,
                },
                subtotal,
                deliveryFee,
                serviceFee: 0,
                totalAmount: total,
                status: "pending_payment",
                buyerConfirmed: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            transaction.set(orderRef, orderData);

            return {
                success: true,
                orderId,
            };
        });

    } catch (error: any) {
        logger.error("Create order error:", error);
        return {
            success: false,
            error: error.message || "Failed to create order",
        };
    }
}

/**
 * Get order by ID
 */
export async function getOrderByIdAction(orderId: string) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify user owns this order
        if (order.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        return { success: true, order };
    } catch (error: any) {
        logger.error("Get order error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update order payment status
 */
export async function updateOrderPaymentAction(
    orderId: string,
    paymentReference: string,
    paymentStatus: "success" | "failed"
) {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const orderDoc = await db.collection(COLLECTIONS.ORDERS).doc(orderId).get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        if (order.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.ORDERS).doc(orderId).update({
            paymentStatus: paymentStatus === "success" ? "paid" : "failed",
            paymentReference,
            status: paymentStatus === "success" ? "confirmed" : "cancelled",
            updatedAt: new Date(),
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Update payment error:", error);
        return { success: false, error: error.message };
    }
}
