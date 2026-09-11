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
import { isSellableProductStatus, isSellableFlashSaleStatus } from "@/lib/product-status";

/**
 * How many units this listing records, or null when nobody is counting.
 *
 *   #582's rule, in the module that did not get it. A missing field reads as
 *   zero everywhere downstream — `decrement_many_or_fail` cannot tell "no stock
 *   recorded" from "none left" — so treating absent as zero here would take
 *   every untracked listing off sale. Absent means UNTRACKED and is not
 *   refused; the atomic decrement still guards the race between two buyers.
 *
 *   Flash-sale rows are explicitly nullable: village-market stores
 *   `availableQuantity: null` when the seller leaves the field empty.
 */
function stockOf(productData: Record<string, any> | undefined): number | null {
    const raw = productData?.availableQuantity;
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

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

    /**
     *   #652 HOW MUCH OF EACH PRODUCT THIS CART ASKS FOR, ACROSS ALL ITS LINES.
     *
     *   #647's stock check compared each LINE against the stock, which is the
     *   same mistake decrement_many_or_fail was making one layer down: two
     *   lines of three against a stock of five passed twice, and six units left
     *   a shelf holding five.
     *
     *   Migration 035 is the real guard and it aggregates now, so the money is
     *   safe either way. This exists so the member is told BEFORE they are sent
     *   to Paystack, which is the whole point of #647's check — being refused
     *   at the reservation after paying is the outcome that costs a refund.
     *
     *   Keyed by collection as well as id, because a flash-sale row and a
     *   product row are different documents that may share an id.
     */
    const requested = new Map<string, number>();
    for (const item of clientItems) {
        const col = item.isFlashSale === true
            ? COLLECTIONS.FLASH_SALE_PRODUCTS
            : COLLECTIONS.PRODUCTS;
        const quantity = Number(item.quantity);
        if (!Number.isInteger(quantity) || quantity <= 0) continue;
        const key = `${col}:${item.id}`;
        requested.set(key, (requested.get(key) ?? 0) + quantity);
    }

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
        const productName = productData?.title || item.title;

        /**
         *   #647 MAY THIS BE SOLD? NOTHING ASKED.
         *
         *   This function reads the product document to take the price from it,
         *   and never looked at what state the listing was in. Four answers are
         *   written by live doors today: `suspended` and `rejected` by the admin
         *   review screen, `archived` by both of the seller's delete doors, and
         *   `removed` by a seller pulling a flash-sale item.
         *
         *   #624 made PRODUCT_VISIBLE_STATUSES decide what a buyer may SEE and
         *   fifteen catalogue queries ask it. No purchase door asked anything.
         *   The cart lives in localStorage and is never re-read against the
         *   database, and the product page serves any id whatever its status —
         *   so an admin pulling a counterfeit listing took it out of the browse
         *   results and left the shared link selling it.
         *
         *   AN ALLOW-LIST, not a list of bad states: `archived` and `removed`
         *   were both invented after the checks around this one were written,
         *   and a deny-list would have missed them exactly as this code did.
         *   A row with no status recorded is refused for the same reason — every
         *   catalogue query selects `status IN (...)`, so such a row has never
         *   been browsable, and what cannot be browsed cannot honestly be in a
         *   cart.
         *
         *   Flash-sale rows are a different collection with their own
         *   vocabulary, so they are asked their own question.
         */
        const sellable = isFlashSale
            ? isSellableFlashSaleStatus(productData?.status)
            : isSellableProductStatus(productData?.status);
        if (!sellable) {
            throw new Error(`${productName} is no longer available`);
        }

        /**
         *   #647 AND IS THERE ANY OF IT? REFUSED BEFORE THE CHARGE, NOT AFTER.
         *
         *   This is #582, in the module that did not get it. Its words there:
         *
         *       The only stock check on this path ran at FULFILMENT, after the
         *       payment reference was claimed — so a listing that really was
         *       short left the buyer charged, the order cancelled and a manual
         *       refund to arrange.
         *
         *   The marketplace's Paystack door reserved stock in _payment_verify,
         *   AFTER the money moved, and wrote `paid_awaiting_refund` when it came
         *   up short. Its message says the item "sold out before your payment
         *   completed", which describes a race — and nothing raced: the checkout
         *   stepper enforces a minimum and no maximum, so five hundred against
         *   three in stock went straight through to Paystack.
         *
         *   (The bank-transfer and pay-on-delivery doors reserve before they
         *   create anything, so they were already safe. The door that takes the
         *   money first was the one with no check.)
         *
         *   The atomic decrement still decides the real race between two buyers.
         *   This catches the ordinary case, where refusing costs nobody
         *   anything.
         */
        //   #652 — the WHOLE cart's demand for this product, not this line's.
        const wanted = requested.get(`${col}:${item.id}`) ?? quantity;
        const stock = stockOf(productData);
        if (stock !== null && wanted > stock) {
            throw new Error(
                stock <= 0
                    ? `${productName} is out of stock`
                    : `${productName} has only ${stock} ${item.unit || "units"} left`,
            );
        }

        let dbPrice = 0;

        if (isFlashSale) {
            dbPrice = productData?.flashPrice || productData?.price || 0;
        } else {
            // Find correct price from database pricing tiers based on client selectedTier
            const selectedTierType = item.selectedTier || "retail";
            const matchedTier = productData?.pricingTiers?.find((t: any) => t.type === selectedTierType);

            /**
             *   #571 THE TIER WAS TAKEN FROM THE CLIENT AND THE QUANTITY THAT
             *        EARNS IT WAS NEVER CHECKED.
             *
             *   The PRICE has come from the database since this function was
             *   written, which is why a buyer cannot name their own figure. But
             *   WHICH price is chosen by `item.selectedTier`, a client-supplied
             *   string, and a bulk or export tier is cheaper per unit precisely
             *   because it requires a minimum quantity. That minimum was never
             *   read.
             *
             *   So a request naming `selectedTier: "bulk"` with `quantity: 1`
             *   was charged the bulk unit price for a single unit. Every export
             *   of a "use server" module is a reachable endpoint whether the app
             *   calls it or not — this codebase already records that, in
             *   _enrollInWaveAction — so "the checkout never sends that" is not
             *   a control.
             *
             *   WHAT THE UI ACTUALLY SENDS, STATED SO THE SCOPE IS HONEST:
             *   /marketplace/checkout sends `pricingTiers[0].type` and the
             *   product page displays `pricingTiers[0].price`, so through the
             *   screens the tier charged is the tier shown, and a retail tier
             *   carries minQuantity 1 (the schema's default). Ordinary traffic
             *   is unaffected by this check. What it closes is the endpoint —
             *   and the case where a seller's first tier is a bulk one, where
             *   the discount was being given through the UI too.
             *
             *   A tier whose minimum is not met does not apply, and the order is
             *   REFUSED rather than silently repriced: charging a total the
             *   buyer was never shown is the outcome this audit spends most of
             *   its time removing.
             */
            if (matchedTier) {
                const minQuantity = Number(matchedTier.minQuantity);
                const required = Number.isFinite(minQuantity) && minQuantity > 0 ? minQuantity : 1;
                if (quantity < required) {
                    throw new Error(
                        `${productData?.title || item.title}: the ${selectedTierType} price applies from ${required} ${item.unit || "units"} upwards`,
                    );
                }
            }

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
