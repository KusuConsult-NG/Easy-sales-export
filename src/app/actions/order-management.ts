"use server";

import { auth } from "@/lib/auth";
import { filterByOwner, isOwnedBySession, ownedProfileIds } from "@/lib/owned-profile-ids";
import { isAnyOwnedBySession } from "@/lib/owned-profile-ids";
import { filterByOwnerInArray } from "@/lib/owned-profile-ids";
import { requireSession } from "@/lib/session-guard";
import { sellerNetFor } from "@/lib/platform-fee";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { hasSellerRole } from "@/lib/seller-approval";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { paystackPayout, payoutReference } from "@/lib/paystack-transfer";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { serializeDoc, serializeDocs, serializeOrder, serializeOrders, toMillis } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { waveCommission } from "@/lib/wave-commission";
import { getLogisticsProvider } from "@/lib/logistics";
import {
    missingShipmentFields,
    normaliseShipment,
    describeShipment,
    type ShipmentRecord,
} from "@/lib/shipment-record";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { ESCROW_RELEASABLE_FROM, pickOrderEscrow, escrowIdFor } from "@/lib/escrow-status";
import { hasReservedStock } from "@/lib/order-status";
import { canSetOrderStatus, orderStatusRefusal } from "@/lib/order-status-authority";
import { scopeOrderToSeller } from "@/lib/order-scope";
import { notifyOrderShipped, notifyOrderDelivered } from "@/lib/marketplace-notifications";
import { estimatedDeliveryFrom } from "@/lib/delivery-estimate";

/**
 * Get all orders for a seller
 */
async function _getSellerOrdersAction(filters?: { status?: OrderStatus; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();

        //   #885 Either spelling of the selling role. `marketplace_seller` is a
        //   first-class UserRole that canonicalRoles does not fold onto
        //   `seller`, so `hasRole(roles, "seller")` was false for its holder and
        //   this screen answered "Not authorized as seller" to a seller.
        if (!hasSellerRole(userData?.roles || [])) { return { success: false as const, error: "Not authorized as seller", data: null };
        }

        //   #904 (SELLER SIDE, THE REST) — the second door onto the seller's
        //   orders, widened with _mp_seller_dashboard's. Both branches, so a
        //   status filter cannot answer a narrower question than "All".
        const sellerIdsOwned = await ownedProfileIds(userId);

        let query: import("@/lib/supabase-db").SupabaseQuery = filterByOwnerInArray(
            db.collection(COLLECTIONS.MARKETPLACE_ORDERS), "sellerIds", sellerIdsOwned,
        ).orderBy("createdAt", "desc");

        if (filters?.status) { query = filterByOwnerInArray(
                db.collection(COLLECTIONS.MARKETPLACE_ORDERS), "sellerIds", sellerIdsOwned,
            )
                .where("status", "==", filters.status)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await query.get();
        /**
         *   #342 THE SECOND READER OF THE SAME SHARED DOCUMENT.
         *
         *        A marketplace order is ONE row holding every seller's line
         *        items and the whole basket's money; the escrow that pays each
         *        seller is a row per seller. This returned the whole document to
         *        any seller in `sellerIds` — another merchant's products, prices
         *        and quantities, and a total that is not this seller's.
         *
         *        Fixed at both readers of this name at once, through the shared
         *        rule in lib/order-scope.ts, because a fix that reaches one of a
         *        pair is the shape this audit keeps finding.
         *
         *        The BUYER's copy of the same action, below, is untouched: the
         *        whole basket is exactly what a buyer bought.
         */
        const orders = serializeOrders(snapshot.docs)
            .map((o) => scopeOrderToSeller(o as any, userId) as Order);

        return { error: null, success: true as const, data: { orders } };
    } catch (error) { logger.error("Get seller orders error:", { 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch orders", data: null };
    }
}
export const getSellerOrdersAction = withFlexibleSafeAction("getSellerOrdersAction", _getSellerOrdersAction);

/**
 * Update order status (seller only)
 */
async function _updateOrderStatusAction(
    orderId: string,
    newStatus: OrderStatus,
    trackingNumber?: string
,
    /**
     * How the goods are travelling — required when marking an order shipped.
     * See lib/shipment-record; the seller picks a carrier or a self delivery.
     */
    shipment?: unknown) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        //   The shipment the seller described is validated AFTER the
        //   authorisation check below, not here. Asked first, an unauthorised
        //   caller was answered "Say how this order is being delivered" —
        //   which is both the wrong refusal and a hint that the order exists
        //   and is theirs to ship.
        let shipmentRecord: ShipmentRecord | null = null;
        let finalTrackingNumber = trackingNumber;

        // Query associated escrow transactions if the status becomes delivered
        let escrowDocs: any[] = [];
        if (newStatus === "delivered") {
            const escrowQuery = await runQueryWithRetry(() => db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get());
            escrowDocs = escrowQuery.docs;
        }

        // Captured out of the block below so the notifications after it can name
        // the buyer and the order — #391.
        let notifyOrder: Order | null = null;

        await (async () => {
            const currentOrderDoc = await orderRef.get();
            if (!currentOrderDoc.exists) throw new Error("Order not found");
            const currentOrder = currentOrderDoc.data() as Order;
            notifyOrder = currentOrder;

            const isUserAdmin = hasRole(session.user.roles || [], "admin") || hasRole(session.user.roles || [], "super_admin");
            /*
             *   #904 (SELLER SIDE, THE REST) — an order can name ONE seller or
             *   SEVERAL, so this asks both fields, and each was a raw compare.
             *   isAnyOwnedBySession takes the whole set and tries every exact
             *   match before resolving anything, so a seller on either field
             *   still pays for no read.
             *
             *   The admin arm is untouched and still first.
             */
            const isAuthorized = isUserAdmin || await isAnyOwnedBySession(
                [currentOrder.sellerId, ...(Array.isArray(currentOrder.sellerIds) ? currentOrder.sellerIds : [])],
                userId,
            );
            if (!isAuthorized) {
                throw new Error("Not authorized to update this order");
            }

            /*
             *   A TRACKING NUMBER WAS INVENTED WHEN THE SELLER HAD NONE.
             *
             *     THE OWNER: "tracking should be realtime."
             *
             *   What stood here: if the status is "shipped" and no number was
             *   typed, ask the logistics provider for one. The only provider was
             *   MockLogisticsProvider, and its answer was
             *   `TRK-${Date.now()}-${Math.floor(Math.random() * 1000)}` — so the
             *   buyer was notified of a consignment number no carrier had ever
             *   issued, indistinguishable from a real one.
             *
             *   The seller now says how the goods are travelling, and that is what
             *   is stored and shown. See lib/shipment-record for the two shapes
             *   and why a self delivery is one of them.
             */
            if (newStatus === "shipped") {
                shipmentRecord = normaliseShipment(shipment);
                if (!shipmentRecord) {
                    //   THROWN, not returned, because this sits inside the
                    //   block whose errors the outer catch turns into a
                    //   refusal — the same way the authorisation guard three
                    //   lines above reports itself. A `return` here would be
                    //   returning from the wrong function.
                    const missing = missingShipmentFields(shipment);
                    throw new Error(missing[0]?.message ?? "Say how this order is being delivered.");
                }
            }

            //   Only a CARRIER shipment has one. A self delivery has a person and
            //   a phone instead, and leaving this undefined is what stops the
            //   buyer's screen printing an empty "Tracking:" line.
            finalTrackingNumber = shipmentRecord?.method === "carrier"
                ? shipmentRecord.trackingNumber
                : trackingNumber;

            // #389 SECURITY. This was one flat list —
            //
            //     ["processing", "shipped", "delivered", "cancelled"]
            //
            // — applied identically to a seller and to an admin. "delivered" is
            // not a label: the branch below writes it onto every escrow row for
            // the order, and api/cron/release-escrow pays the seller 24 hours
            // after an escrow row reaches that status. So a seller calling this
            // action with "delivered" started the timer on their own payout,
            // with no buyer confirmation and no admin release.
            //
            // The buyer's door is confirmOrderReceiptAction, gated on
            // `orderData.buyerId !== userId`. That is where "delivered" is
            // supposed to come from. See lib/order-status-authority.ts for the
            // whole measurement; the rule lives there so this file and its
            // tests read the same list.
            if (!canSetOrderStatus(newStatus, { isAdmin: isUserAdmin })) {
                throw new Error(orderStatusRefusal(newStatus, { isAdmin: isUserAdmin }));
            }

            const updateData: any = { status: newStatus,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (!currentOrder.sellerId && Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.length > 0) {
                updateData.sellerId = currentOrder.sellerIds[0];
            }

            if (finalTrackingNumber) updateData.trackingNumber = finalTrackingNumber;
            //   What the seller said, stored whole, because the buyer's panel
            //   branches on its method and a half-record would render blank.
            if (shipmentRecord) updateData.shipment = shipmentRecord;
            /**
             *   #493 THIS WROTE A PROMISE TO THE MINUTE.
             *
             *        `new Date()` carries the current time of day, so the
             *        estimate landed at whatever o'clock the seller pressed the
             *        button — and two of the three screens that read it print
             *        the hour. See lib/delivery-estimate.ts; the window is
             *        unchanged at seven days and is now named.
             */
            if (newStatus === "shipped") {
                updateData.estimatedDeliveryDate = estimatedDeliveryFrom();
                //   The moment the seller said so. Without it the buyer's
                //   timeline has no shipped event to show, which is how the
                //   invented journey came to be filling that space.
                updateData.shippedAt = FieldValue.serverTimestamp();
            }
            if (newStatus === "delivered") {
                updateData.deliveredAt = FieldValue.serverTimestamp();
                // Synchronize escrow transaction status to "delivered" so the auto-release cron picks it up
                for (const escrowDoc of escrowDocs) {
                    await escrowDoc.ref.update({
                        status: "delivered",
                        updatedAt: FieldValue.serverTimestamp()
                    });
                }
            }

            if (newStatus === "cancelled") {
                // `newStatus === "cancelled" && currentOrder.status !== "cancelled"`
                // was a check-then-write with no lock, and what followed it put
                // stock BACK. Two cancellations of one order both read a
                // non-cancelled status and both restocked, so the seller's
                // availableQuantity gained the order's quantity twice —
                // inventory conjured out of a double click — and `orders` was
                // decremented twice.
                //
                // Claimed from every status a live order can hold, so exactly
                // one caller restocks. "cancelled" is deliberately absent from
                // the list: an order already cancelled must not be restocked
                // again, which is the whole point.
                const cancelClaim = await claimStatusTransitionFromAny({
                    collection: COLLECTIONS.MARKETPLACE_ORDERS,
                    id: orderId,
                    fromAny: [
                        "pending_payment", "payment_received", "confirmed",
                        "processing", "shipped", "delivered", "disputed",
                    ],
                    to: "cancelled",
                    patch: {
                        updatedAt: new Date().toISOString(),
                        ...(finalTrackingNumber ? { trackingNumber: finalTrackingNumber } : {}),
                    },
                });

                if (!cancelClaim.claimed) {
                    throw new Error(cancelClaim.status === null
                        ? "Order not found"
                        : cancelClaim.status === "cancelled"
                            ? "This order has already been cancelled"
                            : `Order cannot be cancelled from status '${cancelClaim.status}'`);
                }

                // ONLY IF STOCK WAS EVER TAKEN.
                //
                // This claims from "pending_payment" among others, and an order
                // in that state has reserved nothing — the Paystack creator
                // writes it without touching availableQuantity and the
                // reservation happens at verification. Restocking it invented
                // inventory, and the `orders` counter is incremented at that
                // same verification, so decrementing it here drove the count
                // negative for an order that had never been counted.
                //
                // `currentOrder.status` is the status BEFORE the claim above;
                // TransitionResult.status is the status after it. See
                // hasReservedStock in lib/order-status.ts.
                const items = hasReservedStock(currentOrder.status) ? (currentOrder.items || []) : [];
                for (const item of items) {
                    const productRef = db.collection(COLLECTIONS.PRODUCTS).doc(item.productId);
                    await productRef.update({
                        availableQuantity: FieldValue.increment(item.quantity),
                        orders: FieldValue.increment(-1),
                        _version: FieldValue.increment(1) });
                }

                // The status is already written by the claim; only the fields
                // it could not carry remain.
                await orderRef.update({
                    _version: FieldValue.increment(1),
                    ...(updateData.sellerId ? { sellerId: updateData.sellerId } : {}),
                });
                return;
            }

            await orderRef.update(updateData);
        })();

        /**
         *   #391 THE TWO EVENTS A BUYER MOST WANTS TO HEAR ABOUT WERE THE TWO
         *        THIS ACTION DID NOT ANNOUNCE.
         *
         *        lib/marketplace-notifications.ts has carried notifyOrderShipped
         *        and notifyOrderDelivered since it was written, and NOTHING HAS
         *        EVER CALLED EITHER. This is the only door that sets either
         *        status, and it sent nothing at all — no in-app notification, no
         *        SMS, no push. A buyer's order shipped, a tracking number was
         *        created for it by the logistics provider three lines above, and
         *        the buyer was told none of it.
         *
         *        Delivered matters more since #389: reaching that status starts
         *        the clock on the seller's payout, and the buyer's window to
         *        dispute runs against it. Announcing it silently was the same
         *        defect as #390's copy — the product knowing something about
         *        somebody's money that it never told them.
         *
         *   FIRE AND FORGET, deliberately. The status change is committed above.
         *   A notification that cannot be written must not undo it, which is the
         *   pattern every other caller of this module already uses.
         */
        const notified = notifyOrder as Order | null;
        if (notified) {
            const orderNumber = (notified as any).orderNumber || orderId;
            const sellerOf = notified.sellerId
                || (Array.isArray(notified.sellerIds) ? notified.sellerIds[0] : undefined);

            // try/catch AND .catch: the second handles a rejected promise, the
            // first a synchronous throw from the call, which would otherwise
            // reach this function's outer catch and report a status change that
            // has already been written as a failure.
            try {
                if (newStatus === "shipped" && notified.buyerId) {
                    notifyOrderShipped({
                        buyerId: notified.buyerId,
                        orderId,
                        orderNumber,
                        trackingNumber: finalTrackingNumber,
                    })?.catch?.((e: unknown) => logger.error("[updateOrderStatusAction] Shipped notification failed:", { orderId, error: e }));
                }

                if (newStatus === "delivered" && notified.buyerId && sellerOf) {
                    notifyOrderDelivered({
                        buyerId: notified.buyerId,
                        sellerId: sellerOf,
                        orderId,
                        orderNumber,
                    })?.catch?.((e: unknown) => logger.error("[updateOrderStatusAction] Delivered notification failed:", { orderId, error: e }));
                }
            } catch (e) {
                logger.error("[updateOrderStatusAction] Notification threw:", { orderId, newStatus, error: e });
            }
        }

        return { error: null, success: true as const, data: { message: "Order status updated successfully" } };
    } catch (error) { logger.error("Update order status error:", { 
            orderId, 
            newStatus, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update order status"};
    }
}
export const updateOrderStatusAction = withFlexibleSafeAction("updateOrderStatusAction", _updateOrderStatusAction);

/**
 * Get all orders for a buyer
 */
async function _getBuyerOrdersAction(filters?: { status?: OrderStatus; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const userId = session.user.id;

        //   #904 (BUYER SIDE) — the other door onto the buyer's orders. It
        //   had to widen with _mp_buyer_dashboard or the same list would
        //   answer two ways depending on the route in.
        const buyerIds = await ownedProfileIds(userId);

        // Build query
        let query = filterByOwner(
            db.collection(COLLECTIONS.MARKETPLACE_ORDERS), "buyerId", buyerIds,
        ).orderBy("createdAt", "desc");

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = serializeOrders(snapshot.docs);

        return { error: null, success: true as const, data: { orders } };
    } catch (error) { logger.error("Get buyer orders error:", { 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch orders"};
    }
}
export const getBuyerOrdersAction = withFlexibleSafeAction("getBuyerOrdersAction", _getBuyerOrdersAction);

/**
 * Confirm delivery (buyer only)
 */
/**
 * DO NOT WIRE THIS UP. It implements a payout model that was rejected.
 *
 * It pays a seller by Paystack BANK TRANSFER for 97.5% of the order, withholding
 * a 2.5% platform commission, and credits WAVE earnings.
 *
 * The decision (2026-08-10) is that marketplace sellers are paid the FULL amount
 * as a WALLET credit. That is `releaseEscrowFunds`: reached from three admin
 * escrow pages, and it completes the order itself. Sellers then withdraw through
 * /dashboard/wallet, an admin approves, and Paystack pays out — so the money
 * still reaches a bank account, one step later and at 100%.
 *
 * This has had no caller for some time. It is kept rather than deleted because
 * it is the only implementation of commission-on-sale and of WAVE
 * earnings-on-sale, both of which the business may want built properly later.
 * Neither has ever run.
 *
 * The hazard is that this is an exported server action named exactly what a
 * "Confirm Delivery" button would reach for. Wiring it up would move sellers
 * onto a different payout model at a different amount, silently. It cannot
 * double-pay an escrow the admin already released — that is claimed — but it can
 * pay the wrong way on an escrow nobody has released yet.
 *
 * See docs/audit/marketplace-payout-2026-08-10.md.
 */
async function _confirmDeliveryAction(orderId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const userId = session.user.id;
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        // WHAT WAS WRONG HERE
        // -------------------
        // `if (currentOrder.status !== "delivered") throw` read the status and
        // the write below changed it — inside runTransaction, which takes no
        // lock. Everything this function does hangs off that check, and the
        // last of those things is a **Paystack transfer to the seller**, made
        // after the block returns.
        //
        // So a buyer double-clicking Confirm Delivery, or two tabs submitting
        // together, had both calls read "delivered" and both proceed: the
        // seller was PAID TWICE out of the business's money, credited twice in
        // WAVE earnings, and given two wallet_transactions rows. The escrow was
        // released twice for good measure.
        //
        // Same defect as the wallet withdrawal state machine, with the same
        // fix: the transition is claimed, so exactly one caller reaches the
        // payout.
        const currentOrderDoc = await orderRef.get();
        if (!currentOrderDoc.exists) throw new Error("Order not found");
        const currentOrder = currentOrderDoc.data() as Order;

        // Authorisation before the claim: a caller who may not confirm this
        // order must not be able to consume the transition.
        //   #904 (BUYER SIDE) — confirming delivery of an order placed on a
        //   superseded profile. Refusing here strands the order in `delivered`
        //   for ever, because only the buyer can make this transition.
        if (!await isOwnedBySession(currentOrder.buyerId, userId)) throw new Error("Unauthorized");

        const nowIso = new Date().toISOString();
        const confirmClaim = await claimStatusTransition({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: orderId,
            from: "delivered",
            to: "completed",
            patch: {
                buyerConfirmed: true,
                buyerConfirmedAt: nowIso,
                updatedAt: nowIso,
            },
        });

        if (!confirmClaim.claimed) {
            throw new Error(confirmClaim.status === null
                ? "Order not found"
                : confirmClaim.status === "completed"
                    ? "This order has already been confirmed"
                    : "Order must be delivered first");
        }

        // _version is bumped separately: the CAS patch is written as JSONB and
        // does not resolve FieldValue sentinels, so an increment placed inside
        // it would be stored as an object rather than applied.
        await orderRef.update({ _version: FieldValue.increment(1) });

        const result = await (async () => {
            const sellerId = currentOrder.sellerId || (Array.isArray(currentOrder.sellerIds) ? currentOrder.sellerIds[0] : undefined);
            if (!sellerId) throw new Error("Seller ID not found on order");

            const escrowId = escrowIdFor(orderId, sellerId, Array.isArray(currentOrder.sellerIds) ? currentOrder.sellerIds : [sellerId]);
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
            const escrowDoc = await escrowRef.get();

            // WHY THIS IS A CLAIM AND NOT AN UPDATE
            // -------------------------------------
            // Two different code paths release an escrow and pay the seller:
            // this one, and `releaseEscrowFunds`, which an admin triggers from
            // the escrow pages. They pay by different means — that one credits
            // the in-platform wallet, this one sends a real bank transfer — so
            // running both pays the seller twice out of two different pots.
            //
            // `releaseEscrowFunds` claims the transition. This did not: it read
            // `exists` and then wrote "released" blindly, so an escrow the admin
            // had already released would be released a second time and the
            // seller paid again. The order-level claim above does not help —
            // it guards a different row, so it stops this function running
            // twice but not the admin path having run first.
            //
            // Same fromAny list as `releaseEscrowFunds`, deliberately: the two
            // paths must agree on which states a release is valid from, or one
            // of them can pay out of a state the other refuses.
            let escrowAlreadyReleased = false;
            if (escrowDoc.exists) {
                const escrowClaim = await claimStatusTransitionFromAny({
                    collection: COLLECTIONS.ESCROW_TRANSACTIONS,
                    id: escrowId,
                    fromAny: [...ESCROW_RELEASABLE_FROM],
                    to: "released",
                    patch: { releasedBy: userId, releasedAt: new Date().toISOString() },
                });

                if (!escrowClaim.claimed) {
                    // Losing the claim means somebody else already released this
                    // escrow and the seller has been paid. The order still
                    // completes — that part is done and correct — but nothing
                    // below this point may move money again.
                    escrowAlreadyReleased = true;
                    logger.warn("Escrow already released; skipping seller payout", {
                        orderId, escrowId, escrowStatus: escrowClaim.status,
                    });
                }
            }

            const sellerRef = db.collection(COLLECTIONS.USERS).doc(sellerId);
            const sellerDoc = await sellerRef.get();
            const sellerData = sellerDoc.data();

            let sellerAmount = 0;
            let isWaveMember = false;
            const roles = (sellerData?.roles || []) as string[];
            if (roles.includes("wave_participant") || roles.includes("wave")) {
                isWaveMember = true;
            }

            // `escrowAlreadyReleased` gates both money movements below. Leaving
            // sellerAmount at 0 is what stops the Paystack transfer, since the
            // caller guards on `sellerAmount > 0`.
            if (!escrowAlreadyReleased && sellerData?.bankAccountNumber && sellerData?.bankCode) {
                /**
                 *   #254 THE PAYOUT WITHHELD 2.5%. THE ESCROW RECORDED 5%.
                 *
                 *        This was:
                 *
                 *            const platformCommissionRate = 0.025;
                 *            sellerAmount = Math.floor(
                 *                currentOrder.totalAmount * (1 - platformCommissionRate));
                 *
                 *        Both escrow creators — marketplace/_payment_orders.ts
                 *        and _payment_verify.ts — write
                 *        `platformFee = grossAmount * fees.platformFeePercentage`
                 *        and `netAmount = grossAmount - platformFee`, with that
                 *        percentage at 0.05. So for a 100,000 order the escrow
                 *        row says the platform took 5,000 and the seller is owed
                 *        95,000, and this paid 97,500. The platform collected
                 *        half what its own books recorded, every time.
                 *
                 *        AND THE BASE WAS WRONG. `totalAmount` is the WHOLE
                 *        order; the seller here is `sellerIds[0]` and the escrow
                 *        is per-seller. On a two-seller order the first seller
                 *        was paid for both sellers' items.
                 *
                 *        Paying the figure the escrow already holds fixes both,
                 *        and takes the rate out of this file's hands — a local
                 *        literal is what let it drift to 0.025.
                 *
                 * The fallback covers rows written before netAmount existed. It
                 * uses the CONFIGURED percentage rather than a literal, so the
                 * two paths still agree.
                 */
                const escrowData = escrowDoc.exists ? escrowDoc.data() : undefined;
                const recordedNet = Number(escrowData?.netAmount);

                if (Number.isFinite(recordedNet) && recordedNet > 0) {
                    //   #271 NOT Math.floor(recordedNet).
                    //
                    //        The escrow row is the authority on what the seller
                    //        is owed, and flooring it discards any kobo it
                    //        records. Harmless while every gross is a whole
                    //        naira and wrong the moment one is not —
                    //        initiateTransfer already converts to integer kobo,
                    //        so nothing downstream ever needed the floor.
                    sellerAmount = recordedNet;
                } else {
                    //   #271 THE COMMENT ABOVE CLAIMED THESE TWO PATHS AGREED.
                    //        THEY DID NOT.
                    //
                    //        This was `Math.floor(gross * (1 - pct))` while the
                    //        three escrow creators write
                    //        `gross - Math.round(gross * pct)`. Sharing the
                    //        PERCENTAGE was the fix that note describes, and it
                    //        was not enough: the two EXPRESSIONS are not the
                    //        same function.
                    //
                    //        Across every whole-naira gross from 500 to 20,000
                    //        at 5% they disagree on 8,775 of 19,501 values —
                    //        45% — always by exactly NGN 1 and always against
                    //        the seller. gross 1,002: the escrow row says 952,
                    //        this paid 951.
                    //
                    //        With f = frac(gross x rate) and 0 < f < 0.5,
                    //        Math.round rounds the fee down while Math.floor on
                    //        the complement rounds the net down too, so the
                    //        same naira is deducted twice.
                    const { getPlatformFees } = await import("@/lib/system-settings");
                    const fees = await getPlatformFees();
                    const gross = Number(escrowData?.grossAmount ?? currentOrder.totalAmount);
                    sellerAmount = sellerNetFor(gross, fees.platformFeePercentage);
                }
            }

            // PHASE 2: WAVE LEDGER SYNC (IF APPLICABLE)
            if (isWaveMember && !escrowAlreadyReleased) {
                // One commission rate for the whole platform (#253). This was a
                // local `0.05` with the comment "5% as per wave.ts" — a copy
                // admitting it was a copy — while wave/_wv_earnings.ts carried
                // its own literal for the figure it SHOWS the member. Two live
                // numbers that had to agree, kept in step by nobody.
                //   #270 AND ONE ROUNDING RULE TOO.
                //
                //        This was `Math.floor(totalAmount * waveCommissionRate)`
                //        — whole naira, rounded DOWN — while _wv_earnings.ts,
                //        the file that SHOWS her the figure, multiplied raw and
                //        unrounded. Both numbers appear on the same page, and
                //        they disagreed in the direction that matters: she was
                //        shown more than she could withdraw. Up to NGN 1 per
                //        sale, permanently, growing with every order.
                //
                //        #253 unified the rate across these two files and left
                //        the rounding in both, so they went on disagreeing
                //        about the same money by a different route.
                const { getWaveSettings } = await import("@/lib/system-settings");
                const { commissionRate: waveCommissionRate } = await getWaveSettings();
                const earningsAmount = waveCommission(currentOrder.totalAmount, waveCommissionRate);

                // Increment persistent balance on user doc
                await sellerRef.update({
                    'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(earningsAmount),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Create Wallet Transaction for the credit record.
                //
                // The id was `WAVE-CR-${orderId}-${Math.random()...}`, so every
                // call produced a different document and a retry could not
                // overwrite its own earlier row — it just added another. Derived
                // from the order id now, which is stable: one order, one credit
                // record, whatever happens above it.
                const txnId = `WAVE-CR-${orderId}`;
                const txnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(txnId);
                await txnRef.set({
                    walletId: sellerId,
                    userId: sellerId,
                    type: "credit",
                    module: "wave",
                    amount: earningsAmount,
                    description: `WAVE Earnings Credit - Order ${orderId}`,
                    status: "completed",
                    reference: orderId,
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: 0
                });
            }

            return { sellerAmount, sellerData, currentOrder };
        })();

        if (result.sellerAmount > 0) { try {
                const bankDetails = result.sellerData;
                if (!bankDetails?.bankAccountNumber || !bankDetails?.bankCode) {
                    throw new Error("Seller bank details are missing.");
                }
                const res = await paystackPayout(
                    {
                        accountNumber: bankDetails.bankAccountNumber,
                        bankCode: bankDetails.bankCode,
                        accountName: bankDetails.bankAccountName || (bankDetails as any).name || bankDetails.fullName || "" 
                    },
                    result.sellerAmount,
                    `Escrow release for order ${orderId}`,
                    // Stable across retries of THIS release (#249). An escrow is
                    // released once; the reference is what makes Paystack refuse
                    // a second transfer rather than honouring it.
                    payoutReference("ESCROW", orderId),
                    // #208 — the seller's stored record, so its resolution
                    // stamp is checked before their escrow is released.
                    bankDetails,
                );

                await orderRef.update({ escrowReleased: res.success,
                    escrowReleasedAt: res.success ? FieldValue.serverTimestamp() : null,
                    paystackTransferCode: res.transferCode || null,
                    sellerAmountPaid: result.sellerAmount,
                    escrowReleaseError: res.success ? null : res.error,
                    escrowPendingManualRelease: !res.success,
                    // A duplicate reference means the seller was already paid; an
                    // indeterminate failure means we cannot say. Either way a
                    // human has to check Paystack before anyone releases again,
                    // and "pending manual release" alone reads as "just do it".
                    escrowNeedsReconciliation: !!(res.duplicate || res.indeterminate),
                    _version: FieldValue.increment(1) });
            } catch (err) { logger.error("Payout side effect failed:", { userId, error: err });
                await orderRef.update({ escrowPendingManualRelease: true, _version: FieldValue.increment(1) });
            }
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Confirm delivery error:", { 
            orderId, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to confirm delivery", data: null };
    }
}
export const confirmDeliveryAction = withFlexibleSafeAction("confirmDeliveryAction", _confirmDeliveryAction);

/**
 * Get a single order by ID — seller view
 */
async function _getOrderDetailsAction(orderId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();

        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const data = orderDoc.data()!;
        const isAdmin = hasRole(session.user.roles || [], "admin") || hasRole(session.user.roles || [], "super_admin");

        //   #904 (SELLER SIDE, THE REST) — the same two-field question as the
        //   status path above, on the escrow door.
        const isAuthorized = await isAnyOwnedBySession(
            [data.sellerId, ...(Array.isArray(data.sellerIds) ? data.sellerIds : [])],
            session.user.id,
        );
        if (!isAuthorized && !isAdmin) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .get();

        // #443. Was `serializeDoc<Order>(...)` — a bare cast onto a type whose
        // `items: OrderItem[]` the document does not have to satisfy.
        const order = serializeOrder(orderDoc.id, orderDoc.data()) as any;
        if (!order.sellerId && Array.isArray(order.sellerIds) && order.sellerIds.length > 0) {
            order.sellerId = order.sellerIds[0];
        }

        if (!escrowQuery.empty) {
            // The active escrow, not whichever row came back first — see
            // pickOrderEscrow in lib/escrow-status.ts.
            order.escrowTransactionId = (pickOrderEscrow(escrowQuery.docs) ?? escrowQuery.docs[0]).id;
            order.escrowReleased = escrowQuery.docs.every(doc => doc.data().status === "released");
        } else {
            order.escrowTransactionId = null;
            order.escrowReleased = false;
        }

        return { error: null, success: true as const, data: { order } };
    } catch (error) { logger.error("Get order details error:", { 
            orderId, 
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error) 
        });
        return { success: false as const, error: "Failed to fetch order details", data: null };
    }
}
export const getOrderDetailsAction = withFlexibleSafeAction("getOrderDetailsAction", _getOrderDetailsAction);
export const getOrderByIdForSellerAction = getOrderDetailsAction;

/**
 * Get tracking updates for a shipment
 */
async function _getTrackingUpdatesAction(orderId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };
        const { session } = sessionResult;

        if (!orderId) {
            return { success: false as const, error: "Order id is required", data: null };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
        if (!orderDoc.exists) {
            return { success: false as const, error: "Order not found", data: null };
        }
        const order = orderDoc.data() as Order & { shipment?: ShipmentRecord };

        /*
         *   SCOPED TO THE TWO PEOPLE THE ORDER IS BETWEEN.
         *
         *   This used to take a TRACKING NUMBER and hand back a timeline for
         *   it, with no check that the caller had anything to do with the
         *   order — the mock made one up from the number, so there was nothing
         *   to leak. Reading the real order means saying who may read it.
         */
        const viewerId = session.user.id;
        const sellers: string[] = Array.isArray(order.sellerIds)
            ? order.sellerIds
            : (order.sellerId ? [order.sellerId] : []);
        /*
         *   THE TWO PEOPLE THE ORDER IS BETWEEN, and nobody else.
         *
         *   My first version added an admin branch reading
         *   `hasAdminPermission(session.user.roles, …)` — roles off the SESSION
         *   TOKEN. #532's ratchet refused it, and was right to: #356 recorded
         *   that class as a security defect, because a revoked admin keeps
         *   whatever the token says for as many hours as it has left.
         *
         *   Converting it to a live role read would have been the other answer,
         *   but nobody asked for admins to read a member's parcel timeline —
         *   I added it speculatively, and the admin order screens have their
         *   own readers. So the branch is gone rather than converted.
         */
        const mayRead = order.buyerId === viewerId || sellers.includes(viewerId);
        if (!mayRead) {
            return { success: false as const, error: "Order not found", data: null };
        }

        /*
         *   THE ORDER'S OWN EVENTS, which are the only ones that happened.
         *
         *   What stood here asked MockLogisticsProvider for a journey through
         *   "Sorting Facility" and "Regional Transit Hub", timestamped from
         *   this order's own dates, and the buyer's page drew it as carrier
         *   scans. Nothing ever left a warehouse.
         *
         *   These four are recorded by this action and by checkout as they
         *   happen, so each carries the real moment it was written. A stage
         *   that has not happened is absent rather than pending — an empty
         *   timeline entry is the same claim as an invented one.
         */
        const at = (value: unknown): string | null => {
            const ms = toMillis(value);
            return ms > 0 ? new Date(ms).toISOString() : null;
        };

        const events: Array<{ status: string; label: string; at: string; note?: string }> = [];
        const push = (status: string, label: string, when: string | null, note?: string) => {
            if (when) events.push({ status, label, at: when, ...(note ? { note } : {}) });
        };

        push("placed", "Order placed", at(order.createdAt));
        push("paid", "Payment received", at((order as { paidAt?: unknown }).paidAt));
        push(
            "shipped",
            "Shipped by the seller",
            at((order as { shippedAt?: unknown }).shippedAt),
            describeShipment(order.shipment) || undefined,
        );
        push("delivered", "Delivered", at((order as { deliveredAt?: unknown }).deliveredAt));

        events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

        return {
            error: null,
            success: true as const,
            data: {
                events,
                shipment: order.shipment ?? null,
                //   Null until a carrier is wired — see lib/logistics. The
                //   screen says "no carrier tracking" rather than drawing one.
                providerName: getLogisticsProvider()?.name ?? null,
            },
        };
    } catch (error) {
        logger.error("Get tracking updates error:", { orderId, error });
        return { success: false as const, error: "Failed to fetch tracking updates", data: null };
    }
}
export const getTrackingUpdatesAction = withFlexibleSafeAction("getTrackingUpdatesAction", _getTrackingUpdatesAction);
