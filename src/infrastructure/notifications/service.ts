/**
 * Centralized Notification Infrastructure Service
 * 
 * Manages all platform-level in-app notifications with atomic counts,
 * target segment filtering, and clean lifecycle tracking.
 */

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";

export interface Notification {
    id?: string;
    userId: string;
    type: "info" | "success" | "warning" | "error" | "loan" | "payment" | "wave" | "withdrawal" | "land" | "escrow" | "dispute";
    title: string;
    message: string;
    link?: string;
    linkText?: string;
    read: boolean;
    createdAt: FieldValue | Timestamp;
    readAt?: FieldValue | Timestamp;
}

/**
 * Creates an individual notification
 */
export async function createNotification(data: Omit<Notification, "read" | "createdAt">): Promise<ActionResponse<any>> {
    try {
        const notification: Omit<Notification, "id"> = {
            ...data,
            read: false,
            createdAt: FieldValue.serverTimestamp()
        };

        const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
        const batch = db.batch();
        batch.set(docRef, notification);
        batch.update(db.collection(COLLECTIONS.USERS).doc(data.userId), {
            unreadCount: FieldValue.increment(1)
        });
        await batch.commit();

        return { success: true, error: null, data: { notificationId: docRef.id } };
    } catch (error) {
        logger.error("Notification infrastructure creation error:", error);
        return { success: false, error: "Failed to dispatch notification", data: null };
    }
}

/**
 * Creates bulk notifications for a set of target users
 */
export async function createBulkNotifications(
    userIds: string[],
    notificationTemplate: Omit<Notification, "id" | "userId" | "read" | "createdAt">
): Promise<ActionResponse<any>> {
    try {
        const chunkSize = 200;
        for (let i = 0; i < userIds.length; i += chunkSize) {
            const chunk = userIds.slice(i, i + chunkSize);
            const batch = db.batch();
            const notificationsRef = db.collection(COLLECTIONS.NOTIFICATIONS);
            const usersRef = db.collection(COLLECTIONS.USERS);

            chunk.forEach((userId) => {
                const docRef = notificationsRef.doc();
                batch.set(docRef, {
                    userId,
                    ...notificationTemplate,
                    read: false,
                    createdAt: FieldValue.serverTimestamp()
                });
                batch.update(usersRef.doc(userId), {
                    unreadCount: FieldValue.increment(1)
                });
            });

            await batch.commit();
        }
        return { success: true, error: null, data: { count: userIds.length } };
    } catch (error) {
        logger.error("Bulk notification infrastructure creation error:", error);
        return { success: false, error: "Failed to dispatch bulk notifications", data: null };
    }
}

/**
 * Get user notifications
 */
export async function getUserNotifications(userId: string): Promise<Notification[]> {
    const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc")
        .get();

    return serializeDocs(snapshot.docs) as unknown as Notification[];
}

/**
 * Marks a notification as read safely by verifying ownership
 */
export async function markNotificationAsRead(notificationId: string, currentUserId: string): Promise<ActionResponse<any>> {
    try {
        const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
        const userRef = db.collection(COLLECTIONS.USERS).doc(currentUserId);
        
        // Execute inside transaction to secure atomic update
        const result = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(docRef);
            if (!doc.exists) {
                throw new Error("Notification not found");
            }
            
            const data = doc.data() as Notification;
            if (data.userId !== currentUserId) {
                throw new Error("Unauthorized to access this resource");
            }

            if (!data.read) {
                transaction.update(docRef, {
                    read: true,
                    readAt: FieldValue.serverTimestamp()
                });

                const userSnap = await transaction.get(userRef);
                if (userSnap.exists) {
                    const userData = userSnap.data() || {};
                    const currentUnread = userData.unreadCount || 0;
                    const nextUnread = Math.max(0, currentUnread - 1);
                    transaction.update(userRef, {
                        unreadCount: nextUnread
                    });
                } else {
                    transaction.set(userRef, { unreadCount: 0 }, { merge: true });
                }
            }
            return { success: true };
        });

        return { success: true, error: null, data: result };
    } catch (error: any) {
        logger.error("Mark notification read transaction error:", error);
        return { success: false, error: error.message || "Failed to mark notification as read", data: null };
    }
}

/**
 * Marks all notifications for a user as read atomically
 */
export async function markAllAsRead(userId: string): Promise<ActionResponse<any>> {
    try {
        const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .get();

        if (snapshot.empty) {
            // Make sure count is 0 anyway to ensure perfect synchronization
            await db.collection(COLLECTIONS.USERS).doc(userId).set({
                unreadCount: 0
            }, { merge: true });
            return { success: true, error: null, data: null };
        }

        const chunkSize = 400;
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += chunkSize) {
            const chunk = docs.slice(i, i + chunkSize);
            const batch = db.batch();
            chunk.forEach((doc) => {
                batch.update(doc.ref, {
                    read: true,
                    readAt: FieldValue.serverTimestamp()
                });
            });
            await batch.commit();
        }

        // Atomically update user document to 0 unreadCount
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            unreadCount: 0
        }, { merge: true });

        return { success: true, error: null, data: { count: snapshot.size } };
    } catch (error) {
        logger.error("Mark all notifications read error:", error);
        return { success: false, error: "Failed to mark notifications as read", data: null };
    }
}

/**
 * Gets the current unread count directly from Firestore truth
 */
export async function getUnreadCount(userId: string): Promise<number> {
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (userDoc.exists) {
        const data = userDoc.data();
        if (data && typeof data.unreadCount === "number") {
            return data.unreadCount;
        }
    }

    // Fallback & backfill count
    const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
        .where("userId", "==", userId)
        .where("read", "==", false)
        .count()
        .get();

    const count = snapshot.data().count;
    
    // Backfill user doc
    await db.collection(COLLECTIONS.USERS).doc(userId).set({
        unreadCount: count
    }, { merge: true });

    return count;
}
