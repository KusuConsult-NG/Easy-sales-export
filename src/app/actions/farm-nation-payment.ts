/**
 * Farm Nation Payment Integration
 * Handles Paystack payments for land purchases
 */
"use server";

import { auth } from "@/lib/auth";
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

/**
 * Initialize Paystack Payment for Property Purchase
 * Creates a payment session and returns authorization URL
 */
export async function initializePropertyPaymentAction(
    propertyId: string,
    propertyTitle: string,
    amount: number,
    sellerId: string
): Promise<PaymentInitState> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Validate amount
        if (amount < 10000) {
            return { error: "Minimum property purchase is ₦10,000", success: false };
        }

        // Check if property exists and is available
        const propertyRef = doc(db, "farmNationProperties", propertyId);
        const propertyDoc = await getDoc(propertyRef);

        if (!propertyDoc.exists()) {
            return { error: "Property not found", success: false };
        }

        const propertyData = propertyDoc.data();

        if (propertyData.status !== "available") {
            return { error: "Property is no longer available", success: false };
        }

        // Buyer cannot purchase their own property
        if (propertyData.ownerId === session.user.id) {
            return { error: "You cannot purchase your own property", success: false };
        }

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email!,
            nairaToKobo(amount),
            {
                userId: session.user.id,
                propertyId,
                propertyTitle,
                sellerId,
                type: "property_purchase",
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/farm-nation/payment/callback`,
            }
        );

        // Create pending purchase record
        const purchaseId = `${session.user.id}_${propertyId}_${Date.now()}`;
        await setDoc(doc(db, "propertyPurchases", purchaseId), {
            purchaseId,
            propertyId,
            propertyTitle,
            buyerId: session.user.id,
            buyerEmail: session.user.email,
            sellerId,
            amount,
            paymentReference: reference,
            status: "pending_payment",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });

        return {
            success: true,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        console.error("Property payment initialization error:", error);
        return {
            success: false,
            error: error.message || "Failed to initialize payment. Please try again.",
        };
    }
}

/**
 * Verify Property Purchase Payment
 * Updates ownership after successful payment
 */
export async function verifyPropertyPaymentAction(reference: string): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    propertyId?: string;
}> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = doc(db, "processedPayments", reference);
        const existingPayment = await getDoc(processedRef);

        if (existingPayment.exists()) {
            return {
                error: "Payment has already been processed",
                success: false
            };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status}: ${paymentData.data.gateway_response}`,
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as any;
        const propertyId = metadata.propertyId;
        const userId = metadata.userId;

        // Verify user match
        if (userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // Update property ownership
        const propertyRef = doc(db, "farmNationProperties", propertyId);
        const propertyDoc = await getDoc(propertyRef);

        if (!propertyDoc.exists()) {
            return { error: "Property not found", success: false };
        }

        const propertyData = propertyDoc.data();
        const amountInNaira = paymentData.data.amount / 100;

        // Transfer ownership
        await updateDoc(doc(db, "farmNationProperties", propertyId), {
            ownerId: session.user.id,
            ownerEmail: session.user.email,
            previousOwnerId: propertyData.ownerId,
            status: "sold",
            soldAt: serverTimestamp(),
            salePrice: amountInNaira,
            updatedAt: serverTimestamp(),
        });

        // Update purchase record
        const purchaseQuery = await getDocs(
            query(
                collection(db, "propertyPurchases"),
                where("paymentReference", "==", reference),
                limit(1)
            )
        );

        if (!purchaseQuery.empty) {
            const purchaseDoc = purchaseQuery.docs[0];
            await updateDoc(doc(db, "propertyPurchases", purchaseDoc.id), {
                status: "completed",
                paymentVerifiedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
        }

        return {
            success: true,
            message: `Property purchase successful! ${metadata.propertyTitle} is now yours.`,
            propertyId,
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        console.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyProperty',
            reference,
        });

        return {
            success: false,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
        };
    }
}
