"use server";

import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { ActionResponse } from "@/lib/safe-action";
import * as notificationService from "@/infrastructure/notifications/service";
import type { Notification } from "@/infrastructure/notifications/service";


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
        if (!session?.user?.id || (session.user.id !== userId && !session.user.roles?.includes('admin'))) {
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
        if (!sessionResult.session) {
            return { success: false, error: "Unauthenticated", data: null };
        }
        // Securely delegate to infrastructure layer
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
        if (!session?.user?.id || (session.user.id !== userId && !session.user.roles?.includes('admin'))) {
            return 0;
        }
        return await notificationService.getUnreadCount(userId);
    } catch (error) { 
        logger.error("Failed to get unread count action:", error);
        return 0;
    }
}

