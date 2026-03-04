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
 * Initialize Paystack Payment for Export Investment
 * Creates a payment session and returns authorization URL
 */
export async function initializeInvestmentPaymentAction(
    windowId: string,
    windowTitle: string,
    investmentAmount: number,
    commodity: string,
    expectedROI: number
): Promise<PaymentInitState> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return sessionResult.error;
    const { session } = sessionResult;

        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        // Validate amount
        if (investmentAmount < 50000) {
            return { error: "Minimum investment is ₦50,000", success: false };
        }

        if (investmentAmount > 10000000) {
            return { error: "Maximum investment is ₦10,000,000", success: false };
        }

        // Check if export window exists and is open
        const windowRef = db.collection("exportWindows").doc(windowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) {
            return { error: "Export window not found", success: false };
        }

        const windowData = windowDoc.data();
        if (!windowData) {
            return { error: "Export window data is corrupted", success: false };
        }

        if (windowData.status !== "open" && windowData.status !== "active") {
            return { error: "This export window is no longer accepting investments", success: false };
        }

        // Check if funding goal exceeded
        const currentFunding = windowData.currentFunding || 0;
        const fundingGoal = windowData.fundingGoal || 0;

        if (currentFunding + investmentAmount > fundingGoal) {
            return {
                error: `Investment exceeds available slots. Maximum available: ₦${(fundingGoal - currentFunding).toLocaleString()}`,
                success: false
            };
        }

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            session.user.email || "",
            nairaToKobo(investmentAmount),
            {
                userId: session.user.id,
                windowId,
                windowTitle,
                commodity,
                investmentAmount,
                expectedROI,
                type: "export_investment",
                callback_url: `${process.env.NEXT_PUBLIC_APP_URL}/export/payment/callback`,
            }
        );

        // Create pending investment record
        const investmentId = `${session.user.id}_${windowId}_${Date.now()}`;
        await db.collection("exportInvestments").doc(investmentId).set({
            investmentId,
            windowId,
            windowTitle,
            commodity,
            investorId: session.user.id,
            investorEmail: session.user.email,
            investorName: session.user.name || session.user.email,
            amount: investmentAmount,
            expectedROI,
            expectedReturn: investmentAmount * (1 + expectedROI / 100),
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
        logger.error("Investment payment initialization error:", error);
        return {
            success: false,
            error: error.message || "Failed to initialize investment payment. Please try again.",
        };
    }
}

/**
 * Verify Export Investment Payment
 * Updates investment and portfolio after successful payment
 */
export async function verifyInvestmentPaymentAction(reference: string): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    investmentId?: string;
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
                error: `Payment ${paymentData.data.status}. Please contact support if amount was debited.`,
                success: false,
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const windowId = metadata.windowId;
        const userId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;
        const expectedAmount = metadata.investmentAmount;

        // Verify user match
        if (userId !== session.user.id) {
            return { error: "Payment verification failed: User mismatch", success: false };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        if (amountInNaira < 50000 || amountInNaira > 10000000) {
            return { error: "Invalid payment amount", success: false };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) {
            return { error: "Payment amount mismatch", success: false };
        }

        // Find investment record
        const investmentQuery = await db.collection("exportInvestments")
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (investmentQuery.empty) {
            return { error: "Investment record not found", success: false };
        }

        const investmentDoc = investmentQuery.docs[0];
        const investmentData = investmentDoc.data();

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        await db.runTransaction(async (transaction) => {
            // Update investment status
            const investmentRef = db.collection("exportInvestments").doc(investmentDoc.id);
            transaction.update(investmentRef, {
                status: "active",
                paymentStatus: "paid",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Update export window funding
            const windowRef = db.collection("exportWindows").doc(windowId);
            const windowSnap = await transaction.get(windowRef);

            if (!windowSnap.exists) {
                throw new Error("Export window not found");
            }

            const windowData = windowSnap.data();
            const currentFunding = windowData?.currentFunding || 0;
            const fundingGoal = windowData?.fundingGoal || 0; // Assuming fundingGoal exists
            const investorCount = windowData?.investorCount || 0;

            // 🔒 SECURITY FIX: Prevent Over-funding
            // If fundingGoal is set (greater than 0), ensure we don't exceed it.
            if (fundingGoal > 0 && (currentFunding + amountInNaira > fundingGoal)) {
                throw new Error(`Investment rejected: Funding goal exceeded. Current: ₦${currentFunding.toLocaleString()}, Goal: ₦${fundingGoal.toLocaleString()}. Amount: ₦${amountInNaira.toLocaleString()}`);
                // In a real system, we might auto-refund here or mark as "overpaid_pending_refund"
            }

            transaction.update(windowRef, {
                currentFunding: currentFunding + amountInNaira,
                investorCount: investorCount + 1,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Update or create investor portfolio
            const portfolioId = session.user.id || "";
            const portfolioRef = db.collection("investorPortfolios").doc(portfolioId);
            const portfolioSnap = await transaction.get(portfolioRef);

            if (portfolioSnap.exists) {
                const pData = portfolioSnap.data();
                if (pData) {
                    const currentInvested = pData.totalInvested || 0;
                    const currentReturns = pData.totalExpectedReturns || 0;
                    const activeCount = pData.activeInvestments || 0;

                    transaction.update(portfolioRef, {
                        totalInvested: currentInvested + amountInNaira,
                        totalExpectedReturns: currentReturns + (investmentData?.expectedReturn || 0),
                        activeInvestments: activeCount + 1,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                }
            } else {
                transaction.set(portfolioRef, {
                    investorId: session.user.id,
                    investorEmail: session.user.email,
                    totalInvested: amountInNaira,
                    totalExpectedReturns: investmentData?.expectedReturn || 0,
                    totalReturned: 0,
                    activeInvestments: 1,
                    completedInvestments: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            }

            // Mark payment as processed
            transaction.set(processedRef, {
                processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "export_investment",
                reference,
            });
        });

        return {
            success: true,
            message: `Investment successful! Your ₦${amountInNaira.toLocaleString()} investment in ${metadata.windowTitle} is now active.`,
            investmentId: investmentDoc.id,
        };
    } catch (error: any) {
        // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyInvestment',
            reference,
        });

        return {
            success: false,
            error: "Failed to verify investment payment. Please contact support with your payment reference.",
        };
    }
}
