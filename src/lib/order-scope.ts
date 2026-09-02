/**
 * What ONE seller may see, and is owed, on an order that belongs to several.
 *
 *   #342 A MARKETPLACE ORDER IS ONE DOCUMENT AND A BASKET IS MANY SELLERS.
 *
 *        Both order creators in marketplace/_payment_orders.ts write a single
 *        MARKETPLACE_ORDERS row per checkout:
 *
 *            sellerIds,                                  every seller in the basket
 *            items: validatedItems,                      every seller's line items
 *            subtotal, deliveryFee, totalAmount,         the whole basket
 *
 *        and then create a SEPARATE ESCROW ROW PER SELLER, because the money is
 *        per seller. Three readers on the seller side never made that
 *        distinction. Each queries
 *
 *            .where("sellerIds", "array-contains", userId)
 *
 *        which is correctly scoped — it returns only orders this seller is part
 *        of — and then hands back, or sums, the whole document.
 *
 *          marketplace/_mp_seller_dashboard.ts  getSellerOrdersAction
 *          order-management.ts                  getSellerOrdersAction
 *          marketplace/_mp_seller_dashboard.ts  getSellerAnalyticsAction
 *
 *        SCOPE IS NOT THE SAME QUESTION AS PAYLOAD. The duplicate-name sweep
 *        looked at this pair and wrote "both filter sellerIds array-contains
 *        session id" — true, and not the defect.
 *
 *        WHAT IT COST, ON THREE SCREENS
 *
 *          marketplace/seller/orders     `{order.items.map(i => i.productTitle)
 *                                        .join(", ")}` and
 *                                        `{order.items.length} Items` — another
 *                                        merchant's products, listed as this
 *                                        seller's, under "Please pack and ship
 *                                        the items."
 *          marketplace/seller/dashboard  `{order.items.length} items •
 *                                        {formatCurrency(order.totalAmount)}`
 *          the analytics tiles           totalSales and monthlyRevenue summed
 *                                        `orderAmount(data)` — the WHOLE
 *                                        basket, delivery fee included — over
 *                                        every order the seller appears in. The
 *                                        figure a seller judges their business
 *                                        by, and the one they compare against a
 *                                        payout computed from their escrow row.
 *
 *        The comment above that sum is careful about WHICH STATUSES count as
 *        revenue and never asks WHOSE money it is.
 *
 * THE SPLIT IS NOT INVENTED HERE
 * ------------------------------
 * _payment_orders.ts already computes what each seller is owed, to create their
 * escrow row:
 *
 *     const deliveryFeePerSeller = calculatedDeliveryFee / uniqueSellers.length;
 *     sellerTotals[sellerId] += item.pricePerUnit * item.quantity;   // their items
 *     sellerTotals[sellerId] += deliveryFeePerSeller;                // their share
 *
 * sellerOrderAmount reproduces exactly that, so a seller's dashboard total and
 * the escrow they are actually paid from agree. Getting this from the escrow
 * row instead would be authoritative but needs a query per order, and no escrow
 * row exists yet while an order is `pending_payment`.
 */

/** One line of a marketplace order. */
interface OrderItem {
    sellerId?: string;
    productId?: string;
    pricePerUnit?: unknown;
    quantity?: unknown;
    [key: string]: unknown;
}

interface ScopeableOrder {
    items?: OrderItem[];
    sellerIds?: string[];
    deliveryFee?: unknown;
    [key: string]: unknown;
}

const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/**
 * Whether this order's lines actually say which seller each belongs to.
 *
 * Orders written before `sellerId` was on every item — and any single-seller
 * order, where the distinction is empty — must keep behaving exactly as they
 * did. Scoping those to nothing would empty a seller's own order list, which is
 * a worse failure than the one being fixed.
 */
export function isMultiSellerOrder(order: ScopeableOrder | null | undefined): boolean {
    const sellers = new Set(
        (order?.items ?? [])
            .map((i) => i?.sellerId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
    );
    return sellers.size > 1;
}

/** The line items belonging to `sellerId`; every item on a single-seller order. */
export function sellerItems(
    order: ScopeableOrder | null | undefined,
    sellerId: string,
): OrderItem[] {
    const items = order?.items ?? [];
    if (!isMultiSellerOrder(order)) return items;
    return items.filter((i) => i?.sellerId === sellerId);
}

/**
 * What this seller is owed on this order, gross.
 *
 * Their items at the recorded unit price, plus an equal share of the delivery
 * fee — the same arithmetic _payment_orders.ts uses to size their escrow row.
 * The platform fee is NOT deducted here: this is the gross, which is what the
 * escrow holds and what the seller order screens show.
 */
export function sellerOrderAmount(
    order: ScopeableOrder | null | undefined,
    sellerId: string,
): number {
    if (!order) return 0;

    if (!isMultiSellerOrder(order)) {
        const total = num(order.totalAmount);
        return total > 0 ? total : 0;
    }

    const mine = sellerItems(order, sellerId);
    const goods = mine.reduce(
        (sum, i) => sum + num(i?.pricePerUnit) * num(i?.quantity),
        0,
    );

    const sellerCount = new Set(
        (order.items ?? [])
            .map((i) => i?.sellerId)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
    ).size;

    const deliveryShare = sellerCount > 0 ? num(order.deliveryFee) / sellerCount : 0;

    return goods + deliveryShare;
}

/**
 * The order as this seller may see it.
 *
 * Their lines, their money, and the buyer's delivery details — which they need,
 * and which are the buyer's dealings with them. What goes is the other
 * merchants' inventory, prices and identities.
 */
export function scopeOrderToSeller<T extends ScopeableOrder>(
    order: T,
    sellerId: string,
): T {
    if (!isMultiSellerOrder(order)) return order;

    const mine = sellerItems(order, sellerId);
    const subtotal = mine.reduce(
        (sum, i) => sum + num(i?.pricePerUnit) * num(i?.quantity),
        0,
    );
    const total = sellerOrderAmount(order, sellerId);

    return {
        ...order,
        items: mine,
        productIds: mine.map((i) => i?.productId).filter(Boolean),
        subtotal,
        // Their share, named the same way the row names the whole — a seller
        // reading `deliveryFee` on their own order means theirs.
        deliveryFee: Math.max(0, total - subtotal),
        totalAmount: total,
        // The other merchants are not this seller's business either.
        sellerIds: [sellerId],
        sellerId,
    } as T;
}
