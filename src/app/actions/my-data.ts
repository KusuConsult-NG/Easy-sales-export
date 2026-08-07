"use server";

/**
 * Session-scoped reads for client components.
 *
 * WHY THIS EXISTS
 * ---------------
 * Six client components queried Supabase directly from the browser using the
 * anon key. That key is published in the JavaScript bundle, and no table has
 * row-level security, so it could read and write the entire database. Moving
 * these reads server-side is the prerequisite for enabling RLS (see
 * supabase/migrations/004_enable_row_level_security.sql) — once nothing in the
 * browser talks to the database, the anon key can be locked out completely.
 *
 * RULES FOR ANYTHING ADDED HERE
 * -----------------------------
 * 1. The user is ALWAYS derived from the session. Never accept a userId
 *    parameter — a browser-supplied id is an authorization bypass waiting to
 *    happen, and several existing actions elsewhere in the codebase take one.
 * 2. Each function answers one specific question. Do not add a general-purpose
 *    "run this query" action; that would hand the browser the same unrestricted
 *    access this module exists to remove.
 * 3. Return plain serializable data. Timestamps become ISO strings via
 *    serializeDocs, so callers must use toDate() from @/lib/date-utils rather
 *    than assuming a Timestamp object.
 */

import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { toDate } from "@/lib/date-utils";
import { logger } from "@/lib/logger";

/** The signed-in user's id, or null when unauthenticated. */
async function currentUserId(): Promise<string | null> {
    const result = await requireSession();
    return result.session?.user?.id ?? null;
}

/**
 * Module subscriptions driving sidebar and dashboard navigation.
 * Replaces a live document listener on the caller's own user record.
 */
export async function getMyServiceRegistrations(): Promise<Record<string, any>> {
    const userId = await currentUserId();
    if (!userId) return {};

    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!snap.exists) return {};
        return serializeDoc<any>(userId, snap.data()).serviceRegistrations ?? {};
    } catch (error) {
        logger.error("[my-data] getMyServiceRegistrations failed", { userId, error });
        return {};
    }
}

/**
 * Number of conversations with a message newer than the caller's last read.
 *
 * The browser version of this query silently lost its `array-contains` filter,
 * so it counted every conversation on the platform and pulled those documents
 * into each signed-in browser. Scoping is enforced here instead.
 */
export async function getMyUnreadMessageCount(): Promise<number> {
    const userId = await currentUserId();
    if (!userId) return 0;

    try {
        const snap = await db
            .collection(COLLECTIONS.CONVERSATIONS)
            .where("participants", "array-contains", userId)
            .get();

        let count = 0;
        for (const doc of snap.docs) {
            const data = doc.data();
            const lastMsg = data.lastMessage?.timestamp;
            if (!lastMsg) continue;

            const lastRead = data.participantDetails?.[userId]?.lastRead;
            const lastMsgMs = toDate(lastMsg).getTime();
            const lastReadMs = lastRead ? toDate(lastRead).getTime() : 0;

            if (lastMsgMs && (!lastReadMs || lastMsgMs > lastReadMs)) count++;
        }
        return count;
    } catch (error) {
        logger.error("[my-data] getMyUnreadMessageCount failed", { userId, error });
        return 0;
    }
}

/** The caller's notifications, newest first. */
export async function getMyNotifications(max = 200): Promise<any[]> {
    const userId = await currentUserId();
    if (!userId) return [];

    try {
        const snap = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(max)
            .get();

        return serializeDocs<any>(snap.docs);
    } catch (error) {
        logger.error("[my-data] getMyNotifications failed", { userId, error });
        return [];
    }
}

/** Count of the caller's unread notifications. */
export async function getMyUnreadNotificationCount(): Promise<number> {
    const userId = await currentUserId();
    if (!userId) return 0;

    try {
        const snap = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .where("read", "==", false)
            .count()
            .get();
        return snap.data().count ?? 0;
    } catch (error) {
        logger.error("[my-data] getMyUnreadNotificationCount failed", { userId, error });
        return 0;
    }
}

/**
 * Delete one of the caller's own notifications.
 *
 * Ownership is re-checked against the stored record. The browser previously
 * issued this delete directly, meaning any id could be passed.
 */
export async function deleteMyNotification(
    notificationId: string
): Promise<{ success: boolean; error?: string }> {
    const userId = await currentUserId();
    if (!userId) return { success: false, error: "Not signed in" };

    try {
        const ref = db.collection(COLLECTIONS.NOTIFICATIONS).doc(notificationId);
        const snap = await ref.get();

        if (!snap.exists) return { success: false, error: "Notification not found" };
        if (snap.data()?.userId !== userId) {
            logger.warn("[my-data] rejected cross-user notification delete", { userId, notificationId });
            return { success: false, error: "Notification not found" };
        }

        await ref.delete();
        return { success: true };
    } catch (error) {
        logger.error("[my-data] deleteMyNotification failed", { userId, notificationId, error });
        return { success: false, error: "Failed to delete notification" };
    }
}

/** Count of the caller's marketplace orders still in an active state. */
export async function getMyActiveOrderCount(): Promise<number> {
    const userId = await currentUserId();
    if (!userId) return 0;

    const ACTIVE = new Set(["pending", "confirmed", "processing", "shipped"]);

    try {
        const snap = await db
            .collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .get();

        return snap.docs.filter(d => ACTIVE.has(d.data().orderStatus)).length;
    } catch (error) {
        logger.error("[my-data] getMyActiveOrderCount failed", { userId, error });
        return 0;
    }
}

/**
 * Upcoming WAVE training and Village Market events, soonest first.
 *
 * Platform-wide content rather than per-user, but still fetched server-side so
 * the browser needs no database access at all. Dates are ISO strings.
 */
export async function getUpcomingEvents(max = 3): Promise<any[]> {
    if (!(await currentUserId())) return [];

    const isUpcoming = (status: string, when: Date) =>
        status !== "cancelled" && status !== "completed" && when >= new Date();

    try {
        const [waveSnap, marketSnap] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS).get(),
            db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS).get(),
        ]);

        const wave = waveSnap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                title: d.title || "Training Session",
                description: d.description || "",
                date: toDate(d.date),
                status: d.status || "upcoming",
                type: "wave" as const,
                meetingLink: d.meetingLink || "",
                instructor: d.instructor || "",
            };
        });

        const market = marketSnap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                title: d.title || "Village Market",
                description: d.description || "",
                date: toDate(d.startTime),
                status: d.status || "upcoming",
                type: "village_market" as const,
                location: d.location ? `${d.location}, ${d.state || ""}` : (d.state || ""),
            };
        });

        return [...wave, ...market]
            .filter(e => isUpcoming(e.status, e.date))
            .sort((a, b) => a.date.getTime() - b.date.getTime())
            .slice(0, max)
            .map(e => ({ ...e, date: e.date.toISOString() }));
    } catch (error) {
        logger.error("[my-data] getUpcomingEvents failed", { error });
        return [];
    }
}

/** Most recently uploaded active WAVE resources. */
export async function getRecentResources(max = 3): Promise<any[]> {
    if (!(await currentUserId())) return [];

    try {
        const snap = await db.collection(COLLECTIONS.WAVE_RESOURCES).get();

        return snap.docs
            .map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    title: d.title || "Resource File",
                    description: d.description || "",
                    category: d.category || "document",
                    fileUrl: d.fileUrl || "",
                    fileName: d.fileName || "",
                    fileSize: d.fileSize || 0,
                    downloads: d.downloads || 0,
                    uploadedAt: toDate(d.uploadedAt ?? d.createdAt),
                    isActive: d.isActive !== false,
                };
            })
            .filter(r => r.isActive)
            .sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())
            .slice(0, max)
            .map(r => ({ ...r, uploadedAt: r.uploadedAt.toISOString() }));
    } catch (error) {
        logger.error("[my-data] getRecentResources failed", { error });
        return [];
    }
}

/** Disputes the caller raised as a buyer, newest first. */
export async function getMyDisputes(): Promise<any[]> {
    const userId = await currentUserId();
    if (!userId) return [];

    try {
        const snap = await db
            .collection(COLLECTIONS.DISPUTES)
            .where("buyerId", "==", userId)
            .get();

        return serializeDocs<any>(snap.docs).sort(
            (a: any, b: any) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
        );
    } catch (error) {
        logger.error("[my-data] getMyDisputes failed", { userId, error });
        return [];
    }
}

/** The caller's wallet balance. Wallet id is the user id. */
export async function getMyWalletBalance(): Promise<number> {
    const userId = await currentUserId();
    if (!userId) return 0;

    try {
        const snap = await db.collection(COLLECTIONS.WALLETS).doc(userId).get();
        if (!snap.exists) return 0;
        return Number(snap.data()?.balance) || 0;
    } catch (error) {
        logger.error("[my-data] getMyWalletBalance failed", { userId, error });
        return 0;
    }
}

/**
 * The caller's cooperative withdrawal requests, newest first.
 *
 * requestedAt / processedAt are returned as ISO strings. The browser version
 * called .toDate() on them and fell back to "now" whenever that failed, which
 * silently displayed today's date for every row.
 */
export async function getMyWithdrawals(): Promise<any[]> {
    const userId = await currentUserId();
    if (!userId) return [];

    try {
        const snap = await db
            .collection("withdrawals")
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();

        return serializeDocs<any>(snap.docs).map((w: any) => ({
            ...w,
            requestedAt: w.createdAt ?? null,
            processedAt: w.processedAt ?? null,
        }));
    } catch (error) {
        logger.error("[my-data] getMyWithdrawals failed", { userId, error });
        return [];
    }
}
