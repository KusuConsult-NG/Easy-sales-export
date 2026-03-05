"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Validate amount
        if (amount < 10000) {
            return { error: "Minimum property purchase is ₦10,000", success: false };
        }

        // Check if property exists and is available
        const propertyRef = db.collection("farmNationProperties").doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { error: "Property not found", success: false };
        }

        const propertyData = propertyDoc.data()!;

        if (propertyData.status !== "available") {
            return { error: "Property is no longer available", success: false };
        }

        // Buyer cannot purchase their own property
        if (propertyData.ownerId === session.user.id) {
            return { error: "You cannot purchase your own property", success: false };
        }

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
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
        await db.collection("propertyPurchases").doc(purchaseId).set({
            purchaseId,
            propertyId,
            propertyTitle,
            buyerId: session.user.id,
            buyerEmail: session.user.email,
            sellerId,
            amount,
            paymentReference: reference,
            status: "pending_payment",
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
        logger.error("Property payment initialization error:", error);
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return sessionResult.error;
        const { session } = sessionResult;

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
                error: `Payment ${paymentData.data.status}: ${paymentData.data.gateway_response}`,
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const propertyId = metadata.propertyId;
        const userId = metadata.userId;

        // Verify user match
        if (userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // RACE CONDITION FIX: Wrap ownership transfer in a Firestore transaction.
        // Without this, two simultaneous buyers could both pass the processedPayments
        // check (both arrive before either writes it), and both call propertyRef.update()
        // with status="sold". Last write wins, causing a double-sale.
        const propertyRef = db.collection("farmNationProperties").doc(propertyId);
        let amountInNaira = 0;

        await db.runTransaction(async (tx) => {
            // Re-read property *inside* the transaction for strong consistency
            const freshPropertyDoc = await tx.get(propertyRef);
            if (!freshPropertyDoc.exists) {
                throw new Error("Property not found");
            }

            const freshData = freshPropertyDoc.data()!;
            amountInNaira = paymentData.data.amount / 100;

            // Re-check status inside the transaction — this is the critical gate.
            // Firestore transactions are serialised: only one will see status="available".
            if (freshData.status !== "available") {
                throw new Error(`Property is no longer available (status: ${freshData.status}). It may have just been purchased.`);
            }

            // Transfer ownership atomically
            const updatedData = {
                ownerId: session.user.id,
                ownerEmail: session.user.email,
                previousOwnerId: freshData.ownerId,
                status: "sold",
                soldAt: FieldValue.serverTimestamp(),
                salePrice: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
            };
            tx.update(propertyRef, updatedData);

            // Mark payment as processed inside the transaction for full atomicity
            const processedRef = db.collection("processedPayments").doc(reference);
            tx.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "property_purchase",
                reference,
            });

            // Update purchase record if it exists
            const purchaseQuery = await db.collection("propertyPurchases")
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();

            if (!purchaseQuery.empty) {
                const purchaseRef = db.collection("propertyPurchases").doc(purchaseQuery.docs[0].id);
                tx.update(purchaseRef, {
                    status: "completed",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            return updatedData;
        });

        return {
            success: true,
            message: `Property purchase successful! ${metadata.propertyTitle} is now yours.`,
            propertyId,
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
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
