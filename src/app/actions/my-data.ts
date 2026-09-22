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
import { ownedProfileIds, filterByOwner } from "@/lib/owned-profile-ids";
import { unstable_cache } from "next/cache";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { serializeDoc, serializeDocs, toMillis } from "@/lib/firestore-serialize";
import { toDate } from "@/lib/date-utils";
import { isActiveOrderStatus } from "@/lib/order-status";
import { logger } from "@/lib/logger";
import { NOTIFICATION_BADGE_WINDOW } from "@/lib/notification-filter";
import { countUnreadNotifications } from "@/lib/unread-notification-count";
import { isOnTheList } from "@/lib/notification-ageing";

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
 *   #453 THE DASHBOARD ASKED THE SERVER EIGHT TIMES AND CHECKED THE SAME
 *        SESSION EIGHT TIMES TO DRAW ONE PAGE.
 *
 *        /dashboard opened with
 *
 *            await Promise.allSettled([
 *                getMyServiceRegistrations(), getMyUnreadNotificationCount(),
 *                getMyUnreadMessageCount(),   getMyNotifications(4),
 *                getMyWalletBalance(),        getMyActiveOrderCount(),
 *                getUpcomingEvents(3),        getRecentResources(3),
 *            ]);
 *
 *        Parallel in the browser, and still EIGHT SEPARATE SERVER ACTIONS —
 *        eight HTTP round trips, each paying the full latency to the container.
 *
 *        And each one opens with currentUserId() -> requireSession(), which
 *        tries Redis and falls through to a DATABASE READ OF THE USER DOCUMENT
 *        when the cache misses. With UPSTASH_REDIS_REST_URL unset — which is
 *        how this platform is deployed today, and the startup log says so —
 *        every miss is a real read. So one dashboard load cost eight identical
 *        reads of the same row before doing any of the work it was asked for.
 *
 *        ONE round trip now, ONE session check, and the eight queries run in
 *        parallel where they are cheapest: next to the database. The eight
 *        functions stay exported and unchanged — other screens call several of
 *        them individually, and this is not a reason to disturb those.
 *
 *        THIS IS THE HALF THAT DOES NOT DEPEND ON CONFIGURATION. Setting Redis
 *        removes seven of the eight profile READS; this removes seven of the
 *        eight ROUND TRIPS and seven of the eight session checks whether Redis
 *        is there or not. Both are worth having.
 */
export interface MyDashboard {
    serviceRegistrations: Record<string, any>;
    unreadNotifications: number;
    unreadMessages: number;
    recentNotifications: any[];
    walletBalance: number;
    activeOrders: number;
    upcomingEvents: any[];
    recentResources: any[];
}

/** Everything /dashboard draws, in one call. */
export async function getMyDashboard(): Promise<MyDashboard> {
    const empty: MyDashboard = {
        serviceRegistrations: {}, unreadNotifications: 0, unreadMessages: 0,
        recentNotifications: [], walletBalance: 0, activeOrders: 0,
        upcomingEvents: [], recentResources: [],
    };

    // The one session check. Every function below re-checks it internally too —
    // they are still individually callable and must stay safe on their own —
    // but with the id already resolved those checks hit the same request's
    // resolved session rather than eight separate ones.
    if (!(await currentUserId())) return empty;

    // allSettled, NOT all — for the reason /dashboard's own comment gives: one
    // rejection must cost its own tile and not the whole page. Each function
    // already returns a safe default internally, so a rejection here is the
    // unexpected case and is logged by name.
    const settled = await Promise.allSettled([
        getMyServiceRegistrations(),
        getMyUnreadNotificationCount(),
        getMyUnreadMessageCount(),
        getMyNotifications(4),
        getMyWalletBalance(),
        getMyActiveOrderCount(),
        getUpcomingEvents(3),
        getRecentResources(3),
    ]);

    const at = <T,>(index: number, fallback: T, name: string): T => {
        const result = settled[index];
        if (result.status === "fulfilled") return result.value as T;
        logger.error(`[my-data] dashboard: ${name} failed`, { reason: result.reason });
        return fallback;
    };

    return {
        serviceRegistrations: at(0, {}, "service registrations"),
        unreadNotifications: at(1, 0, "unread notification count"),
        unreadMessages: at(2, 0, "unread message count"),
        recentNotifications: at(3, [], "recent notifications"),
        walletBalance: at(4, 0, "wallet balance"),
        activeOrders: at(5, 0, "active order count"),
        upcomingEvents: at(6, [], "upcoming events"),
        recentResources: at(7, [], "recent resources"),
    };
}

/**
 * The caller's roles, read LIVE from their document.
 *
 *   THE OWNER: "this is still the seller's dashboard with the buyer's features
 *   why? ... A buyer can only see the buyers features and the seller can only
 *   see sellers features and when users sign up as both seller and buyer then
 *   they can see all the features on the sidebar."
 *
 *   The rule is theirs and it is plain. What made it hard to APPLY is that
 *   ModuleSidebar decides from `session.user.roles` — a JWT claim, and
 *   auth.config.ts issues stateless tokens with an 8-hour maxAge. #878 refused
 *   to gate a list of your own things on that claim for exactly this reason,
 *   and it was right to: a member approved five minutes ago still carries the
 *   old token, so gating on it hides screens from people who have earned them
 *   until they sign out and back in.
 *
 *   So the claim is replaced rather than the gate abandoned. This is the same
 *   repair #460 made to the academy enrolment path and #364 made to fifteen API
 *   routes: ask the document, not the token.
 *
 *   ONE FIELD, DELIBERATELY. The nav needs to know what this account may do and
 *   nothing else, and this module's rule 2 is that each function answers one
 *   specific question. Returning the whole user document to a client component
 *   would hand the browser a KYC record to draw a sidebar with.
 */
export async function getMyLiveRoles(): Promise<string[]> {
    const userId = await currentUserId();
    if (!userId) return [];

    try {
        const snap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        if (!snap.exists) return [];
        const roles = (snap.data() as { roles?: unknown } | undefined)?.roles;
        return Array.isArray(roles) ? roles.filter((r): r is string => typeof r === "string") : [];
    } catch (error) {
        /*
         *   AN UNREADABLE DOCUMENT FALLS BACK TO THE TOKEN, NOT TO NOTHING.
         *
         *   The caller treats [] as "no answer yet" and keeps using the claim.
         *   Returning an empty list as though it were the truth would empty the
         *   sidebar for everybody the moment a read failed — which is the
         *   failure #878 warned about, arriving by a different route.
         */
        logger.error("[my-data] getMyLiveRoles failed; the caller keeps its token claim", { userId, error });
        return [];
    }
}

/** The three values the nav draws, and nothing else. */
export interface MyNavSummary {
    serviceRegistrations: Record<string, any>;
    unreadNotifications: number;
    unreadMessages: number;
}

/**
 * The nav's three values in ONE call.
 *
 *   #539 THE NAV POLLED THREE THINGS THE DASHBOARD WAS ALREADY FETCHING.
 *
 *        DashboardNav ran three separate pollers — service registrations (8s),
 *        unread messages (8s) and, through useUnreadNotifications, unread
 *        notifications (10s). getMyDashboard returns ALL THREE. On /dashboard
 *        every one of them was therefore fetched TWICE, about every eight
 *        seconds, for as long as the screen was open.
 *
 *        #453 collapsed the dashboard PAGE's eight actions into one round trip
 *        and #538 stopped the polling in hidden tabs. Neither could see this,
 *        because the duplication is not inside one component: the nav lives in
 *        the LAYOUT and the tiles live in the PAGE, and nothing was shared
 *        between them.
 *
 *        This is the same "several doors onto one thing" the audit keeps
 *        finding. It costs latency rather than correctness, which is why it
 *        survived so long — nothing was ever WRONG on the screen.
 *
 *   WHY A SECOND ACTION RATHER THAN REUSING getMyDashboard EVERYWHERE.
 *   DashboardNav is also mounted by /messages, where there is no dashboard to
 *   draw. Sharing getMyDashboard there would have replaced three cheap queries
 *   with eight, so the nav asks for what the nav needs. The three functions are
 *   the same ones getMyDashboard calls, so there is still one definition of
 *   each value — this composes them, it does not restate them.
 */
export async function getMyNavSummary(): Promise<MyNavSummary> {
    const empty: MyNavSummary = {
        serviceRegistrations: {}, unreadNotifications: 0, unreadMessages: 0,
    };

    // The one session check, for the same reason getMyDashboard has one.
    if (!(await currentUserId())) return empty;

    // allSettled, not all: one failing count must cost its own badge and not
    // blank the whole navigation.
    const settled = await Promise.allSettled([
        getMyServiceRegistrations(),
        getMyUnreadNotificationCount(),
        getMyUnreadMessageCount(),
    ]);

    const at = <T,>(index: number, fallback: T, name: string): T => {
        const result = settled[index];
        if (result.status === "fulfilled") return result.value as T;
        logger.error(`[my-data] nav summary: ${name} failed`, { reason: result.reason });
        return fallback;
    };

    return {
        serviceRegistrations: at(0, {}, "service registrations"),
        unreadNotifications: at(1, 0, "unread notification count"),
        unreadMessages: at(2, 0, "unread message count"),
    };
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
        //   #615 — one over the window is not enough here: archived rows are
        //   filtered AFTER the read, so a page made entirely of archived rows
        //   would come back empty while current ones sat just past the limit.
        //   Reading a multiple and trimming to `max` keeps the caller's contract.
        //   #904 (userId) — same argument as the order counts already widened
        //   in this file: my-data answers "what do you hold about me", and a
        //   notice on a superseded profile is still held about them.
        const snap = await filterByOwner(
            db.collection(COLLECTIONS.NOTIFICATIONS), "userId",
            await ownedProfileIds(userId))
            .orderBy("createdAt", "desc")
            .limit(max * 3)
            .get();

        //   Archived rows are off the list and still in the store. Through the
        //   shared predicate rather than `archived !== true` written out here,
        //   because that is the spelling that drifts — #439, and the reason every
        //   other shared reading in this codebase exists.
        return serializeDocs<any>(snap.docs).filter(isOnTheList).slice(0, max);
    } catch (error) {
        logger.error("[my-data] getMyNotifications failed", { userId, error });
        return [];
    }
}

/**
 * Count of the caller's unread notifications — the ones they can actually see.
 *
 *   #416 TWO BADGES FOR ONE FACT, COUNTED DIFFERENTLY.
 *
 *   This was a server-side `.count()` over every unread row for the user.
 *   NotificationCenter, meanwhile, computes the number on its bell from the 50
 *   notifications it fetched, AFTER `isNotificationVisible` has removed the
 *   ones belonging to modules the user is not subscribed to.
 *
 *   Both badges are on the dashboard at once — the bell in the layout header,
 *   and DashboardNav's, through useUnreadNotifications. So a member subscribed
 *   to one module with unread rows from another saw two different numbers side
 *   by side, and the larger one could not be cleared: opening the panel shows
 *   only the visible ones, so the nav badge never came down. A badge counting
 *   things the panel will not show is a badge with no way out.
 *
 *   #390's class, with a symptom you can see: one rule stated twice, the copies
 *   differing in both the filter and the window.
 *
 *   The rule is stated once now — the same window, and the same set. Both badges
 *   agree by construction, and both cap at the same 50.
 *
 *   #634 AND THE SET THEY AGREED ON WAS THE WRONG ONE. Making both badges apply
 *   `isNotificationVisible` stopped them disagreeing — on zero. The filter hid
 *   module-typed notifications from members with no active registration for that
 *   module, which is most of the people those notifications are written to: an
 *   escrow buyer, an export booker, a dispute respondent. So a member with five
 *   unread escrow rows had no bell count, opened the panel, and read "No
 *   notifications yet". The filter is gone; the shared window is the whole of
 *   what makes these two numbers one number, and it is still shared.
 */
export async function getMyUnreadNotificationCount(): Promise<number> {
    let session: Awaited<ReturnType<typeof requireSession>>["session"] = null;
    try {
        session = (await requireSession()).session;
    } catch (error) {
        logger.error("[my-data] session lookup failed", { error });
        return 0;
    }

    const userId = session?.user?.id;
    if (!userId) return 0;

    //   #687 THE RULE IS STATED ONCE, in lib/unread-notification-count.ts.
    //
    //   This query used to live here, and the notification service kept a THIRD
    //   version of the same question — a cached `users.unreadCount` that five
    //   of the platform's notification writers never touched. Two copies of a
    //   counting rule is what #416 was; three is what #687 found.
    //
    //   #634 still holds inside that rule: nothing is subtracted for a module
    //   the member is not registered for, because the notification was
    //   addressed to them regardless.
    return countUnreadNotifications(userId);
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
    //
    // #585 AND EXPORT ORDERS COUNT TOO.
    //
    // export_orders is keyed `buyerId` exactly as the marketplace's is, and the
    // export payment callback sends the buyer HERE — "View My Dashboard" — with
    // a tile that read one of the two collections. So the order they had just
    // paid tens of thousands of dollars for was not among their active orders.
    //
    // Two statuses are export-only and both are terminal: cancelled_out_of_stock
    // (#582) and refunded. isActiveOrderStatus is a whitelist, so neither is
    // counted, which is right — an order awaiting a refund is not in flight.
    try {
        /*
         *   #904 (BUYER SIDE) — AND THIS FILE IS WHERE IT MATTERS MOST.
         *
         *   my-data is what the platform hands somebody who asks what it holds
         *   about them. An order placed on a profile they no longer sign in as
         *   is still theirs, and leaving it out does not merely under-count a
         *   tile — it answers "everything we have" with less than everything.
         */
        const buyerIds = await ownedProfileIds(userId);

        const [marketplaceSnap, exportSnap] = await Promise.all([
            filterByOwner(db.collection(COLLECTIONS.MARKETPLACE_ORDERS), "buyerId", buyerIds).get(),
            filterByOwner(db.collection(COLLECTIONS.EXPORT_ORDERS), "buyerId", buyerIds).get(),
        ]);

        return [...marketplaceSnap.docs, ...exportSnap.docs]
            .filter(d => isActiveOrderStatus(d.data().status)).length;
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
/*
 *   THE SAME TWO COLLECTIONS, FOR EVERY USER, EVERY EIGHT SECONDS.
 *
 *   Upcoming events are platform-wide — the rows do not depend on who is
 *   asking — but this ran once per caller anyway. `getMyDashboard` calls it,
 *   `dashboard/layout.tsx` awaits THAT on the server for every entry to
 *   /dashboard and its six sub-pages, and `NavSummaryProvider` then re-polls
 *   it every 8s for as long as the tab stays visible. Links to those pages
 *   are prefetched by default (only 13 `prefetch={false}` exist in the whole
 *   app), so the work also ran for pages nobody opened — the production log's
 *   repeated "destination stream closed early" on `/dashboard?_rsc=` is that
 *   render being paid for and thrown away.
 *
 *   Neither read carries a `.limit()`, so each costs up to
 *   DEFAULT_QUERY_LIMIT rows fetched in 1,000-row pages — up to five
 *   sequential round trips apiece — to render three tiles.
 *
 *   CACHED RATHER THAN NARROWED, deliberately. A `.limit()` with no
 *   `orderBy` drops rows arbitrarily and could hide the genuinely next
 *   event; ordering in the database is not safe to assume either, because
 *   the stored date shape varies enough that `toDate` accepts three of them.
 *   Caching changes no result — the same rows, the same filter, the same
 *   sort, just not recomputed per caller.
 *
 *   REVALIDATE RATHER THAN TAGS. Six files write these collections. A tag is
 *   correct only while every one of them remembers it, and a forgotten one
 *   shows a stale dashboard with nothing to say so. Sixty seconds is bounded
 *   staleness that needs no writer's cooperation: an admin's new training
 *   event appears within a minute, which is all this tile promises.
 *
 *   NOT EXPORTED. This module is "use server", so every export is a server
 *   action and a public endpoint. The cache wrapper is an implementation
 *   detail and stays module-private.
 */
const fetchUpcomingEventsCached = unstable_cache(
    async (max: number): Promise<any[]> => {
        const isUpcoming = (status: string, when: Date) =>
            status !== "cancelled" && status !== "completed" && when >= new Date();

        /*
         *   NARROWED TO THE FIELDS THE MAPPERS BELOW ACTUALLY READ — #696.
         *
         *   Both of these are PLATFORM-WIDE scans with no filter, run to draw
         *   three rows, behind the dashboard's eight-second poll. Every row
         *   came back as a whole document.
         *
         *   That is the exact cost the 2026-08-10 performance audit measured
         *   and named: "598 ms to scan ~1,830 rows ... the likely cause is
         *   large JSONB being detoasted by SELECT *. SELECTING FEWER COLUMNS
         *   IS THE FIX; indexing is not." A training event carries its agenda
         *   and a market event its stalls; neither appears on this tile.
         *
         *   THE FIELD LISTS ARE THE MAPPERS' OWN. Anything read below and not
         *   named here arrives as `undefined` and falls to its default — a
         *   silent wrong value, not an error — so the two must be kept in step.
         *   The fake database narrows exactly as the adapter does, so a field
         *   dropped from either list fails the suite rather than the tile.
         */
        const [waveSnap, marketSnap] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_TRAINING_EVENTS)
                .select("title", "description", "date", "status", "meetingLink", "instructor")
                .get(),
            db.collection(COLLECTIONS.VILLAGE_MARKET_EVENTS)
                .select("title", "description", "startTime", "status", "location", "state")
                .get(),
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
    },
    ["my-data", "upcoming-events"],
    { revalidate: 60 },
);

/** The next few platform events, newest deadline first. */
export async function getUpcomingEvents(max = 3): Promise<any[]> {
    //   The session check stays OUT of the cached function: it reads cookies,
    //   which a cached scope may not, and the answer is the same for everyone
    //   who passes it.
    if (!(await currentUserId())) return [];

    try {
        return await fetchUpcomingEventsCached(max);
    } catch (error) {
        logger.error("[my-data] getUpcomingEvents failed", { error });
        return [];
    }
}

/*
 *   PLATFORM-WIDE, FOR THE SAME REASON getUpcomingEvents ABOVE IS. One
 *   collection rather than two, read in full to show three rows, on the same
 *   server-rendered layout and the same 8s poll. Cached on the same terms and
 *   for the same reasons — see that header; this one does not restate them.
 */
const fetchRecentResourcesCached = unstable_cache(
    async (max: number): Promise<any[]> => {
        //   Narrowed on the same terms as getUpcomingEvents above — see that
        //   header. A resource row carries its file metadata and description;
        //   this tile shows a title and a date.
        const snap = await db.collection(COLLECTIONS.WAVE_RESOURCES)
            .select("title", "description", "category", "fileUrl", "fileName",
                "fileSize", "downloads", "uploadedAt", "createdAt", "isActive")
            .get();

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
    },
    ["my-data", "recent-resources"],
    { revalidate: 60 },
);

/** Most recently uploaded active WAVE resources. */
export async function getRecentResources(max = 3): Promise<any[]> {
    if (!(await currentUserId())) return [];

    try {
        return await fetchRecentResourcesCached(max);
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
        //   #904 (BUYER SIDE) — same reason as the order counts above: this
        //   is the answer to "what do you hold about me".
        const buyerIds = await ownedProfileIds(userId);

        const snap = await filterByOwner(
            db.collection(COLLECTIONS.DISPUTES), "buyerId", buyerIds,
        ).get();

        return serializeDocs<any>(snap.docs).sort(
            (a: any, b: any) => toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()
        );
    } catch (error) {
        logger.error("[my-data] getMyDisputes failed", { userId, error });
        return [];
    }
}

/**
 * The caller's SPENDABLE wallet balance. Wallet id is the user id.
 *
 * The live id, and on purpose — this is the figure the dashboard puts in front
 * of somebody about to spend it, and the balance functions only ever move the
 * live row (migration 005 keys both on p_user_id). A balance resolved across a
 * superseded profile would be a number this platform then refuses to honour at
 * checkout, which is a worse failure than the one it would be fixing.
 *
 * Money left under a superseded profile is caught where it matters instead:
 * the account-deletion guard counts every row (actions/user.ts), the supersede
 * tool refuses to strand it in the first place (admin/_duplicate_profiles.ts),
 * and wallet creation logs it (actions/wallet.ts).
 */
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
        //   #904 (userId) — BOTH, for the reason the comment above already
        //   gives about these two collections: "a member's own record of their
        //   withdrawals should not omit a whole class of them". A profile is
        //   another such class.
        const withdrawalIds = await ownedProfileIds(userId);

        const [platformSnap, coopSnap] = await Promise.all([
            filterByOwner(db.collection(COLLECTIONS.WITHDRAWALS), "userId", withdrawalIds)
                .orderBy("createdAt", "desc")
                .get(),
            filterByOwner(db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS), "userId",
                withdrawalIds)
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
    /*
     *   #799 EXPORT WAS MISSING, AND #415'S OWN HEADER NAMES IT.
     *
     *   That header says the defect it fixes "DECIDES A REDIRECT. All FIVE
     *   pending screens (wave, academy, export, marketplace, farm-nation)
     *   leave the 'Application Under Review' page on
     *   `applicationStatus === "approved"`."
     *
     *   Five screens named. FOUR entries in this table. /export/onboarding/pending
     *   asks for `export_onboarding_applications:status`, which matched nothing,
     *   so every poll fell to the `!spec` branch and returned UNKNOWN.
     *
     *   WHAT THAT COSTS, TRACED RATHER THAN GUESSED:
     *
     *     getMyApplicationStatus  → UNKNOWN (and logs "unlisted lookup")
     *     usePendingApplicationStatus → sets checkFailed and RETURNS EARLY,
     *                                   deliberately, so a non-answer cannot
     *                                   overwrite the last real status
     *     `status` therefore never leaves its initial "pending"
     *     the effect that redirects on "approved" NEVER FIRES
     *
     *   So an export applicant who HAS BEEN APPROVED sits on "Application
     *   Under Review" forever. Not intermittently — the lookup can never
     *   succeed, so it is every approved exporter, on every visit. The warning
     *   has been printing on every end-to-end run the whole time.
     *
     *   #415 built the right mechanism and wired it to four of the five doors
     *   it names. This audit's most repeated finding, one more time.
     *
     *   READ FROM serviceRegistrations, like farm-nation above, because that
     *   is the field EVERY transition writes: pending_approval on submit,
     *   approved on admin approval, rejected, and revision_required — which
     *   this page also redirects on. The application row is written too, but
     *   not on every one of those paths.
     */
    [`${COLLECTIONS.EXPORT_APPLICATIONS}:status`]: {
        collection: COLLECTIONS.USERS,
        statusField: "status",
        fromServiceRegistrations: "export",
    },
    /*
     *   COOPERATIVE — THE FIFTH DOOR, ADDED WITH THE SCREEN THAT NEEDS IT.
     *
     *   /cooperatives/onboarding/pending did not exist at all: the dashboard
     *   built that URL for cooperative members and the route 404'd, while the
     *   other three modules resolved. Observed in production, twice in
     *   thirty-two seconds from one phone.
     *
     *   THE ENTRY GOES IN WITH THE PAGE, not after it, because #799 above
     *   records exactly what a pending screen does without one: the poll
     *   returns UNKNOWN, usePendingApplicationStatus sets `checkFailed` and
     *   returns early, `status` never leaves its initial "pending", and the
     *   approval redirect never fires. Export sat like that for the whole
     *   life of #415. Adding the page alone would have reproduced it here —
     *   the same finding, one module over, in the fix for a sibling of it.
     *
     *   `cooperatives`, PLURAL. Both spellings live on this platform and
     *   schema-normalizer mirrors them as a pair, but every status transition
     *   writes the plural — _coop_membership, _coop_registration,
     *   _coop_identity and _coop_admin_members all do. Reading the singular
     *   would answer for a field the writers only reach through a mirror.
     *
     *   From serviceRegistrations rather than a membership row, for the reason
     *   given for farm-nation and export above: it is the field EVERY
     *   transition writes, including revision_required, which the page
     *   redirects on.
     */
    [`${COLLECTIONS.USERS}:cooperatives`]: {
        collection: COLLECTIONS.USERS,
        statusField: "status",
        fromServiceRegistrations: "cooperatives",
    },
};

export interface MyApplicationStatus {
    status: string;
    createdAt: string | null;
    rejectionReason: string | null;
}

const PENDING: MyApplicationStatus = { status: "pending", createdAt: null, rejectionReason: null };

/**
 *   #415 "I COULD NOT CHECK" WAS ANSWERED AS "YOU ARE STILL WAITING".
 *
 *   getMyApplicationStatus returned PENDING — a definite state — for four
 *   different situations: a genuine pending row, no row at all, a lookup that
 *   is not on the allowlist, NO SESSION, and a thrown query. The last two are
 *   not statuses. They are the absence of an answer.
 *
 *   AND IT DECIDES A REDIRECT. All five pending screens (wave, academy,
 *   export, marketplace, farm-nation) leave the "Application Under Review"
 *   page on `applicationStatus === "approved"`. So while the read keeps
 *   failing, an applicant who HAS been approved is held on a page telling them
 *   to wait — and one whose session has expired is told the same thing instead
 *   of being asked to sign in. #313's class ("MFA reported off when it could
 *   not check"), #316's ("academy payment status answered unpaid"), #323's
 *   ("a failed membership check ejected real WAVE members").
 *
 *   ITS OWN NEIGHBOUR ALREADY DISAGREED. getMyMembershipStatus, seventy lines
 *   below in this same file, answers "unauthenticated" with no session and
 *   "unknown" when it finds nothing — and both are asserted in
 *   lib/__tests__/my-data-status.test.ts, in the describe block directly under
 *   the one that asserted this function reports "pending" when the query
 *   fails. Two answers to one question, tested side by side, and the
 *   difference was never the subject of either test.
 *
 *   The two now agree. `snap.empty` still answers "pending": no application row
 *   IS the pending state for a page you only reach by applying. What changed is
 *   the three cases where nothing was actually read.
 */
const UNKNOWN: MyApplicationStatus = { status: "unknown", createdAt: null, rejectionReason: null };
const UNAUTHENTICATED: MyApplicationStatus = { status: "unauthenticated", createdAt: null, rejectionReason: null };

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
    if (!userId) return UNAUTHENTICATED;

    const spec = APPLICATION_QUERIES[`${collectionName}:${statusField}`];
    if (!spec) {
        logger.warn("[my-data] getMyApplicationStatus called with an unlisted lookup", {
            collectionName,
            statusField,
        });
        return UNKNOWN;
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

        //   #904 (userId) — "have I applied?" asked of every profile they
        //   hold. Missing it tells somebody who HAS applied that they have not
        //   (#849), which is the worst answer this function can give.
        const snap = await filterByOwner(
            db.collection(spec.collection), "userId", await ownedProfileIds(userId))
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
        return UNKNOWN;
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

        //   The fallback widens too, or a degraded answer is narrower than
        //   the one it replaces.
        const fallbackSnap = await filterByOwner(
            db.collection(spec.fallback), "userId", await ownedProfileIds(userId))
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
