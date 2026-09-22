import type { CartItem } from "@/lib/types/marketplace";

/**
 * What the checkout sends the server for one cart line.
 *
 *   WHY THIS IS A FUNCTION AND NOT TWO OBJECT LITERALS.
 *
 *   The checkout page built `CartItem[]` twice — once to price delivery and
 *   once to take the payment — and both literals omitted `isFlashSale`.
 *
 *   Nothing caught it. `Product` does not declare the flag, so inside the
 *   checkout it was invisible to TypeScript even though add-to-cart had
 *   written it; and `CartItem.isFlashSale` is optional, so leaving it out is
 *   legal. `validateCartItems` picks the collection from that flag alone:
 *
 *       const col = item.isFlashSale === true
 *           ? COLLECTIONS.FLASH_SALE_PRODUCTS
 *           : COLLECTIONS.PRODUCTS;
 *
 *   so a village-market line was looked up in PRODUCTS, where its id does not
 *   exist, and the buyer was told "Product not found: <title>" about a listing
 *   that was there the whole time — in the other table.
 *
 *   One mapping now. A field added here reaches both doors or neither.
 */
export interface CheckoutCartLine {
    id: string;
    title: string;
    sellerId: string;
    unit: string;
    quantity: number;
    pricingTiers?: Array<{ type?: string; price?: number }>;
    isFlashSale?: boolean;
    eventId?: string;
    quoteId?: string;
}

export function toCartItems(lines: readonly CheckoutCartLine[]): CartItem[] {
    return lines.map(item => ({
        id: item.id,
        title: item.title,
        sellerId: item.sellerId,
        price: item.pricingTiers?.[0]?.price || 0,
        quantity: item.quantity,
        unit: item.unit,
        selectedTier: (item.pricingTiers?.[0]?.type || "retail") as CartItem["selectedTier"],
        addedAt: new Date(),
        //   The collection this line belongs to. Dropping it sends a
        //   village-market id to PRODUCTS, where it does not exist.
        ...(item.isFlashSale ? { isFlashSale: true } : {}),
        ...(item.eventId ? { eventId: item.eventId } : {}),
        //   #873 The id only. The server reads the quote, checks it is this
        //   buyer's, unspent and unexpired, and takes the seller's own agreed
        //   figure off the row — nothing here sets a price.
        ...(item.quoteId ? { quoteId: item.quoteId } : {}),
    }));
}
