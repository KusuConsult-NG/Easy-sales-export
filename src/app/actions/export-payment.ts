"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { exportWindowAcceptsInvestment, exportWindowReturnMultiplier } from "@/lib/export-window-status";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { getBaseUrl } from "@/lib/server-utils";
import { getExchangeRates } from "@/lib/system-settings";
import { minimumOrderMT } from "@/lib/export-minimum-order";
import { EXPORT_STOCK_FIELD, exportStockIsTracked, exportStockOf } from "@/lib/export-stock";
import { writeGuard, PaymentStatusWriteSchema } from "@/lib/write-guard";
import { claimPaymentOnce, decrementManyOrFail, incrementWithinCeiling , markFulfilmentFailed } from "@/lib/wallet-ledger";
import { isAmountAtLeast } from "@/lib/amount";

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

/**
 *   #577 THE AMOUNT THE BUYER APPROVED IS NOW PART OF THE REQUEST.
 *
 *   The cart screen showed a naira total computed from a constant in the
 *   browser — `const USD_TO_NGN_RATE = 1650` — while this action charges at
 *   `getExchangeRates().usdToNgn`, an owner-editable setting. #381 removed that
 *   constant from THIS file (its corpse is the commented line above) and left
 *   the copy in the screen, so the two agreed only for as long as nobody
 *   touched the setting. The catalogue price can drift the same way: the cart
 *   holds a snapshot taken when the item was added, and every line here is
 *   re-priced from the row.
 *
 *   So the caller states the total it displayed, and this refuses to charge
 *   anything else. A mismatch is not an error in the buyer's cart — it is the
 *   price having moved — so the refusal carries the current figures back for
 *   the screen to show and the buyer to accept.
 *
 *   THE TOLERANCE IS ONE KOBO, and it is there for floating-point noise on the
 *   multiplication, not as slack: a rate change of one thousandth of a naira on
 *   a $100,000 order moves the total by ₦100 and is refused.
 */
const QUOTE_TOLERANCE_KOBO = 1;

export async function initializeExportOrderPaymentAction(
    cartItems: ExportCartItemInput[],
    buyerDetails: ExportBuyerDetails,
    quotedTotalNGN: number
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

            /**
             *   #580 THE MINIMUM ORDER, ON THE DOOR THAT CHARGES.
             *
             *   `minOrderMT` is required on both submission forms, stored on
             *   the row, published by the catalogue route and printed on every
             *   product card — and read by nothing between the card and the
             *   charge. The card would not let a buyer add 10 MT of a 20 MT
             *   product; the cart's minus button stepped them there in twos.
             *
             *   An absent or non-positive minimum means none, so no order that
             *   is legitimate today is refused. See lib/export-minimum-order.
             */
            const minimumMT = minimumOrderMT(productData);
            if (minimumMT !== null && quantityMT < minimumMT) {
                return { error: `${productData.name || item.productId} has a minimum order of ${minimumMT} MT`, success: false as const, data: undefined, meta: null };
            }

            const pricePerMT = Number(productData.pricePerMT || 0);
            if (!Number.isFinite(pricePerMT) || pricePerMT <= 0) {
                return { error: `Product ${productData.name || item.productId} is not priced for sale`, success: false as const, data: undefined, meta: null };
            }

            /**
             *   #582 REFUSED BEFORE THE CHARGE, NOT AFTER IT.
             *
             *   The only stock check on this path ran at FULFILMENT, after the
             *   payment reference was claimed — so a listing that really was
             *   short left the buyer charged, the order cancelled and a manual
             *   refund to arrange. Checked here too, where refusing costs
             *   nobody anything. The atomic decrement still guards the race
             *   between two buyers; this catches the ordinary case.
             */
            const stockMT = exportStockOf(productData);
            if (stockMT !== null && quantityMT > stockMT) {
                return {
                    error: stockMT === 0
                        ? `${productData.name || item.productId} is out of stock`
                        : `${productData.name || item.productId} has only ${stockMT} MT available`,
                    success: false as const, data: undefined, meta: null,
                };
            }

            const itemTotalUSD = pricePerMT * quantityMT;
            totalUSD += itemTotalUSD;

            validatedItems.push({ productId: item.productId,
                name: productData.name,
                grade: item.grade,
                quantityMT,
                pricePerMT: pricePerMT,
                totalUSD: itemTotalUSD,
                sellerId: productData.userId || "export-operations",
                /**
                 *   #582 — WHETHER ANYBODY IS COUNTING THIS LISTING'S STOCK,
                 *   decided here because this is where the catalogue row is
                 *   already in hand.
                 *
                 *   Fulfilment cannot ask the question itself:
                 *   decrement_many_or_fail reads a missing field as 0, so from
                 *   inside Postgres "no stock recorded" and "none left" are the
                 *   same value. Recorded on the order, so an older order
                 *   without the flag reads as untracked — the safe direction,
                 *   since the alternative is the refusal this finding is about.
                 */
                stockTracked: exportStockIsTracked(productData),
            });
        }

        const { usdToNgn } = await getExchangeRates();
        const totalNGN = totalUSD * usdToNgn;

        //   #577 — what the buyer was shown, or nothing. A caller that does not
        //   state a total cannot have shown one it agrees with.
        const quoted = Number(quotedTotalNGN);
        if (!Number.isFinite(quoted) || quoted <= 0) {
            return { error: "This order was not priced. Please reload the cart and try again.", success: false as const, data: undefined, meta: null };
        }

        if (Math.abs(nairaToKobo(quoted) - nairaToKobo(totalNGN)) > QUOTE_TOLERANCE_KOBO) {
            return {
                error: `The price of this order has changed — it is now ₦${Math.round(totalNGN).toLocaleString()} (you were shown ₦${Math.round(quoted).toLocaleString()}). Nothing has been charged. Check the updated total and pay again if you are happy with it.`,
                success: false as const,
                data: undefined,
                meta: { quote: { totalUSD, totalNGN, usdToNgn } },
            };
        }

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

        // The authorization URL, returned.
        //
        // This returned `data: null` — the second initiator in this file to
        // discard the URL it had just obtained from Paystack (see
        // initializeInvestmentPaymentAction below). Its caller, the export cart,
        // reads `result.data?.authorizationUrl` and shows "Failed to initialize
        // payment: No authorization URL", so the export buyer checkout could not
        // complete a single order — and the page CLEARS THE CART before it looks
        // for the URL, so the buyer lost their basket on the way to the error.
        return { error: null, success: true as const,
            meta: null,
            data: { authorizationUrl, reference } };
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
            /**
             *   #582 ONLY THE LISTINGS SOMEBODY IS ACTUALLY COUNTING.
             *
             *   This decremented `availableQuantity` — the MARKETPLACE's field
             *   name — on a collection that has never carried it, and a missing
             *   field is 0 to decrement_many_or_fail. So every paid export
             *   order was cancelled as out of stock and left awaiting a manual
             *   refund. See lib/export-stock.
             *
             *   An unrecorded stock is not a stock of zero. A listing with a
             *   real quantity is still counted down, and a genuine shortfall is
             *   still refused all-or-nothing, which is #279's fix and untouched.
             */
            const trackedItems = (orderData.items || []).filter((item: any) => item?.stockTracked === true);

            const stock = trackedItems.length === 0
                ? { ok: true as const, failedId: undefined, reason: undefined }
                : await decrementManyOrFail(
                    trackedItems.map((item: any) => ({
                        collection: COLLECTIONS.EXPORT_CATALOG,
                        id: item.productId,
                        field: EXPORT_STOCK_FIELD,
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

        /**
         *   #585 AND TELL THE BUYER, WHO IS THE ONE WHO PAID.
         *
         *   This notified the admins and stopped. Every other module's payment
         *   path notifies the person whose money moved; the export buyer got a
         *   confirmation screen, and after they closed it there was no record
         *   of the order on any screen they could open.
         *
         *   Its own failure must not fail the fulfilment: the payment is
         *   claimed, the stock is decremented and the order is processing by
         *   the time this runs, so a notification that cannot be written is
         *   worth a log line and nothing more.
         */
        try {
            const { createNotification } = await import("@/infrastructure/notifications/service");
            await createNotification({
                userId: session.user.id,
                type: "payment",
                title: "Export order confirmed",
                message: `We have received your payment for order ${orderData.orderId}. Our export team will prepare your consignment and the shipping documentation.`,
                link: "/export/buyer/orders",
                linkText: "View my orders",
            });
        } catch (e: any) {
            logger.warn("Failed to notify export buyer of their order", { error: e?.message || String(e) });
        }

        // Notify Admins
        try {
            const { notifyAdmins } = await import("@/lib/admin-notifications");
            await notifyAdmins({
                type: "export",
                title: "New Export Order Received",
                message: `Export order ${orderData.orderId} has been fully paid. Term: ${orderData.buyerDetails.shippingTerm}. Port: ${orderData.buyerDetails.portOfDestination}.`,
                // /admin/export/orders/{id} is not a route — there is no [id]
                // segment under it, only the list page. Every "New Export Order
                // Received" notification an admin received linked to a 404. The
                // order id is already in the message above, and the list page is
                // where they would look it up.
                link: `/admin/export/orders`,
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
        if (!isAmountAtLeast(investmentAmount, 50000)) { return { error: "Minimum investment is ₦50, 000", success: false as const, data: undefined, meta: null };
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

        // #275 Was a status check with no deadline, like _ex_investments.ts.
        const investable = exportWindowAcceptsInvestment(windowData);
        if (!investable.ok) {
            return { error: investable.message, success: false as const, data: undefined, meta: null };
        }

        // Check if funding goal exceeded — WHEN there is one.
        //
        // This read `windowData.fundingGoal || 0` and then refused whenever
        // `currentFunding + investmentAmount > fundingGoal`. Nothing anywhere in
        // the codebase writes `fundingGoal` onto an export window: neither of
        // the two createExportWindowAction implementations does, the seeder is
        // deprecated, and the field appears only in reads, comments and tests.
        //
        // So fundingGoal was always 0, the minimum investment is ₦50,000, and
        // `0 + 50000 > 0` is true. EVERY investment on EVERY window was refused,
        // with "Investment exceeds available slots. Maximum available: ₦0" — the
        // export investment feature could not take a single payment.
        //
        // An absent ceiling means uncapped, which is not an invention here: it
        // is what incrementWithinCeiling does with a missing ceiling field
        // (migration 015, and the comment at the fulfilment end of this same
        // file), and what the sibling path in export/_ex_investments.ts already
        // does with its `fundingGoal > 0 &&` guard. `goal` is read as a fallback
        // for the same reason both fulfilment paths read it: older windows
        // recorded it under that name.
        //
        // NOTE FOR THE OWNER: because no window carries a goal, no window is
        // capped. Deciding which of the two window shapes should record one, and
        // from what — the aggregation windows carry targetVolume and slotPrice,
        // whose product would be a natural goal — is a product decision, not one
        // to make inside a bug fix.
        const currentFunding = windowData.currentFunding || 0;
        const fundingGoal = Number(windowData.fundingGoal ?? windowData.goal ?? 0);

        if (fundingGoal > 0 && currentFunding + investmentAmount > fundingGoal) {
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
            /**
             *   #429 THE STORED TITLE WAS THE COMMODITY, TWICE.
             *
             *   /export/windows/[id] calls this as
             *
             *       initializeInvestmentPaymentAction(
             *           windowId,
             *           windowData.commodity,   <- the windowTitle parameter
             *           investmentAmount,
             *           windowData.commodity,   <- the commodity parameter
             *           ...)
             *
             *   so every investment record ever written stored the commodity in
             *   both fields, and the Paystack description reads
             *   "Export Investment - <commodity>". Taken from the window here,
             *   with the caller's value ignored for the same reason as the ROI.
             */
            windowTitle: String(windowData.title ?? windowData.commodity ?? windowTitle ?? ""),
            commodity: String(windowData.commodity ?? commodity ?? ""),
            investorId: session.user.id,
            investorEmail: session.user.email,
            investorName: session.user.name || session.user.email,
            amount: investmentAmount,
            /**
             *   #429 THE EXPECTED RETURN WAS WHATEVER THE BROWSER SAID.
             *
             *   `expectedROI` and `windowTitle` are PARAMETERS. This is a
             *   "use server" export, so it is an independently addressable
             *   endpoint — the property that made autoEnrollPaidUser a
             *   paid-content bypass — and it stored
             *
             *       expectedReturn: investmentAmount * (1 + expectedROI / 100)
             *
             *   from a number the caller supplied, while holding `windowData`,
             *   the authoritative row, three lines above.
             *
             *   The MONEY was never at risk: the release
             *   (api/cron/release-escrow) pays amount * exportWindowReturnMultiplier
             *   read from the window, which is #324's fix. What was at risk is
             *   the figure the investor is SHOWN and the platform aggregates —
             *   the portfolio reads this field, and totalExpectedReturns is
             *   incremented by it. A record could promise a return the payout
             *   would never make, which is #113's and #324's own shape: the page
             *   advertising one figure and the payout computing another.
             *
             *   TWO DOORS, ONE HARDENED. _ex_investments.ts's fulfilment path
             *   already writes `amount * exportWindowReturnMultiplier(window)`.
             *   #324 corrected the payout and that sibling; this initiator was
             *   never adopted. Same helper on both now, so the stored
             *   expectation and the eventual payout use one rule.
             *
             *   The parameter is kept so existing callers compile and is
             *   deliberately ignored — /export/windows/[id] was already passing
             *   exportWindowRoiPercent(windowData.projectedROI), a
             *   window-derived value, so nothing legitimate changes.
             */
            expectedROI: (exportWindowReturnMultiplier(windowData) - 1) * 100,
            expectedReturn: investmentAmount * exportWindowReturnMultiplier(windowData),
            paymentReference: reference,
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() });

        // The authorization URL, returned.
        //
        // This returned `data: null` — discarding the very URL it had just asked
        // Paystack for. Its one caller, /export/windows/[id], reads
        // `result.data?.authorizationUrl` and shows "Failed to initialize
        // investment: No authorization URL" when it is missing, which is what
        // every investor saw on the rare path where the funding gate above did
        // not refuse them first. Two independent faults, either of which alone
        // made investing impossible.
        return { error: null, success: true as const,
            meta: null,
            data: { authorizationUrl, reference } };
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
        if (!isAmountAtLeast(amountInNaira, 50000, 10000000)) { return { error: "Invalid payment amount", success: false as const, meta: null };
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
