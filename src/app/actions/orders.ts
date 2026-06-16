"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, Product } from "@/lib/types/marketplace";

import { getPlatformFees } from "@/lib/system-settings";
import { withOptimisticLock } from "@/lib/data-integrity";
import { withFlexibleSafeAction } from "@/lib/safe-action";

/**
 * Server Actions for Order Management
 */

export type CreateOrderState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

export interface OrderItem { productId: string;
    quantity: number;
    tierType: "retail" | "bulk" | "export"; }

/**
 * Create a new order
 */
/**
 * Create a new order with atomic inventory checking
 */
async function _createOrderAction(
    items: OrderItem[],
    deliveryAddress: { street: string;
        city: string;
        state: string;
        lga: string;
        phone: string;
    }
): Promise<CreateOrderState> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const fees = await getPlatformFees();
        
        return await db.runTransaction(async (transaction) => { const productRefs = items.map(item => db.collection(COLLECTIONS.PRODUCTS).doc(item.productId));
            const productDocs = await Promise.all(productRefs.map(ref => transaction.get(ref)));

            const sellerOrders = new Map<string, { items: { productId: string; productTitle: string; quantity: number; unitPrice: number; totalPrice: number; tier: string }[], subtotal: number }>();

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const productDoc = productDocs[i];

                if (!productDoc.exists) {
                    throw new Error(`Product ${item.productId} not found`);
                }

                const product = productDoc.data() as Product;

                if (product.availableQuantity < item.quantity) {
                    throw new Error(`OUT OF STOCK: "${product.title}" has only ${product.availableQuantity} units remaining.`);
                }

                const tier = product.pricingTiers.find(t => t.type === item.tierType);
                if (!tier) {
                    throw new Error(`Pricing tier ${item.tierType} not found for product ${product.title}`);
                }

                const totalPrice = tier.price * item.quantity;
                const sellerId = product.sellerId;

                if (!sellerOrders.has(sellerId)) { sellerOrders.set(sellerId, { items: [], subtotal: 0 });
                }
                const so = sellerOrders.get(sellerId)!;
                so.subtotal += totalPrice;

                transaction.update(productRefs[i], { availableQuantity: product.availableQuantity - item.quantity,
                    _version: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp() });

                so.items.push({ productId: item.productId,
                    productTitle: product.title,
                    quantity: item.quantity,
                    unitPrice: tier.price,
                    totalPrice: totalPrice,
                    tier: item.tierType });
            }

            const orderIds: string[] = [];
            const deliveryFeePerSeller = fees.baseDeliveryFee;

            for (const [sellerId, data] of sellerOrders.entries()) {
                const total = data.subtotal + deliveryFeePerSeller;
                
                const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc();
                const orderId = orderRef.id;
                orderIds.push(orderId);

                const orderData: Order = {
                    id: orderId,
                    orderNumber: `ORD-${Date.now()}-${sellerId.slice(0,4)}`,
                    buyerId: userId,
                    sellerId,
                    productIds: data.items.map(i => i.productId),
                    items: data.items as any,
                    deliveryAddress: { recipientName: session.user.name || "",
                        recipientPhone: deliveryAddress.phone,
                        street: deliveryAddress.street,
                        city: deliveryAddress.city,
                        state: deliveryAddress.state,
                        lga: deliveryAddress.lga },
                    subtotal: data.subtotal,
                    deliveryFee: deliveryFeePerSeller,
                    serviceFee: 0,
                    totalAmount: total,
                    status: "pending_payment",
                    buyerConfirmed: false,
                    _version: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp() };

                transaction.set(orderRef, orderData);
            }

            return { error: null, success: true as const, data: null };
        });

    } catch (error) { logger.error("Create order error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create order", data: null };
    }
}
export const createOrderAction = withFlexibleSafeAction("createOrderAction", _createOrderAction);

/**
 * Get order by ID
 */
async function _getOrderByIdAction(orderId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();

        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const orderData = orderDoc.data();

        if (orderData?.buyerId !== session.user.id) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .get();

        const { serializeDoc } = await import("@/lib/firestore-serialize");
        const order = serializeDoc(orderDoc.id, orderDoc.data()) as unknown as any;

        if (!escrowQuery.empty) {
            order.escrowTransactionId = escrowQuery.docs[0].id;
            order.escrowReleased = escrowQuery.docs.every(doc => doc.data().status === "released");
        } else {
            order.escrowTransactionId = null;
            order.escrowReleased = false;
        }

        return { success: true as const, error: null, data: { order } };
    } catch (error) { logger.error("Get order error:", {
            userId: sessionResult?.session?.user?.id,
            orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Fetch failed", data: null };
    }
}
export const getOrderByIdAction = withFlexibleSafeAction("getOrderByIdAction", _getOrderByIdAction);

