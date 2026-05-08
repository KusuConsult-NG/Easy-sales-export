"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number {
    return Math.round(naira * 100);
}

export interface PaymentInitState {
    error: null, success: true | false;
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
    sellerId: string,
    buyerInfo: { fullName: string; email: string; phone: string; purpose: string; }
): Promise<PaymentInitState> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Validate amount
        if (amount < 10000) {
            return { error: "Minimum property purchase is ₦10,000", success: false };
        }

        // Check if property exists and is available
        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
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

        // Create pending purchase record in FARM_NATION_TRANSACTIONS
        const purchaseId = `${session.user.id}_${propertyId}_${Date.now()}`;
        await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchaseId).set({
            id: purchaseId,
            propertyId,
            propertyName: propertyTitle,
            propertyPrice: amount,
            propertyType: propertyData.type,
            buyerId: session.user.id,
            buyerName: buyerInfo.fullName,
            buyerEmail: buyerInfo.email,
            buyerPhone: buyerInfo.phone,
            purpose: buyerInfo.purpose,
            sellerId,
            sellerName: propertyData.ownerName,
            status: "pending_payment",
            escrowAmount: amount,
            escrowStatus: "pending",
            paymentReference: reference,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
        
        await propertyRef.update({
            status: "pending",
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            error: null, success: true as const,
            data: {
                authorizationUrl,
                reference,
            },
        };
    } catch (error: any) {
        logger.error("Property payment initialization error:", error);
        return {
            success: false as const,
            error: error.message || "Failed to initialize payment. Please try again.",
        };
    }
}

/**
 * Verify Property Purchase Payment
 * Updates ownership after successful payment
 */
export async function verifyPropertyPaymentAction(reference: string): Promise<{
    error: null, success: true | false;
    message?: string;
    propertyId?: string;
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return {
                success: false as const,
                error: "Too many payment verification attempts. Please try again later."
            };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
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
                success: false as const,
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

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        let amountInNaira = 0;

        await db.runTransaction(async (tx) => {
            const freshPropertyDoc = await tx.get(propertyRef);
            if (!freshPropertyDoc.exists) {
                throw new Error("Property not found");
            }

            const freshData = freshPropertyDoc.data()!;
            amountInNaira = paymentData.data.amount / 100;

            if (freshData.status !== "pending") {
                throw new Error(`Property is not in pending state (status: ${freshData.status}).`);
            }

            // Transfer ownership later, just lock it in escrow
            const updatedData = {
                status: "pending_escrow", // Wait for admin to release C of O
                escrowHeldAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            };
            tx.update(propertyRef, updatedData);

            // Mark payment as processed inside the transaction for full atomicity
            const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
            tx.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "farm_nation_escrow",
                reference,
            });

            // Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            tx.set(globalTxRef, {
                id: reference,
                userId: session.user.id,
                type: "property_purchase",
                module: "farm_nation",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Property Purchase - ${metadata.propertyTitle}`
            });

            // Update purchase record
            const purchaseQuery = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();

            if (!purchaseQuery.empty) {
                const purchaseRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchaseQuery.docs[0].id);
                tx.update(purchaseRef, {
                    status: "payment_confirmed",
                    escrowStatus: "held",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            return updatedData;
        });

        return {
            error: null, success: true as const,
            message: `Payment successful! Your funds are held securely in escrow for ${metadata.propertyTitle}.`,
            propertyId,
        };
    } catch (error: any) {
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyProperty',
            reference,
        });

        return {
            success: false as const,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
        };
    }
}
