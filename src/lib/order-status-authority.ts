/**
 *   #389 SECURITY: A SELLER COULD MARK THEIR OWN ORDER DELIVERED, AND BE PAID
 *        FOR IT TWENTY-FOUR HOURS LATER WITH NOBODY HAVING CONFIRMED ANYTHING.
 *
 *   HOW THE MONEY ACTUALLY LEAVES ESCROW
 *   ------------------------------------
 *   An order's escrow row is released to the seller by exactly one automatic
 *   path: api/cron/release-escrow's processDeliveredEscrowTransactions, which
 *   takes every ESCROW row that has been in status "delivered" for more than
 *   24 hours, claims it to "released", and credits the seller's wallet.
 *
 *   So "delivered" is not a display label. It is the START OF A PAYOUT TIMER.
 *
 *   WHO IS SUPPOSED TO START IT
 *   ---------------------------
 *   The BUYER. confirmOrderReceiptAction (actions/marketplace/_buyer.ts) is
 *   gated on `orderData.buyerId !== userId` and does exactly this: it claims
 *   the order to "delivered" and moves the live escrow row to "delivered".
 *   The whole escrow design rests on that — the buyer says the goods arrived,
 *   and the clock on the seller's money starts from the buyer's word.
 *
 *   WHO COULD ALSO START IT
 *   -----------------------
 *   The seller. _updateOrderStatusAction authorises
 *
 *       isUserAdmin || currentOrder.sellerId === userId || sellerIds.includes(userId)
 *
 *   and then accepted `newStatus` out of ["processing", "shipped",
 *   "delivered", "cancelled"] — one flat list for both kinds of caller. Its
 *   "delivered" branch stamps deliveredAt AND writes status "delivered" onto
 *   every escrow row for the order, which is precisely what the cron looks
 *   for. A seller calling it with "delivered" paid themselves 24 hours later,
 *   with no buyer confirmation and no admin release.
 *
 *   WHY NOBODY HAD HIT IT, AND WHY THAT IS NOT A DEFENCE
 *   ---------------------------------------------------
 *   No screen offers it. The seller order DETAIL page only ever calls
 *   handleStatusUpdate("shipped"); the seller order LIST page had a button
 *   captioned "Mark as Delivered" that was never wired to anything (#388) —
 *   the intention was there and the wiring is the only reason this had not
 *   run. But updateOrderStatusAction is an exported server action, and the
 *   detail page imports it, so its endpoint is served to every seller's
 *   browser. "No button calls it" is not a gate.
 *
 *   THE RULE, STATED ONCE
 *   ---------------------
 *   Fulfilment states a seller genuinely owns — processing, shipped, and
 *   cancelling their own order — stay with the seller. "delivered" is the
 *   buyer's word, taken through confirmOrderReceiptAction, or an admin
 *   overriding on the buyer's behalf. It is not the seller's to assert.
 *
 *   NOTHING IS REMOVED. The transition still exists and admins keep it, which
 *   is what a support agent needs when a buyer will not confirm a delivery
 *   that plainly happened.
 *
 *   This module is pure — no session, no database, no next/* import — so both
 *   the action and its tests can state the rule from the same place instead of
 *   from two lists that drift. That drift is what this audit has unpicked
 *   under #26, #38 and #26's four re-findings.
 */

import type { OrderStatus } from "@/lib/types/marketplace";

/**
 * The fulfilment states a SELLER may set on their own order.
 *
 * "delivered" is deliberately absent — see the header. "completed" is absent
 * too and always was: completion is claimed by the release paths, not typed
 * in by a party to the sale.
 */
export const SELLER_SETTABLE_ORDER_STATUSES = [
    "processing",
    "shipped",
    "cancelled",
] as const;

/**
 * The states only an admin may set.
 *
 * One entry today. It is a list rather than a special case so that the next
 * state somebody wants to put behind the same door is added here, and both the
 * action and the ratchet see it at once.
 */
export const ADMIN_ONLY_ORDER_STATUSES = ["delivered"] as const;

/** Everything updateOrderStatusAction will accept from anybody. */
export const SETTABLE_ORDER_STATUSES: readonly OrderStatus[] = [
    ...SELLER_SETTABLE_ORDER_STATUSES,
    ...ADMIN_ONLY_ORDER_STATUSES,
] as readonly OrderStatus[];

/** May this caller set this status through updateOrderStatusAction? */
export function canSetOrderStatus(
    status: string,
    caller: { isAdmin: boolean },
): boolean {
    if ((SELLER_SETTABLE_ORDER_STATUSES as readonly string[]).includes(status)) return true;
    if ((ADMIN_ONLY_ORDER_STATUSES as readonly string[]).includes(status)) return caller.isAdmin;
    return false;
}

/**
 * What a seller is told when they reach for "delivered".
 *
 * It names the door that IS open to the buyer, rather than saying only "no" —
 * #322's rule: a refusal that does not say what to do instead reads to the
 * person on the screen as the button being broken.
 */
export const ORDER_STATUS_REFUSAL_FOR_SELLER =
    "Only the buyer can confirm delivery. Mark the order as shipped; the buyer "
    + "confirms receipt from their orders page, and support can confirm it for "
    + "them if they do not.";

/** What anybody is told when the status is not settable here at all. */
export function orderStatusRefusal(status: string, caller: { isAdmin: boolean }): string {
    if (!caller.isAdmin && (ADMIN_ONLY_ORDER_STATUSES as readonly string[]).includes(status)) {
        return ORDER_STATUS_REFUSAL_FOR_SELLER;
    }
    return `Order status cannot be set to '${status}' here`;
}
