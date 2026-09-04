/**
 * Cart pricing, weight and delivery — the arithmetic behind a marketplace order.
 *
 * These four were private helpers in marketplace/_payment.ts, shared by four of
 * its five actions: initializeOrderPayment, createBankTransferOrder,
 * createPaymentOnDeliveryOrder and calculateDelivery.
 *
 * WHY THEY MOVED, AND WHY NOT INTO A "use server" FILE
 * ----------------------------------------------------
 * _payment.ts is a money path, and the file's actions are what the atomicity
 * work of #43-#58 concentrated on. Splitting the ACTIONS apart would have
 * separated callers from these helpers, and sharing them between the pieces
 * would have meant exporting them from a "use server" module — which publishes
 * them as endpoints.
 *
 * validateCartItems is the one that matters there: it reads each product from
 * the database and computes the subtotal from the STORED price, which is what
 * stops a client-supplied price being charged. As an endpoint it would be a
 * remote caller handing us a cart and receiving a priced order back, with the
 * validation it is named for happening inside the thing being bypassed.
 *
 * WHAT THIS IS NOT
 * ----------------
 * Not a rewrite. Every function body is unchanged, and _payment.ts imports them
 * rather than declaring them. The actions in that file — five of them, one 448
 * lines long — are deliberately left in one place: they share a payment
 * lifecycle, and splitting them further would separate steps of the same
 * transaction across files for the sake of a line count.
 *
 * These are now directly testable, which they were not while private to a
 * "use server" module.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { CartItem } from "@/lib/types/marketplace";
import { deliveryFeeFor, type DeliveryFees } from "@/lib/delivery-fee";

// Helper function to convert Naira to Kobo (Paystack uses kobo)
export function nairaToKobo(naira: number): number { 
    return Math.round(naira * 100); 
}


export interface ValidatedItem { 
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
export async function validateCartItems(clientItems: CartItem[]): Promise<{ subtotal: number; validatedItems: ValidatedItem[] }> {
    let subtotal = 0;
    const validatedItems = [];

    for (const item of clientItems) {
        const isFlashSale = item.isFlashSale === true;
        const col = isFlashSale ? COLLECTIONS.FLASH_SALE_PRODUCTS : COLLECTIONS.PRODUCTS;
        const productDoc = await db.collection(col).doc(item.id).get();

        if (!productDoc.exists) {
            throw new Error(`Product not found: ${item.title}`);
        }

        // Quantity comes from the client and was used raw.
        //
        // `itemTotal = effectivePrice * item.quantity` a few lines below, so a
        // negative quantity subtracts from the order. Mixed with a real item it
        // keeps the total above minOrderAmount while charging the buyer far less
        // than the goods are worth.
        //
        // It does not end in theft — decrementManyOrFail refuses a non-positive
        // amount, so verification throws at the stock step, AFTER the payment
        // reference is claimed. The buyer is charged, no escrow is written, no
        // order exists, and a retry is a no-op because the reference is spent.
        // A stuck payment needing a manual refund is still a defect.
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) {
            throw new Error(`Invalid quantity for ${item.title}`);
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

        // Taking the price from the database is not enough on its own — the
        // stored price also has to be a real one.
        //
        // Nothing that writes a price requires it to be positive:
        // PricingTierSchema is `price: z.number().default(0)`, and
        // addFlashSaleProductAction wrote `data.price` straight through. A
        // seller could list an item at a negative price, and unlike the quantity
        // case nothing downstream refuses it — the quantity stays positive so
        // the stock decrement succeeds, the order completes, and that seller's
        // escrow is created with a negative grossAmount while the other seller's
        // is whole. The buyer pays the reduced total; the platform still owes
        // the second seller in full.
        //
        // A zero price is refused for the same reason: an order line worth
        // nothing is either a mistake or a way to move stock without paying.
        if (!Number.isFinite(effectivePrice) || effectivePrice <= 0) {
            throw new Error(`Invalid price for ${productData?.title || item.title}`);
        }

        const itemTotal = effectivePrice * quantity;

        subtotal += itemTotal;
        validatedItems.push({ 
            productId: item.id,
            productTitle: productData?.title || item.title,
            sellerId: productData?.sellerId || item.sellerId, // Trust DB sellerId
            quantity,
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
export function estimateCartWeight(items: CartItem[]): number {
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


/**
 * The delivery fee for a cart, server-side.
 *
 *   #381 THIS TOOK THE CONFIGURED FEES AND THREW THEM AWAY.
 *
 *        The third parameter was `_fees: any` — accepted, underscore-prefixed
 *        so lint would not object, and never read. Every figure in the body was
 *        a literal: 2000 inside the city, 3000 outside, 20 per kilometre past
 *        10, 500 per 5kg past 5.
 *
 *        This is the rule the LIVE checkout uses (/marketplace/checkout calls
 *        calculateDeliveryAction, and the Paystack door calls it directly), so
 *        the platform's own delivery settings applied to nothing a buyer paid,
 *        while a second rule in actions/orders.ts charged a flat ₦2,500 from an
 *        action no screen calls.
 *
 *        The rule now lives once, in lib/delivery-fee.ts, and reads the fees it
 *        is handed. Its defaults are these exact literals, so nothing a buyer
 *        pays changed — see the note there and in system-settings.ts.
 */
export function calculateDeliveryFee(
    items: CartItem[],
    location: any,
    fees: DeliveryFees | null | undefined,
): number {
    const weight = typeof location?.weight === "number"
        ? location.weight
        : estimateCartWeight(items);

    return deliveryFeeFor(fees, location, items.length, weight);
}
