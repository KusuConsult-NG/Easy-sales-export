/**
 * Centralized Notification Infrastructure Service
 * 
 * Manages all platform-level in-app notifications.
 *
 * #687 It used to say "with atomic counts". The counts were not atomic — the
 * batch that carried them is a sequential loop (#679) — nor complete, since
 * five notification writers never went through this file, nor read by anything.
 * Counting now happens in one place, lib/unread-notification-count.ts, and this
 * service keeps no counter of its own.
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
import { countUnreadNotifications } from "@/lib/unread-notification-count";

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

        /*
         *   #687 ONE WRITE, AND NO COUNTER.
         *
         *   This was a two-operation batch: the notification, and an increment
         *   of `users.unreadCount`. The counter is gone — see the header — and
         *   with it the batch, which #679 established is a sequential loop
         *   rather than an atomic commit. A single document write needs no
         *   batch and cannot half-succeed.
         */
        const docRef = db.collection(COLLECTIONS.NOTIFICATIONS).doc();
        await docRef.set(notification);

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
                //   #687 The notification only. The `users.unreadCount`
                //   increment that stood here maintained a counter nothing read.
                batch.set(docRef, {
                    userId,
                    ...notificationTemplate,
                    read: false,
                    createdAt: FieldValue.serverTimestamp()
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
                /*
                 *   #687 The read flag is the whole of it.
                 *
                 *   A second document read and a second write stood here, to
                 *   decrement `users.unreadCount` — on the hot path, inside the
                 *   transaction, for a counter nothing consulted. What made it
                 *   worse than wasted work is that the decrement was
                 *   `Math.max(0, current - 1)` against a figure five of the
                 *   platform's notification writers never incremented, so it
                 *   drifted DOWNWARD with every read of a notification those
                 *   paths had created.
                 */
                transaction.update(docRef, {
                    read: true,
                    readAt: FieldValue.serverTimestamp()
                });
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
            //   #687 Nothing to mark, and no counter to synchronise — the
            //   count is taken from these rows now, so there is no second
            //   figure that could disagree with them.
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

            //   #687 The figure is REPORTED, not stored. #534's point stands
            //   whole — a truncated sweep must not be reported as a completed
            //   one — and the caller is still told exactly how many rows are
            //   left. What is gone is writing that number into a counter,
            //   which is what made it a second source of truth.
            return {
                success: true,
                error: null,
                data: { count: snapshot.size, truncated: true, remaining: remaining.data().count },
            };
        }

        //   #687 No counter to zero. Every row that could be counted has just
        //   had `read: true` written to it, so the count IS zero, derived
        //   rather than asserted.
        return { success: true, error: null, data: { count: snapshot.size, truncated: false } };
    } catch (error) {
        logger.error("Mark all notifications read error:", error);
        return { success: false, error: "Failed to mark notifications as read", data: null };
    }
}

/**
 *   #687 A THIRD COUNT OF ONE FACT, MAINTAINED BY NINE WRITERS, BYPASSED BY
 *        FIVE, AND READ BY NOTHING.
 *
 *   Its docstring said "the current unread count directly from Firestore
 *   truth". It read a DENORMALISED COUNTER — `users.unreadCount` — and took the
 *   real count only when that field was ABSENT, then backfilled the field so
 *   the expensive path could never run again.
 *
 *   THE COUNTER WAS ALREADY WRONG. Five of the platform's notification writers
 *   go straight to the collection and never incremented it: the in-app
 *   broadcast, marketplace quote requests, two wallet withdrawal decisions, and
 *   lib/marketplace-notifications.ts — the shared helper, with seven callers of
 *   its own. Meanwhile markAllAsRead wrote 0. So for any member who had ever
 *   cleared their bell and then received a notification down one of those five
 *   paths, this function returned 0 over unread mail.
 *
 *   IT WAS HARMLESS ONLY BECAUSE NOTHING CALLED IT. Its one caller,
 *   getUnreadCountAction, has no callers of its own; the live badges both count
 *   the rows. That is the whole of the defect: the obvious-looking function,
 *   with the most authoritative docstring, was the broken one, and the next
 *   person needing a count would have reached for it.
 *
 *   It now asks the same question the badges ask, in the one place that asks
 *   it. The counter is no longer written by anything in this file.
 *
 *   THE STORED FIELD IS LEFT WHERE IT IS on the user documents that carry it.
 *   Nothing on this platform destroys a record to tidy up, and a stale number
 *   nothing reads costs nothing; what mattered was that it stopped being
 *   presented as the truth.
 */
export async function getUnreadCount(userId: string): Promise<number> {
    return countUnreadNotifications(userId);
}
