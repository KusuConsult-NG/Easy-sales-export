/**
 * Marketplace Notification Helpers
 *
 * Typed helper functions that fire in-app notifications for transaction
 * lifecycle events. Notifications go to:
 *   - The buyer (order placed, confirmed, shipped, delivered, cancelled)
 *   - The merchant/seller (new order, payment received, cancellation)
 *   - Admin users (every new order, for marketplace oversight)
 *
 * Admin notifications appear in the admin's in-app NotificationCenter,
 * using the same `notifications` Firestore collection as all other users.
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { logger } from "@/lib/logger";
import { COLLECTIONS } from "@/lib/types/firestore";
import { ESCROW_DELIVERED_AUTO_RELEASE_HOURS } from "@/lib/escrow-release-copy";

// ---------------------------------------------------------------------------
// Internal: write a single notification document
// ---------------------------------------------------------------------------

async function _writeNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    link?: string;
    linkText?: string;
}): Promise<void> {
    try {
        await db.collection(COLLECTIONS.NOTIFICATIONS).add({
            ...data,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
        });
    } catch (err) {
        logger.error("[marketplace-notifications] Failed to write notification:", err);
    }
}

// ---------------------------------------------------------------------------
// Internal: get all admin user UIDs to fan-out admin notifications
// ---------------------------------------------------------------------------

async function _getAdminUserIds(): Promise<string[]> {
    try {
        // Query users whose roles array contains 'marketplace_admin' or 'super_admin'
        const [adminSnap, superSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "marketplace_admin")
                .select() // fetch only doc IDs — no field data needed
                .get(),
            db.collection(COLLECTIONS.USERS)
                .where("roles", "array-contains", "super_admin")
                .select()
                .get(),
        ]);

        const ids = new Set<string>();
        adminSnap.docs.forEach((d) => ids.add(d.id));
        superSnap.docs.forEach((d) => ids.add(d.id));

        return Array.from(ids);
    } catch (err) {
        logger.error("[marketplace-notifications] Failed to fetch admin UIDs:", err);
        return [];
    }
}

// ---------------------------------------------------------------------------
// Internal: fan-out one notification to multiple users
// ---------------------------------------------------------------------------

async function _fanOut(
    userIds: string[],
    data: Omit<Parameters<typeof _writeNotification>[0], "userId">
): Promise<void> {
    if (userIds.length === 0) return;
    await Promise.allSettled(
        userIds.map((uid) => _writeNotification({ userId: uid, ...data }))
    );
}

// ===========================================================================
// Public notification helpers
// ===========================================================================

/**
 * Notify buyer + seller + all admins when a new order is placed.
 */
export async function notifyOrderPlaced(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    orderNumber: string;
    amount: number;
}): Promise<void> {
    const { buyerId, sellerId, orderId, orderNumber, amount } = params;
    const formatted = new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
    }).format(amount);

    const adminIds = await _getAdminUserIds();

    await Promise.allSettled([
        // → Buyer
        _writeNotification({
            userId: buyerId,
            type: "transaction",
            title: "Order Placed Successfully",
            message: `Your order #${orderNumber} for ${formatted} has been placed. Await seller confirmation.`,
            link: `/marketplace/buyer/orders/${orderId}`,
            linkText: "View Order",
        }),

        // → Seller / Merchant
        _writeNotification({
            userId: sellerId,
            type: "transaction",
            title: "New Order Received 🛒",
            message: `You have a new order #${orderNumber} worth ${formatted}. Please confirm and prepare for shipment.`,
            link: `/marketplace/seller/orders/${orderId}`,
            linkText: "View Order",
        }),

        // → All admin users (marketplace admin oversight)
        // _fanOut(adminIds, {
        //     type: "marketplace",
        //     title: `New Marketplace Order — #${orderNumber}`,
        //     message: `A new order worth ${formatted} has been placed on the marketplace.`,
        //     link: `/admin/marketplace/orders/${orderId}`,
        //     linkText: "Review Order",
        // }),
    ]);
}

/**
 * Notify buyer when payment has been verified and seller when they'll receive funds.
 */
export async function notifyPaymentReceived(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    orderNumber: string;
    amount: number;
    paymentMethod?: string;
}): Promise<void> {
    const { buyerId, sellerId, orderId, orderNumber, amount, paymentMethod } = params;
    const formatted = new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
    }).format(amount);

    const methodLabel =
        paymentMethod === "wallet"
            ? "Wallet"
            : paymentMethod === "payment_on_delivery"
                ? "Pay on Delivery"
                : "Escrow";

    await Promise.allSettled([
        _writeNotification({
            userId: buyerId,
            type: "payment",
            title: "Payment Confirmed ✅",
            message: `Payment of ${formatted} for order #${orderNumber} has been confirmed via ${methodLabel}.`,
            link: `/marketplace/buyer/orders/${orderId}`,
            linkText: "Track Order",
        }),
        _writeNotification({
            userId: sellerId,
            type: "payment",
            title: "Payment Received",
            message: `Payment of ${formatted} for order #${orderNumber} is secured. Funds will be released upon delivery confirmation.`,
            link: `/marketplace/seller/orders/${orderId}`,
            linkText: "View Order",
        }),
    ]);

    // Send external notifications (SMS and Push) to the seller
    try {
        const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(sellerId).get();
        const sellerPhone = sellerDoc.exists ? (sellerDoc.data()?.phone || sellerDoc.data()?.phoneNumber) : null;
        
        const smsPromises = [];
        if (sellerPhone) {
            const { sendSMS } = await import("@/lib/africastalking");
            // #266 NOT `formatted`. That is Intl currency formatting, which
            // emits the naira sign — right for the in-app notifications above,
            // which render HTML, and wrong here, where sendSMS puts the text
            // through a 7-bit gate that replaced it with "?". The seller was
            // told escrow was funded with "?45,000".
            const { formatNairaForSMS } = await import("@/lib/sms-utils");
            const smsMessage = `EasySales: Escrow is funded with ${formatNairaForSMS(amount)} for order #${orderNumber}. Please deliver the products. Log in for details.`;
            smsPromises.push(sendSMS(sellerPhone, smsMessage));
        }

        const { sendPushNotification } = await import("@/lib/fcm");
        const pushPromise = sendPushNotification(
            sellerId,
            "Escrow Funded 💰",
            `Escrow is funded with ${formatted} for order #${orderNumber}. Please deliver the products.`,
            `/marketplace/seller/orders/${orderId}`
        );

        await Promise.allSettled([...smsPromises, pushPromise]);
    } catch (err) {
        logger.error("[marketplace-notifications] Failed to send external notification to seller:", err);
    }
}

/**
 * Notify buyer when their order has been shipped.
 */
export async function notifyOrderShipped(params: {
    buyerId: string;
    orderId: string;
    orderNumber: string;
    trackingNumber?: string;
}): Promise<void> {
    const { buyerId, orderId, orderNumber, trackingNumber } = params;
    const trackingNote = trackingNumber ? ` Tracking number: ${trackingNumber}.` : "";
    await _writeNotification({
        userId: buyerId,
        type: "transaction",
        title: "Your Order Has Been Shipped 🚚",
        message: `Order #${orderNumber} is on its way!${trackingNote}`,
        link: `/marketplace/buyer/orders/${orderId}`,
        linkText: "Track Order",
    });
}

/**
 * Notify buyer + seller + admins when an order is marked delivered.
 *
 * #390. THIS HAS NO CALLER. Nothing in the app sends an order-delivered
 * notification, so neither message below has ever reached anybody. Both said
 * the buyer's confirmation is what releases the money, which is not how the
 * release works — the escrow is paid out automatically a fixed window after
 * reaching "delivered", and confirming is what puts it there. The copy is
 * corrected rather than left as it was, because the function is named exactly
 * what somebody wiring this up would reach for, and they would have shipped
 * the falsehood with it. That it is unreachable is recorded here rather than
 * fixed: wiring a notification is a product decision, not an audit repair.
 */
export async function notifyOrderDelivered(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    orderNumber: string;
}): Promise<void> {
    const { buyerId, sellerId, orderId, orderNumber } = params;
    const adminIds = await _getAdminUserIds();

    await Promise.allSettled([
        _writeNotification({
            userId: buyerId,
            type: "transaction",
            title: "Order Delivered 📦",
            message: `Order #${orderNumber} has been delivered. Confirm receipt if it arrived — payment reaches the seller ${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after you confirm, so open a dispute before then if anything is wrong.`,
            link: `/marketplace/buyer/orders/${orderId}`,
            linkText: "Confirm Delivery",
        }),
        _writeNotification({
            userId: sellerId,
            type: "transaction",
            title: "Order Marked as Delivered",
            message: `Order #${orderNumber} has been marked delivered. Payment is released to your wallet ${ESCROW_DELIVERED_AUTO_RELEASE_HOURS} hours after the buyer confirms receipt, unless a dispute is opened.`,
            link: `/marketplace/seller/orders/${orderId}`,
            linkText: "View Order",
        }),
        // _fanOut(adminIds, {
        //     type: "marketplace",
        //     title: `Order Delivered — #${orderNumber}`,
        //     message: `Order #${orderNumber} has been delivered. Awaiting buyer confirmation.`,
        //     link: `/admin/marketplace/orders/${orderId}`,
        //     linkText: "View Order",
        // }),
    ]);
}

/**
 * Notify buyer + seller + admins when an order is cancelled.
 */
export async function notifyOrderCancelled(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    orderNumber: string;
    reason?: string;
    cancelledBy?: "buyer" | "seller" | "admin";
}): Promise<void> {
    const { buyerId, sellerId, orderId, orderNumber, reason, cancelledBy } = params;
    const adminIds = await _getAdminUserIds();
    const reasonNote = reason ? ` Reason: ${reason}` : "";
    const byLabel = cancelledBy ? ` (cancelled by ${cancelledBy})` : "";

    await Promise.allSettled([
        _writeNotification({
            userId: buyerId,
            type: "transaction",
            title: "Order Cancelled",
            message: `Order #${orderNumber} has been cancelled.${reasonNote}${byLabel}`,
            link: `/marketplace/buyer/orders/${orderId}`,
            linkText: "View Order",
        }),
        _writeNotification({
            userId: sellerId,
            type: "transaction",
            title: "Order Cancelled",
            message: `Order #${orderNumber} has been cancelled.${reasonNote}`,
            link: `/marketplace/seller/orders/${orderId}`,
            linkText: "View Order",
        }),
        // _fanOut(adminIds, {
        //     type: "marketplace",
        //     title: `Order Cancelled — #${orderNumber}`,
        //     message: `Order #${orderNumber} was cancelled.${reasonNote}${byLabel}`,
        //     link: `/admin/marketplace/orders/${orderId}`,
        //     linkText: "View Order",
        // }),
    ]);
}

/**
 * Notify buyer when escrow funds are released to the seller.
 * Signals the final completion of a transaction.
 */
export async function notifyEscrowReleased(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    orderNumber: string;
    amount: number;
}): Promise<void> {
    const { buyerId, sellerId, orderId, orderNumber, amount } = params;
    const formatted = new Intl.NumberFormat("en-NG", {
        style: "currency",
        currency: "NGN",
        maximumFractionDigits: 0,
    }).format(amount);

    await Promise.allSettled([
        _writeNotification({
            userId: buyerId,
            type: "escrow",
            title: "Transaction Complete ✅",
            message: `Your escrow for order #${orderNumber} has been released. Transaction complete.`,
            link: `/marketplace/buyer/orders/${orderId}`,
            linkText: "View Summary",
        }),
        _writeNotification({
            userId: sellerId,
            type: "payment",
            title: `Payment Released — ${formatted} 🎉`,
            message: `Escrow funds of ${formatted} for order #${orderNumber} have been released to your account.`,
            link: `/marketplace/seller/orders/${orderId}`,
            linkText: "View Order",
        }),
    ]);
}

/**
 * Notify buyer + seller + admins when a new Village Market event is created.
 */
export async function notifyVillageMarketCreated(params: {
    eventId: string;
    eventTitle: string;
    sellerIds?: string[];
    startTime: Date;
}): Promise<void> {
    const { eventId, eventTitle, sellerIds = [], startTime } = params;
    const adminIds = await _getAdminUserIds();
    const dateStr = startTime.toLocaleDateString("en-NG", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
    });

    await Promise.allSettled([
        _fanOut(sellerIds, {
            type: "marketplace",
            title: `Village Market: ${eventTitle}`,
            message: `A new Village Market event has been scheduled for ${dateStr}. Join now to list your products!`,
            link: `/marketplace/village-market/${eventId}`,
            linkText: "View Event",
        }),
        // _fanOut(adminIds, {
        //     type: "marketplace",
        //     title: `Village Market Created — ${eventTitle}`,
        //     message: `Event scheduled for ${dateStr}.`,
        //     link: `/admin/marketplace/village-market/${eventId}`,
        //     linkText: "Manage Event",
        // }),
    ]);
}

/**
 * Notify a seller when the admin grants or revokes their Verified Badge.
 */
export async function notifyBadgeUpdated(params: {
    sellerId: string;
    granted: boolean;
}): Promise<void> {
    const { sellerId, granted } = params;
    await _writeNotification({
        userId: sellerId,
        type: "marketplace",
        title: granted ? "Verified Badge Granted ✅" : "Verified Badge Revoked",
        message: granted
            ? "Congratulations! Your seller account has been awarded a Verified Badge. It will now appear on all your product listings."
            : "Your Verified Badge has been revoked by an administrator. Contact support for more information.",
        link: "/marketplace/seller/dashboard",
        linkText: "View Dashboard",
    });
}
