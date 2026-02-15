"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

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

        // Calculate total
        const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
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

        // Create pending order record
        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        await db.collection("marketplaceOrders").doc(orderId).set({
            orderId,
            buyerId: session.user.id,
            buyerEmail,
            buyerPhone,
            items: cartItems.map(item => ({
                productId: item.id,
                productTitle: item.title,
                sellerId: item.sellerId,
                quantity: item.quantity,
                unit: item.unit,
                pricePerUnit: item.price,
                totalPrice: item.price * item.quantity,
            })),
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
            // Update order status
            const orderRef = db.collection("marketplaceOrders").doc(orderDoc.id);
            transaction.update(orderRef, {
                paymentStatus: "paid",
                orderStatus: "processing",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                paidAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "marketplace_order",
                reference,
            });
        });

        return {
            success: true,
            message: `Order successful! Your order #${orderData.orderId} is now being processed.`,
            orderId: orderData.orderId,
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyOrder',
            reference,
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

        const subtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
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
            items: cartItems.map(item => ({
                productId: item.id,
                productTitle: item.title,
                sellerId: item.sellerId,
                quantity: item.quantity,
                unit: item.unit,
                pricePerUnit: item.price,
                totalPrice: item.price * item.quantity,
            })),
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
