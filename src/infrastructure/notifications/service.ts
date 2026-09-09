/**
 * Centralized Notification Infrastructure Service
 * 
 * Manages all platform-level in-app notifications with atomic counts,
 * target segment filtering, and clean lifecycle tracking.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";
import type { Notification as SharedNotification } from "@/lib/types/shared";
// #534 The window size lives in a client-safe module: the notifications
// screen is a "use client" file and must not reach this one.
import { NOTIFICATION_PAGE_SIZE } from "@/lib/notification-filter";

/**
 * Server-side Notification shape.
 * The `type` field delegates to the authoritative SharedNotification["type"]
 * union from @/lib/types/shared so all type values remain in sync.
 * `createdAt` uses FieldValue | Timestamp (write shape) vs the client-side Date
 * (read shape) defined in SharedNotification — they are intentionally different.
 */
export interface Notification {
    id?: string;
    userId: string;
    type: SharedNotification["type"];
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

/** One page of notifications, and whether there is another behind it. */
export interface NotificationPage {
    notifications: Notification[];
    hasMore: boolean;
}

/**
 * Get user notifications — one page at a time.
 *
 *   #534 THIS READ EVERY NOTIFICATION THE USER HAD EVER RECEIVED.
 *
 *        `.where(userId).orderBy(createdAt, desc).get()` with no `.limit()`.
 *        The adapter caps an unlimited query at DEFAULT_QUERY_LIMIT — 5,000 —
 *        and sets `truncated` on the snapshot, which nothing here read. So the
 *        function returned "all the notifications" and meant "the newest five
 *        thousand", with no way for a caller to tell.
 *
 *        Nothing ages a notification out. The platform purges audit logs and
 *        chatbot rows on a schedule and has never had one for these, so every
 *        row ever written to a member is still there — the owner's own account
 *        holds one per WAVE application going back months, because notifyAdmins
 *        writes one to EVERY admin for EVERY submission.
 *
 *        Paged now, newest first, with an explicit `before` cursor. The caller
 *        asks for more if it wants more.
 */
export async function getUserNotifications(
    userId: string,
    options: { limit?: number; before?: Date | string } = {},
): Promise<NotificationPage> {
    const limit = Math.max(1, Math.min(options.limit ?? NOTIFICATION_PAGE_SIZE, 200));

    let query = db.collection(COLLECTIONS.NOTIFICATIONS)
        .where("userId", "==", userId)
        .orderBy("createdAt", "desc");

    if (options.before) {
        query = query.startAfter(options.before);
    }

    //   One more than asked for, so "is there another page" is answered by the
    //   read itself rather than by a second count that could disagree with it.
    const snapshot = await query.limit(limit + 1).get();
    const docs = snapshot.docs.slice(0, limit);

    return {
        notifications: serializeDocs(docs) as unknown as Notification[],
        hasMore: snapshot.docs.length > limit,
    };
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
        /**
         *   #534 THIS READ WAS CAPPED AND THE COUNTER WAS SET TO ZERO ANYWAY.
         *
         *   The query had no `.limit()`, so the adapter capped it at
         *   DEFAULT_QUERY_LIMIT — 5,000 — and set `truncated` on the snapshot.
         *   Nothing read that flag. The function then marked whatever it got
         *   and finished with
         *
         *       await db.collection(USERS).doc(userId).set({ unreadCount: 0 })
         *
         *   unconditionally. So for a user past the cap, "mark all as read"
         *   marked five thousand, left the rest unread, and wrote a counter
         *   saying none were — and getUnreadCount TRUSTS that counter, taking
         *   the expensive path only when the field is missing. The badge would
         *   have read zero for ever over thousands of unread rows.
         *
         *   Nobody is past 5,000 today; the owner's own account is in the low
         *   hundreds. It is fixed because the shape is the one this audit keeps
         *   finding — a bounded read used as if it were complete, and a derived
         *   figure written from it — not because it has fired.
         *
         *   `.all()` is the adapter's honest escape hatch for a sweep that
         *   genuinely needs everything, and it reports its own ceiling.
         */
        const snapshot = await db.collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .all()
            .get();

        if (snapshot.truncated) {
            logger.error(
                `[Notifications] the unread sweep for ${userId} hit the unbounded ceiling. `
                + `Some notifications remain unread and the count is recomputed rather than zeroed.`,
            );
        }

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

        //   #534 Zero only when the sweep really finished.
        //
        //   A truncated sweep leaves unread rows behind, so writing 0 would be
        //   a figure the data contradicts. The count is recounted from the
        //   database instead — `.count()` is a server-side aggregate and is not
        //   subject to the row cap — and the caller is told it is incomplete.
        if (snapshot.truncated) {
            const remaining = await db.collection(COLLECTIONS.NOTIFICATIONS)
                .where("userId", "==", userId)
                .where("read", "==", false)
                .count()
                .get();

            await db.collection(COLLECTIONS.USERS).doc(userId).set({
                unreadCount: remaining.data().count,
            }, { merge: true });

            return {
                success: true,
                error: null,
                data: { count: snapshot.size, truncated: true, remaining: remaining.data().count },
            };
        }

        // Atomically update user document to 0 unreadCount
        await db.collection(COLLECTIONS.USERS).doc(userId).set({
            unreadCount: 0
        }, { merge: true });

        return { success: true, error: null, data: { count: snapshot.size, truncated: false } };
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
