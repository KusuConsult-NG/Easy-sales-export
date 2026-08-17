"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Order, OrderStatus } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { paystackPayout } from "@/lib/paystack-transfer";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { getLogisticsProvider } from "@/lib/logistics";
import { runQueryWithRetry } from "@/lib/firestore-utils";
import { ESCROW_RELEASABLE_FROM, pickOrderEscrow } from "@/lib/escrow-status";

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

        if (!hasRole(userData?.roles || [], "seller")) { return { success: false as const, error: "Not authorized as seller", data: null };
        }

        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerIds", "array-contains", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) { query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
                .where("sellerIds", "array-contains", userId)
                .where("status", "==", filters.status)
                .orderBy("createdAt", "desc");
        }

        const snapshot = await query.get();
        const orders = serializeDocs<Order>(snapshot.docs);

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
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        let finalTrackingNumber = trackingNumber;
        if (newStatus === "shipped" && !finalTrackingNumber) {
            const orderDoc = await orderRef.get();
            if (orderDoc.exists) {
                const orderData = orderDoc.data() as Order;
                const provider = getLogisticsProvider();
                const shipment = await provider.createShipment({
                    orderId,
                    sellerId: orderData.sellerId || (Array.isArray(orderData.sellerIds) ? orderData.sellerIds[0] : undefined),
                    buyerId: orderData.buyerId,
                    destination: orderData.deliveryAddress?.city || "Destination",
                });
                finalTrackingNumber = shipment.trackingNumber;
            }
        }

        // Query associated escrow transactions if the status becomes delivered
        let escrowDocs: any[] = [];
        if (newStatus === "delivered") {
            const escrowQuery = await runQueryWithRetry(() => db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get());
            escrowDocs = escrowQuery.docs;
        }

        await (async () => {
            const currentOrderDoc = await orderRef.get();
            if (!currentOrderDoc.exists) throw new Error("Order not found");
            const currentOrder = currentOrderDoc.data() as Order;

            const isUserAdmin = hasRole(session.user.roles || [], "admin") || hasRole(session.user.roles || [], "super_admin");
            const isAuthorized = isUserAdmin || currentOrder.sellerId === userId || (Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.includes(userId));
            if (!isAuthorized) {
                throw new Error("Not authorized to update this order");
            }

            const allowedStatuses: OrderStatus[] = ["processing", "shipped", "delivered", "cancelled"];
            if (!allowedStatuses.includes(newStatus)) {
                throw new Error(`Sellers cannot set status to '${newStatus}'`);
            }

            const updateData: any = { status: newStatus,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (!currentOrder.sellerId && Array.isArray(currentOrder.sellerIds) && currentOrder.sellerIds.length > 0) {
                updateData.sellerId = currentOrder.sellerIds[0];
            }

            if (finalTrackingNumber) updateData.trackingNumber = finalTrackingNumber;
            if (newStatus === "shipped") { const estimatedDate = new Date();
                estimatedDate.setDate(estimatedDate.getDate() + 7);
                updateData.estimatedDeliveryDate = estimatedDate;
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

                const items = currentOrder.items || [];
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

        // Build query
        let query = db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc");

        if (filters?.status) { query = query.where("status", "==", filters.status);
        }

        const snapshot = await query.get();
        const orders = serializeDocs<Order>(snapshot.docs);

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
        if (currentOrder.buyerId !== userId) throw new Error("Unauthorized");

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

            const escrowId = `ESC-${orderId}-${sellerId.substring(0, 5)}`;
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
                const platformCommissionRate = 0.025;
                sellerAmount = Math.floor(currentOrder.totalAmount * (1 - platformCommissionRate));
            }

            // PHASE 2: WAVE LEDGER SYNC (IF APPLICABLE)
            if (isWaveMember && !escrowAlreadyReleased) {
                const waveCommissionRate = 0.05; // 5% as per wave.ts
                const earningsAmount = Math.floor(currentOrder.totalAmount * waveCommissionRate);

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
                    `Escrow release for order ${orderId}`
                );

                await orderRef.update({ escrowReleased: res.success,
                    escrowReleasedAt: res.success ? FieldValue.serverTimestamp() : null,
                    paystackTransferCode: res.transferCode || null,
                    sellerAmountPaid: result.sellerAmount,
                    escrowReleaseError: res.success ? null : res.error,
                    escrowPendingManualRelease: !res.success,
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

        const isAuthorized = data.sellerId === session.user.id || (Array.isArray(data.sellerIds) && data.sellerIds.includes(session.user.id));
        if (!isAuthorized && !isAdmin) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .get();

        const order = serializeDoc<Order>(orderDoc.id, orderDoc.data()) as any;
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
async function _getTrackingUpdatesAction(trackingNumber: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Authentication required", data: null };

        if (!trackingNumber) {
            return { success: false as const, error: "Tracking number is required", data: null };
        }

        const provider = getLogisticsProvider();
        const updates = await provider.trackShipment(trackingNumber);

        const { serializeValue } = await import("@/lib/firestore-serialize");
        const serializedUpdates = serializeValue(updates);

        return { error: null, success: true as const, data: { updates: serializedUpdates, providerName: provider.name } };
    } catch (error) {
        logger.error("Get tracking updates error:", { trackingNumber, error });
        return { success: false as const, error: "Failed to fetch tracking updates", data: null };
    }
}
export const getTrackingUpdatesAction = withFlexibleSafeAction("getTrackingUpdatesAction", _getTrackingUpdatesAction);
