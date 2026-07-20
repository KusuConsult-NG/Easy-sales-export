"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { getBaseUrl } from "@/lib/server-utils";
import { getExchangeRates } from "@/lib/system-settings";
import { writeGuard, PaymentStatusWriteSchema } from "@/lib/write-guard";

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { return Math.round(naira * 100); }

export type PaymentInitState = 
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any };

export interface ExportCartItemInput { productId: string;
    quantityMT: number;
    grade: string; }

export interface ExportBuyerDetails { companyName: string;
    contactPerson: string;
    email: string;
    phone: string;
    country: string;
    portOfDestination: string;
    shippingTerm: string;
    additionalNotes: string; }

// const USD_TO_NGN_RATE = 1650; // REMOVED: Now fetched dynamically

export async function initializeExportOrderPaymentAction(
    cartItems: ExportCartItemInput[],
    buyerDetails: ExportBuyerDetails
): Promise<PaymentInitState> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, data: null, meta: null };
        }

        if (!cartItems.length) { return { error: "Cart is empty", success: false as const, data: undefined, meta: null };
        }

        let totalUSD = 0;
        const validatedItems = [];

        // Validate items against DB
        for (const item of cartItems) {
            const productDoc = await db.collection(COLLECTIONS.EXPORT_CATALOG).doc(item.productId).get();
            if (!productDoc.exists) {
                return { error: `Product not found: ${item.productId}`, success: false as const, data: undefined, meta: null };
            }
            const productData = productDoc.data()!;
            
            // Allow only active products
            if (!productData.isActive) {
                return { error: `Product ${productData.name} is not available for purchase`, success: false as const, data: undefined, meta: null };
            }

            const pricePerMT = productData.pricePerMT || 0;
            const itemTotalUSD = pricePerMT * item.quantityMT;
            totalUSD += itemTotalUSD;

            validatedItems.push({ productId: item.productId,
                name: productData.name,
                grade: item.grade,
                quantityMT: item.quantityMT,
                pricePerMT: pricePerMT,
                totalUSD: itemTotalUSD,
                sellerId: productData.userId || "export-operations"
            });
        }

        const { usdToNgn } = await getExchangeRates();
        const totalNGN = totalUSD * usdToNgn;

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/export/buyer/cart/payment-callback`;

        // Initialize payment with Paystack
        const { authorizationUrl, reference } = await initializePaystackPayment(
            buyerDetails.email,
            nairaToKobo(totalNGN),
            {
                userId: session.user.id,
                type: "export_buyer_order",
                totalUSD,
                totalNGN,
                itemCount: cartItems.length,
                callback_url: callbackUrl 
            },
            callbackUrl
        );

        // Pre-create the order as "pending_payment"
        const orderId = `EXP-ORD-${Date.now()}-${session.user.id.substring(0, 5)}`;
        await db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderId).set({ orderId,
            buyerId: session.user.id,
            buyerDetails,
            items: validatedItems,
            totalUSD,
            totalNGN,
            exchangeRate: usdToNgn,
            paymentReference: reference,
            paymentStatus: "pending",
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const,
            meta: null
        , data: null };
    } catch (error: any) { logger.error("Export Order payment initialization error:", error);
        return { error: "Failed to initialize payment.", success: false as const, data: undefined, meta: null
 };
    }
}

export async function verifyExportOrderPaymentAction(reference: string) { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, meta: null };
        }

        // Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        // ✅ FIX: If webhook already processed this payment, return success not an error.
        if (existingPayment.exists) {
            logger.info(`[verifyExportOrderPaymentAction] Payment ${reference} already processed — returning success.`);
            const orderQuery = await db.collection(COLLECTIONS.EXPORT_ORDERS)
                .where("paymentReference", "==", reference).limit(1).get();
            return { error: null, success: true as const, meta: null, data: { orderId: orderQuery.empty ? reference : orderQuery.docs[0].id } };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status || 'failed'}. Please contact support if amount was debited.`,
                success: false as const, meta: null
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const userId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;

        // Verify user match
        if (userId !== session.user.id) { return { error: "Payment verification failed: User mismatch", success: false as const, meta: null };
        }

        // Find the pending order
        const orderQuery = await db.collection(COLLECTIONS.EXPORT_ORDERS)
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (orderQuery.empty) { return { error: "Export Order record not found", success: false as const, meta: null };
        }

        const orderDoc = orderQuery.docs[0];
        const orderData = orderDoc.data();

        await db.runTransaction(async (transaction) => { // Update order status
            const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderDoc.id);
            transaction.update(orderRef, writeGuard(
                PaymentStatusWriteSchema.partial(),
                {
                    status: "processing",
                    paymentStatus: "completed",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                'export-payment/verifyExportOrderPayment'
            ));

            // Mark payment as processed
            transaction.set(processedRef, { processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "export_buyer_order",
                reference });

            // Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            transaction.set(globalTxRef, {
                id: reference,
                userId: session.user.id,
                type: "export_order",
                module: "export",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Export Order #${orderData.orderId}`
            });
            
            // Decrement global catalog stock
            for (const item of orderData.items) {
                const productRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(item.productId);
                transaction.update(productRef, { 
                    availableQuantity: FieldValue.increment(-item.quantityMT),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        // Notify Admins
        try {
            const { notifyAdmins } = await import("@/lib/admin-notifications");
            await notifyAdmins({
                type: "export",
                title: "New Export Order Received",
                message: `Export order ${orderData.orderId} has been fully paid. Term: ${orderData.buyerDetails.shippingTerm}. Port: ${orderData.buyerDetails.portOfDestination}.`,
                link: `/admin/export/orders/${orderData.orderId}`,
                linkText: "View Order"
            });
        } catch (e: any) { logger.warn("Failed to send export order admin notification", { error: e?.message || String(e) });
        }

        return { error: null, success: true as const,
            meta: null
        , data: { orderId: orderDoc.id } };
    } catch (error: any) { logger.error('[Export Order Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyExportOrder',
            reference,
            error: error.message
        });

        return { error: "Failed to verify export order payment. Please contact support.", success: false as const, meta: null };
    }
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
): Promise<PaymentInitState> { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, meta: null };
        }

        // Validate amount
        if (investmentAmount < 50000) { return { error: "Minimum investment is ₦50, 000", success: false as const, data: undefined, meta: null };
        }

        if (investmentAmount > 10000000) { return { error: "Maximum investment is ₦10, 000, 000", success: false as const, data: undefined, meta: null };
        }

        // Check if export window exists and is open
        const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(windowId);
        const windowDoc = await windowRef.get();

        if (!windowDoc.exists) { return { error: "Export window not found", success: false as const, data: undefined, meta: null };
        }

        const windowData = windowDoc.data();
        if (!windowData) { return { error: "Export window data is corrupted", success: false as const, data: undefined, meta: null };
        }

        if (windowData.status !== "open" && windowData.status !== "active") { return { error: "This export window is no longer accepting investments", success: false as const, data: undefined, meta: null };
        }

        // Check if funding goal exceeded
        const currentFunding = windowData.currentFunding || 0;
        const fundingGoal = windowData.fundingGoal || 0;

        if (currentFunding + investmentAmount > fundingGoal) {
            return {
                error: `Investment exceeds available slots. Maximum available: ₦${(fundingGoal - currentFunding).toLocaleString()}`,
                success: false as const,
                data: undefined,
                meta: null
            };
        }

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/export/payment/callback`;

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
                callback_url: callbackUrl 
            },
            callbackUrl
        );

        // Create pending investment record
        const investmentId = `${session.user.id}_${windowId}_${Date.now()}`;
        await db.collection(COLLECTIONS.EXPORT_INVESTMENTS).doc(investmentId).set({ investmentId,
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
            updatedAt: FieldValue.serverTimestamp() });

        return { error: null, success: true as const,
            meta: null
        , data: null };
    } catch (error: any) { logger.error("Investment payment initialization error:", error);
        return { error: "Failed to initialize investment payment. Please try again.", success: false as const, data: undefined, meta: null
 };
    }
}

/**
 * Verify Export Investment Payment
 * Updates investment and portfolio after successful payment
 */
export async function verifyInvestmentPaymentAction(reference: string) { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
    const { session } = sessionResult;

        if (!session?.user) { return { error: "Authentication required", success: false as const, meta: null };
        }

        // 🔒 SECURITY FIX #1: Double-payment protection
        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        // ✅ FIX: If webhook already processed this payment, return success not an error.
        if (existingPayment.exists) {
            logger.info(`[verifyInvestmentPaymentAction] Payment ${reference} already processed — returning success.`);
            const invQuery = await db.collection(COLLECTIONS.EXPORT_INVESTMENTS)
                .where("paymentReference", "==", reference).limit(1).get();
            return { error: null, success: true as const, meta: null, data: { investmentId: invQuery.empty ? reference : invQuery.docs[0].id } };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status}. Please contact support if amount was debited.`,
                success: false as const, meta: null
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const windowId = metadata.windowId;
        const userId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;
        const expectedAmount = metadata.investmentAmount;

        // Verify user match
        if (userId !== session.user.id) { return { error: "Payment verification failed: User mismatch", success: false as const, meta: null };
        }

        // 🔒 SECURITY FIX #3: Amount re-validation
        if (amountInNaira < 50000 || amountInNaira > 10000000) { return { error: "Invalid payment amount", success: false as const, meta: null };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) { return { error: "Payment amount mismatch", success: false as const, meta: null };
        }

        // Find investment record
        const investmentQuery = await db.collection(COLLECTIONS.EXPORT_INVESTMENTS)
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (investmentQuery.empty) { return { error: "Investment record not found", success: false as const, meta: null };
        }

        const investmentDoc = investmentQuery.docs[0];
        const investmentData = investmentDoc.data();

        // 🔒 SECURITY FIX #4: Use Firestore transaction for atomicity
        await db.runTransaction(async (transaction) => { // Update investment status
            const investmentRef = db.collection(COLLECTIONS.EXPORT_INVESTMENTS).doc(investmentDoc.id);
            transaction.update(investmentRef, writeGuard(
                PaymentStatusWriteSchema.partial(),
                {
                    status: "active",
                    paymentStatus: "completed",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                'export-payment/verifyInvestmentPayment'
            ));

            // Update export window funding
            const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(windowId);
            const windowSnap = await transaction.get(windowRef);

            if (!windowSnap.exists) { throw new Error("Export window not found");
            }

            const windowData = windowSnap.data();
            const currentFunding = windowData?.fundedAmount || windowData?.currentFunding || 0;
            const fundingGoal = windowData?.fundingGoal || windowData?.goal || 0;
            const spotsFilled = windowData?.spotsFilled || windowData?.investorCount || 0;

            // 🔒 SECURITY FIX: Prevent Over-funding
            // If fundingGoal is set (greater than 0), ensure we don't exceed it.
            if (fundingGoal > 0 && (currentFunding + amountInNaira > fundingGoal)) {
                throw new Error(`Investment rejected: Funding goal exceeded. Current: ₦${currentFunding.toLocaleString()}, Goal: ₦${fundingGoal.toLocaleString()}. Amount: ₦${amountInNaira.toLocaleString()}`);
                // In a real system, we might auto-refund here or mark as "overpaid_pending_refund"
            }

            transaction.update(windowRef, { 
                fundedAmount: currentFunding + amountInNaira,
                spotsFilled: spotsFilled + 1,
                participantsCount: spotsFilled + 1,
                currentFunding: currentFunding + amountInNaira,
                investorCount: spotsFilled + 1,
                updatedAt: FieldValue.serverTimestamp() 
            });

            // Update or create investor portfolio
            const portfolioId = session.user.id || "";
            const portfolioRef = db.collection(COLLECTIONS.INVESTOR_PORTFOLIOS).doc(portfolioId);
            const portfolioSnap = await transaction.get(portfolioRef);

            if (portfolioSnap.exists) { const pData = portfolioSnap.data();
                if (pData) {
                    const currentInvested = pData.totalInvested || 0;
                    const currentReturns = pData.totalExpectedReturns || 0;
                    const activeCount = pData.activeInvestments || 0;

                    transaction.update(portfolioRef, {
                        totalInvested: currentInvested + amountInNaira,
                        totalExpectedReturns: currentReturns + (investmentData?.expectedReturn || 0),
                        activeInvestments: activeCount + 1,
                        updatedAt: FieldValue.serverTimestamp() });
                }
            } else { transaction.set(portfolioRef, {
                    investorId: session.user.id,
                    investorEmail: session.user.email,
                    totalInvested: amountInNaira,
                    totalExpectedReturns: investmentData?.expectedReturn || 0,
                    totalReturned: 0,
                    activeInvestments: 1,
                    completedInvestments: 0,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp() });
            }

            // Mark payment as processed
            transaction.set(processedRef, { processedAt: FieldValue.serverTimestamp(),
                userId: session.user.id,
                amount: amountInNaira,
                type: "export_investment",
                reference });

            // Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            transaction.set(globalTxRef, {
                id: reference,
                userId: session.user.id,
                type: "export_investment",
                module: "export",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Export Investment - ${metadata.windowTitle}`
            });
        });

        return {
            error: null,
            success: true as const,
            data: { investmentId: investmentDoc.id }
        };
    } catch (error: any) { // 🔒 SECURITY FIX #2: Sanitized error logging
        logger.error('[Payment Verification Error]', {
            timestamp: new Date().toISOString(),
            action: 'verifyInvestment',
            reference
        });

        return {
            error: "Failed to verify investment payment. Please contact support with your payment reference.",
            success: false as const,
            data: null,
            meta: null
        };
    }
}
