"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import { requireSession } from "@/lib/session-guard";
import { ActionResponse } from "@/lib/safe-action";

/**
 * In-App Notification System
 */

export interface Notification { id?: string;
    userId: string;
    type: "info" | "success" | "warning" | "error" | "loan" | "payment" | "wave" | "withdrawal" | "land" | "escrow" | "dispute";
    title: string;
    message: string;
    link?: string;
    linkText?: string;
    read: boolean;
    createdAt: FieldValue | Timestamp;
    readAt?: FieldValue | Timestamp; }

/**
 * Create notification
 */
export async function createNotificationAction(data: { userId: string;
    type: "info" | "success" | "warning" | "error" | "loan" | "payment" | "wave" | "withdrawal" | "land" | "escrow" | "dispute";
    title: string;
    message: string;
    link?: string;
    linkText?: string; }): Promise<ActionResponse<any>> { try {
        const notification: Omit<Notification, "id"> = {
            ...data,
            read: false,
            createdAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.NOTIFICATIONS).add(notification);

        return { success: true, error: null, data: { notificationId: docRef.id } };
    } catch (error) { logger.error("Notification creation error:", error);
        return { success: false, error: "Failed to create notification", data: null };
    }
}

/**
 * Bulk create notifications
 */
export async function createBulkNotificationsAction(
    userIds: string[],
    notification: Omit<Notification, "id" | "userId">
): Promise<ActionResponse<any>> { try {
        const batch = db.batch();
        const notificationsRef = db.collection(COLLECTIONS.NOTIFICATIONS);

        userIds.forEach((userId) => {
            const docRef = notificationsRef.doc();
            batch.set(docRef, {
                userId,
                ...notification,
                read: false,
                createdAt: FieldValue.serverTimestamp() });
        });

        await batch.commit();

        return { success: true, error: null, data: { count: userIds.length } };
    } catch (error) { logger.error("Bulk notification creation error:", error);
        return { success: false, error: "Failed to create notifications", data: null };
    }
}

/**
 * Get user notifications
 */
export async function getUserNotificationsAction(userId: string): Promise<Notification[]> { try {
        const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        return serializeDocs(snapshot.docs) as unknown as Notification[];
    } catch (error) { logger.error("Failed to fetch notifications:", error);
        return [];
    }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsReadAction(
    notificationId: string
): Promise<ActionResponse<any>> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: "Unauthenticated", data: null };
        const { session } = sessionResult;

        // Verify ownership — only the notification's owner can mark it read
        const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
        const snap = await docRef.get();
        if (!snap.exists) return { success: false, error: "Notification not found", data: null };
        if (snap.data()?.userId !== session.user.id) { return { success: false, error: "Forbidden", data: null };
        }

        await docRef.update({ read: true,
            readAt: FieldValue.serverTimestamp() });

        return { success: true, error: null, data: null };
    } catch (error) { logger.error("Mark as read error:", error);
        return { success: false, error: "Failed to mark as read", data: null };
    }
}

/**
 * Mark all notifications as read for user
 */
export async function markAllAsReadAction(userId: string): Promise<ActionResponse<any>> { try {
        const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .get();

        if (snapshot.empty) {
            return { success: true, error: null, data: null };
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => { batch.update(doc.ref, {
                read: true,
                readAt: FieldValue.serverTimestamp() });
        });

        await batch.commit();

        return { success: true, error: null, data: null };
    } catch (error) { logger.error("Mark all as read error:", error);
        return { success: false, error: "Failed to mark all as read", data: null };
    }
}

/**
 * Get unread count
 */
export async function getUnreadCountAction(userId: string): Promise<number> { try {
        const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .count()
            .get();

        return snapshot.data().count;
    } catch (error) { logger.error("Failed to get unread count:", error);
        return 0;
    }
}
