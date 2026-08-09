"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { initializePaystackPayment, verifyPaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimPaymentOnce, decrementManyOrFail } from "@/lib/wallet-ledger";
import { getPlatformFees } from "@/lib/system-settings";
import { rateLimit } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";
import { notifyOrderPlaced, notifyPaymentReceived } from "@/lib/marketplace-notifications";
import { withSafeAction } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import type { CartItem } from "@/lib/types/marketplace";
import type { ActionResponse } from "@/lib/safe-action";
import { createNotification } from "@/infrastructure/notifications/service";

const paymentLimiter = rateLimit(rateLimitConfig.payment);

// Helper function to convert Naira to Kobo (Paystack uses kobo)
function nairaToKobo(naira: number): number { 
    return Math.round(naira * 100); 
}

interface ValidatedItem { 
    productId: string;
    productTitle: string;
    sellerId: string;
    quantity: number;
    unit: string;
    pricePerUnit: number;
    totalPrice: number; 
    isFlashSale?: boolean;
    eventId?: string;
}

/**
 * Validate Cart Items against Database Prices
 * Returns the calculated subtotal and validated items list
 */
async function validateCartItems(clientItems: CartItem[]): Promise<{ subtotal: number; validatedItems: ValidatedItem[] }> {
    let subtotal = 0;
    const validatedItems = [];

    for (const item of clientItems) {
        const isFlashSale = item.isFlashSale === true;
        const col = isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
        const productDoc = await db.collection(col).doc(item.id).get();

        if (!productDoc.exists) {
            throw new Error(`Product not found: ${item.title}`);
        }

        const productData = productDoc.data();
        let dbPrice = 0;
        
        if (isFlashSale) {
            dbPrice = productData?.flashPrice || productData?.price || 0;
        } else {
            // Find correct price from database pricing tiers based on client selectedTier
            const selectedTierType = item.selectedTier || "retail";
            const matchedTier = productData?.pricingTiers?.find((t: any) => t.type === selectedTierType);
            dbPrice = matchedTier?.price 
                || productData?.pricingTiers?.[0]?.price 
                || productData?.price 
                || 0;
        }

        // Force DB price for security
        const effectivePrice = dbPrice;
        const itemTotal = effectivePrice * item.quantity;

        subtotal += itemTotal;
        validatedItems.push({ 
            productId: item.id,
            productTitle: productData?.title || item.title,
            sellerId: productData?.sellerId || item.sellerId, // Trust DB sellerId
            quantity: item.quantity,
            unit: item.unit,
            pricePerUnit: effectivePrice,
            totalPrice: itemTotal,
            isFlashSale: isFlashSale,
            eventId: productData?.eventId || undefined
        });
    }

    return { subtotal, validatedItems };
}

// Helper to estimate total weight of the cart items
function estimateCartWeight(items: CartItem[]): number {
    return items.reduce((total, item) => {
        const unit = (item.unit || "").toLowerCase().trim();
        let itemWeight = 1; // Default to 1kg per item unit if not specified
        if (unit === "kg") {
            itemWeight = 1;
        } else if (unit === "ton" || unit === "tonne" || unit === "tons" || unit === "tonnes") {
            itemWeight = 1000;
        } else if (unit.includes("50kg")) {
            itemWeight = 50;
        } else if (unit.includes("25kg")) {
            itemWeight = 25;
        } else if (unit.includes("10kg")) {
            itemWeight = 10;
        } else if (unit.includes("5kg")) {
            itemWeight = 5;
        } else if (unit.includes("bag")) {
            itemWeight = 50; // Standard bag weight in Nigeria
        }
        return total + (itemWeight * item.quantity);
    }, 0);
}

// Helper to calculate delivery fee server-side
function calculateDeliveryFee(items: CartItem[], location: any, _fees: any): number { 
    const isWithinCityCenter = location?.isWithinCityCenter !== false; // defaults to true
    const baseFee = isWithinCityCenter ? 2000 : 3000; // 2k flat rate for city center, 3k outside
    const distance = typeof location?.distance === "number" ? location.distance : 10; // default to 10KM (within flat rate)
    const weight = typeof location?.weight === "number" ? location.weight : estimateCartWeight(items); // default to estimated cart weight

    let fee = baseFee;

    // 1. Distance surcharge: 20 naira for every additional KM above 10KM
    if (distance > 10) {
        fee += (distance - 10) * 20;
    }

    // 2. Weight surcharge: 500 naira for every additional 5kg above 5kg
    if (weight > 5) {
        fee += Math.ceil((weight - 5) / 5) * 500;
    }

    return Math.round(fee); 
}

/**
 * Initialize Paystack Payment for Marketplace Order
 * Creates a payment session and returns authorization URL
 */
async function _initializeOrderPaymentAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number,
    location?: {
        recipientName?: string;
        recipientPhone?: string;
        street?: string;
        city?: string;
        state?: string;
        lga?: string;
        distance?: number;
        weight?: number;
        isWithinCityCenter?: boolean;
    }
): Promise<ActionResponse<{ authorizationUrl: string; reference: string }>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        if (deliveryFee < 0) { 
            return { error: "Invalid delivery fee", success: false as const, data: null };
        }

        const { subtotal, validatedItems } = await validateCartItems(cartItems);

        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, location || {}, fees);
        const totalAmount = subtotal + calculatedDeliveryFee;

        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false as const, data: null };
        }

        const baseUrl = await getBaseUrl();
        const callbackUrl = `${baseUrl}/marketplace/payment/callback`;

        const { authorizationUrl, reference } = await initializePaystackPayment(
            buyerEmail,
            nairaToKobo(totalAmount),
            {
                userId,
                buyerEmail,
                buyerPhone,
                itemCount: cartItems.length,
                subtotal,
                deliveryFee: calculatedDeliveryFee,
                totalAmount,
                type: "marketplace_order",
                callback_url: callbackUrl 
            },
            callbackUrl
        );

        const sellerIds = Array.from(new Set(validatedItems.map(item => item.sellerId)));

        const orderId = `ORD-${Date.now()}-${userId.substring(0, 8)}`;
        await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).set({ 
            sellerIds,
            sellerId: sellerIds[0] || "",
            orderId,
            buyerId: userId,
            buyerEmail,
            buyerPhone,
            items: validatedItems,
            productIds: validatedItems.map(i => i.productId),
            subtotal,
            deliveryFee: calculatedDeliveryFee,
            totalAmount,
            paymentReference: reference,
            paymentStatus: "pending",
            status: "pending_payment",
            deliveryAddress: {
                recipientName: location?.recipientName || "",
                recipientPhone: location?.recipientPhone || buyerPhone,
                street: location?.street || "",
                city: location?.city || "",
                state: location?.state || "",
                lga: location?.lga || "",
                distance: location?.distance || 10,
                weight: location?.weight || estimateCartWeight(cartItems),
                isWithinCityCenter: location?.isWithinCityCenter !== false
            },
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            _version: 0 
        });

        // Create Escrow Record for each seller with status: "pending"
        const sellerTotals: Record<string, number> = {};
        const uniqueSellers = Array.from(new Set(validatedItems.map((i: any) => i.sellerId))) as string[];
        const deliveryFeePerSeller = calculatedDeliveryFee / uniqueSellers.length;

        validatedItems.forEach((item: any) => { 
            const sellerId = item.sellerId;
            const itemTotal = item.pricePerUnit * item.quantity;
            sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + itemTotal;
        });

        uniqueSellers.forEach(sellerId => { 
            sellerTotals[sellerId] = (sellerTotals[sellerId] || 0) + deliveryFeePerSeller;
        });

        // Fetch seller emails
        const sellerDocs = await Promise.all(
            uniqueSellers.map(id => db.collection(COLLECTIONS.USERS).doc(id).get())
        );
        const sellerEmails: Record<string, string> = {};
        sellerDocs.forEach((doc, idx) => {
            if (doc.exists) {
                sellerEmails[uniqueSellers[idx]] = doc.data()?.email || "";
            }
        });
        
        // Fetch product descriptions
        const productIds = Array.from(new Set(validatedItems.map(item => item.productId)));
        const productDocs = await Promise.all(
            productIds.map(id => db.collection(COLLECTIONS.PRODUCTS).doc(id).get())
        );
        const productDetails: Record<string, { title: string; description: string }> = {};
        productDocs.forEach((doc, idx) => {
            if (doc.exists) {
                productDetails[productIds[idx]] = {
                    title: doc.data()?.title || "Unnamed Item",
                    description: doc.data()?.description || ""
                };
            }
        });

        for (const [sellerId, grossAmount] of Object.entries(sellerTotals)) {
            const escrowId = `ESC-${orderId}-${sellerId.substring(0, 5)}`;
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

            const platformFee = Math.round(grossAmount * fees.platformFeePercentage);
            const netAmount = grossAmount - platformFee;

            const pNames = validatedItems
                .filter(item => item.sellerId === sellerId)
                .map(item => productDetails[item.productId]?.title || item.productTitle || "Unnamed Item");
            const pDescriptions = validatedItems
                .filter(item => item.sellerId === sellerId)
                .map(item => productDetails[item.productId]?.description || "")
                .filter(Boolean);

            await escrowRef.set({ 
                id: escrowId,
                orderId: orderId,
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
                status: "pending",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 
            });
        }

        const primarySellerId = validatedItems[0]?.sellerId;
        if (primarySellerId) { 
            notifyOrderPlaced({
                buyerId: userId,
                sellerId: primarySellerId,
                orderId,
                orderNumber: orderId,
                amount: totalAmount 
            }).catch((e) => logger.error("[initializeOrderPaymentAction] Notification failed:", { userId, error: e }));
        }

        return { error: null, success: true as const, data: { authorizationUrl, reference } };
    } catch (error) { 
        logger.error("Order payment initialization error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
            cartCount: cartItems.length
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to initialize payment. Please try again.", data: null };
    }
}
export const initializeOrderPaymentAction = withSafeAction("initializeOrderPaymentAction", _initializeOrderPaymentAction);

/**
 * Verify Marketplace Order Payment
 * Updates order status after successful payment
 */
async function _verifyOrderPaymentAction(reference: string): Promise<ActionResponse<{ orderId: string; message: string }>> { 
    let sessionResult;
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
            // Find the order to return its ID to the UI
            const orderQuery = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("paymentReference", "==", reference)
                .limit(1)
                .get();
            const orderId = orderQuery.empty ? reference : orderQuery.docs[0].data()?.orderId || orderQuery.docs[0].id;
            logger.info(`[verifyOrderPaymentAction] Payment ${reference} already processed by webhook — returning success to client.`);
            return { error: null, success: true as const, data: { orderId, message: "Order payment successful!" } };
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
        const expectedAmount = metadata.totalAmount;

        // Verify user match
        if (paystackUserId !== userId) { 
            return { error: "Payment verification failed: User mismatch", success: false as const, data: null };
        }

        const fees = await getPlatformFees();
        if (amountInNaira < fees.minOrderAmount || amountInNaira > fees.maxOrderAmount) { 
            return { error: "Invalid payment amount", success: false as const, data: null };
        }

        // Verify amount matches metadata (allow 1 naira variance for rounding)
        if (expectedAmount && Math.abs(amountInNaira - expectedAmount) > 1) { 
            return { error: "Payment amount mismatch", success: false as const, data: null };
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

        if (!claim.claimed) {
            // The fast path above catches the common case, where the webhook
            // finished before the user was redirected back. This catches the
            // one it cannot: both arriving at once. Same answer to the user —
            // the order is live and they have been charged once.
            logger.info(`[Marketplace] Payment ${reference} already processed; order is live.`);
            return {
                error: null,
                success: true as const,
                data: {
                    orderId: orderData.orderId || orderDoc.id,
                    message: "Order payment successful!",
                },
            };
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

            // 5. Calculate Financial Split
            const sellerTotals: Record<string, number> = {};
            const deliveryFeePerSeller = orderData.deliveryFee / uniqueSellers.length;

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
                const escrowId = `ESC-${orderData.orderId}-${sellerId.substring(0, 5)}`;
                const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

                const platformFee = Math.round(grossAmount * fees.platformFeePercentage);
                const netAmount = grossAmount - platformFee;

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
        logger.error('[Payment Verification Error]', {
            userId: sessionResult?.session?.user?.id,
            action: 'verifyOrder',
            reference,
            error: error instanceof Error ? error.message : String(error)
        });

        return { success: false as const, error: "Failed to verify payment: " + (error instanceof Error ? error.message : "Unknown error"), data: null };
    }
}
export const verifyOrderPaymentAction = withSafeAction("verifyOrderPaymentAction", _verifyOrderPaymentAction);

/**
 * Create Marketplace Order with Bank Transfer Payment
 */
async function _createBankTransferOrderAction(
    cartItems: CartItem[],
    buyerEmail: string,
    buyerPhone: string,
    deliveryFee: number
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        if (deliveryFee < 0) { 
            return { error: "Invalid delivery fee", success: false as const, data: null };
        }

        const { subtotal, validatedItems } = await validateCartItems(cartItems);
        const fees = await getPlatformFees();
        const calculatedDeliveryFee = calculateDeliveryFee(cartItems, {}, fees);
        const totalAmount = subtotal + calculatedDeliveryFee;

        if (totalAmount < fees.minOrderAmount) {
            return { error: `Minimum order amount is ₦${fees.minOrderAmount}`, success: false as const, data: null };
        }

        const sellerIds = Array.from(new Set(validatedItems.map(item => item.sellerId)));
        const orderId = `ORD-${Date.now()}-${session.user.id.substring(0, 8)}`;
        const orderReference = `BT-${Date.now()}`;

        const lowStockProducts: { sellerId: string; title: string; qty: number; isFlashSale: boolean; id: string }[] = [];

        await db.runTransaction(async (transaction) => {
            for (const item of validatedItems) {
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const productDoc = await transaction.get(productRef);
                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty < item.quantity) {
                        throw new Error(`Insufficient stock for product ID: ${item.productId}`);
                    }
                } else {
                    throw new Error(`Product not found ID: ${item.productId}`);
                }
            }

            for (const item of validatedItems) { 
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const doc = await transaction.get(productRef);
                const currentQty = doc.data()?.availableQuantity || 0;
                const newQty = currentQty - item.quantity;

                transaction.update(productRef, {
                    availableQuantity: FieldValue.increment(-item.quantity),
                    orders: FieldValue.increment(1),
                    _version: FieldValue.increment(1) 
                });

                if (newQty <= 5) {
                    lowStockProducts.push({
                        sellerId: doc.data()?.sellerId || item.sellerId,
                        title: doc.data()?.title || item.productTitle,
                        qty: newQty,
                        isFlashSale: !!item.isFlashSale,
                        id: item.productId
                    });
                }
            }

            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
            transaction.set(orderRef, { 
                sellerIds,
                sellerId: sellerIds[0] || "",
                orderId,
                buyerId: session.user.id,
                buyerEmail,
                buyerPhone,
                items: validatedItems,
                productIds: validatedItems.map(i => i.productId),
                subtotal,
                deliveryFee: calculatedDeliveryFee,
                totalAmount,
                paymentMethod: "bank_transfer",
                paymentReference: orderReference,
                paymentStatus: "pending_verification",
                status: "processing",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 
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

        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("Bank transfer order creation error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create order. Please try again.", data: null };
    }
}
export const createBankTransferOrderAction = withSafeAction("createBankTransferOrderAction", _createBankTransferOrderAction);

/**
 * Calculate Delivery Fee (Server-Side)
 */
async function _calculateDeliveryAction(items: CartItem[], location?: any): Promise<ActionResponse<{ fee: number }>> { 
    console.log("[Server Actions] _calculateDeliveryAction called with location:", location);
    try {
        console.log("[Server Actions] Fetching platform fees...");
        const fees = await getPlatformFees();
        console.log("[Server Actions] Platform fees fetched:", fees);
        const fee = calculateDeliveryFee(items, location, fees);
        console.log("[Server Actions] Calculated fee:", fee);
        return { error: null, success: true as const, data: { fee } };
    } catch (error: any) { 
        logger.error("Calculate delivery fee error:", error);
        return { success: false as const, data: null, error: error.message };
    }
}
export const calculateDeliveryAction = withSafeAction("calculateDeliveryAction", _calculateDeliveryAction);

/**
 * Create a marketplace order with Payment on Delivery.
 */
async function _createPaymentOnDeliveryOrderAction(
    cartItems: CartItem[],
    buyerPhone: string,
    deliveryAddress: { 
        recipientName: string;
        recipientPhone: string;
        street: string;
        city: string;
        state: string;
        lga: string;
    }
): Promise<ActionResponse<null>> { 
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;

        const { subtotal, validatedItems } = await validateCartItems(cartItems);
        const fees = await getPlatformFees();
        const deliveryFee = calculateDeliveryFee(cartItems, deliveryAddress, fees);
        const totalAmount = subtotal + deliveryFee;

        if (totalAmount < fees.minOrderAmount) { 
            return { success: false as const, error: `Minimum order amount is ₦${fees.minOrderAmount}`, data: null };
        }

        const sellerIds = Array.from(new Set(validatedItems.map((i) => i.sellerId))) as string[];
        for (const sid of sellerIds) { 
            const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sid).get();
            if (!sellerDoc.data()?.allowsPaymentOnDelivery) {
                return { success: false as const, error: "One or more sellers in your cart do not offer Payment on Delivery", data: null };
            }
        }

        const orderId = `POD-${Date.now()}-${session.user.id.substring(0, 8)}`;

        const lowStockProducts: { sellerId: string; title: string; qty: number; isFlashSale: boolean; id: string }[] = [];

        await db.runTransaction(async (transaction) => {
            for (const item of validatedItems) {
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const productDoc = await transaction.get(productRef);
                if (productDoc.exists) {
                    const currentQty = productDoc.data()?.availableQuantity || 0;
                    if (currentQty < item.quantity) {
                        throw new Error(`Insufficient stock for product ID: ${item.productId}`);
                    }
                } else {
                    throw new Error(`Product not found ID: ${item.productId}`);
                }
            }

            for (const item of validatedItems) { 
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const doc = await transaction.get(productRef);
                const currentQty = doc.data()?.availableQuantity || 0;
                const newQty = currentQty - item.quantity;

                transaction.update(productRef, {
                    availableQuantity: FieldValue.increment(-item.quantity),
                    orders: FieldValue.increment(1),
                    _version: FieldValue.increment(1) 
                });

                if (newQty <= 5) {
                    lowStockProducts.push({
                        sellerId: doc.data()?.sellerId || item.sellerId,
                        title: doc.data()?.title || item.productTitle,
                        qty: newQty,
                        isFlashSale: !!item.isFlashSale,
                        id: item.productId
                    });
                }
            }

            const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
            transaction.set(orderRef, { 
                orderId,
                buyerId: session.user.id,
                buyerPhone,
                sellerIds,
                sellerId: sellerIds[0] || "",
                items: validatedItems,
                productIds: validatedItems.map((i) => i.productId),
                subtotal,
                deliveryFee,
                totalAmount,
                paymentMethod: "payment_on_delivery",
                paymentStatus: "pending",
                status: "processing",
                deliveryAddress,
                buyerConfirmed: false,
                reviewSubmitted: false,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 
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

        notifyOrderPlaced({ 
            buyerId: session.user.id,
            sellerId: sellerIds[0],
            orderId,
            orderNumber: orderId,
            amount: totalAmount 
        }).catch((e) => logger.error("[POD] Notification error:", e));

        revalidatePath("/marketplace/buyer/orders");
        return { error: null, success: true as const, data: null };
    } catch (error) { 
        logger.error("createPaymentOnDeliveryOrderAction error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create POD order", data: null };
    }
}
export const createPaymentOnDeliveryOrderAction = withSafeAction("createPaymentOnDeliveryOrderAction", _createPaymentOnDeliveryOrderAction);

