/**
 * Marketplace order status, and which orders count as money.
 *
 * THE DEFECT
 * ----------
 * Two dashboards add up order amounts, and neither excluded orders that were
 * never paid for.
 *
 *   _mp_buyer_dashboard.ts   totalSpent = every order, summed. No status filter
 *                            at all. So a buyer's "Total Spent" included baskets
 *                            still at `pending_payment` and orders they had
 *                            CANCELLED.
 *
 *   _mp_seller_dashboard.ts  totalSales / monthlyRevenue / prevMonthRevenue,
 *                            excluding only `cancelled` and `disputed`. So a
 *                            seller's revenue — including the monthly figure
 *                            they judge their business by — counted unpaid
 *                            orders as income.
 *
 * Neither is a rounding problem. `pending_payment` is the status an order is
 * created in, before the buyer has been charged anything; an abandoned checkout
 * sits there forever and was being reported as revenue on one screen and as
 * spending on the other.
 *
 * AND A SILENT ZERO
 * -----------------
 * The buyer sum was `sum + o.totalAmount` with no coercion. One order missing
 * `totalAmount` makes the whole reduce NaN — and `formatCurrency(NaN)` returns
 * "₦0", so the figure did not look broken. It looked like nothing had been
 * spent. That is worse than an obvious error, and it is why the coercion is
 * here rather than at the call site.
 *
 * TWO QUESTIONS, NOT ONE
 * ----------------------
 * "Has the buyer paid this?" and "is this the seller's revenue?" differ on
 * exactly one status. A DISPUTED order has been paid by the buyer — their money
 * left — but it is not the seller's yet; it is in escrow pending a decision.
 * The seller dashboard already excluded it, correctly. Rather than force one
 * set, both are named, so a future reader can see that the difference is
 * deliberate.
 */

export const ORDER_STATUSES = [
    "pending_payment",
    "payment_received",
    "processing",
    "shipped",
    "delivered",
    "completed",
    "cancelled",
    "disputed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The buyer's money has left them.
 *
 * Includes "disputed": they paid, and whether they get it back is what the
 * dispute decides.
 */
export const ORDER_PAID_BY_BUYER: readonly OrderStatus[] = [
    "payment_received",
    "processing",
    "shipped",
    "delivered",
    "completed",
    "disputed",
];

/**
 * The seller may count this as revenue.
 *
 * Excludes "disputed" — that money is in escrow, not theirs — which is what the
 * seller dashboard already did.
 */
export const ORDER_COUNTS_AS_SELLER_REVENUE: readonly OrderStatus[] = [
    "payment_received",
    "processing",
    "shipped",
    "delivered",
    "completed",
];

/** Nothing has been charged. */
export const ORDER_UNPAID_STATUSES: readonly OrderStatus[] = ["pending_payment"];

/** Finished, one way or another. */
export const ORDER_TERMINAL_STATUSES: readonly OrderStatus[] = [
    "delivered",
    "completed",
    "cancelled",
];

/** Live: paid for and not yet finished. */
export const ORDER_ACTIVE_STATUSES: readonly OrderStatus[] = [
    "pending_payment",
    "payment_received",
    "processing",
    "shipped",
    "disputed",
];

/**
 * What a buyer may confirm receipt from.
 *
 * _confirmOrderReceiptAction's list was `["in_transit", "processing",
 * "shipped"]`. "in_transit" is an ESCROW status — no order ever holds it, so it
 * was a dead entry that read as though a fourth state were supported.
 */
export const ORDER_CONFIRMABLE_FROM: readonly OrderStatus[] = ["processing", "shipped"];

export function isPaidByBuyer(status: unknown): boolean {
    return ORDER_PAID_BY_BUYER.includes(String(status ?? "") as OrderStatus);
}

export function countsAsSellerRevenue(status: unknown): boolean {
    return ORDER_COUNTS_AS_SELLER_REVENUE.includes(String(status ?? "") as OrderStatus);
}

export function isActiveOrderStatus(status: unknown): boolean {
    return ORDER_ACTIVE_STATUSES.includes(String(status ?? "") as OrderStatus);
}

/**
 * An order's amount as a number, or 0.
 *
 * The coercion lives here so no caller can forget it and get a silent ₦0 for a
 * whole dashboard.
 */
export function orderAmount(order: { totalAmount?: unknown } | null | undefined): number {
    const n = Number(order?.totalAmount);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Sums the orders matching a predicate, coercing each amount. */
export function sumOrders<T extends { status?: unknown; totalAmount?: unknown }>(
    orders: readonly T[],
    matches: (status: unknown) => boolean,
): number {
    return orders.reduce((sum, o) => (matches(o?.status) ? sum + orderAmount(o) : sum), 0);
}
