"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, Product } from "@/lib/types/marketplace";

import { getPlatformFees } from "@/lib/system-settings";

/**
 * Server Actions for Order Management
 */

export interface CreateOrderState {
    success: boolean;
    error?: string;
    orderId?: string;
    orderIds?: string[];
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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const userId = session.user.id;

        const fees = await getPlatformFees();
        
        // 🔒 TRANSACTION: Prevent Overselling
        return await db.runTransaction(async (transaction) => {
            // 1. Read all products first (Concurrency requirement)
            const productRefs = items.map(item => db.collection(COLLECTIONS.PRODUCTS).doc(item.productId));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            const sellerOrders = new Map<string, { items: any[], subtotal: number }>();

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
                const sellerId = product.sellerId;

                if (!sellerOrders.has(sellerId)) {
                    sellerOrders.set(sellerId, { items: [], subtotal: 0 });
                }
                const so = sellerOrders.get(sellerId)!;
                so.subtotal += totalPrice;

                // 2b. Decrement Inventory in Transaction
                transaction.update(productRefs[i], {
                    availableQuantity: product.availableQuantity - item.quantity,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                so.items.push({
                    productId: item.productId,
                    productTitle: product.title,
                    quantity: item.quantity,
                    unitPrice: tier.price,
                    totalPrice: totalPrice,
                    tier: item.tierType,
                });
            }

            const orderIds: string[] = [];
            const deliveryFeePerSeller = fees.baseDeliveryFee; // Dynamic fee instead of hardcoded 5000

            for (const [sellerId, data] of sellerOrders.entries()) {
                const total = data.subtotal + deliveryFeePerSeller;
                
                // 3. Create Order
                const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc();
                const orderId = orderRef.id;
                orderIds.push(orderId);

                const orderData: Partial<Order> = {
                    id: orderId,
                    orderNumber: `ORD-${Date.now()}-${sellerId.slice(0,4)}`,
                    buyerId: userId,
                    sellerId,
                    items: data.items,
                    deliveryAddress: {
                        recipientName: session.user.name || "",
                        recipientPhone: deliveryAddress.phone,
                        street: deliveryAddress.street,
                        city: deliveryAddress.city,
                        state: deliveryAddress.state,
                        lga: deliveryAddress.lga,
                    },
                    subtotal: data.subtotal,
                    deliveryFee: deliveryFeePerSeller,
                    serviceFee: 0,
                    totalAmount: total,
                    status: "pending_payment",
                    buyerConfirmed: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };

                transaction.set(orderRef, orderData);
            }

            return { success: true, orderId: orderIds[0], orderIds };
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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();

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
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;

        if (!session?.user) {
            return { success: false, error: "Not authenticated" };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();

        if (!orderDoc.exists) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        if (order.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).update({
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
