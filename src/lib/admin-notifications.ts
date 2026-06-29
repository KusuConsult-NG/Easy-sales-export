import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createBulkNotifications } from "@/infrastructure/notifications/service";
import { sendPushToMany } from "@/lib/fcm";
import { logger } from "@/lib/logger";
import type { Notification } from "@/infrastructure/notifications/service";

interface AdminNotificationPayload {
    type: Notification["type"];
    title: string;
    message: string;
    link?: string;
    linkText?: string;
}

/**
 * Notifies all admins (users with 'admin' or 'super_admin' roles) 
 * via in-app and push notifications instead of Resend emails.
 */
export async function notifyAdmins(payload: AdminNotificationPayload): Promise<void> {
    try {
        // Query users with 'admin' role
        const adminsSnap = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "admin")
            .get();
        
        // Query users with 'super_admin' role
        const superAdminsSnap = await db.collection(COLLECTIONS.USERS)
            .where("roles", "array-contains", "super_admin")
            .get();

        const adminIds = new Set<string>();
        adminsSnap.docs.forEach(doc => adminIds.add(doc.id));
        superAdminsSnap.docs.forEach(doc => adminIds.add(doc.id));

        const uniqueAdminIds = Array.from(adminIds);
        if (uniqueAdminIds.length === 0) {
            logger.warn("[AdminNotification] No admins or super_admins found in Firestore.");
            return;
        }

        // 1. Send In-App Notifications (Bulk)
        await createBulkNotifications(uniqueAdminIds, {
            type: payload.type,
            title: payload.title,
            message: payload.message,
            link: payload.link,
            linkText: payload.linkText
        });

        // 2. Send Push Notifications (FCM)
        await sendPushToMany(uniqueAdminIds, payload.title, payload.message, payload.link);

        logger.info(`[AdminNotification] Successfully notified ${uniqueAdminIds.length} admins (In-App & FCM) for: ${payload.title}`);
    } catch (error) {
        logger.error("[AdminNotification] Failed to notify admins:", error);
    }
}
