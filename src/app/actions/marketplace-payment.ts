"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";

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
        const totalAmount = subtotal + deliveryFee;

        // Validate amount
        if (totalAmount < 500) {
            return { error: "Minimum order amount is ₦500", success: false };
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
                deliveryFee,
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
            subtotal,
            deliveryFee,
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
        if (amountInNaira < 500 || amountInNaira > 10000000) {
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

            // 3. Create Escrow Transactions (Split by Seller)
            const items = orderData.items || [];
            const sellerTotals: Record<string, number> = {};

            // Calculate total per seller
            items.forEach((item: any) => {
                const sellerId = item.sellerId;
                const itemTotal = item.pricePerUnit * item.quantity;
                if (!sellerTotals[sellerId]) {
                    sellerTotals[sellerId] = 0;
                }
                sellerTotals[sellerId] += itemTotal;
            });

            // Create Escrow Record for each seller
            Object.entries(sellerTotals).forEach(([sellerId, totalAmount]) => {
                const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
                const escrowRef = db.collection("escrow_transactions").doc(escrowId);

                transaction.set(escrowRef, {
                    id: escrowId,
                    orderId: orderData.orderId,
                    buyerId: session.user.id,
                    sellerId: sellerId,
                    amount: totalAmount,
                    status: "funded", // Funds are secured
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
            error: "Failed to verify payment. Please contact support with your payment reference.",
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
        const totalAmount = subtotal + deliveryFee;

        if (totalAmount < 500) {
            return { error: "Minimum order amount is ₦500", success: false };
        }

        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        const orderReference = `BT-${Date.now()}`;

        await db.collection("marketplaceOrders").doc(orderId).set({
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: validatedItems, // Use validated items
            subtotal,
            deliveryFee,
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
