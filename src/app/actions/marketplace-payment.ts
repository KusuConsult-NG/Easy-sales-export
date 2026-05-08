"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getPlatformFees } from "@/lib/system-settings";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { notifyOrderPlaced,
    notifyPaymentReceived } from "@/lib/marketplace-notifications";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import type { CartItem } from "@/lib/types/marketplace";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

interface ValidatedItem { productId: string;
    productTitle: string;
    sellerId: string;
    quantity: number;
    unit: string;
    pricePerUnit: number;
    totalPrice: number; }

/**
 * Validate Cart Items against Database Prices
 * Returns the calculated subtotal and validated items list
 */
async function validateCartItems(clientItems: CartItem[]): Promise<{ subtotal: number; validatedItems: ValidatedItem[] }> {
    let subtotal = 0;
    const validatedItems = [];

    for (const item of clientItems) {
        const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(item.id).get();

        if (!productDoc.exists) {
            throw new Error(`Product not found: ${item.title}`);
        }

        const productData = productDoc.data();
        const dbPrice = productData?.price || 0;

        // Force DB price for security
        const effectivePrice = dbPrice;
        const itemTotal = effectivePrice * item.quantity;

        subtotal += itemTotal;
        validatedItems.push({ productId: item.id,
            productTitle: productData?.title || item.title,
            sellerId: productData?.sellerId || item.sellerId, // Trust DB sellerId
            quantity: item.quantity,
            unit: item.unit,
            pricePerUnit: effectivePrice,
            totalPrice: itemTotal });
    }

    return { subtotal, validatedItems };
}

// Helper to calculate delivery fee server-side
function calculateDeliveryFee(items: CartItem[], _location: any, fees: any): number { const baseFee = fees.baseDeliveryFee || 1500;
    const additionalItemFee = fees.additionalItemFee || 200;
    return baseFee + (Math.max(0, items.length - 1) * additionalItemFee); }

/**
 * Initialize Paystack Payment for Marketplace Order
 * Creates a payment session and returns authorization URL
 */
async function _initializeOrderPaymentAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error};
        const { session } = sessionResult;

        const userId = session.user.id;

        if (deliveryFee < 0) { return { error: "Invalid delivery fee", success: false as const, data: null };
        }

        const { subtotal, validatedItems } = await validateCartItems(cartItems);

        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, {}, fees);
        const totalAmount = subtotal + calculatedDeliveryFee;

        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false as const };
        }

        const { authorizationUrl, reference } = await initializePaystackPayment(
            buyerEmail,
            nairaToKobo(totalAmount),
            {
                userId,
                buyerEmail,
                buyerPhone,
                itemCount: cartItems.length,
                subtotal,
                deliveryFee: calculatedDeliveryFee,
                totalAmount,
                type: "marketplace_order",
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/marketplace/payment/callback` }
        );

        const sellerIds = Array.from(new Set(validatedItems.map(item => item.sellerId)));

        const orderId = `ORD-${Date.now()}-${userId.substring(0, 8)}`;
        await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).set({ sellerIds,
            orderId,
            buyerId: userId,
            buyerEmail,
            buyerPhone,
            items: validatedItems,
            productIds: validatedItems.map(i => i.productId),
            subtotal,
            deliveryFee: calculatedDeliveryFee,
            totalAmount,
            paymentReference: reference,
            paymentStatus: "pending",
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 });

        const primarySellerId = validatedItems[0]?.sellerId;
        if (primarySellerId) { notifyOrderPlaced({
                buyerId: userId,
                sellerId: primarySellerId,
                orderId,
                orderNumber: orderId,
                amount: totalAmount }).catch((e) => logger.error("[initializeOrderPaymentAction] Notification failed:", { userId, error: e }));
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Order payment initialization error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
            cartCount: cartItems.length
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to initialize payment. Please try again."};
    }
}
export const initializeOrderPaymentAction = withFlexibleSafeAction("initializeOrderPaymentAction", _initializeOrderPaymentAction);

/**
 * Verify Marketplace Order Payment
 * Updates order status after successful payment
 */
async function _verifyOrderPaymentAction(reference: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error};
        const { session } = sessionResult;

        const userId = session.user.id;

        const rateLimitResult = await paymentLimiter.check(userId);
        if (!rateLimitResult.success) { return { success: false as const, error: "Too many payment verification attempts. Please try again later."};
        }

        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        if (existingPayment.exists) { return { error: "Payment has already been processed", success: false as const, data: null };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status}. Please contact support if amount was debited.`,
                success: false as const };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const paystackUserId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;
        const expectedAmount = metadata.totalAmount;

        // Verify user match
        if (paystackUserId !== userId) { return { error: "Payment verification failed: User mismatch", success: false as const, data: null };
        }

        const fees = await getPlatformFees();
        if (amountInNaira < fees.minOrderAmount || amountInNaira > fees.maxOrderAmount) { return { error: "Invalid payment amount", success: false as const, data: null };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) { return { error: "Payment amount mismatch", success: false as const, data: null };
        }

        // Find order record
        const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (orderQuery.empty) { return { error: "Order record not found", success: false as const, data: null };
        }

        const orderDoc = orderQuery.docs[0];
        const orderData = orderDoc.data();

        await db.runTransaction(async (transaction) => { // 1. Update order status -> escrow_held
            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);
            transaction.update(orderRef, {
                paymentStatus: "escrow_held",
                status: "processing",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                paidAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });

            // 2. Mark payment as processed
            transaction.set(processedRef, { processedAt: FieldValue.serverTimestamp(),
                userId: userId,
                amount: amountInNaira,
                type: "marketplace_order",
                reference });

            const items = orderData.items || [];

            // 3. Decrement Inventory
            for (const item of items) { const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                const productDoc = await transaction.get(productRef);

                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty >= item.quantity) {
                        transaction.update(productRef, {
                            availableQuantity: FieldValue.increment(-item.quantity),
                            orders: FieldValue.increment(1),
                            _version: FieldValue.increment(1) });
                    } else {
                        throw new Error(`Insufficient stock for product: ${item.productTitle}`);
                    }
                }
            }

            // 4. Calculate Financial Split
            const sellerTotals: Record<string, number> = {};
            const uniqueSellers = Array.from(new Set(items.map((i: any) => i.sellerId))) as string[];
            const deliveryFeePerSeller = orderData.deliveryFee / uniqueSellers.length;

            items.forEach((item: any) => { const sellerId = item.sellerId;
                const itemTotal = item.pricePerUnit * item.quantity;
                sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + itemTotal;
            });

            uniqueSellers.forEach(sellerId => { sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller;
            });

            // Create Escrow Record for each seller
            for (const [sellerId, grossAmount] of Object.entries(sellerTotals)) {
                const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
                const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

                const platformFee = Math.round(grossAmount * fees.platformFeePercentage);
                const netAmount = grossAmount - platformFee;

                transaction.set(escrowRef, { id: escrowId,
                    orderId: orderData.orderId,
                    buyerId: userId,
                    sellerId: sellerId,
                    grossAmount: grossAmount,
                    platformFee: platformFee,
                    netAmount: netAmount,
                    status: "funded",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: 0 });
            }

            // 5. Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            transaction.set(globalTxRef, {
                id: reference,
                userId: userId,
                type: "marketplace_order",
                module: "marketplace",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Order #${orderData.orderId} - ${items.length} items`
            });
        });

        revalidatePath("/dashboard");
        revalidatePath("/marketplace/buyer/orders");

        const uniqueSellerIds = Array.from(new Set(orderData.items?.map((i: any) => i.sellerId) || [])) as string[];
        const notifPromises = uniqueSellerIds.map(sellerId => 
            notifyPaymentReceived({ buyerId: userId,
                sellerId: sellerId,
                orderId: orderData.orderId,
                orderNumber: orderData.orderId,
                amount: amountInNaira,
                paymentMethod: "escrow" })
        );
        
        Promise.allSettled(notifPromises).catch((e) => logger.error("[verifyOrderPaymentAction] Notification failed:", { userId, error: e }));

        return {
            error: null,
            success: true as const,
            data: { orderId: orderData.orderId }
        };
    } catch (error) { logger.error('[Payment Verification Error]', {
            userId: sessionResult?.session?.user?.id,
            action: 'verifyOrder',
            reference,
            error: error instanceof Error ? error.message : String(error)
        });

        return { success: false as const, error: "Failed to verify payment: " + (error instanceof Error ? error.message : "Unknown error")};
    }
}
export const verifyOrderPaymentAction = withFlexibleSafeAction("verifyOrderPaymentAction", _verifyOrderPaymentAction);

/**
 * Create Marketplace Order with Bank Transfer Payment
 */
async function _createBankTransferOrderAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error};
        const { session } = sessionResult;

        if (deliveryFee < 0) { return { error: "Invalid delivery fee", success: false as const, data: null };
        }

        const { subtotal, validatedItems } = await validateCartItems(cartItems);
        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, {}, fees);
        const totalAmount = subtotal + calculatedDeliveryFee;

        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false as const };
        }

        const sellerIds = Array.from(new Set(validatedItems.map(item => item.sellerId)));
        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        const orderReference = `BT-${Date.now()}`;

        await db.runTransaction(async (transaction) => {
            for (const item of validatedItems) {
                const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                const productDoc = await transaction.get(productRef);
                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty < item.quantity) {
                        throw new Error(`Insufficient stock for product ID: ${item.productId}`);
                    }
                } else {
                    throw new Error(`Product not found ID: ${item.productId}`);
                }
            }

            for (const item of validatedItems) { const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                transaction.update(productRef, {
                    availableQuantity: FieldValue.increment(-item.quantity),
                    orders: FieldValue.increment(1),
                    _version: FieldValue.increment(1) });
            }

            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
            transaction.set(orderRef, { sellerIds,
                orderId,
                buyerId: session.user.id,
                buyerEmail,
                buyerPhone,
                items: validatedItems,
                productIds: validatedItems.map(i => i.productId),
                subtotal,
                deliveryFee: calculatedDeliveryFee,
                totalAmount,
                paymentMethod: "bank_transfer",
                paymentReference: orderReference,
                paymentStatus: "pending_verification",
                status: "processing",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 });
        });

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Bank transfer order creation error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create order. Please try again."};
    }
}
export const createBankTransferOrderAction = withFlexibleSafeAction("createBankTransferOrderAction", _createBankTransferOrderAction);

/**
 * Calculate Delivery Fee (Server-Side)
 */
async function _calculateDeliveryAction(items: CartItem[], location?: any) { let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => ({ session: null }));
        const fees = await getPlatformFees();
        const fee = calculateDeliveryFee(items, location, fees);
        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Calculate delivery fee error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, data: { fee: 0 }, error: error.message };
    }
}
export const calculateDeliveryAction = withFlexibleSafeAction("calculateDeliveryAction", _calculateDeliveryAction);

/**
 * Create a marketplace order with Payment on Delivery.
 */
async function _createPaymentOnDeliveryOrderAction(
    cartItems: CartItem[],
    buyerPhone: string,
    deliveryAddress: { recipientName: string;
        recipientPhone: string;
        street: string;
        city: string;
        state: string;
        lga: string;
    }
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized"};
        const { session } = sessionResult;

        const { subtotal, validatedItems } = await validateCartItems(cartItems);
        const fees = await getPlatformFees();
        const deliveryFee = calculateDeliveryFee(cartItems, {}, fees);
        const totalAmount = subtotal + deliveryFee;

        if (totalAmount < fees.minOrderAmount) { return { success: false as const, error: `Minimum order amount is ₦${fees.minOrderAmount}` };
        }

        const sellerIds = Array.from(new Set(validatedItems.map((i) => i.sellerId))) as string[];
        for (const sid of sellerIds) { const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sid).get();
            if (!sellerDoc.data()?.allowsPaymentOnDelivery) {
                return { success: false as const, error: "One or more sellers in your cart do not offer Payment on Delivery"};
            }
        }

        const orderId = `POD-${Date.now()}-${session.user.id.substring(0, 8)}`;

        await db.runTransaction(async (transaction) => {
            for (const item of validatedItems) {
                const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                const productDoc = await transaction.get(productRef);
                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty < item.quantity) {
                        throw new Error(`Insufficient stock for product ID: ${item.productId}`);
                    }
                } else {
                    throw new Error(`Product not found ID: ${item.productId}`);
                }
            }

            for (const item of validatedItems) { const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                transaction.update(productRef, {
                    availableQuantity: FieldValue.increment(-item.quantity),
                    orders: FieldValue.increment(1),
                    _version: FieldValue.increment(1) });
            }

            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
            transaction.set(orderRef, { orderId,
                buyerId: session.user.id,
                buyerPhone,
                sellerIds,
                items: validatedItems,
                productIds: validatedItems.map((i) => i.productId),
                subtotal,
                deliveryFee,
                totalAmount,
                paymentMethod: "payment_on_delivery",
                paymentStatus: "pending",
                status: "processing",
                deliveryAddress,
                buyerConfirmed: false,
                reviewSubmitted: false,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 });
        });

        notifyOrderPlaced({ buyerId: session.user.id,
            sellerId: sellerIds[0],
            orderId,
            orderNumber: orderId,
            amount: totalAmount }).catch((e) => logger.error("[POD] Notification error:", e));

        revalidatePath("/marketplace/buyer/orders");
        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("createPaymentOnDeliveryOrderAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create POD order", data: null };
    }
}
export const createPaymentOnDeliveryOrderAction = withFlexibleSafeAction("createPaymentOnDeliveryOrderAction", _createPaymentOnDeliveryOrderAction);
