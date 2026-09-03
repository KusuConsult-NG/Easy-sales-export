"use server";

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { ActionResponse } from "@/lib/safe-action";
import * as notificationService from "@/infrastructure/notifications/service";
import type { Notification } from "@/infrastructure/notifications/service";
import { isSafeInternalPath } from "@/lib/safe-redirect";


/**
 * A notification appears inside the platform's own UI, so its link is trusted
 * by whoever reads it.
 *
 * `link` arrived from the caller and was stored unchecked, on an endpoint that
 * required no session at all — so anyone could drop "Your payment failed, click
 * here" into any user's feed, pointing anywhere. Every internal caller uses a
 * relative path (/loans, /admin/marketplace/disputes/…, /courses/…/certificate),
 * so requiring one costs nothing and removes the off-site destination.
 *
 * Protocol-relative URLs ("//evil.example") are refused too: they are absolute
 * to a browser and look relative to a naive check.
 */
function isSafeNotificationLink(link: string | undefined): boolean {
    // An absent link is fine — the notification simply has no destination.
    if (!link) return true;
    // The shared rule (#262). This carried its own copy, correct on the
    // protocol-relative case but blind to the backslash authority and to the
    // leading control characters a browser strips.
    return isSafeInternalPath(link);
}

/**
 * Create notification
 */
export async function createNotificationAction(data: { 
    userId: string;
    type: "info" | "success" | "warning" | "error" | "loan" | "payment" | "wave" | "withdrawal" | "land" | "escrow" | "dispute";
    title: string;
    message: string;
    link?: string;
    linkText?: string; 
}): Promise<ActionResponse<any>> { 
    try {
        // This endpoint had no session check of any kind.
        //
        // It is a "use server" export, so an unauthenticated request could write
        // a notification to ANY userId with any title, message and link — and it
        // renders in the platform's own notification centre, where a user has
        // every reason to trust it. That is a phishing surface with the
        // platform's name on it.
        //
        // Trusted server callers — the escrow cron, the other actions — use
        // notificationService.createNotification directly and are unaffected.
        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { success: false, error: "Unauthenticated", data: null };
        }

        if (!isSafeNotificationLink(data.link)) {
            return { success: false, error: "Notification link must be a relative path", data: null };
        }

        return await notificationService.createNotification(data);
    } catch (error) { 
        logger.error("Notification action creation error:", error);
        return { success: false, error: "Failed to create notification", data: null };
    }
}

/**
 * Bulk create notifications
 */
export async function createBulkNotificationsAction(
    userIds: string[],
    notification: Omit<Notification, "id" | "userId" | "read" | "createdAt">
): Promise<ActionResponse<any>> { 
    try {
        // Same hole as createNotificationAction, aimed at a list of people.
        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { success: false, error: "Unauthenticated", data: null };
        }

        if (!isSafeNotificationLink((notification as { link?: string }).link)) {
            return { success: false, error: "Notification link must be a relative path", data: null };
        }

        return await notificationService.createBulkNotifications(userIds, notification);
    } catch (error) { 
        logger.error("Bulk notification action creation error:", error);
        return { success: false, error: "Failed to create notifications", data: null };
    }
}

/**
 * Get user notifications
 */
export async function getUserNotificationsAction(userId: string): Promise<Notification[]> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return [];
        const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== userId && !session.user.roles?.includes('admin') && !session.user.roles?.includes('super_admin'))) {
            return [];
        }
        return await notificationService.getUserNotifications(userId);
    } catch (error) { 
        logger.error("Failed to fetch notifications action:", error);
        return [];
    }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsReadAction(
    notificationId: string
): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: "Unauthenticated", data: null };
        }
        const { session } = sessionResult;

        return await notificationService.markNotificationAsRead(notificationId, session.user.id);
    } catch (error) { 
        logger.error("Mark as read action error:", error);
        return { success: false, error: "Failed to mark as read", data: null };
    }
}

/**
 * Mark all notifications as read for user
 */
export async function markAllAsReadAction(userId: string): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { success: false, error: "Unauthenticated", data: null };
        }
        const { session } = sessionResult;

        // The comment here used to read "Securely delegate to infrastructure
        // layer". The infrastructure layer does not check either:
        // markAllAsRead(userId) queries by that id and writes, with no notion of
        // who asked. So any signed-in user could clear anybody's unread
        // notifications — including the alerts about a withdrawal or a dispute
        // that the owner had not read yet.
        //
        // getUserNotificationsAction and getUnreadCountAction, in this same
        // file, already compare against the session. The write did not.
        const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");
        if (session.user.id !== userId && !isAdmin) {
            return { success: false, error: "Unauthorized", data: null };
        }

        return await notificationService.markAllAsRead(userId);
    } catch (error) { 
        logger.error("Mark all as read action error:", error);
        return { success: false, error: "Failed to mark all as read", data: null };
    }
}

/**
 * Get unread count
 */
export async function getUnreadCountAction(userId: string): Promise<number> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return 0;
        const { session } = sessionResult;
        if (!session?.user?.id || (session.user.id !== userId && !session.user.roles?.includes('admin') && !session.user.roles?.includes('super_admin'))) {
            return 0;
        }
        return await notificationService.getUnreadCount(userId);
    } catch (error) { 
        logger.error("Failed to get unread count action:", error);
        return 0;
    }
}

