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
import { claimPaymentOnce, decrementManyOrFail, incrementWithinCeiling , markFulfilmentFailed } from "@/lib/wallet-ledger";

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

            // Neither factor of this line total was checked.
            //
            // Same defect as #113 in marketplace/_payment.ts, in the module that
            // was not fixed at the same time — and worse here, because the
            // marketplace at least has a minOrderAmount floor and this path has
            // no minimum at all.
            //
            // quantityMT comes straight from the client. A negative one
            // subtracts from the order: pair it with a real item and the buyer
            // is charged a fraction of what the goods are worth. It does not end
            // in theft — decrementManyOrFail refuses a non-positive amount, so
            // verification throws at the stock step AFTER the payment reference
            // is claimed — but that leaves a charge with no order and no
            // automatic refund.
            //
            // pricePerMT comes from the catalogue document, which
            // submitExportProductAction writes from an unvalidated `any`. A
            // negative price needs an admin to approve the listing, and then
            // nothing downstream refuses it.
            //
            // Fractional tonnage is legitimate — 2.5 MT is a real order — so
            // this requires a positive finite number rather than an integer,
            // unlike the marketplace equivalent which counts whole units.
            const quantityMT = Number(item.quantityMT);
            if (!Number.isFinite(quantityMT) || quantityMT <= 0) {
                return { error: `Invalid quantity for ${productData.name || item.productId}`, success: false as const, data: undefined, meta: null };
            }

            const pricePerMT = Number(productData.pricePerMT || 0);
            if (!Number.isFinite(pricePerMT) || pricePerMT <= 0) {
                return { error: `Product ${productData.name || item.productId} is not priced for sale`, success: false as const, data: undefined, meta: null };
            }

            const itemTotalUSD = pricePerMT * quantityMT;
            totalUSD += itemTotalUSD;

            validatedItems.push({ productId: item.productId,
                name: productData.name,
                grade: item.grade,
                quantityMT,
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

        // The "double-payment protection" that used to sit here read
        // processed_payments and returned early if the row existed. That read
        // was the first half of a check-then-write whose second half ran after
        // fulfilment, so it protected against a webhook that had ALREADY
        // finished and against nothing else. claimPaymentOnce below is the
        // whole gate now, and it is decided by Postgres rather than by this
        // read.

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

        // The processed-payment check above read the marker and the write below
        // set it, with the whole fulfilment in between — so two deliveries of
        // one payment (the webhook and the buyer landing on this callback) both
        // read "not processed" and both fulfilled, decrementing catalog stock
        // twice for one order. Claimed first now, then fulfilled.
        const claim = await claimPaymentOnce({
            reference,
            userId: session.user.id,
            amount: amountInNaira,
            type: "export_buyer_order",
            source: "client_verify",
            metadata: { orderId: orderData.orderId },
        });

        if (!claim.claimed) {
            logger.info(`[verifyExportOrderPaymentAction] Payment ${reference} already claimed — nothing to do.`);
            return {
                error: null,
                success: true as const,
                meta: null,
                data: { orderId: orderData.orderId },
            } as any;
        }

        {
            // Stock first, and all-or-nothing. FieldValue.increment(-qty) is
            // atomic but unbounded, so an order for more than the catalog holds
            // drove availableQuantity negative — and a per-item loop would
            // leave the earlier items decremented when a later one fell short.
            // decrement_many_or_fail (015) locks every row, checks them all,
            // then writes, in id order so concurrent orders cannot deadlock.
            const stock = await decrementManyOrFail(
                (orderData.items || []).map((item: any) => ({
                    collection: COLLECTIONS.EXPORT_CATALOG,
                    id: item.productId,
                    field: "availableQuantity",
                    amount: item.quantityMT,
                }))
            );

            if (!stock.ok) {
                // The payment is already claimed, so this will not retry. The
                // buyer has been charged for stock that is not there, which
                // somebody has to refund — log loudly enough to be found.
                logger.error("[verifyExportOrderPaymentAction] PAID BUT OUT OF STOCK — refund required", {
                    reference,
                    orderId: orderData.orderId,
                    failedProductId: stock.failedId,
                    reason: stock.reason,
                });

                const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderDoc.id);
                await orderRef.update({
                    status: "cancelled_out_of_stock",
                    paymentStatus: "paid_awaiting_refund",
                    refundReason: `Insufficient catalog stock for product ${stock.failedId}`,
                    refundAmount: amountInNaira,
                    updatedAt: FieldValue.serverTimestamp(),
                });

                return {
                    error: "This order could not be fulfilled: one of the products is no longer available in the quantity ordered. You have been charged and a refund is being arranged.",
                    success: false as const,
                    meta: null,
                };
            }

            const orderRef = db.collection(COLLECTIONS.EXPORT_ORDERS).doc(orderDoc.id);
            await orderRef.update(writeGuard(
                PaymentStatusWriteSchema.partial(),
                {
                    status: "processing",
                    paymentStatus: "completed",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                'export-payment/verifyExportOrderPayment'
            ));

            // (The processed_payments row is written by claimPaymentOnce above.)

            // Global Ledger Record — last, deliberately.
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            await globalTxRef.set({
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
        }

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

        // "SECURITY FIX #1: Double-payment protection" read processed_payments
        // and returned early if the row existed, while the row itself was
        // written after fulfilment. It caught a webhook that had already
        // FINISHED, and nothing else — two deliveries in flight together both
        // read an absent row. claimPaymentOnce below is the whole gate now.

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

        // WHAT WAS WRONG HERE
        // -------------------
        // Labelled "SECURITY FIX #4: Use Firestore transaction for atomicity".
        // The wrapper provided no atomicity, and underneath it were two real
        // defects on the window's funding total.
        //
        // 1. LOST UPDATE. The funding counters were ABSOLUTE writes computed in
        //    JavaScript from a value read moments earlier:
        //
        //        fundedAmount: currentFunding + amountInNaira,
        //        spotsFilled:  spotsFilled + 1,
        //
        //    Two investors funding one window at the same time both read the
        //    same currentFunding and each wrote their own total. One
        //    investment vanished from the window's funding while the investor's
        //    money had been taken and their record marked active. Note these
        //    were not even FieldValue.increment — migration 010 could not help
        //    a write that never used the sentinel.
        //
        // 2. THE OVERFUNDING GUARD WAS NOT A GUARD. It read currentFunding,
        //    compared currentFunding + amount to the goal, and then wrote —
        //    with no lock. Two investments that each fit under the goal but
        //    together exceed it both passed.
        //
        // increment_within_ceiling (migration 015) fixes both in one statement:
        // it locks the row, checks the ceiling held on that same record, and
        // increments only if the result still fits.
        const claim = await claimPaymentOnce({
            reference,
            userId: session.user.id,
            amount: amountInNaira,
            type: "export_investment",
            source: "client_verify",
            metadata: { windowId, investmentId: investmentDoc.id },
        });

        if (!claim.claimed) {
            // The webhook got here first. A duplicate delivery is a success.
            logger.info(`[verifyInvestmentPaymentAction] Payment ${reference} already claimed — nothing to do.`);
            return {
                error: null,
                success: true as const,
                data: { investmentId: investmentDoc.id },
                meta: null,
            };
        }

        {
            const windowRef = db.collection(COLLECTIONS.EXPORT_WINDOWS).doc(windowId);
            const windowSnap = await windowRef.get();

            if (!windowSnap.exists) { throw new Error("Export window not found");
            }

            const windowData = windowSnap.data();

            // Which field holds the ceiling depends on when the window was
            // written — both vocabularies exist in the data. Passing the wrong
            // name would leave the window UNBOUNDED, because a record with no
            // ceiling recorded is deliberately treated as uncapped.
            const ceilingField = windowData?.fundingGoal !== undefined ? "fundingGoal" : "goal";
            const fundingGoal = windowData?.fundingGoal ?? windowData?.goal ?? 0;

            const raised = await incrementWithinCeiling({
                collection: COLLECTIONS.EXPORT_WINDOWS,
                id: windowId,
                field: "fundedAmount",
                amount: amountInNaira,
                ceilingField,
            });

            if (!raised.ok) {
                throw new Error(`Investment rejected: Funding goal exceeded. Goal: ₦${Number(fundingGoal).toLocaleString()}. Amount: ₦${amountInNaira.toLocaleString()}`);
            }

            // The remaining counters carry no ceiling, so a plain atomic
            // increment is enough. currentFunding duplicates fundedAmount and
            // is kept in step deliberately — both names are read elsewhere.
            await windowRef.update({
                spotsFilled: FieldValue.increment(1),
                participantsCount: FieldValue.increment(1),
                currentFunding: FieldValue.increment(amountInNaira),
                investorCount: FieldValue.increment(1),
                updatedAt: FieldValue.serverTimestamp()
            });

            const investmentRef = db.collection(COLLECTIONS.EXPORT_INVESTMENTS).doc(investmentDoc.id);
            await investmentRef.update(writeGuard(
                PaymentStatusWriteSchema.partial(),
                {
                    status: "active",
                    paymentStatus: "completed",
                    paymentVerifiedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                'export-payment/verifyInvestmentPayment'
            ));

            // Update or create investor portfolio. These totals were absolute
            // writes too, with the same lost-update shape.
            const portfolioId = session.user.id || "";
            const portfolioRef = db.collection(COLLECTIONS.INVESTOR_PORTFOLIOS).doc(portfolioId);
            const portfolioSnap = await portfolioRef.get();

            if (portfolioSnap.exists) {
                await portfolioRef.update({
                    totalInvested: FieldValue.increment(amountInNaira),
                    totalExpectedReturns: FieldValue.increment(investmentData?.expectedReturn || 0),
                    activeInvestments: FieldValue.increment(1),
                    updatedAt: FieldValue.serverTimestamp() });
            } else { await portfolioRef.set({
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

            // (The processed_payments row is written by claimPaymentOnce above.
            //  Writing it here as well is what put the marker AFTER the work.)

            // Global Ledger Record — last, so a crash leaves the investment
            // recorded without a duplicate ledger entry rather than the reverse.
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            await globalTxRef.set({
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
        }

        return {
            error: null,
            success: true as const,
            data: { investmentId: investmentDoc.id }
        };
    } catch (error: any) { // 🔒 SECURITY FIX #2: Sanitized error logging
        // Past the claim, necessarily: the function returns early when the claim
        // is lost. claim_payment_once wrote status 'completed' at claim time, so a
        // failure here leaves a payment that looks settled with no investment
        // recorded, invisible to reconcilePendingFulfillments.
        //
        // Two things throw in that window: export window not found, and the
        // funding goal being exceeded — and the second is the one that matters,
        // because an investor whose money was taken and rejected for overfunding
        // currently leaves no findable record.
        await markFulfilmentFailed(reference, error?.message ?? String(error));
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
