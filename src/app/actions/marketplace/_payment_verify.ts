"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimPaymentOnce, decrementManyOrFail, markFulfilmentFailed } from "@/lib/wallet-ledger";
import { getPlatformFees } from "@/lib/system-settings";
import { platformFeeFor, sellerNetFor } from "@/lib/platform-fee";
import { checkOrderPaymentAmount } from "@/lib/order-payment-amount";
import { escrowIdFor } from "@/lib/escrow-status";
import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";
import { notifyPaymentReceived } from "@/lib/marketplace-notifications";
import { withSafeAction } from "@/lib/safe-action";
import type { ActionResponse } from "@/lib/safe-action";
import { createNotification } from "@/infrastructure/notifications/service";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

/**
 * Was this payment's order ACTUALLY fulfilled?
 *
 * Both early returns below used to look the order up and then ignore its
 * status. A payment whose fulfilment died part-way leaves a claimed
 * processed_payments row and an order still at `paymentStatus: "pending"` — and
 * the buyer retrying was told "Order payment successful!" while no escrow
 * existed and no seller had an order to ship.
 *
 * `pending` is the value _payment_orders.ts writes at placement. Anything else
 * — "escrow_held" from this path and from the webhook, or
 * "paid_awaiting_refund" from the out-of-stock branch — means a fulfilment path
 * ran and reached a decision. That is the same test the reconcile-fulfilment
 * cron applies to decide whether a marketplace payment produced an order, so
 * the two agree on what "fulfilled" means.
 */
async function findFulfilledOrder(reference: string): Promise<
    { fulfilled: true; orderId: string } | { fulfilled: false; orderId: string | null }
> {
    const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
        .where("paymentReference", "==", reference)
        .limit(1)
        .get();

    if (orderQuery.empty) return { fulfilled: false, orderId: null };

    const doc = orderQuery.docs[0];
    const data = doc.data() ?? {};
    const orderId = data.orderId || doc.id;

    return data.paymentStatus && data.paymentStatus !== "pending"
        ? { fulfilled: true, orderId }
        : { fulfilled: false, orderId };
}

/** What a buyer is told when their money was taken and nothing was delivered. */
const UNFULFILLED_MESSAGE =
    "Your payment went through but the order could not be completed. " +
    "Support has been alerted and will contact you — please do not pay again.";


/**
 * Verify Marketplace Order Payment
 * Updates order status after successful payment
 */
async function _verifyOrderPaymentAction(reference: string): Promise<ActionResponse<{ orderId: string; message: string }>> { 
    let sessionResult;
    // Whether THIS call took the payment. Everything after the claim is money
    // already collected, so a throw past this point is not an ordinary error —
    // see the catch.
    let claimedHere = false;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const rateLimitResult = await paymentLimiter.check(userId);
        if (!rateLimitResult.success) { 
            return { success: false as const, error: "Too many payment verification attempts. Please try again later.", data: null };
        }

        const processedRef = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).doc(reference);
        const existingPayment = await processedRef.get();

        // Fast path: the webhook usually finishes before the user is redirected
        // back, so return SUCCESS rather than an error — the order IS live, and
        // users used to see "Payment verification failed" after being charged.
        //
        // This is a read with no lock, so it cannot catch the two arriving at
        // once. claimPaymentOnce below is the actual gate; this only saves a
        // Paystack round trip in the common case.
        if (existingPayment.exists) {
            // Processed does NOT mean fulfilled.
            //
            // This returned success on the strength of the marker alone, having
            // looked the order up purely to report its id. A payment whose
            // fulfilment died part-way has the same marker and an order still at
            // "pending", so the buyer was told it worked.
            const settled = await findFulfilledOrder(reference);

            if (settled.fulfilled) {
                logger.info(`[verifyOrderPaymentAction] Payment ${reference} already processed by webhook — returning success to client.`);
                return { error: null, success: true as const, data: { orderId: settled.orderId, message: "Order payment successful!" } };
            }

            logger.error(
                `[Marketplace] Payment ${reference} is claimed but its order is not fulfilled ` +
                `(order ${settled.orderId ?? "not found"}). Money was taken and nothing was delivered.`
            );
            await markFulfilmentFailed(reference, "claimed payment with an unfulfilled order");
            return { error: UNFULFILLED_MESSAGE, success: false as const, data: null };
        }

        // Verify payment with Paystack
        const paymentData = await verifyPaystackPayment(reference);

        if (!paymentData.status || paymentData.data.status !== "success") {
            return {
                error: `Payment ${paymentData.data.status}. Please contact support if amount was debited.`,
                data: null,
                success: false as const 
            };
        }

        // Get metadata
        const metadata = paymentData.data.metadata as Record<string, any>;
        const paystackUserId = metadata.userId;
        const amountInNaira = paymentData.data.amount / 100;
        // `metadata.totalAmount` is deliberately no longer used to validate the
        // amount: it is the gateway's copy, and the ORDER's total is the record
        // the goods ship against. See order-payment-amount.ts.

        // Verify user match
        if (paystackUserId !== userId) { 
            return { error: "Payment verification failed: User mismatch", success: false as const, data: null };
        }

        // Find order record
        const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("paymentReference", "==", reference)
            .limit(1)
            .get();

        if (orderQuery.empty) { 
            return { error: "Order record not found", success: false as const, data: null };
        }

        const orderDoc = orderQuery.docs[0];
        const orderData = orderDoc.data();

        /**
         * The amount check, shared with the webhook path.
         *
         * WHAT THIS REPLACES, AND WHY
         * ---------------------------
         * Two checks used to sit ABOVE the order lookup:
         *
         *   1. `amountInNaira < fees.minOrderAmount || > fees.maxOrderAmount`
         *      Placement-time bounds, re-applied after the money was taken.
         *      minOrderAmount is already enforced in three places in
         *      _payment_orders.ts when the order is created, so re-checking here
         *      prevents nothing — and an admin changing the fee configuration
         *      between placement and payment turned a charged buyer's valid order
         *      into "Invalid payment amount".
         *
         *   2. `Math.abs(amountInNaira - expectedAmount) > 1` against
         *      `metadata.totalAmount` — the gateway's copy of the total, and a
         *      refusal in BOTH directions. processMarketplaceOrder, which the
         *      webhook and the reconciler use, compared against the ORDER's total
         *      and refused only underpayment. Same payment, two answers, decided
         *      by whichever path arrived first — and they race by design, as the
         *      fast-path comment above says.
         *
         * Worse, a payment refused here never reached claimPaymentOnce, so it had
         * no processed_payments row — and reconcile-paystack treats a Paystack
         * success with no row as missing and AUTO-HEALS it through
         * processMarketplaceOrder, fulfilling exactly what was just rejected.
         *
         * See order-payment-amount.ts for the rules and the reasoning behind each.
         */
        // Still fetched — `platformFeePercentage` is used to split the escrow
        // below. It is only the min/max ORDER BOUNDS that are no longer re-applied
        // after the money has been taken.
        const fees = await getPlatformFees();

        const amountVerdict = checkOrderPaymentAmount(amountInNaira, orderData.totalAmount);

        if (!amountVerdict.ok) {
            logger.error(
                `[Marketplace] Payment ${reference} refused on amount: ${amountVerdict.reason}. ` +
                `Paid ₦${amountInNaira}, order total ₦${orderData.totalAmount}. The buyer has been ` +
                `charged — this needs a refund.`
            );
            return { error: amountVerdict.message, success: false as const, data: null };
        }

        // Fetch buyer and seller emails first (outside transaction, to satisfy read-before-write)
        const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const buyerEmail = buyerDoc.exists ? buyerDoc.data()?.email || "" : (orderData.buyerEmail || "");

        const uniqueSellers = Array.from(new Set(orderData.items?.map((i: any) => i.sellerId) || [])) as string[];
        const sellerEmails: Record<string, string> = {};
        await Promise.all(
            uniqueSellers.map(async (sellerId) => {
                const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
                sellerEmails[sellerId] = sellerDoc.exists ? sellerDoc.data()?.email || "" : "";
            })
        );

        const lowStockProducts: { sellerId: string; title: string; qty: number; isFlashSale: boolean; id: string }[] = [];

        // Claim the payment before fulfilling the order.
        //
        // The check above reads processedRef outside any transaction, and the
        // marker is written inside it — so two callers both pass and both
        // fulfil: stock decremented twice, escrow created twice, seller credited
        // twice.
        //
        // This is not hypothetical here. The comment on that check says the
        // Paystack webhook "fires before user is redirected back", so the two
        // paths are known to overlap; only the sequential case was handled.
        const claim = await claimPaymentOnce({
            reference,
            userId,
            amount: amountInNaira,
            type: "marketplace_order",
            source: "order_verification",
            metadata: { orderId: orderDoc.id },
        });

        claimedHere = claim.claimed;

        if (!claim.claimed) {
            // The fast path above catches the common case, where the webhook
            // finished before the user was redirected back. This catches the
            // one it cannot: both arriving at once.
            //
            // Whether that other caller actually FINISHED is a different
            // question from whether it started, and this returned success on
            // the strength of the lost claim alone.
            const settled = await findFulfilledOrder(reference);

            if (settled.fulfilled) {
                logger.info(`[Marketplace] Payment ${reference} already processed; order is live.`);
                return {
                    error: null,
                    success: true as const,
                    data: {
                        orderId: settled.orderId,
                        message: "Order payment successful!",
                    },
                };
            }

            logger.error(
                `[Marketplace] Payment ${reference} was claimed by another caller that did not ` +
                `fulfil order ${orderDoc.id}. Money was taken and nothing was delivered.`
            );
            await markFulfilmentFailed(reference, "concurrent claim did not fulfil the order");
            return { error: UNFULFILLED_MESSAGE, success: false as const, data: null };
        }

        // Reserve stock across every product in the order, atomically.
        //
        // The decrement below used to sit behind `if (currentQty >= quantity)`
        // inside runTransaction, which takes no lock — so two DIFFERENT orders
        // for the last unit both passed and stock went negative. The claim above
        // only stops the SAME payment fulfilling twice; it cannot stop two
        // separate buyers racing.
        //
        // All-or-nothing matters here: a per-product loop would leave the first
        // items decremented when the third is short. See migration 015.
        const stockItems = (orderData.items || []).map((item: any) => ({
            collection: item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS,
            id: item.productId,
            field: "availableQuantity",
            amount: item.quantity,
        }));

        const stock = await decrementManyOrFail(stockItems);

        if (!stock.ok) {
            // The buyer has already paid — the claim above succeeded, so this is
            // real money with nothing to ship. Returning a bare error would lose
            // it: the payment reference is now claimed, so a retry takes the
            // "already processed" path above and tells the buyer the order is
            // live. Nothing decremented (015 is all-or-nothing), so the only
            // thing outstanding is the refund.
            //
            // Record it on the order so it is findable and refundable rather
            // than silent. This is the same gap the old in-transaction throw
            // had; it is fixed here because the early return makes it plain.
            const shortItem = (orderData.items || []).find((i: any) => i.productId === stock.failedId);

            logger.error(
                `[Marketplace] PAID BUT UNFULFILLABLE — order ${orderDoc.id}, reference ${reference}, ` +
                `₦${amountInNaira} taken, product ${stock.failedId} ${stock.reason}. Needs refund.`
            );

            await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id).update({
                paymentStatus: "paid_awaiting_refund",
                status: "cancelled_out_of_stock",
                paidAmount: amountInNaira,
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                refundReason: stock.reason === "not_found"
                    ? `Product ${stock.failedId} is no longer listed`
                    : `Insufficient stock for ${shortItem?.productTitle ?? stock.failedId}`,
                refundRequiredAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
            });

            return {
                error: stock.reason === "not_found"
                    ? "A product in this order is no longer available. You have been charged and a refund is being processed."
                    : `${shortItem?.productTitle ?? "A product"} sold out before your payment completed. You have been charged and a refund is being processed.`,
                success: false as const,
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => { 
            const items = orderData.items || [];

            // 1. All Reads First
            const productSnapshots: { ref: any; doc: any; item: any }[] = [];
            for (const item of items) {
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const doc = await transaction.get(productRef);
                productSnapshots.push({ ref: productRef, doc, item });
            }

            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(userId);
            const walletSnap = await transaction.get(walletRef);
            let currentBalance = 0;
            if (walletSnap.exists) {
                currentBalance = walletSnap.data()?.balance || 0;
            }

            // 2. Update order status -> escrow_held
            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderDoc.id);
            transaction.update(orderRef, {
                paymentStatus: "escrow_held",
                status: "processing",
                paymentVerifiedAt: FieldValue.serverTimestamp(),
                paidAmount: amountInNaira,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });

            // 3. (The processed_payments row is written by claimPaymentOnce
            //     above. Writing it here as well is what put the marker AFTER
            //     the fulfilment, so a duplicate could fulfil twice.)

            // 4. Inventory — already decremented by the reservation above.
            //
            // Do NOT decrement here as well. These reads ran after the
            // reservation, so availableQuantity is the post-decrement figure and
            // is what the low-stock alert should report. The check-then-write
            // that used to live here is exactly the race migration 015 removes.
            for (const { ref, doc, item } of productSnapshots) { 
                if (doc.exists) {
                    const remainingQty = doc.data()?.availableQuantity || 0;

                    transaction.update(ref, {
                        orders: FieldValue.increment(1),
                        _version: FieldValue.increment(1) 
                    });

                    if (remainingQty <= 5) {
                        lowStockProducts.push({
                            sellerId: doc.data()?.sellerId || item.sellerId,
                            title: doc.data()?.title || item.productTitle,
                            qty: remainingQty,
                            isFlashSale: !!item.isFlashSale,
                            id: item.productId
                        });
                    }
                }
            }

            /**
             *   #409 THE SPLIT COULD PRODUCE NaN, AND THE ESCROW WRITE BELOW
             *   HAD NOTHING TO STOP IT.
             *
             *   This was:
             *
             *       const deliveryFeePerSeller = orderData.deliveryFee / uniqueSellers.length;
             *
             *   `orderData.deliveryFee` is read off a stored order. An order
             *   written before the field existed, or by any path that omitted
             *   it, yields `undefined / n` — NaN. Every sellerTotal then becomes
             *   NaN, platformFeeFor and sellerNetFor propagate it, and the
             *   escrow rows below are written with amount, grossAmount,
             *   platformFee and netAmount all NaN. Nothing downstream tests for
             *   that: the release path reads the stored amount and pays it.
             *
             *   THE GUARD EXISTS — ON THE DOOR THAT WAS RETIRED. #398 shut down
             *   _escrow_lifecycle.ts because nothing ever called it, and its
             *   create begins `if (!Number.isFinite(data.amount) || data.amount
             *   <= 0)`. The dispute resolver has it too. The LIVE creation, the
             *   one every Paystack checkout goes through, did not. That is #112
             *   again — "the escrow amount check fails open when the amount is
             *   unreadable" — on the path that actually runs.
             *
             *   FAILING CLOSED, CAREFULLY. A missing delivery fee is treated as
             *   zero rather than as a reason to abort: the buyer has already
             *   paid at this point, and refusing here would leave a verified
             *   payment with no escrow at all, which is worse than a slightly
             *   understated fee. What must never happen is a NaN reaching the
             *   ledger, so the split is sanitised here and the amount is
             *   asserted at the write.
             */
            const sellerTotals: Record<string, number> = {};
            const storedDeliveryFee = Number(orderData.deliveryFee);
            const deliveryFeePerSeller = Number.isFinite(storedDeliveryFee) && uniqueSellers.length > 0
                ? storedDeliveryFee / uniqueSellers.length
                : 0;

            items.forEach((item: any) => { 
                const sellerId = item.sellerId;
                const itemTotal = item.pricePerUnit * item.quantity;
                sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + itemTotal;
            });

            uniqueSellers.forEach(sellerId => { 
                sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller;
            });

            // Create/Update Escrow Record for each seller to "funded"
            for (const [sellerId, grossAmount] of Object.entries(sellerTotals)) {
                /**
                 * #409. The same test _escrow_lifecycle.ts applies before it
                 * creates an escrow, now applied on the live path. Reaching this
                 * means an item price or quantity was unreadable, so the split
                 * cannot be trusted — and a transaction that throws is retryable
                 * and visible to the reconciliation jobs (#298/#299), whereas a
                 * NaN written here is money the release path will happily pay.
                 */
                if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
                    throw new Error(
                        `Refusing to create escrow for order ${orderData.orderId}, seller ${sellerId}: `
                        + `computed amount is ${String(grossAmount)}. The order's item prices or delivery `
                        + `fee are unreadable; no escrow row is written rather than one holding NaN.`
                    );
                }

                const escrowId = escrowIdFor(orderData.orderId, sellerId, Object.keys(sellerTotals));
                const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

                // #271 One split, computed once.
                const platformFee = platformFeeFor(grossAmount, fees.platformFeePercentage);
                const netAmount = sellerNetFor(grossAmount, fees.platformFeePercentage);

                const originalCreatedAt = orderData.createdAt || FieldValue.serverTimestamp();

                const pNames = productSnapshots
                    .filter(p => p.item.sellerId === sellerId)
                    .map(p => p.doc.data()?.title || p.item.productTitle || "Unnamed Item");
                const pDescriptions = productSnapshots
                    .filter(p => p.item.sellerId === sellerId)
                    .map(p => p.doc.data()?.description || "")
                    .filter(Boolean);

                transaction.set(escrowRef, { 
                    id: escrowId,
                    orderId: orderData.orderId,
                    buyerId: userId,
                    buyerEmail: buyerEmail,
                    sellerId: sellerId,
                    sellerEmail: sellerEmails[sellerId] || "",
                    participants: [userId, sellerId],
                    amount: grossAmount,
                    grossAmount: grossAmount,
                    platformFee: platformFee,
                    netAmount: netAmount,
                    productName: pNames.join(", ") || "Unnamed Item",
                    productDescription: pDescriptions.join("; ") || "",
                    status: "funded",
                    createdAt: originalCreatedAt,
                    updatedAt: FieldValue.serverTimestamp(),
                    paidAt: FieldValue.serverTimestamp(),
                    _version: 0 
                });
            }

            // 6. Log the direct Paystack payment in the payments collection
            const paymentId = `PAY-${orderData.orderId || orderDoc.id}`;
            const paymentRef = db.collection(COLLECTIONS.PAYMENTS).doc(paymentId);
            transaction.set(paymentRef, {
                id: paymentId,
                userId: userId,
                userEmail: buyerEmail,
                amount: amountInNaira,
                currency: "NGN",
                paymentReference: reference,
                status: "success",
                paymentMethod: "paystack",
                purpose: "escrow_payment",
                relatedId: orderData.orderId || orderDoc.id,
                initiatedAt: orderData.createdAt || FieldValue.serverTimestamp(),
                completedAt: FieldValue.serverTimestamp(),
                sellerId: orderData.sellerId || (uniqueSellers && uniqueSellers[0]) || "",
                sellerIds: orderData.sellerIds || uniqueSellers || [],
                participants: [userId, ...(orderData.sellerIds || uniqueSellers || [orderData.sellerId]).filter(Boolean)]
            });

            // 7. Log a balanced pair of transactions in wallet_transactions
            if (!walletSnap.exists) {
                transaction.set(walletRef, {
                    userId,
                    balance: 0,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                transaction.update(walletRef, {
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            const fundingTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();
            const purchaseTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc();

            // Funding txn (credit)
            transaction.set(fundingTxnRef, {
                id: fundingTxnRef.id,
                walletId: userId,
                userId,
                type: "funding",
                amount: amountInNaira,
                balanceBefore: currentBalance,
                balanceAfter: currentBalance + amountInNaira,
                reference: reference,
                description: `Wallet funded via Paystack (Direct Order Payment)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // Purchase txn (debit)
            transaction.set(purchaseTxnRef, {
                id: purchaseTxnRef.id,
                walletId: userId,
                userId,
                type: "purchase",
                amount: -amountInNaira,
                balanceBefore: currentBalance + amountInNaira,
                balanceAfter: currentBalance,
                orderId: orderData.orderId || orderDoc.id,
                description: `Marketplace purchase — Order`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 8. Global Ledger Record
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
            transaction.set(globalTxRef, {
                id: reference,
                userId: userId,
                type: "marketplace_order",
                module: "marketplace",
                amount: amountInNaira,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference,
                description: `Order #${orderData.orderId} - ${items.length} items`
            });
        });

        // Send low-stock warnings to sellers
        for (const p of lowStockProducts) {
            try {
                const message = p.qty === 0 
                    ? `Your product "${p.title}" is out of stock! Please restock soon.` 
                    : `Your product "${p.title}" is running out of stock! Only ${p.qty} units remaining.`;
                await createNotification({
                    userId: p.sellerId,
                    type: "warning",
                    title: p.qty === 0 ? "Out of Stock Alert" : "Low Stock Warning",
                    message,
                    link: p.isFlashSale ? `/marketplace/village-market` : `/marketplace/seller/products`,
                    linkText: "Manage Products"
                });
            } catch (err) {
                logger.error("Failed to send low stock notification:", err);
            }
        }

        revalidatePath("/dashboard");
        revalidatePath("/marketplace/buyer/orders");

        const uniqueSellerIds = Array.from(new Set(orderData.items?.map((i: any) => i.sellerId) || [])) as string[];
        const notifPromises = uniqueSellerIds.map(sellerId => 
            notifyPaymentReceived({ 
                buyerId: userId,
                sellerId: sellerId,
                orderId: orderData.orderId,
                orderNumber: orderData.orderId,
                amount: amountInNaira,
                paymentMethod: "escrow" 
            })
        );
        
        Promise.allSettled(notifPromises).catch((e) => logger.error("[verifyOrderPaymentAction] Notification failed:", { userId, error: e }));

        return {
            error: null,
            success: true as const,
            data: { orderId: orderData.orderId, message: "Order payment successful!" }
        };
    } catch (error) { 
        const message = error instanceof Error ? error.message : String(error);

        logger.error('[Payment Verification Error]', {
            userId: sessionResult?.session?.user?.id,
            action: 'verifyOrder',
            reference,
            error: message
        });

        // THE PAYMENT WAS TAKEN. RECORD THAT NOTHING WAS DELIVERED.
        //
        // Everything below the claim is one runTransaction the adapter does not
        // roll back — it queues the writes and flushes them one at a time — so a
        // throw part-way leaves the reference claimed as "completed", the stock
        // decremented, and the order possibly still at "pending" with no escrow
        // and no seller notified.
        //
        // This was the ONLY claimed-payment path in the codebase that did not
        // record that. The webhook service, export-payment, escrow-lifecycle,
        // cooperative/_payment, cooperative/_loans_repayments and
        // farm-nation-payment all call markFulfilmentFailed here; this one
        // logged a generic message and returned, leaving a row that says
        // "completed" for a payment that delivered nothing.
        //
        // Only when the claim was taken HERE. A throw before it — Paystack
        // unreachable, the order missing — took no money on this path and must
        // not mark somebody else's completed payment as failed.
        if (claimedHere) {
            await markFulfilmentFailed(reference, message);
            return { success: false as const, error: UNFULFILLED_MESSAGE, data: null };
        }

        return { success: false as const, error: "Failed to verify payment: " + message, data: null };
    }
}


export const verifyOrderPaymentAction = withSafeAction("verifyOrderPaymentAction", _verifyOrderPaymentAction);
