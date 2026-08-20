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
import { serializeDoc, serializeDocs, toMillis } from "@/lib/firestore-serialize";
import { toDate } from "@/lib/date-utils";
import { isActiveOrderStatus } from "@/lib/order-status";
import { logger } from "@/lib/logger";

/** The signed-in user's id, or null when unauthenticated. */
async function currentUserId(): Promise<string | null> {
    // requireSession() is the one call in this module outside a try/catch, and
    // every function here begins with it. A session lookup that throws
    // therefore escaped the per-function handling and rejected the action.
    //
    // That mattered because this module is the only one under src/app/actions
    // NOT wrapped in withSafeAction — these return raw values (a number, an
    // array) rather than { success, error }, so there is no wrapper converting
    // a throw into a result. The dashboard awaited eight of them together and
    // one rejection blanked the whole page.
    //
    // Returning null is what every caller already handles: each opens with
    // `if (!userId) return <empty default>`. An unreadable session is
    // indistinguishable from being signed out, which is the correct reading.
    try {
        const result = await requireSession();
        return result.session?.user?.id ?? null;
    } catch (error) {
        logger.error("[my-data] session lookup failed", { error });
        return null;
    }
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

    // `status`, and the SHARED set.
    //
    // TWO FAULTS, EITHER OF WHICH ALONE MADE THIS ZERO.
    //
    // It read `orderStatus`. Every writer of MARKETPLACE_ORDERS sets `status`
    // — _payment_orders.ts writes `status: "pending_payment"`, the dispute path
    // transitions `status`, the fulfilment paths update `status`. `orderStatus`
    // exists only on the MarketplaceOrder interface and in this one filter, so
    // it was undefined on every real order and the dashboard's Active Orders
    // tile showed 0 for every buyer, however many orders they had in flight.
    //
    // And the hand-written set was the wrong vocabulary: "pending" and
    // "confirmed" are not statuses any writer produces, while pending_payment,
    // payment_received and disputed — three of the five states an order is
    // actually live in — were missing. lib/order-status.ts already owns this
    // rule; this was a fifth copy of it, on the wrong field.
    try {
        const snap = await db
            .collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("buyerId", "==", userId)
            .get();

        return snap.docs.filter(d => isActiveOrderStatus(d.data().status)).length;
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
        // THE MEMBER'S COOPERATIVE WITHDRAWAL HISTORY WAS PERMANENTLY EMPTY.
        //
        // This read "withdrawals" — the platform wallet collection. Every
        // cooperative withdrawal request is written to cooperative_withdrawals,
        // by all three of the doors that create one. And the ONLY caller of this
        // function is /cooperatives/withdrawals, the member's cooperative
        // withdrawal history page: it asked for their withdrawals, was handed a
        // list that structurally could not contain any, and rendered "no
        // withdrawals yet" to members whose money had already been paid out.
        //
        // Both collections, since this lives in the "my data" module and a
        // member's own record of their withdrawals should not omit a whole class
        // of them. `source` distinguishes the two for any caller that cares.
        const [platformSnap, coopSnap] = await Promise.all([
            db.collection(COLLECTIONS.WITHDRAWALS)
                .where("userId", "==", userId)
                .orderBy("createdAt", "desc")
                .get(),
            db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS)
                .where("userId", "==", userId)
                .get(),
        ]);

        const rows = [
            ...serializeDocs<any>(platformSnap.docs).map((w: any) => ({ ...w, source: "wallet" })),
            ...serializeDocs<any>(coopSnap.docs).map((w: any) => ({ ...w, source: "cooperative" })),
        ];

        return rows
            .map((w: any) => ({
                ...w,
                requestedAt: w.requestedAt ?? w.createdAt ?? null,
                processedAt: w.processedAt ?? null,
            }))
            .sort((a: any, b: any) => toMillis(b.requestedAt) - toMillis(a.requestedAt));
    } catch (error) {
        logger.error("[my-data] getMyWithdrawals failed", { userId, error });
        return [];
    }
}

/* ==========================================================================
 * Application and membership status
 *
 * These back the three polling hooks that were still reading Supabase from the
 * browser after the first pass of this refactor (useMembershipStatus,
 * usePendingApplicationStatus, useUnreadNotifications). They are the last
 * anon-key readers, and RLS cannot be enabled until they are gone.
 *
 * Both actions take a *kind*, never a query. The browser picks from a fixed
 * allowlist below and the collection, the status field and the ownership
 * filter are all decided here — see rule 2 at the top of this file.
 * ========================================================================== */

/**
 * Application lookups a pending page is allowed to poll, keyed
 * `collection:statusField` to match what the calling hook already passes.
 *
 * `fromServiceRegistrations` reads users.serviceRegistrations[key].status
 * instead of a document in its own collection — farm-nation records
 * onboarding state on the user record rather than in an applications table.
 */
const APPLICATION_QUERIES: Record<
    string,
    { collection: string; statusField: string; fromServiceRegistrations?: string }
> = {
    [`${COLLECTIONS.SELLER_VERIFICATIONS}:status`]: {
        collection: COLLECTIONS.SELLER_VERIFICATIONS,
        statusField: "status",
    },
    [`${COLLECTIONS.ACADEMY_APPLICATIONS}:status`]: {
        collection: COLLECTIONS.ACADEMY_APPLICATIONS,
        statusField: "status",
    },
    [`${COLLECTIONS.WAVE_APPLICATIONS}:status`]: {
        collection: COLLECTIONS.WAVE_APPLICATIONS,
        statusField: "status",
    },
    [`${COLLECTIONS.USERS}:farmNation`]: {
        collection: COLLECTIONS.USERS,
        statusField: "status",
        fromServiceRegistrations: "farmNation",
    },
};

export interface MyApplicationStatus {
    status: string;
    createdAt: string | null;
    rejectionReason: string | null;
}

const PENDING: MyApplicationStatus = { status: "pending", createdAt: null, rejectionReason: null };

/**
 * Status of the caller's most recent application of one kind.
 *
 * The browser version selected the newest record by sorting in JavaScript
 * after fetching every matching row; the ordering is done in the query here.
 */
export async function getMyApplicationStatus(
    collectionName: string,
    statusField: string
): Promise<MyApplicationStatus> {
    const userId = await currentUserId();
    if (!userId) return PENDING;

    const spec = APPLICATION_QUERIES[`${collectionName}:${statusField}`];
    if (!spec) {
        logger.warn("[my-data] getMyApplicationStatus called with an unlisted lookup", {
            collectionName,
            statusField,
        });
        return PENDING;
    }

    try {
        if (spec.fromServiceRegistrations) {
            const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (!snap.exists) return PENDING;

            const registration =
                serializeDoc<any>(userId, snap.data()).serviceRegistrations?.[
                    spec.fromServiceRegistrations
                ];
            return {
                status: registration?.status ?? "pending",
                createdAt: registration?.createdAt ?? null,
                rejectionReason: registration?.rejectionReason ?? null,
            };
        }

        const snap = await db
            .collection(spec.collection)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (snap.empty) return PENDING;

        const latest = serializeDocs<any>(snap.docs)[0] ?? {};
        return {
            status: latest[spec.statusField] ?? "pending",
            createdAt: latest.createdAt ?? null,
            rejectionReason: latest.rejectionReason ?? null,
        };
    } catch (error) {
        logger.error("[my-data] getMyApplicationStatus failed", { userId, collectionName, error });
        return PENDING;
    }
}

/**
 * Modules whose membership the caller may check, mapped to the registration
 * key on the user record and the collection to fall back to.
 *
 * Two of these fallbacks name a different collection than the browser version
 * did. It looked for `farmnation_applications` and `export_applications`,
 * neither of which is written anywhere in the codebase — the writers use
 * COLLECTIONS.FARM_NATION_APPLICATIONS (`farm_nation_applications`) and
 * COLLECTIONS.EXPORT_APPLICATIONS (`export_onboarding_applications`). Those
 * two fallbacks therefore never matched a row and always fell through to the
 * session value. They query the real collections here.
 *
 * `fallback: null` preserves the browser behaviour for marketplace, which
 * named no fallback collection at all.
 */
const MEMBERSHIP_MODULES: Record<string, { regKeys: string[]; fallback: string | null }> = {
    wave: { regKeys: ["wave"], fallback: COLLECTIONS.WAVE_APPLICATIONS },
    academy: { regKeys: ["academy"], fallback: COLLECTIONS.ACADEMY_APPLICATIONS },
    export: { regKeys: ["export"], fallback: COLLECTIONS.EXPORT_APPLICATIONS },
    cooperative: {
        regKeys: ["cooperatives", "cooperative"],
        fallback: COLLECTIONS.COOPERATIVE_MEMBERS,
    },
    cooperatives: {
        regKeys: ["cooperatives", "cooperative"],
        fallback: COLLECTIONS.COOPERATIVE_MEMBERS,
    },
    "farm-nation": {
        regKeys: ["farmNation", "farm_nation"],
        fallback: COLLECTIONS.FARM_NATION_APPLICATIONS,
    },
    farmNation: {
        regKeys: ["farmNation", "farm_nation"],
        fallback: COLLECTIONS.FARM_NATION_APPLICATIONS,
    },
    marketplace: { regKeys: ["marketplace"], fallback: null },
};

/** Statuses that settle the question without consulting the fallback. */
const SETTLED_STATUSES = new Set(["approved", "active", "verified", "paid"]);

export interface MyMembershipStatus {
    status: string;
    data: any | null;
}

/**
 * The caller's membership status for one module.
 *
 * Returns status "unknown" when nothing is found, leaving the hook to fall
 * back to the value already in the NextAuth session.
 */
export async function getMyMembershipStatus(moduleType: string): Promise<MyMembershipStatus> {
    const userId = await currentUserId();
    if (!userId) return { status: "unauthenticated", data: null };

    const spec = MEMBERSHIP_MODULES[moduleType];
    if (!spec) {
        logger.warn("[my-data] getMyMembershipStatus called for an unknown module", { moduleType });
        return { status: "unknown", data: null };
    }

    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (snap.exists) {
            const registrations =
                serializeDoc<any>(userId, snap.data()).serviceRegistrations ?? {};
            const registration = spec.regKeys.map((k) => registrations[k]).find(Boolean);

            if (registration?.status && SETTLED_STATUSES.has(registration.status)) {
                return { status: registration.status, data: registration };
            }
        }

        if (!spec.fallback) return { status: "unknown", data: null };

        const fallbackSnap = await db
            .collection(spec.fallback)
            .where("userId", "==", userId)
            .limit(1)
            .get();

        if (!fallbackSnap.empty) {
            const doc = serializeDocs<any>(fallbackSnap.docs)[0] ?? {};
            return {
                status: doc.status ?? doc.membershipStatus ?? "pending",
                data: doc,
            };
        }

        return { status: "unknown", data: null };
    } catch (error) {
        logger.error("[my-data] getMyMembershipStatus failed", { userId, moduleType, error });
        return { status: "error", data: null };
    }
}
