"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { rateLimit } from '@/lib/rate-limiter';
import { rateLimitConfig } from '@/lib/rate-limits.config';
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

/**
 * Initialize Paystack Payment for Property Purchase
 * Creates a payment session and returns authorization URL
 */
async function _initializePropertyPaymentAction(
    propertyId: string,
    propertyTitle: string,
    amount: number,
    sellerId: string,
    buyerInfo: { 
        fullName: string; 
        email: string; 
        phone: string; 
        purpose: string; 
        zoningComplianceDeclarationAccepted?: boolean;
    }
): Promise<ActionResponse<{ authorizationUrl: string; reference: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user) { 
            return { success: false, error: "Authentication required", data: null };
        }

        // Strict validation of zoning compliance declaration
        if (!buyerInfo.zoningComplianceDeclarationAccepted) {
            return { success: false, error: "Zoning compliance declaration must be accepted to proceed with property purchase", data: null };
        }

        // Validate amount
        if (amount < 10000) { 
            return { success: false, error: "Minimum property purchase is ₦10,000", data: null };
        }

        // Check if property exists and is available
        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) { 
            return { success: false, error: "Property not found", data: null };
        }

        const propertyData = propertyDoc.data()!;

        if (propertyData.status !== "verified") { 
            return { success: false, error: "Property is no longer available", data: null };
        }

        // Buyer cannot purchase their own property
        if (propertyData.ownerId === session.user.id) { 
            return { success: false, error: "You cannot purchase your own property", data: null };
        }

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/farm-nation/payment/callback`;

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
                callback_url: callbackUrl 
            },
            callbackUrl
        );

        // Create pending purchase record in FARM_NATION_TRANSACTIONS
        const purchaseId = `${session.user.id}_${propertyId}_${Date.now()}`;
        await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(purchaseId).set({ 
            id: purchaseId,
            propertyId,
            propertyName: propertyTitle,
            propertyPrice: amount,
            propertyType: propertyData.category || "land",
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
            zoningComplianceDeclarationAccepted: true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        });
        
        await propertyRef.update({ 
            status: "pending_escrow", // Update status to reflect it's being purchased
            updatedAt: FieldValue.serverTimestamp() 
        });

        return { 
            success: true, 
            error: null, 
            data: { authorizationUrl, reference } 
        };
    } catch (error: any) { 
        logger.error("Property payment initialization error:", error);
        return { success: false, error: error.message || "Failed to initialize payment. Please try again.", data: null };
    }
}
export const initializePropertyPaymentAction = withFlexibleSafeAction("initializePropertyPaymentAction", _initializePropertyPaymentAction);

/**
 * Verify Property Purchase Payment
 * Updates ownership after successful payment
 */
async function _verifyPropertyPaymentAction(reference: string): Promise<ActionResponse<{ propertyId: string; message: string }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user) { 
            return { success: false, error: "Authentication required", data: null };
        }

        const rateLimitResult = await paymentLimiter.check(session.user.id);
        if (!rateLimitResult.success) { 
            return { success: false, error: "Too many payment verification attempts. Please try again later.", data: null };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        // ✅ FIX: If webhook already processed this payment, return success not an error.
        if (existingPayment.exists) {
            logger.info(`[verifyPropertyPaymentAction] Payment ${reference} already processed — returning success.`);
            // Find the property from metadata so we can return its ID
            const txQuery = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("paymentReference", "==", reference).limit(1).get();
            const propertyId = txQuery.empty ? "" : txQuery.docs[0].data()?.propertyId || "";
            return { success: true, error: null, data: { propertyId, message: "Payment successful! Your funds are held securely in escrow." } };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                success: false,
                error: `Payment ${paymentData.data.status}: ${paymentData.data.gateway_response}`,
                data: null
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const propertyId = metadata.propertyId;
        const userId = metadata.userId;

        // Verify user match
        if (userId !== session.user.id) { 
            return { success: false, error: "Payment verification failed: User mismatch", data: null };
        }

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        let amountInNaira = 0;

        await db.runTransaction(async (tx) => { 
            const freshPropertyDoc = await tx.get(propertyRef);
            if (!freshPropertyDoc.exists) {
                throw new Error("Property not found");
            }

            const freshData = freshPropertyDoc.data()!;
            amountInNaira = paymentData.data.amount / 100;

            if (freshData.status !== "pending_escrow") {
                throw new Error(`Property is not in pending escrow state (status: ${freshData.status}).`);
            }

            // Transfer ownership later, just lock it in escrow
            const updatedData = { 
                status: "pending_escrow", // Wait for admin to release C of O
                escrowHeldAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            };
            tx.update(propertyRef, updatedData);

            // Mark payment as processed inside the transaction for full atomicity
            const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
            tx.set(processedRef, { 
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "farm_nation_escrow",
                reference 
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

            // Log direct Paystack payment in the payments collection
            const paymentId = `PAY-${reference}`;
            const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
            tx.set(paymentRef, {
                id: paymentId,
                userId: session.user.id,
                userEmail: session.user.email || "",
                amount: amountInNaira,
                currency: "NGN",
                paymentReference: reference,
                status: "success",
                paymentMethod: "paystack",
                purpose: "escrow_payment",
                relatedId: propertyId,
                initiatedAt: freshData.createdAt || FieldValue.serverTimestamp(),
                completedAt: FieldValue.serverTimestamp(),
                sellerId: metadata.sellerId || freshData.ownerId || "",
                participants: [session.user.id, metadata.sellerId || freshData.ownerId || ""].filter(Boolean)
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
                    updatedAt: FieldValue.serverTimestamp() 
                });
            }
        });

        return {
            success: true,
            error: null,
            data: { 
                propertyId,
                message: `Payment successful! Your funds are held securely in escrow for ${metadata.propertyTitle}.`
            }
        };
    } catch (error: any) {
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyProperty',
            reference,
            error: error instanceof Error ? error.message : String(error)
        });

        return {
            success: false,
            error: "Failed to verify payment. Please contact support with reference: " + reference,
            data: null
        };
    }
}
export const verifyPropertyPaymentAction = withFlexibleSafeAction("verifyPropertyPaymentAction", _verifyPropertyPaymentAction);
