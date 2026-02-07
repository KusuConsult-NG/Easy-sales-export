/**
 * Server Actions for Order Management
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDoc,
    serverTimestamp,
} from "firebase/firestore";
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

        // Fetch product details for all items
        const orderItems = await Promise.all(
            items.map(async (item) => {
                const productDoc = await getDoc(doc(db, COLLECTIONS.PRODUCTS, item.productId));

                if (!productDoc.exists()) {
                    throw new Error(`Product ${item.productId} not found`);
                }

                const product = productDoc.data() as Product;
                const tier = product.pricingTiers.find(t => t.type === item.tierType);

                if (!tier) {
                    throw new Error(`Pricing tier ${item.tierType} not found for product`);
                }

                return {
                    productId: item.productId,
                    productTitle: product.title,
                    quantity: item.quantity,
                    unitPrice: tier.price,
                    totalPrice: tier.price * item.quantity,
                    tier: item.tierType,
                };
            })
        );

        // Calculate totals
        const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
        const deliveryFee = 5000; // Flat delivery fee for now
        const total = subtotal + deliveryFee;

        // Get seller ID from first product (multi-vendor orders handled separately later)
        const firstProduct = await getDoc(doc(db, COLLECTIONS.PRODUCTS, items[0].productId));
        const sellerId = firstProduct.exists() ? (firstProduct.data() as Product).sellerId : "";

        // Create order document
        const orderData: Partial<Order> = {
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

        const orderRef = await addDoc(collection(db, COLLECTIONS.ORDERS), orderData);
        const orderId = orderRef.id;

        // Update order with ID
        await updateDoc(orderRef, { id: orderId });

        // In production, initialize Paystack payment here
        // For now, return success with orderId

        return {
            success: true,
            orderId,
            // paymentUrl: paystackUrl, // Would be returned from Paystack
        };
    } catch (error: any) {
        console.error("Create order error:", error);
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

        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));

        if (!orderDoc.exists()) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        // Verify user owns this order
        if (order.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        return { success: true, order };
    } catch (error: any) {
        console.error("Get order error:", error);
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

        const orderDoc = await getDoc(doc(db, COLLECTIONS.ORDERS, orderId));

        if (!orderDoc.exists()) {
            return { success: false, error: "Order not found" };
        }

        const order = orderDoc.data() as Order;

        if (order.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(doc(db, COLLECTIONS.ORDERS, orderId), {
            paymentStatus: paymentStatus === "success" ? "paid" : "failed",
            paymentReference,
            status: paymentStatus === "success" ? "confirmed" : "cancelled",
            updatedAt: new Date(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update payment error:", error);
        return { success: false, error: error.message };
    }
}
