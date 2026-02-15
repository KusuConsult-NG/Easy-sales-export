"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";

/**
 * In-App Notification System
 */

export interface Notification {
    id?: string;
    userId: string;
    type: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    link?: string;
    linkText?: string;
    read: boolean;
    createdAt: FieldValue | Timestamp;
    readAt?: FieldValue | Timestamp;
}

/**
 * Create notification
 */
export async function createNotificationAction(data: {
    userId: string;
    type: "info" | "success" | "warning" | "error";
    title: string;
    message: string;
    link?: string;
    linkText?: string;
}): Promise<{ success: boolean; error?: string; notificationId?: string }> {
    try {
        const notification: Omit<Notification, "id"> = {
            ...data,
            read: false,
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection("notifications").add(notification);

        return { success: true, notificationId: docRef.id };
    } catch (error) {
        logger.error("Notification creation error:", error);
        return { success: false, error: "Failed to create notification" };
    }
}

/**
 * Bulk create notifications
 */
export async function createBulkNotificationsAction(
    userIds: string[],
    notification: Omit<Notification, "id" | "userId">
): Promise<{ success: boolean; error?: string; count?: number }> {
    try {
        const batch = db.batch();
        const notificationsRef = db.collection("notifications");

        userIds.forEach((userId) => {
            const docRef = notificationsRef.doc();
            batch.set(docRef, {
                userId,
                ...notification,
                read: false,
                createdAt: FieldValue.serverTimestamp(),
            });
        });

        await batch.commit();

        return { success: true, count: userIds.length };
    } catch (error) {
        logger.error("Bulk notification creation error:", error);
        return { success: false, error: "Failed to create notifications" };
    }
}

/**
 * Get user notifications
 */
export async function getUserNotificationsAction(userId: string): Promise<Notification[]> {
    try {
        const snapshot = await db.collection("notifications")
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                userId: data.userId,
                title: data.title,
                message: data.message,
                type: data.type,
                link: data.link,
                linkText: data.linkText,
                read: data.read,
                createdAt: data.createdAt,
                readAt: data.readAt,
            } as Notification;
        });
    } catch (error) {
        logger.error("Failed to fetch notifications:", error);
        return [];
    }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsReadAction(
    notificationId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        await db.collection("notifications").doc(notificationId).update({
            read: true,
            readAt: FieldValue.serverTimestamp(),
        });

        return { success: true };
    } catch (error) {
        logger.error("Mark as read error:", error);
        return { success: false, error: "Failed to mark as read" };
    }
}

/**
 * Mark all notifications as read for user
 */
export async function markAllAsReadAction(userId: string): Promise<{ success: boolean; error?: string }> {
    try {
        const snapshot = await db.collection("notifications")
            .where("userId", "==", userId)
            .where("read", "==", false)
            .get();

        if (snapshot.empty) {
            return { success: true };
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.update(doc.ref, {
                read: true,
                readAt: FieldValue.serverTimestamp(),
            });
        });

        await batch.commit();

        return { success: true };
    } catch (error) {
        logger.error("Mark all as read error:", error);
        return { success: false, error: "Failed to mark all as read" };
    }
}

/**
 * Get unread count
 */
export async function getUnreadCountAction(userId: string): Promise<number> {
    try {
        const snapshot = await db.collection("notifications")
            .where("userId", "==", userId)
            .where("read", "==", false)
            .count()
            .get();

        return snapshot.data().count;
    } catch (error) {
        logger.error("Failed to get unread count:", error);
        return 0;
    }
}
