"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { initializePaystackPayment } from "@/lib/paystack-server";
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { decrementManyOrFail } from "@/lib/wallet-ledger";
import { getPlatformFees } from "@/lib/system-settings";
import { platformFeeFor, sellerNetFor } from "@/lib/platform-fee";
import { notifyOrderPlaced } from "@/lib/marketplace-notifications";
import { withSafeAction } from "@/lib/safe-action";
import { getBaseUrl } from "@/lib/server-utils";
import type { CartItem } from "@/lib/types/marketplace";
import type { ActionResponse } from "@/lib/safe-action";
import { createNotification } from "@/infrastructure/notifications/service";
import { validateCartItems, calculateDeliveryFee, estimateCartWeight, nairaToKobo } from "@/lib/marketplace-cart";
import { escrowIdFor } from "@/lib/escrow-status";

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
            const escrowId = escrowIdFor(orderId, sellerId, Object.keys(sellerTotals));
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

            // #271 One split, computed once.
            const platformFee = platformFeeFor(grossAmount, fees.platformFeePercentage);
            const netAmount = sellerNetFor(grossAmount, fees.platformFeePercentage);

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

        // Reserve stock across every product in the order, atomically.
        //
        // The decrement below used to sit behind `if (currentQty < quantity)`
        // inside runTransaction, which takes no lock — so two DIFFERENT orders
        // for the last unit both passed and stock went negative. The Paystack
        // path in this same file was converted; these two order-creation paths
        // were classified as status-only transitions and left, but they move
        // real inventory. See docs/audit/integrity-sweep-2026-08-10.md (F5).
        //
        // All-or-nothing matters here: the per-item loop would leave the first
        // items decremented when the third turns out to be short. See migration
        // 015.
        const stock = await decrementManyOrFail(validatedItems.map((item: any) => ({
            collection: item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS,
            id: item.productId,
            field: "availableQuantity",
            amount: item.quantity,
        })));

        if (!stock.ok) {
            // Simpler than the Paystack path's equivalent: nothing has been
            // charged at this point, so the order is refused outright rather
            // than recorded as paid_awaiting_refund. Nothing was decremented
            // either — 015 is all-or-nothing.
            const shortItem = validatedItems.find((i: any) => i.productId === stock.failedId);
            return {
                success: false as const,
                error: stock.reason === "not_found"
                    ? "A product in your cart is no longer available"
                    : `Insufficient stock for ${shortItem?.productTitle ?? "a product in your cart"}`,
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            // Inventory is already decremented by the reservation above.
            //
            // Do NOT decrement here as well — keeping both would take stock
            // twice. These reads run after the reservation, so
            // availableQuantity is the post-decrement figure, which is what the
            // low-stock alert should report.
            for (const item of validatedItems) {
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const doc = await transaction.get(productRef);
                const remainingQty = doc.data()?.availableQuantity || 0;

                transaction.update(productRef, {
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

        // Reserve stock atomically, before the order exists. Same conversion as
        // the bank-transfer path above and the Paystack path earlier in this
        // file: the check-then-decrement this replaces took no lock, so two
        // different orders for the last unit both passed.
        const stock = await decrementManyOrFail(validatedItems.map((item: any) => ({
            collection: item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS,
            id: item.productId,
            field: "availableQuantity",
            amount: item.quantity,
        })));

        if (!stock.ok) {
            // Nothing charged on this path either — payment happens on
            // delivery — so refuse outright. 015 is all-or-nothing, so nothing
            // was decremented.
            const shortItem = validatedItems.find((i: any) => i.productId === stock.failedId);
            return {
                success: false as const,
                error: stock.reason === "not_found"
                    ? "A product in your cart is no longer available"
                    : `Insufficient stock for ${shortItem?.productTitle ?? "a product in your cart"}`,
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            // Inventory already decremented by the reservation above; do NOT
            // decrement again. The reads below run after it, so
            // availableQuantity is the post-decrement figure.
            for (const item of validatedItems) {
                const col = item.isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
                const productRef = db.collection(col).doc(item.productId);
                const doc = await transaction.get(productRef);
                const remainingQty = doc.data()?.availableQuantity || 0;

                transaction.update(productRef, {
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
