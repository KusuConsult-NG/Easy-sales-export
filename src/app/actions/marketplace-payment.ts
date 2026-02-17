"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getPlatformFees } from "@/lib/system-settings";

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

export interface PaymentInitState {
    success: boolean;
    error?: string | null;
    data?: {
        authorizationUrl: string;
        reference: string;
    };
}

export interface CartItem {
    id: string;
    title: string;
    sellerId: string;
    price: number;
    quantity: number;
    unit: string;
}

/**
 * Validate Cart Items against Database Prices
 * Returns the calculated subtotal and validated items list
 */
async function validateCartItems(clientItems: CartItem[]): Promise<{ subtotal: number; validatedItems: any[] }> {
    let subtotal = 0;
    const validatedItems = [];

    for (const item of clientItems) {
        const productDoc = await db.collection(COLLECTIONS.PRODUCTS).doc(item.id).get();

        if (!productDoc.exists) {
            throw new Error(`Product not found: ${item.title}`);
        }

        const productData = productDoc.data();
        const dbPrice = productData?.price || 0;

        // Verify price match (allow minor floating point diffs if necessary, but exact match preferred for currency)
        // In a real scenario, we might just overwrite with DB price, but let's be strict for security
        if (Math.abs(dbPrice - item.price) > 0.1) {
            logger.warn(`Price mismatch for ${item.id}. Client: ${item.price}, DB: ${dbPrice}`);
            // We can either throw or perform "Silent Correction" - forcing the DB price
            // Let's force DB price for security
        }

        const effectivePrice = dbPrice;
        const itemTotal = effectivePrice * item.quantity;

        subtotal += itemTotal;
        validatedItems.push({
            productId: item.id,
            productTitle: productData?.title || item.title,
            sellerId: productData?.sellerId || item.sellerId, // Trust DB sellerId
            quantity: item.quantity,
            unit: item.unit,
            pricePerUnit: effectivePrice,
            totalPrice: itemTotal,
        });
    }

    return { subtotal, validatedItems };
}

/**
 * Initialize Paystack Payment for Marketplace Order
 * Creates a payment session and returns authorization URL
 */
export async function initializeOrderPaymentAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number
): Promise<PaymentInitState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // 🔒 SECURITY FIX: Validate Delivery Fee
        if (deliveryFee < 0) {
            return { error: "Invalid delivery fee", success: false };
        }

        // 🔒 SECURITY FIX: Server-side Price Validation
        const { subtotal, validatedItems } = await validateCartItems(cartItems);

        // 🔒 SECURITY FIX: Server-Side Fee Calculation (Ignore client fee)
        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, {}, fees); // Pass location if available
        const totalAmount = subtotal + calculatedDeliveryFee;

        // Validate amount
        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false };
        }

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            buyerEmail,
            nairaToKobo(totalAmount),
            {
                userId: session.user.id,
                buyerEmail,
                buyerPhone,
                itemCount: cartItems.length,
                subtotal,
                deliveryFee: calculatedDeliveryFee,
                totalAmount,
                type: "marketplace_order",
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/marketplace/payment/callback`,
            }
        );

        // Create pending order record with VALIDATED items
        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        await db.collection("marketplaceOrders").doc(orderId).set({
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: validatedItems, // Use validated items
            productIds: validatedItems.map(i => i.productId), // For querying
            subtotal,
            deliveryFee: calculatedDeliveryFee, // Use server calculated fee
            totalAmount,
            paymentReference: reference,
            paymentStatus: "pending",
            orderStatus: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        logger.error("Order payment initialization error:", error);
        return {
            success: false,
            error: error.message || "Failed to initialize payment. Please try again.",
        };
    }
}

/**
 * Verify Marketplace Order Payment
 * Updates order status after successful payment
 */
// Helper to calculate delivery fee server-side
function calculateDeliveryFee(items: any[], location: any, fees: any): number {
    // 🔒 SECURITY FIX: Server-Side Fee Calculation
    // For now, we assume a flat fees or based on item count as a placeholder for real logistics API.
    // In a real app, this would query a logistics provider (e.g., GIGL, Kwik).

    // Simple logic: Base fee + additional item fee
    const baseFee = fees.baseDeliveryFee;
    const additionalItemFee = fees.additionalItemFee;

    // Filter distinct sellers (split delivery?) - For now assume consolidated or per-order fee
    // Let's stick to a robust default standard for the MVP to prevent "0" fee exploits.

    return baseFee + (Math.max(0, items.length - 1) * additionalItemFee);
}

/**
 * Platform Fee Percentage (Dynamic)
 */
// Removed hardcoded PLATFORM_FEE_PERCENTAGE constant

/**
 * Verify Marketplace Order Payment
 * Updates order status after successful payment
 */
export async function verifyOrderPaymentAction(reference: string): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    orderId?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection("processedPayments").doc(reference);
        const existingPayment = await processedRef.get();

        if (existingPayment.exists) {
            return {
                error: "Payment has already been processed",
                success: false
            };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status}. Please contact support if amount was debited.`,
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as any;
        const userId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;
        const expectedAmount = metadata.totalAmount;

        // Verify user match
        if (userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        const fees = await getPlatformFees();
        if (amountInNaira < fees.minOrderAmount || amountInNaira > fees.maxOrderAmount) {
            return { error: "Invalid payment amount", success: false };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) {
            return { error: "Payment amount mismatch", success: false };
        }

        // Find order record
        const orderQuery = await db.collection("marketplaceOrders")
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (orderQuery.empty) {
            return { error: "Order record not found", success: false };
        }

        const orderDoc = orderQuery.docs[0];
        const orderData = orderDoc.data();

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        // This transaction now handles:
        // 1. Order Status Update
        // 2. Inventory Decrement (Prevent double-sell)
        // 3. Escrow Ledger Creation (Revenue Split)
        await db.runTransaction(async (transaction) => {
            // 1. Update order status -> escrow_held
            const orderRef = db.collection("marketplaceOrders").doc(orderDoc.id);
            transaction.update(orderRef, {
                paymentStatus: "escrow_held", // Funds are held, not yet paid to seller
                orderStatus: "processing",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                paidAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // 2. Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "marketplace_order",
                reference,
            });

            const items = orderData.items || [];

            // 3. Decrement Inventory (CRITICAL FIX)
            for (const item of items) {
                const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                const productDoc = await transaction.get(productRef);

                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty >= item.quantity) {
                        transaction.update(productRef, {
                            availableQuantity: FieldValue.increment(-item.quantity),
                            orders: FieldValue.increment(1)
                        });
                    } else {
                        throw new Error(`Insufficient stock for product: ${item.productTitle}`);
                    }
                }
            }

            // 4. Calculate Financial Split (CRITICAL FIX)
            // Goal: Split items to sellers, add delivery fee to seller(s), deduct platform fee.

            const sellerTotals: Record<string, number> = {};
            const sellerDeliveryShare: Record<string, number> = {}; // If we split delivery

            // Identify unique sellers
            const uniqueSellers = Array.from(new Set(items.map((i: any) => i.sellerId))) as string[];
            const deliveryFeePerSeller = orderData.deliveryFee / uniqueSellers.length; // Simply split delivery fee among sellers for now

            // Calculate total per seller
            items.forEach((item: any) => {
                const sellerId = item.sellerId;
                const itemTotal = item.pricePerUnit * item.quantity;

                if (!sellerTotals[sellerId]) sellerTotals[sellerId] = 0;
                sellerTotals[sellerId] += itemTotal;

                if (!sellerDeliveryShare[sellerId]) sellerDeliveryShare[sellerId] = 0;
            });

            // Add Delivery Share
            uniqueSellers.forEach(sellerId => {
                sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller;
            });

            // Create Escrow Record for each seller
            Object.entries(sellerTotals).forEach(([sellerId, grossAmount]) => {
                const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
                const escrowRef = db.collection("escrow_transactions").doc(escrowId);

                const platformFee = Math.round(grossAmount * fees.platformFeePercentage);
                const netAmount = grossAmount - platformFee;

                transaction.set(escrowRef, {
                    id: escrowId,
                    orderId: orderData.orderId,
                    buyerId: session.user.id,
                    sellerId: sellerId,
                    grossAmount: grossAmount,     // Total items + delivery
                    platformFee: platformFee,     // Dynamic Commission
                    netAmount: netAmount,         // What seller actually gets
                    status: "funded",             // Funds are secured
                    createdAt: FieldValue.serverTimestamp(),
                });
            });
        });

        return {
            success: true,
            message: `Payment secured in Escrow! Order #${orderData.orderId} is now processing.`,
            orderId: orderData.orderId,
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyOrder',
            reference,
            error: error.message
        });

        return {
            success: false,
            error: "Failed to verify payment: " + error.message, // Ensure user sees logical errors (like stock)
        };
    }
}

/**
 * Create Marketplace Order with Bank Transfer Payment
 * Creates a pending order that requires manual payment verification
 */
export async function createBankTransferOrderAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number
): Promise<{
    success: boolean;
    error?: string;
    orderId?: string;
    orderReference?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // 🔒 SECURITY FIX: Validate Delivery Fee
        if (deliveryFee < 0) {
            return { error: "Invalid delivery fee", success: false };
        }

        // 🔒 SECURITY FIX: Server-side Price Validation
        const { subtotal, validatedItems } = await validateCartItems(cartItems);

        // 🔒 SECURITY FIX: Server-Side Fee Calculation (Ignore client fee)
        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, {}, fees);
        const totalAmount = subtotal + calculatedDeliveryFee;

        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false };
        }

        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        const orderReference = `BT-${Date.now()}`;

        await db.collection("marketplaceOrders").doc(orderId).set({
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: validatedItems, // Use validated items
            productIds: validatedItems.map(i => i.productId), // For querying
            subtotal,
            deliveryFee: calculatedDeliveryFee, // Use server calculated fee
            totalAmount,
            paymentMethod: "bank_transfer",
            paymentReference: orderReference,
            paymentStatus: "pending_verification",
            orderStatus: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            orderId,
            orderReference,
        };
    } catch (error: any) {
        logger.error("Bank transfer order creation error:", error);
        return {
            success: false,
            error: error.message || "Failed to create order. Please try again.",
        };
    }
}

/**
 * Calculate Delivery Fee (Server-Side)
 * Exposed for UI to display accurate fees before payment
 */
export async function calculateDeliveryAction(items: CartItem[], location?: any): Promise<{ success: boolean; fee: number; error?: string }> {
    try {
        const fees = await getPlatformFees();
        const fee = calculateDeliveryFee(items, location, fees);
        return { success: true, fee };
    } catch (error: any) {
        return { success: false, fee: 0, error: error.message };
    }
}
