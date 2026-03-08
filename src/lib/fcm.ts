/**
 * Firebase Cloud Messaging — Server-Side Push Notification Sender
 *
 * Sends push notifications via FCM using Firebase Admin SDK.
 * Requires the user's FCM token to be stored in their user document
 * under the field `fcmToken`.
 */

import { getMessaging } from "firebase-admin/messaging";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

interface PushResult {
    success: boolean;
    messageId?: string;
    error?: string;
}

/**
 * Send a push notification to a specific user by UID.
 * Looks up their FCM token from Firestore.
 * Silently skips if the user has no token (they haven't opted in).
 */
export async function sendPushNotification(
    uid: string,
    title: string,
    body: string,
    link?: string
): Promise<PushResult> {
    try {
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
        const fcmToken: string | undefined = userDoc.data()?.fcmToken;

        if (!fcmToken) {
            // User hasn't registered for push — silent skip
            return { success: false, error: "No FCM token registered" };
        }

        const messaging = getMessaging();
        const messageId = await messaging.send({
            token: fcmToken,
            notification: { title, body },
            webpush: link
                ? {
                    notification: { title, body },
                    fcmOptions: { link },
                }
                : undefined,
        });

        logger.info(`[fcm] Push sent to uid=${uid} messageId=${messageId}`);
        return { success: true, messageId };
    } catch (err: unknown) {
        logger.error("[fcm] Push notification failed:", { uid, error: String(err) });
        return { success: false, error: String(err) };
    }
}

/**
 * Fan-out a push notification to multiple users.
 */
export async function sendPushToMany(
    uids: string[],
    title: string,
    body: string,
    link?: string
): Promise<void> {
    if (!uids.length) return;
    await Promise.allSettled(uids.map((uid) => sendPushNotification(uid, title, body, link)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Named helpers — called from server actions alongside email/SMS
// ─────────────────────────────────────────────────────────────────────────────

export async function pushOrderPlaced(buyerId: string, sellerId: string, orderNumber: string, orderId: string) {
    await Promise.allSettled([
        sendPushNotification(buyerId, "Order Placed ✅", `Your order #${orderNumber} is confirmed.`, `/marketplace/buyer/orders/${orderId}`),
        sendPushNotification(sellerId, "New Order 🛒", `You have a new order #${orderNumber}.`, `/marketplace/seller/orders/${orderId}`),
    ]);
}

export async function pushEscrowReleased(sellerId: string, orderNumber: string, amount: number, orderId: string) {
    const formatted = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
    return sendPushNotification(sellerId, `Payment Released 🎉`, `${formatted} released for order #${orderNumber}.`, `/marketplace/seller/orders/${orderId}`);
}

export async function pushWithdrawalDecision(userId: string, approved: boolean, amount: number) {
    const formatted = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(amount);
    return sendPushNotification(
        userId,
        approved ? "Withdrawal Approved ✅" : "Withdrawal Declined",
        approved ? `${formatted} is being processed.` : `Your ${formatted} withdrawal was declined.`,
        "/dashboard/wallet"
    );
}

export async function pushDisputeResolved(buyerId: string, sellerId: string, orderNumber: string) {
    await Promise.allSettled([
        sendPushNotification(buyerId, "Dispute Resolved", `The dispute for order #${orderNumber} has been closed.`, "/marketplace/buyer/orders"),
        sendPushNotification(sellerId, "Dispute Resolved", `The dispute for order #${orderNumber} has been closed.`, "/marketplace/seller/orders"),
    ]);
}
