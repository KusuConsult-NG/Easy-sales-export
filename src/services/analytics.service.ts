import { getAdminDb } from "@/lib/supabase-db";
import { AggregateField, FieldPath } from "@/lib/firestore-compat";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { UNKNOWN_DATE_ISO, dateRangeEnd, dateRangeStart } from "@/lib/date-utils";
import { AWAITING_REVIEW_STATUSES } from "@/lib/land-listing-status";
import { RECENT_ACTIVITY_DAYS } from "@/lib/recent-activity";
import { countLivePeople } from "@/lib/user-population";
//   #756 — one accepted-status list for every module tile, measured against
//   what the code actually writes rather than spelled out per query.
import { registrationStatusFilter, settledStatusFilter, inReviewStatusFilter } from "@/lib/module-registration-status";
import type {
    AnalyticsServiceContract,
    PlatformHealthMetrics,
    AnalyticsData,
    FinancialOverview,
    ModuleRegistrationStats,
    UserSegments
} from "@easy-sales/services";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────


async function safeCount(
    ref: import("@/lib/supabase-db").SupabaseQuery | any
): Promise<number> {
    try {
        const snap = await ref.count().get();
        return snap.data().count ?? 0;
    } catch (_e) {
        return 0;
    }
}

/** Returns a list of { label, start, end } for the last N calendar months */
function lastNMonths(n: number): Array<{ label: string; start: Date; end: Date }> {
    const months: Array<{ label: string; start: Date; end: Date }> = [];
    const now = new Date();
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = new Date(d.getFullYear(), d.getMonth(), 1);
        const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
        const label = d.toLocaleString("en-NG", { month: "short", year: "2-digit" });
        months.push({ label, start, end });
    }
    return months;
}

/**
 * How many recent payments the finance screen is sent.
 *
 * The read had no limit at all: it loaded every row in PROCESSED_PAYMENTS,
 * sorted them in memory and returned the lot as `recentTransactions`. A screen
 * showing "recent" activity needs a page, and #465 measured what the unbounded
 * form costs on a grown collection — `canceling statement due to statement
 * timeout`. The totals beside the list come from COUNT(*) and Paystack, not
 * from this list's length, which is what makes bounding it safe.
 */
const RECENT_TRANSACTION_LIMIT = 200;

/**
 * Read one settled aggregate, recording the figure as unreadable if it failed.
 *
 *   #768 ONE DEFINITION, BECAUSE WRITING THE PAIR BY HAND IS WHAT WENT WRONG.
 *
 *   #516 gave both of this service's overview methods the same vocabulary — a
 *   list of figures that could not be read, so a screen can say "Unavailable"
 *   instead of drawing an outage as a quiet day. `getDashboardStats` got a
 *   local helper and every one of its figures went through it.
 *   `getFinancialOverview` hand-wrote the pair instead:
 *
 *       x = r.status === "fulfilled" ? r.value.data().total ?? 0 : 0;
 *       if (r.status !== "fulfilled") { unavailable.push("x"); logger.error(…) }
 *
 *   and after three of those somebody stopped writing the second half. #753
 *   counted the result: eight bare ternaries, five with no name attached —
 *   including `totalRevenue`, the figure revenue-display.ts exists for.
 *
 *   The zero is DELIBERATE and unchanged: the screen still renders, and the
 *   name is what separates "no activity" from "we could not count it". What
 *   changes is that a caller cannot produce the first without the second,
 *   because it is one call.
 *
 *   A FACTORY rather than a free function taking the array each time, so a call
 *   site reads the same in both methods and neither can pass the wrong list.
 */
function figureReader(into: string[], label: string) {
    return <T>(
        name: string,
        result: PromiseSettledResult<T>,
        read: (v: T) => number,
    ): number => {
        if (result.status === "fulfilled") return read(result.value);
        into.push(name);
        logger.error(`[${label}] ${name} could not be read`, {
            reason: String(result.reason),
        });
        return 0;
    };
}

export class AnalyticsService implements AnalyticsServiceContract {
    /**
     * Aggregates key system health and usage metrics.
     */
    static async getPlatformHealthMetrics(): Promise<PlatformHealthMetrics> {
        const db = getAdminDb();
        
        //   #518 "ACTIVE USERS" MEANT SOMETHING DIFFERENT HERE FROM EVERYWHERE
        //   ELSE, AND WAS COMPUTED FROM A FIELD NOBODY WRITES.
        //
        //   This read `totalUsers - (users where status == "suspended")`.
        //
        //   NOTHING WRITES THAT. The only `status: "suspended"` write in the
        //   codebase is on a seller VERIFICATION record
        //   (api/admin/marketplace/suspend-seller), never on a user document;
        //   account suspension is auth-revocation.ts setting `disabled` on the
        //   auth account. So the subtrahend was always 0 and `activeUsers` was
        //   `totalUsers` — every account ever created, reported as active.
        //
        //   THE SIBLING QUERY IN THIS SAME Promise.all RECORDS THE IDENTICAL
        //   DEFECT: "'locked' is not an escrow status and never was … so
        //   `activeEscrows` has always read 0". Whoever found that fixed the
        //   escrow line and left the line above it, which is this audit's most
        //   repeated shape — the fix reaching one of N doors — with the two
        //   doors adjacent in one array.
        //
        //   AND IT WAS A THIRD DEFINITION. lib/recent-activity.ts is this
        //   platform's stated rule for "recently active" and its header argues
        //   the key deliberately; getDashboardStats applies it. This method
        //   answered a different question under the same label, so two admin
        //   surfaces could report "Active Users" an order of magnitude apart.
        //   One rule now, and RECENT_ACTIVITY_DAYS rather than a hand-written 30.
        const activeSince = new Date();
        activeSince.setDate(activeSince.getDate() - RECENT_ACTIVITY_DAYS);

        try {
            /*
             *   #735 ERASING AN ACCOUNT MADE IT COUNT AS AN ACTIVE USER.
             *
             *   "Active" here is `updatedAt >= 30 days ago`, and BOTH of this
             *   platform's tombstone operations write `updatedAt`:
             *
             *     user-soft-delete   `updatedAt: FieldValue.serverTimestamp()`
             *                        in the scrub patch
             *     #724's resolver    the same, beside `_migratedTo`
             *
             *   So the act of honouring a deletion request moved this number UP,
             *   and kept it up for thirty days. Resolving a duplicate did the
             *   same. The metric ran backwards from what it reports.
             *
             *   SUBTRACTED BY INCLUSION–EXCLUSION rather than filtered, because
             *   these are `.count()` aggregates with no rows to inspect. A row
             *   that is both deleted AND superseded would otherwise be removed
             *   twice, so it is added back.
             *
             *   `_migratedTo != ""` matches rows that HAVE the field and no
             *   others — the adapter emits `raw_data->>'f' <> 'x'`, which is
             *   NULL and therefore NOT TRUE for a row missing the key. That
             *   property is asserted in fake-db-matches-postgres, and
             *   loadNonContactableUserIds relies on the same one.
             */
            const recentlyTouched = () =>
                db.collection(COLLECTIONS.USERS).where("updatedAt", ">=", activeSince);

            /*
             *   #747 — the inclusion–exclusion #735 wrote inline here now lives
             *   in lib/user-population.ts, because a second figure needed it:
             *   `totalUsers` beside it was a raw `.count()` of the same
             *   collection and carried the same tombstones.
             *
             *   Taking a QUERY rather than a collection is what lets one
             *   function serve both — the total counts over the whole
             *   collection, the active figure over the recently-touched window.
             */
            const [totalUsers, activeUsers, fundedEscrowsSnap] = await Promise.all([
                countLivePeople(db.collection(COLLECTIONS.USERS)),
                countLivePeople(recentlyTouched()),
                // An escrow holding money is `funded`: marketplace/_payment.ts
                // sets it when payment clears, and it stays there until a
                // release, a refund or a dispute moves it on.
                db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "funded").count().get()
            ]);

            return {
                totalUsers,
                activeUsers,
                activeEscrows: fundedEscrowsSnap.data().count ?? 0,
                lastCalculatedAt: new Date().toISOString()
            };
        } catch (error) {
            logger.error("Failed to fetch platform health metrics:", error);
            //   THE CATCH USED TO RETURN THREE ZEROS AND A FRESH
            //   lastCalculatedAt — fabricated figures stamped as just measured,
            //   which is the worst version of the shape #514, #516 and #517 each
            //   found: not merely a failed read rendered as an answer, but one
            //   carrying a timestamp asserting its freshness.
            return {
                totalUsers: 0,
                activeUsers: 0,
                activeEscrows: 0,
                lastCalculatedAt: new Date().toISOString(),
                unavailable: ["totalUsers", "activeUsers", "activeEscrows"],
            };
        }
    }

    async getPlatformHealthMetrics(): Promise<PlatformHealthMetrics> {
        return AnalyticsService.getPlatformHealthMetrics();
    }

    // Centralized Helper: Get Platform Metrics without session checks
    private async getPlatformMetrics(db: any, options?: { dateFrom?: Date; dateTo?: Date }) {
        /*
         *   #747 — this was `db.collection(USERS).count()`, every row, and it
         *   is the figure the admin dashboard shows as Total Users. It counted
         *   accounts erased at the person's request and superseded duplicate
         *   rows that #724's resolver had already established are the same
         *   person as a live row.
         *
         *   #735 built exactly this subtraction for the ACTIVE figure, in this
         *   same file, four lines above another raw count. One of two. The rule
         *   is in lib/user-population.ts now and both read it.
         */
        const totalUsers = await countLivePeople(db.collection(COLLECTIONS.USERS));

        let totalRevenue = 0;
        let totalTransactions = 0;
        //   #699 — always false now, and kept on the payload rather than
        //   removed. It meant "the Paystack sweep stopped at its ceiling, so
        //   this is a floor"; the database aggregate has no ceiling, so the
        //   figure is exact. The field stays because the dashboard and #665's
        //   ratchet both read it, and a caller that stops finding it would be a
        //   worse change than one that always finds it false.
        const revenueIsPartial = false;

        /**
         *   #699 THIS SWEPT PAYSTACK'S HTTP API, SEQUENTIALLY, ON A PAGE RENDER.
         *
         *   It called eachPaystackSuccess with NO maxPages, so it used
         *   MAX_REVENUE_PAGES — up to 100 awaited round trips to a third party,
         *   100 transactions at a time, with the whole admin dashboard behind a
         *   full-screen spinner until it finished. The cost grew with every
         *   payment the platform had ever taken.
         *
         *   The fallback below was always the better answer and said so in its
         *   own words: the aggregate is computed BY THE DATABASE over the whole
         *   table, so it is never partial, where the sweep was capped and
         *   reported `revenueIsPartial` when it truncated. The slow source was
         *   also the less accurate one.
         *
         *   READING THE LEDGER IS NOT A SHORTCUT. Whether the ledger matches
         *   Paystack is reconciliation's question, and cron/reconcile-paystack
         *   asks it on a schedule — returning 409 when money is missing (#677)
         *   rather than reporting success. A live sweep on a page render does
         *   not make the figure truer; it makes it slower, capped, and dependent
         *   on Paystack being up.
         */
        let revenueSource: "paystack" | "database" | null = null;

        {
            try {
                let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                    .where("status", "==", "completed");
                if (options?.dateFrom) {
                    query = query.where("processedAt", ">=", options.dateFrom);
                }
                if (options?.dateTo) {
                    query = query.where("processedAt", "<=", options.dateTo);
                }
                const revenueSnap = await query
                    .aggregate({
                        totalRevenue: AggregateField.sum("amount"),
                        totalTransactions: AggregateField.count()
                    })
                    .get();
                const data = revenueSnap.data();
                totalRevenue = Number(data.totalRevenue) || 0;
                totalTransactions = Number(data.totalTransactions) || 0;
                revenueSource = "database";
            } catch (e: any) {
                logger.error(`[PlatformMetrics] Firestore fallback aggregate query failed: ${e.message}`);
            }
        }

        if (revenueSource === null) {
            // Both sources failed. Returning 0 here is what made an outage
            // indistinguishable from a day with no sales — the figure was
            // rendered with the same confidence as a real one. revenueAvailable
            // lets the dashboard say "unavailable" instead of "₦0".
            logger.error(
                "[PlatformMetrics] Revenue could not be determined from Paystack or the database. " +
                "Reporting it as unavailable rather than as zero."
            );
        }

        return {
            totalRevenue,
            totalTransactions,
            totalUsers,
            revenueAvailable: revenueSource !== null,
            revenueSource,
            revenueIsPartial,
        };
    }

    // Centralized Helper: Get Global Pending Approvals without session checks
    private async getGlobalPendingApprovals(db: any) {
        const [
            wave,
            cooperative,
            exportOnboarding,
            sellers,
            land,
            loans,
            waveWithdrawals,
            cooperativeWithdrawals
        ] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("membershipStatus", "==", "pending").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "==", "pending").count().get(),
            // The sibling of the count in global-aggregation.ts. `pending` on a
            // land listing means "reserved by a buyer mid-purchase", not
            // "awaiting approval" — see land-listing-status.ts. `in` over the
            // whole set: `[0]` undercounted by every outstanding inspection.
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...AWAITING_REVIEW_STATUSES]).count().get(),
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).where("status", "==", "pending").count().get()
        ]);

        const counts = {
            wave: wave.data().count || 0,
            cooperative: cooperative.data().count || 0,
            export: exportOnboarding.data().count || 0,
            sellers: sellers.data().count || 0,
            land: land.data().count || 0,
            loans: loans.data().count || 0,
            withdrawals: (waveWithdrawals.data().count || 0) + (cooperativeWithdrawals.data().count || 0)
        };

        const totalPending = Object.values(counts).reduce((sum, count) => sum + count, 0);

        return {
            totalPending,
            counts
        };
    }

    /**
     *   #473 THIS DOWNLOADED THE ENTIRE USERS TABLE TO COUNT FOUR NUMBERS.
     *
     *   Measured through a real browser logged in as admin, against real
     *   PostgREST and real PostgreSQL with 50,009 users, every database round
     *   trip recorded with its method and payload:
     *
     *       /admin, cold load     96 round trips
     *         count-only (HEAD)   29 calls, 1,415 ms — correct and cheap
     *         returning rows      67 calls, 8,795 ms, 4.6 MB transferred
     *
     *   Over fifty of those 67 were the loop below, at 92 kB a page, and its
     *   entire output is four integers. It also fired all 51 pages at once
     *   through Promise.all, so one dashboard widget saturated the connection
     *   pool and everything else on the page queued behind it.
     *
     *   The classification is now migration 029's user_segment(), and the
     *   counting is count_user_segments() — ONE round trip, no rows leaving the
     *   database. The SQL is held to the JavaScript by
     *   src/__tests__/pg/the-sql-segments-agree-with-the-javascript.test.ts,
     *   which classifies the same 37 documents both ways and fails on a single
     *   disagreement, because these four numbers are on the admin dashboard and
     *   a silent change to them is worse than the slowness.
     */
    private async countUserSegmentsInDatabase(): Promise<UserSegments | null> {
        const { supabaseAdmin } = await import("@/lib/supabase");

        const { data, error } = await supabaseAdmin.rpc("count_user_segments");
        if (error) {
            console.error(
                "[ANALYTICS SERVICE] count_user_segments unavailable — falling back to reading " +
                "the whole users table, which is slow and was #473. Apply " +
                "supabase/migrations/029_user_segment_counts.sql. Reason:",
                error.message,
            );
            return null;
        }

        // Supabase returns a one-row set for a TABLE-returning function.
        const row = Array.isArray(data) ? data[0] : data;
        if (!row) return null;

        return {
            active: Number(row.active) || 0,
            pending: Number(row.pending) || 0,
            stalled: Number(row.stalled) || 0,
            ghost: Number(row.ghost) || 0,
        };
    }

    /**
     * The pre-#473 implementation, kept as the fallback ONLY.
     *
     * It is still correct and still slow. It runs when migration 029 has not
     * been applied yet — the owner deploys code and applies migrations
     * separately, and #469 is what happens when that order is assumed away. A
     * deploy that lands before the migration is then slow rather than broken,
     * and the log above says exactly which file fixes it.
     */
    private async calculateUserSegments(): Promise<UserSegments> {
        const { supabaseAdmin } = await import("@/lib/supabase");
        const { categorizeUser } = await import("@/lib/broadcast-logic");

        // Fetch total count to determine chunks
        const { count, error: countErr } = await supabaseAdmin
            .from("users")
            .select("*", { count: "exact", head: true });

        if (countErr || count === null) {
            console.error("[ANALYTICS SERVICE] Failed to get user count for segmentation:", countErr);
            return { active: 0, pending: 0, stalled: 0, ghost: 0 };
        }

        const pageSize = 1000;
        const totalPages = Math.ceil(count / pageSize);
        const promises = [];

        for (let page = 0; page < totalPages; page++) {
            promises.push(
                supabaseAdmin
                    .from("users")
                    //   #756 — the two tombstone fields come with the row so the
                    //   loop can skip them. See the note on the loop below.
                    .select("raw_data->serviceRegistrations, raw_data->verificationProfile, raw_data->bankDetails, raw_data->address, raw_data->deleted, raw_data->_migratedTo")
                    .range(page * pageSize, (page + 1) * pageSize - 1)
            );
        }

        const results = await Promise.all(promises);
        const counts = {
            active_users: 0,
            pending_users: 0,
            stalled_users: 0,
            ghost_users: 0
        };

        for (const res of results) {
            if (res.error) continue;
            const users = res.data || [];
            for (const u of users) {
                /*
                 *   #756 AN ERASED ACCOUNT WAS COUNTED, AND COUNTED AS A GHOST.
                 *
                 *   Reported by the owner, who had two different platform
                 *   populations on one screen: "41,696 Unique Accounts" beside
                 *   "Total Analyzed 42,566".
                 *
                 *   #747 made the headline exclude tombstones — an account
                 *   erased at the person's request, and a profile superseded by
                 *   the duplicate resolver, are not people. This segmentation
                 *   never got that rule: it reads every row in the table.
                 *
                 *   And the bucket they land in is the worst one available. A
                 *   scrub removes the application, the bank details and the
                 *   address, which is the EXACT definition of `ghost_users` —
                 *   "No application, bank details or address on record". So
                 *   every erasure honoured made the Ghost figure bigger, and
                 *   the owner reading "Ghost 19,981 (46.9%)" was being shown
                 *   deleted accounts as a problem to fix.
                 *
                 *   Skipped in JS rather than filtered in the query,
                 *   deliberately: the negative PostgREST filter for "does not
                 *   have this key" is the one this codebase has already been
                 *   caught by — `raw_data->>'f' <> 'x'` is NULL, and therefore
                 *   not true, for a row missing the key, so it excludes exactly
                 *   the rows it should keep. The rows are already being read and
                 *   walked; two more fields on the select costs nothing and the
                 *   rule is then plain and testable.
                 */
                if ((u as any).deleted === true) continue;
                const migratedTo = (u as any)._migratedTo;
                if (typeof migratedTo === "string" && migratedTo !== "") continue;

                const reconstructed = {
                    serviceRegistrations: (u as any).serviceRegistrations,
                    verificationProfile: (u as any).verificationProfile,
                    bankDetails: (u as any).bankDetails,
                    address: (u as any).address
                };
                const category = categorizeUser(reconstructed);
                if (category in counts) {
                    counts[category as keyof typeof counts]++;
                }
            }
        }

        return {
            active: counts.active_users,
            pending: counts.pending_users,
            stalled: counts.stalled_users,
            ghost: counts.ghost_users
        };
    }

    /**
     * The four segment counters, LIVE.
     *
     *   #482 THE CACHE WAS PAYING FOR AN EXPENSE THAT NO LONGER EXISTS.
     *
     *   It cached for ten minutes because the only way to get these numbers was
     *   #473's whole-table read — 51 pages and 4.6 MB on this data. Ten minutes
     *   of staleness was a fair price for not doing that on every page load.
     *
     *   #473 replaced it with one RPC. Measured on 50,017 users, five runs:
     *
     *       count_user_segments()   58, 54, 52, 52, 50 ms
     *
     *   Fifty milliseconds is not worth ten minutes of wrong numbers, and the
     *   staleness cost more than time: the cache is per CONTAINER (Redis is not
     *   configured, so #459's in-memory fallback holds it), so two admins on two
     *   Railway instances could read different totals for the same platform at
     *   the same moment, with no way to tell which was current. The owner asked
     *   for them live; this is why that is now the right answer and was not
     *   before.
     *
     *   THE FALLBACK IS STILL CACHED, AND THAT IS THE WHOLE CARE IN THIS CHANGE.
     *   When migration 029 is absent the code reads the table page by page —
     *   51 requests fired at once. Uncached, that would run on EVERY admin page
     *   load: strictly worse than the behaviour #473 removed, from a change that
     *   reads as a simplification. So the cheap path is live and the expensive
     *   path keeps its ten minutes. The cache follows the cost, which is what it
     *   was always for.
     */
    private async getUserSegmentsCached(): Promise<UserSegments> {
        // #473's RPC: one round trip, ~50 ms. Read it live.
        const live = await this.countUserSegmentsInDatabase();
        if (live) return live;

        // Migration 029 is not applied. This path pages the whole users table,
        // so it keeps the cache it has always had — see the note above.
        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = "admin:user-segments-counts";

        try {
            const cached = await getCached<UserSegments>(cacheKey);
            if (cached) return cached;
        } catch (e) {
            // quiet fail on cache read
        }

        const segments = await this.calculateUserSegments();

        try {
            await setCache(cacheKey, segments, 600); // Cache for 10 minutes
        } catch (e) {}

        return segments;
    }

    /**
     * Centralized dashboard statistics.
     */
    async getDashboardStats(options?: { dateFrom?: string; dateTo?: string }): Promise<AnalyticsData> {
        const db = getAdminDb();
        const months = lastNMonths(6);
        const now = new Date();

        const filterFrom = options?.dateFrom ? dateRangeStart(options.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const filterTo   = options?.dateTo   ? dateRangeEnd(options.dateTo) : now;

        //   The same window as lib/recent-activity.ts and getPlatformHealthMetrics,
        //   read from the constant rather than spelled out a third time — #518.
        const thirtyDaysAgo = new Date(Date.now() - RECENT_ACTIVITY_DAYS * 24 * 60 * 60 * 1000);
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [
            activeUsersSnap,
            pendingEscrowsCount,
            activeLandCount,
            pendingLoansCount,
            recentActivityCount,
        ] = await Promise.allSettled([
            db.collection(COLLECTIONS.USERS).where("updatedAt", ">=", thirtyDaysAgo).count().get(),
            safeCount(db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "pending")),
            safeCount(db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "active")),
            safeCount(db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending")),
            safeCount(db.collection(COLLECTIONS.AUDIT_LOGS).where("timestamp", ">=", twentyFourHoursAgo)),
        ]);

        const isDateFiltered = !!(options?.dateFrom || options?.dateTo);

        /**
         *   #753 EVERY HEADLINE FIGURE COLLAPSED A FAILED READ TO ZERO. ONE OF
         *        THE EIGHT SAID SO.
         *
         *   Reported by the owner, from the live dashboard:
         *
         *       Total Users     0       Total registered accounts
         *       Active Users    0       Logged in recently
         *       Total Revenue   Unavailable
         *                               Could not reach Paystack or the database
         *
         *   Three tiles, one outage, and only the third told the truth. The
         *   platform has about 42,600 accounts, so "0" there is not a bad
         *   estimate — it is a statement that the business does not exist, on
         *   the first screen an administrator opens BECAUSE something looks
         *   wrong.
         *
         *   THE REASONING WAS ALREADY WRITTEN DOWN HERE, THREE TIMES:
         *
         *     - beside the zeros in the branch below — "A rejected metrics call
         *       is not zero revenue, it is no answer" — and then applied to
         *       revenue alone, while totalUsers and totalTransactions were set
         *       to 0 on the two lines above it with no flag at all;
         *     - on the revenue tile — "a zero here is a real business figure; an
         *       outage rendered as ₦0 is indistinguishable from a day with no
         *       sales";
         *     - and on `unavailableMonths` — "a bar of zero and a bar that could
         *       not be drawn look identical on a chart, and only one of them is
         *       a fact about the business".
         *
         *   A chart bar got this treatment and the user count did not. The
         *   recurring shape of this audit: a correct rule applied to some of the
         *   places it names.
         *
         * ── WHY A SET AND NOT EIGHT BOOLEANS ────────────────────────────────
         *
         *   `revenueAvailable` is a per-figure flag, and adding seven more is how
         *   the ninth figure gets forgotten. A figure records itself as
         *   unreadable by NAME, so the screen asks one question — "is this one
         *   unavailable" — and a figure added later either joins the set or is
         *   visibly absent from it.
         *
         *   Revenue keeps its own richer flag: it has a third state, `partial`,
         *   that no other figure has, and #665 fought to get that onto the
         *   payload.
         */
        const unavailableFigures: string[] = [];
        //   #768 One definition, shared with getFinancialOverview. It was
        //   declared inline here and that method hand-wrote the pair eight
        //   times instead, naming three figures and missing five.
        const settled = figureReader(unavailableFigures, "DashboardStats");

        let totalUsers: number;
        let totalRevenue: number;
        let totalTransactions: number;
        let pendingApprovals: number;
        // False when neither Paystack nor the database could give a figure, so the
        // dashboard can say "unavailable" rather than render a confident zero.
        let revenueAvailable: boolean;
        /**
         *   #665 TRUE WHEN THE FIGURE IS A FLOOR RATHER THAN A TOTAL.
         *
         *   getPlatformMetrics has returned this all along, beside
         *   revenueAvailable, under a comment reading "an admin reading this
         *   figure needs to know it is a floor, not a total. Surfaced on the
         *   payload below, not only logged."
         *
         *   IT WAS LOST HERE, not at the screen. Both branches below copy
         *   `revenueAvailable` out of that same object and neither copied this,
         *   so it never reached platformOverview — and the dashboard's type
         *   therefore did not have the field, which is why nothing read it. The
         *   compiler was enforcing its absence.
         */
        let revenueIsPartial = false;

        if (isDateFiltered) {
            const [newUsersSnap, metricsResult, pendingRes] = await Promise.allSettled([
                db.collection(COLLECTIONS.USERS)
                    .where("createdAt", ">=", filterFrom)
                    .where("createdAt", "<=", filterTo)
                    .count()
                    .get(),
                this.getPlatformMetrics(db, { dateFrom: filterFrom, dateTo: filterTo }),
                this.getGlobalPendingApprovals(db),
            ]);
            totalUsers = settled("totalUsers", newUsersSnap, (v) => v.data().count ?? 0);
            if (metricsResult.status === "fulfilled") {
                totalRevenue = metricsResult.value.totalRevenue;
                totalTransactions = metricsResult.value.totalTransactions;
                revenueAvailable = metricsResult.value.revenueAvailable;
                //   #665 — copied beside its sibling, which is where it was dropped.
                revenueIsPartial = metricsResult.value.revenueIsPartial;
            } else {
                //   A rejected metrics call is not zero revenue, it is no answer.
                //   #753 — and it is not zero TRANSACTIONS either, which is what
                //   the line below used to claim silently.
                totalRevenue = 0;
                totalTransactions = 0;
                revenueAvailable = false;
                unavailableFigures.push("totalTransactions");
            }
            pendingApprovals = settled("pendingApprovals", pendingRes, (v) => v.totalPending);
        } else {
            //   #517 THE TWO BRANCHES DISAGREED ABOUT WHAT A FAILURE MEANS.
            //
            //   The date-filtered branch above uses Promise.allSettled and says
            //   why — "A rejected metrics call is not zero revenue, it is no
            //   answer" — so a metrics outage leaves the rest of the dashboard
            //   standing with revenueAvailable false.
            //
            //   This branch used Promise.all, so the SAME failure threw out of
            //   getDashboardStats and took every other figure with it: pending
            //   escrows, land listings, loans, both charts, the module usage.
            //   And this is the DEFAULT branch — the one an admin gets on a
            //   plain page load, with the filtered view being the more robust of
            //   the two.
            //
            //   One rule: a figure that could not be read is unavailable, and
            //   the figures that WERE read are still worth showing.
            const [metricsResult, pendingResult] = await Promise.allSettled([
                this.getPlatformMetrics(db),
                this.getGlobalPendingApprovals(db),
            ]);
            if (metricsResult.status === "fulfilled") {
                totalUsers = metricsResult.value.totalUsers;
                totalTransactions = metricsResult.value.totalTransactions;
                totalRevenue = metricsResult.value.totalRevenue;
                revenueAvailable = metricsResult.value.revenueAvailable;
                //   #665 — copied beside its sibling, which is where it was dropped.
                revenueIsPartial = metricsResult.value.revenueIsPartial;
            } else {
                logger.error("[DashboardStats] platform metrics failed", {
                    reason: String(metricsResult.reason),
                });
                /*
                 *   #753 — THE THREE LINES THE OWNER WAS LOOKING AT.
                 *
                 *   `getPlatformMetrics` is the single read behind Total Users,
                 *   Total Transactions and Total Revenue on a plain page load,
                 *   so one rejection blanks all three — and only revenue was
                 *   marked. That is the exact screen in the report: two zeros
                 *   and one honest "Unavailable", from one failure.
                 */
                totalUsers = 0;
                totalTransactions = 0;
                totalRevenue = 0;
                revenueAvailable = false;
                unavailableFigures.push("totalUsers", "totalTransactions");
            }
            pendingApprovals = settled("pendingApprovals", pendingResult, (v) => v.totalPending);
        }

        const activeUsers = settled("activeUsers", activeUsersSnap, (v) => v.data().count ?? 0);
        const pendingEscrows = settled("pendingEscrows", pendingEscrowsCount, (v) => v);
        const activeLandListings = settled("activeLandListings", activeLandCount, (v) => v);
        const pendingLoans = settled("pendingLoans", pendingLoansCount, (v) => v);
        const recentActivity = settled("recentActivityCount", recentActivityCount, (v) => v);

        // Revenue by month — from the platform's own ledger (#699).
        let revenueByMonth: Array<{ month: string; revenue: number }> = [];
        // True when the monthly chart hit its page cap, so earlier months read
        // low. Surfaced rather than left for the reader to infer from a dip.
        let monthlyRevenueIsPartial = false;
        //   Months whose own query failed, by label — the difference between a
        //   flat bar and a bar nobody could draw.
        const unavailableMonths: string[] = [];

        /*
         *   #699 THE MONTHLY CHART SWEPT PAYSTACK ON EVERY DASHBOARD LOAD.
         *
         *   Five pages, three seconds of timeout each, awaited one after
         *   another, with DashboardClient holding a full-screen spinner over the
         *   whole page until it returned. The block's own comment priced it —
         *   "3s per extra page on a dashboard load" — and named the alternative:
         *   "summing from processed_payments instead would be exact and fast.
         *   That is a product call, so it is reported rather than taken."
         *
         *   The product call has been made: the owner reports a ten-second page.
         *   The per-month database aggregates below are what it now uses, and
         *   they were already written, already parallel, and already exact. The
         *   sweep also under-reported by construction: 500 transactions across
         *   twelve months meant early months were drawn from whatever was left.
         */

        {
            //   #517 A MONTH THAT FAILED TO READ WAS DRAWN AS A MONTH WITH NO
            //   SALES, AND THEN THE SERIES DECLARED ITSELF EXACT.
            //
            //   The catch below returned `{ month, revenue: 0 }`, so one
            //   aggregate timing out put a zero bar on the dashboard chart —
            //   indistinguishable from a month in which nothing was sold. And
            //   the line after the loop set
            //
            //       monthlyRevenueIsPartial = false;
            //
            //   with the comment "Per-month database aggregates are exact, so
            //   this path is complete" — a claim about completeness made
            //   unconditionally, five lines below the code that silently drops
            //   whole months. The flag existed for precisely this and was set to
            //   the wrong value on the one path that needed it.
            const failedMonths: string[] = [];
            const revenuePromises = months.map(async ({ label, start, end }) => {
                try {
                    const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                        .where("status", "==", "completed")
                        .where("processedAt", ">=", start)
                        .where("processedAt", "<=", end)
                        .aggregate({
                            total: AggregateField.sum("amount")
                        })
                        .get();
                    const total = Number(snap.data().total) || 0;
                    return { month: label, revenue: total, failed: false };
                } catch (e) {
                    logger.error("[DashboardStats] monthly revenue aggregate failed", {
                        month: label,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return { month: label, revenue: 0, failed: true };
                }
            });

            const settled = await Promise.all(revenuePromises);
            for (const m of settled) if (m.failed) failedMonths.push(m.month);
            revenueByMonth = settled.map(({ month, revenue }) => ({ month, revenue }));

            //   Exact ONLY when every month actually answered. The zero stays so
            //   the chart still renders, and the flag says it is not a reading.
            monthlyRevenueIsPartial = failedMonths.length > 0;
            unavailableMonths.push(...failedMonths);
        }

        const monthlyRevenue = revenueByMonth.length > 0 ? revenueByMonth[revenueByMonth.length - 1].revenue : 0;

        // User growth by month.
        //
        //   The same shape as the revenue series above: `catch (_e)` returned
        //   `{ users: 0 }`, so a failed count drew a month in which nobody
        //   joined. No logger either — #308's class.
        const userGrowthSettled = await Promise.all(
            months.map(async ({ label, start, end }) => {
                try {
                    const snap = await db
                        .collection(COLLECTIONS.USERS)
                        .where("createdAt", ">=", start)
                        .where("createdAt", "<=", end)
                        .count()
                        .get();
                    return { month: label, users: snap.data().count ?? 0, failed: false };
                } catch (e) {
                    logger.error("[DashboardStats] user growth count failed", {
                        month: label,
                        error: e instanceof Error ? e.message : String(e),
                    });
                    return { month: label, users: 0, failed: true };
                }
            })
        );
        const userGrowthByMonth = userGrowthSettled.map(({ month, users }) => ({ month, users }));
        for (const m of userGrowthSettled) if (m.failed) unavailableMonths.push(m.month);
        const userGrowthIsPartial = userGrowthSettled.some((m) => m.failed);

        // Module registration usage stats
        const canonicalStats = await this.getModuleRegistrationStats();
        const moduleUsage = [
            { module: "WAVE Apps", count: canonicalStats.wave },
            { module: "Briefings", count: canonicalStats.waveBriefing },
            { module: "Academy", count: canonicalStats.academy },
            { module: "Cooperative", count: canonicalStats.cooperatives },
            { module: "Co-op Onboarding", count: canonicalStats.cooperativeOnboarding },
            { module: "Farm Nation", count: canonicalStats.farmNation },
            { module: "Marketplace", count: canonicalStats.marketplace },
            { module: "Export Hub", count: canonicalStats.exportHub },
            { module: "Export Onboarding", count: canonicalStats.exportOnboarding },
        ].filter((m) => m.count > 0);

        // Recent transactions — filters must come before orderBy to avoid
        // Firestore composite index requirements on inequality fields.
        const recentTransactions: AnalyticsData["recentTransactions"] = [];
        try {
            let txQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed");
            if (isDateFiltered) {
                txQuery = txQuery
                    .where("processedAt", ">=", filterFrom)
                    .where("processedAt", "<=", filterTo);
            }
            txQuery = txQuery.orderBy("processedAt", "desc");
            const [txSnap] = await Promise.allSettled([txQuery.limit(15).get()]);

            const allDocs: any[] = [];
            if (txSnap.status === "fulfilled") {
                txSnap.value.docs.forEach(d => allDocs.push(d.data()));
            }

            allDocs.sort((a, b) => {
                const tsa = a.processedAt ?? a.createdAt ?? a.date ?? 0;
                const tsb = b.processedAt ?? b.createdAt ?? b.date ?? 0;
                const ta = tsa?.toDate ? tsa.toDate().getTime() : new Date(tsa).getTime();
                const tb = tsb?.toDate ? tsb.toDate().getTime() : new Date(tsb).getTime();
                return tb - ta;
            });

            let collected = 0;
            for (const d of allDocs) {
                if (collected >= 8) break;
                const ts = d.processedAt ?? d.createdAt ?? d.date ?? null;
                if (Number(d.amount) > 0 || d.amount === undefined || d.registrationFee !== undefined) {
                    recentTransactions.push({
                        id: d.id || Math.random().toString(),
                        type: d.type ?? d.action ?? "Transaction",
                        amount: Number(d.amount ?? d.registrationFee) || 0,
                        date: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : UNKNOWN_DATE_ISO)
                    });
                    collected++;
                }
            }
        } catch (e) {
            logger.error("Failed to fetch unified recent transactions in service:", e);
        }

        // User segments
        const userSegments = await this.getUserSegmentsCached();

        return {
            platformOverview: {
                totalUsers,
                activeUsers,
                totalRevenue,
                monthlyRevenue,
                totalTransactions,
                revenueAvailable,
                revenueIsPartial,
                pendingApprovals,
                recentActivityCount: recentActivity,
                //   #753 — the figures on this payload whose read FAILED. A
                //   zero that is a measurement and a zero that is an outage are
                //   different facts, and every tile but revenue rendered them
                //   identically. Named rather than flagged per figure, so a
                //   figure added later joins the set or is visibly absent.
                unavailableFigures,
            },
            counts: {
                pendingEscrows,
                activeLandListings,
                pendingLoans,
            },
            revenueByMonth,
            monthlyRevenueIsPartial,
            userGrowthByMonth,
            userGrowthIsPartial,
            //   The months whose own query failed, by label. A bar of zero and a
            //   bar that could not be drawn look identical on a chart, and only
            //   one of them is a fact about the business.
            unavailableMonths,
            moduleUsage: moduleUsage.length ? moduleUsage : [{ module: "No data yet", count: 1 }],
            userSegments,
            recentTransactions,
        };
    }

    /**
     * Centralized financial overview.
     */
    async getFinancialOverview(): Promise<FinancialOverview> {
        const db = getAdminDb();

        let totalRevenue = 0;
        const revenueIsPartial = false;
        let totalEscrowVolume = 0;
        let totalLoansDisbursed = 0;
        let totalSuccessfulCount = 0;
        let totalAbandonedCount = 0;
        let totalFailedCount = 0;
        const recentTransactions: FinancialOverview["recentTransactions"] = [];

        // 1. Fetch escrow total and loans total from Firestore (they are internal systems)
        const [allEscrowsR, loanR] = await Promise.allSettled([
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).aggregate({ total: AggregateField.sum("amount") }).get(),
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "disbursed").aggregate({ total: AggregateField.sum("amount") }).get(),
        ]);
        
        //   #516 A FAILED READ WAS RENDERED AS ZERO NAIRA.
        //
        //   `fulfilled ? total : 0` on a Promise.allSettled means a timed-out
        //   aggregate reaches the admin's finance screen as ₦0 of escrow volume
        //   and ₦0 of loans disbursed, with nothing saying the query failed.
        //   This file already had the vocabulary for exactly this —
        //   `revenueIsPartial` is set when the Paystack sweep hits its ceiling,
        //   with the note "an admin reading this figure needs to know it is a
        //   floor, not a total" — and it was applied to one number out of four.
        //
        //   The value stays 0 so the screen still renders; `unavailable` names
        //   what could not be read, which is the difference between "no escrow
        //   activity" and "we could not count it".
        /*
         *   #768 THE SAME HELPER getDashboardStats USES, NOT A SECOND SPELLING.
         *
         *   #516 gave this method the `unavailable` vocabulary and reached
         *   three figures with it, hand-writing the pair each time: a bare
         *   `fulfilled ? … : 0`, then an `if (… !== "fulfilled")` beside it
         *   that pushes a name. #753 counted what that left — EIGHT bare
         *   ternaries in this method, five of them with no name attached:
         *
         *       totalAbandonedCount     the recovery queue's size
         *       totalFailedCount        the recovery queue's other half
         *       totalRevenue            THE platform figure
         *       the two payout halves   an admin pays out against their sum
         *
         *   and recorded that the finance page "needs the same availability
         *   plumbing end to end". This is that work.
         *
         *   WHY THE HELPER AND NOT FIVE MORE PAIRS. getDashboardStats was
         *   repaired by `settled(name, result, read)` — one call that returns 0
         *   AND records the name — and the bare ternary is now absent from that
         *   whole method. Writing the pair by hand is what produced a method
         *   where three figures were named and five were not; the ninth would
         *   have gone the same way. Lifted to a module-level factory so both
         *   methods share one definition rather than two that can drift.
         */
        const unavailable: string[] = [];
        const settled = figureReader(unavailable, "FinancialOverview");

        totalEscrowVolume = settled("totalEscrowVolume", allEscrowsR, (v) => v.data().total ?? 0);
        totalLoansDisbursed = settled("totalLoansDisbursed", loanR, (v) => v.data().total ?? 0);

        /*
         *   #699 THIS PAGE CALLED PAYSTACK FOUR TIMES BEFORE IT RENDERED.
         *
         *   Three `perPage=1` probes to read success, failed and abandoned
         *   counts out of `meta.total`, and then eachPaystackSuccess with NO
         *   maxPages — up to 100 further awaited round trips, 3s of timeout
         *   each. On the finance tab, in front of the reader.
         *
         *   Every one of those numbers is already computed below from the
         *   platform's own ledger, by the database, over the whole table: the
         *   three `.count()` queries that the old code ran ANYWAY under the
         *   comment "Always calculate accurate counts from database
         *   collections", and the revenue aggregate that sat in the fallback.
         *   The API round trips bought nothing the next twenty lines did not
         *   already have.
         *
         *   Reconciliation is what proves the ledger matches Paystack, and it
         *   still sweeps — see cron/reconcile-paystack and
         *   api/admin/finance/reconcile. Neither renders a page.
         */
        // Always calculate accurate counts from database collections
        const [countAbandonedR, countFailedR, countSuccessR] = await Promise.allSettled([
            db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "abandoned").count().get(),
            db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "failed").count().get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").count().get(),
        ]);
        if (totalAbandonedCount === 0 || totalAbandonedCount === undefined) {
            totalAbandonedCount = settled("totalAbandonedCount", countAbandonedR, (v) => v.data().count ?? 0);
        }
        if (totalFailedCount === 0 || totalFailedCount === undefined) {
            totalFailedCount = settled("totalFailedCount", countFailedR, (v) => v.data().count ?? 0);
        }
        //   Neither source could count. Left at 0 and NAMED — this is the case
        //   the removed `totalSuccessfulCount = recentTransactions.length`
        //   fallback used to paper over, reporting the size of one page as the
        //   platform's lifetime total.
        const dbSuccessCount = settled("totalSuccessfulCount", countSuccessR, (v) => v.data().count ?? 0);
        if (dbSuccessCount > 0) {
            totalSuccessfulCount = Math.max(totalSuccessfulCount, dbSuccessCount);
        }

        {
            const [allTxnsR] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").aggregate({ totalRevenue: AggregateField.sum("amount") }).get(),
            ]);

            totalSuccessfulCount = countSuccessR.status === "fulfilled" ? (countSuccessR.value.data().count ?? 0) : totalSuccessfulCount;
            /*
             *   #768 THE WORST OF THE EIGHT, AND ONE OF THE FIVE STILL SILENT.
             *
             *   revenue-display.ts was written for exactly this number and says
             *   so: "unavailable — nothing could be read. Rendering ₦0 here is
             *   the defect #620 and #621 are filed under: an outage drawn as a
             *   day with no sales."
             *
             *   It gives three states and the machinery to show them, and
             *   nothing here ever selected the third for a FAILED AGGREGATE. So
             *   a timed-out revenue sum arrived at the finance screen as a
             *   confident ₦0 — the exact picture that helper exists to prevent.
             *
             *   Named on `unavailable`, which is the list the finance screen's
             *   own banner already reads and which the other seven figures in
             *   this method use. One vocabulary, not a fourth flag.
             */
            totalRevenue = settled("totalRevenue", allTxnsR, (v) => Number(v.data().totalRevenue) || 0);
        }

        try {
            //   #516 A LIST CALLED "RECENT" READ THE WHOLE TABLE, AND IT WAS
            //   NOT FILTERED TO THE THING IT WAS LABELLED.
            //
            //   This was `.orderBy("processedAt","desc").get()` — no status
            //   filter and NO LIMIT, on the collection every payment lands in.
            //   Every other read of PROCESSED_PAYMENTS in this file is bounded;
            //   this one loaded the collection, mapped it, sorted it in memory
            //   and returned all of it as `recentTransactions`, which the admin
            //   finance screen puts straight into React state and renders under
            //   the tab labelled SUCCESSFUL.
            //
            //   So a pending or failed row was listed as a successful payment,
            //   and #465 already measured what an unbounded read of a grown
            //   collection costs here: `canceling statement due to statement
            //   timeout`.
            const [txSnap] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                    .where("status", "==", "completed")
                    .orderBy("processedAt", "desc")
                    .limit(RECENT_TRANSACTION_LIMIT)
                    .get()
            ]);

            const toTx = (doc: any) => {
                const d = doc.data();
                const ts = d.date ?? d.processedAt ?? d.createdAt ?? d.requestedAt ?? d.timestamp ?? null;
                return {
                    id: doc.id,
                    type: d.type ?? d.action ?? "payment",
                    amount: Number(d.amount) || 0,
                    status: d.status ?? "completed",
                    description: d.description ?? d.purpose ?? d.note ?? null,
                    reference: d.reference ?? d.paymentReference ?? null,
                    timestamp: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : null),
                    phone: d.phone ?? d.userPhone ?? d.customerPhone ?? d.metadata?.phone ?? d.customer?.phone ?? null,
                    userId: d.userId ?? d.metadata?.userId ?? null,
                };
            };

            const all: ReturnType<typeof toTx>[] = [];
            if (txSnap.status === "fulfilled") all.push(...txSnap.value.docs.map(d => toTx(d)));

            all
                .filter(tx => tx.amount > 0)
                .sort((a, b) => {
                    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tb - ta;
                })
                .forEach(tx => recentTransactions.push(tx));

            //   THE COUNT NO LONGER REDEFINES ITSELF FROM THE LIST.
            //
            //   This was `if (recentTransactions.length > totalSuccessfulCount)
            //   totalSuccessfulCount = recentTransactions.length` — so the
            //   authoritative figure, taken from Paystack and cross-checked
            //   against a COUNT(*) on completed rows, was overwritten by the
            //   length of an unfiltered list whenever that list was longer.
            //   "Successful payments" became "rows in processed_payments with a
            //   positive amount", of any status.
            //
            //   Now that the list is a bounded page of at most
            //   RECENT_TRANSACTION_LIMIT rows, its length is not a total of
            //   anything and must never be read as one.
        } catch (e: any) {
            unavailable.push("recentTransactions");
            logger.error("[FinancialOverview] recent-transactions read failed", { error: e.message });
        }

        let pendingPayoutAmount = 0;
        const [coopPayoutsR, wavePayoutsR] = await Promise.allSettled([
            db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
        ]);
        /*
         *   #768 Both halves through the helper, so each names ITSELF when it
         *   is the one that failed — "pendingPayoutAmount" alone told an admin
         *   the total was unreadable without saying which side of it.
         *
         *   The combined name is KEPT as well, and deliberately: a sum of two
         *   halves where one failed is not a smaller sum, it is an unknown one,
         *   and this figure is what an admin pays out against. The screen reads
         *   the combined name; the halves are there for whoever has to work out
         *   which collection is down.
         */
        const coopPayouts = settled("pendingPayoutAmount.cooperative", coopPayoutsR, (v) => v.data().total ?? 0);
        const wavePayouts = settled("pendingPayoutAmount.wave", wavePayoutsR, (v) => v.data().total ?? 0);
        pendingPayoutAmount = coopPayouts + wavePayouts;
        if (coopPayoutsR.status !== "fulfilled" || wavePayoutsR.status !== "fulfilled") {
            unavailable.push("pendingPayoutAmount");
        }

        const failedTransactions: FinancialOverview["failedTransactions"] = [];
        try {
            /**
             *   #696 EVERY FAILED PAYMENT EVER RECORDED, IN FULL, ON A DASHBOARD.
             *
             *   This read had no projection and NO LIMIT. Its sibling two
             *   blocks up — `recentTransactions` — is capped at 15; this one
             *   took the whole collection, mapped it and sorted it in
             *   JavaScript, and returned all of it. The cost grows with the
             *   number of payments that have ever failed, which only goes up.
             *
             *   IT WAS ALREADY TRUNCATED, SILENTLY. A query with no .limit()
             *   stops at DEFAULT_QUERY_LIMIT (5,000) and logs a warning, so
             *   "every failed payment" was already a lie past that point — the
             *   worst of both, unbounded cost and an incomplete answer.
             *
             *   ORDERED ON THE NATIVE COLUMN, deliberately. The JavaScript sort
             *   below reads failedAt ?? abandonedAt ?? createdAt ?? updatedAt,
             *   and ordering on any ONE of those in SQL would hit #49: Postgres
             *   sorts DESC as NULLS FIRST, so the rows MISSING that key would
             *   come back first — abandoned rows have no failedAt. `createdAt`
             *   maps to the `created_at` COLUMN, which every table has and which
             *   is never null, so it orders every row and is monotonic with when
             *   the failure was recorded. The JS sort still runs, on the page.
             *
             *   The counts an admin reads are NOT affected: totalFailed and
             *   totalAbandoned come from .count() queries above, which the
             *   database answers over the whole table.
             */
            const FAILED_TRANSACTIONS_PAGE = 500;
            const failedSnap = await db.collection(COLLECTIONS.FAILED_PAYMENTS)
                .select(
                    "type", "amount", "status", "gatewayResponse", "paystackEvent",
                    "failedAt", "abandonedAt", "createdAt", "updatedAt",
                    "phone", "userPhone", "customerPhone", "metadata", "customer", "userId",
                )
                .orderBy("createdAt", "desc")
                .limit(FAILED_TRANSACTIONS_PAGE)
                .get();
            failedSnap.docs.forEach((doc: any) => {
                const d = doc.data();
                const parseTs = (val: any) => {
                    if (!val || (typeof val === 'object' && Object.keys(val).length === 0)) return null;
                    if (typeof val.toDate === 'function') return val.toDate().toISOString();
                    if (val._seconds) return new Date(val._seconds * 1000).toISOString();
                    if (typeof val === 'string' && val.length > 5) {
                        const parsedDate = new Date(val);
                        return isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString();
                    }
                    if (typeof val === 'number') return new Date(val).toISOString();
                    return null;
                };

                const timestamp = parseTs(d.failedAt) ?? parseTs(d.abandonedAt) ?? parseTs(d.createdAt) ?? parseTs(d.updatedAt) ?? null;

                failedTransactions.push({
                    id: doc.id,
                    type: d.type ?? "unknown",
                    amount: Number(d.amount) || 0,
                    status: (d.status === "abandoned" ? "abandoned" : "failed") as "failed" | "abandoned",
                    gatewayResponse: d.gatewayResponse ?? d.paystackEvent ?? null,
                    timestamp,
                    phone: d.phone ?? d.userPhone ?? d.customerPhone ?? d.metadata?.phone ?? d.customer?.phone ?? null,
                    userId: d.userId ?? d.metadata?.userId ?? null,
                });
            });
            failedTransactions.sort((a, b) => {
                const ta = a.timestamp && !isNaN(new Date(a.timestamp).getTime()) ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp && !isNaN(new Date(b.timestamp).getTime()) ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            });
        } catch (e) {
            // "Silently skip" was the comment here, and it meant the failed and
            // abandoned tabs rendered as empty — "no failed payments" — when the
            // read had thrown. #514's rule: an absence is not a fact.
            unavailable.push("failedTransactions");
            logger.error("[FinancialOverview] failed-payments read failed", {
                error: e instanceof Error ? e.message : String(e),
            });
        }

        // Hydrate phone numbers for transactions where phone is missing/placeholder
        try {
            const PLACEHOLDER_NAMES = new Set(["user", "unknown", "unknown user", "n/a", ""]);
            const isPlaceholder = (v: any) => !v || PLACEHOLDER_NAMES.has(String(v).toLowerCase().trim());

            const userIdsToFetch = new Set<string>();

            recentTransactions.forEach(tx => {
                if (isPlaceholder(tx.phone)) {
                    if (tx.userId) userIdsToFetch.add(tx.userId);
                }
            });

            failedTransactions.forEach(tx => {
                if (isPlaceholder(tx.phone)) {
                    if (tx.userId) userIdsToFetch.add(tx.userId);
                }
            });

            const userMapByUid = new Map<string, any>();
            const uids = Array.from(userIdsToFetch).filter(Boolean);

            if (uids.length > 0) {
                const chunks = [];
                for (let i = 0; i < uids.length; i += 30) {
                    chunks.push(uids.slice(i, i + 30));
                }
                const userSnaps = await Promise.all(
                    chunks.map(chunk =>
                        db.collection(COLLECTIONS.USERS)
                            .where(FieldPath.documentId(), "in", chunk)
                            /*
                             *   #696 — THE FOUR FIELDS getPhoneFromUser READS,
                             *   instead of the whole user document.
                             *
                             *   A user row is the largest document this platform
                             *   stores: serviceRegistrations, verificationProfile,
                             *   bankDetails, documents, kyc and address. This
                             *   hydration runs on the ADMIN FINANCIAL OVERVIEW,
                             *   once per distinct payer with a missing phone
                             *   across both the recent and the failed lists — so
                             *   the dashboard was pulling a full profile per
                             *   transaction to read a phone number off it.
                             *
                             *   `.select()` did nothing until #696, which is why
                             *   this reads as if it were already narrow.
                             */
                            .select("phone", "phoneNumber", "kyc", "serviceRegistrations")
                            .get()
                    )
                );
                userSnaps.forEach(snap => {
                    snap.forEach(doc => {
                        userMapByUid.set(doc.id, doc.data());
                    });
                });
            }

            const getPhoneFromUser = (uData: any) => {
                if (!uData) return "";
                let p = uData.phone || uData.phoneNumber || uData.kyc?.phoneNumber || uData.kyc?.phone || "";
                if (isPlaceholder(p) && uData.serviceRegistrations) {
                    for (const reg of Object.values(uData.serviceRegistrations) as any[]) {
                        const profile = reg?.profile || reg;
                        if (profile && profile.phone && !isPlaceholder(profile.phone)) {
                            p = profile.phone;
                            break;
                        }
                    }
                }
                return isPlaceholder(p) ? "" : p;
            };

            recentTransactions.forEach(tx => {
                if (isPlaceholder(tx.phone) && tx.userId) {
                    const uData = userMapByUid.get(tx.userId);
                    const phone = getPhoneFromUser(uData);
                    if (phone) tx.phone = phone;
                }
                if (isPlaceholder(tx.phone)) tx.phone = "";
            });

            failedTransactions.forEach(tx => {
                if (isPlaceholder(tx.phone) && tx.userId) {
                    const uData = userMapByUid.get(tx.userId);
                    const phone = getPhoneFromUser(uData);
                    if (phone) tx.phone = phone;
                }
                if (isPlaceholder(tx.phone)) tx.phone = "";
            });
        } catch (err: any) {
            console.error("[FINANCE SERVICE] Failed to hydrate phone numbers:", err.message);
        }

        return {
            error: null,
            success: true,
            totalRevenue,
            // True when the Paystack paging ceiling was reached, so totalRevenue
            // is a floor rather than a total. Surfaced instead of logged only,
            // because an admin reading the figure is the person who needs to
            // know it is incomplete.
            revenueIsPartial,
            totalEscrowVolume,
            totalLoansDisbursed,
            pendingPayoutAmount,
            recentTransactions,
            failedTransactions,
            totalSuccessfulCount,
            totalAbandonedCount,
            totalFailedCount,
            //   Which figures above could NOT be read, by name.
            //
            //   `revenueAvailable` in getPlatformHealthMetrics is the same idea
            //   as one boolean for one number; four numbers would need four
            //   booleans, so this is that concept generalised — and it is the
            //   same shape #514 gave the public seller endpoint, so the platform
            //   has one way of saying "unknown" rather than two.
            unavailable,
        };
    }

    /**
     * Module registration stats (uses Next.js unstable_cache to match requirements).
     */
    async getModuleRegistrationStats(): Promise<ModuleRegistrationStats> {
        return fetchModuleRegistrationStatsCached();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cached module registration stats implementation
// ─────────────────────────────────────────────────────────────────────────────
const fetchModuleRegistrationStatsCached = unstable_cache(
    async (): Promise<ModuleRegistrationStats> => {
        const db = getAdminDb();
        const { supabaseAdmin } = await import("@/lib/supabase");

        /*
         *   #756 — the accepted status list comes from ONE place now. It was
         *   spelled out inline, once per module, and measured against every
         *   `serviceRegistrations.<module>.status` write in the codebase it was
         *   wrong in both directions. See lib/module-registration-status.ts.
         */
        const ST = registrationStatusFilter();
        //   #846 The cooperative pair's two halves, derived so their union is
        //   ACTIVE_REGISTRATION_STATUSES by definition.
        const SETTLED = settledStatusFilter();
        const IN_REVIEW = inReviewStatusFilter();
        const reg = (module: string) => `raw_data->serviceRegistrations->${module}->>status.in.${ST}`;
        const anyRole = (...roles: string[]) => roles.map((r) => `roles.cs.{"${r}"}`).join(",");

        const [
            waveBriefing,
            waveRes,
            academyRes,
            coopsRes,
            coopOnbRes,
            farmNationRes,
            exportHubRes,
            exportOnbRes,
            marketplaceRes
        ] = await Promise.all([
            // WAVE Briefing registrations (keep direct dedicated table count)
            safeCount(db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)),

            // WAVE Applications
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or(`${reg('wave')},${anyRole('wave_participant')}`),

            // Academy
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or(`${reg('academy')},${anyRole('academy_participant')}`),

            // Cooperatives (active/approved)
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                //   #846 Derived from ACTIVE_REGISTRATION_STATUSES rather than
                //   spelled out, so this slice and the onboarding one below
                //   partition that list by construction instead of by
                //   coincidence. See lib/module-registration-status.
                .or(`raw_data->serviceRegistrations->cooperatives->>status.in.${SETTLED}
,raw_data->serviceRegistrations->cooperative->>status.in.${SETTLED},roles.cs.{"cooperative_member"}`.replace(/\n/g, '')),

            // Cooperative Onboarding (pending)
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                //   #756 — `revision_required` is written by
                //   _coop_admin_members when an admin asks for corrections, and
                //   was in neither the active list nor this one, so a member
                //   mid-review appeared in no tile at all.
                //   #846 The other half of the same partition.
                .or(`raw_data->serviceRegistrations->cooperatives->>status.in.${IN_REVIEW}
,raw_data->serviceRegistrations->cooperative->>status.in.${IN_REVIEW}`.replace(/\n/g, '')),

            // Farm Nation
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                /*
                 *   #756 FARM NATION ASKED FOR TWO STRINGS THAT ARE NOT ROLES.
                 *
                 *   It matched `roles.cs.{"farm-nation-buyer"}` and
                 *   `{"farm-nation-seller"}`. Neither appears anywhere else in
                 *   this codebase — not in UserRole, not in ALL_USER_ROLES, not
                 *   in any writer — so the clause matched nobody and the module
                 *   was counted on its serviceRegistrations mirror alone.
                 *
                 *   The real participant roles are `farmer`, `land_owner` and
                 *   `investor`, which lib/conversation-scope.ts already maps to
                 *   the farmnation module. This is #96's defect —
                 *   "farmnation_admin" for `farm_nation_admin` — a third time,
                 *   in a third file.
                 */
                .or(`${reg('farmNation')},${reg('farm_nation')},${anyRole('farmer', 'land_owner', 'investor')}`),

            // Export Hub
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                /*
                 *   #756 — THE REPORTED ZERO. `_ex_onboarding.ts` writes
                 *   "pending_approval" on both of its paths and that is the
                 *   only status an export applicant holds before approval; it
                 *   was not in the accepted list, so every pending export
                 *   registration was invisible.
                 */
                .or(`${reg('export')},${anyRole('export_participant')}`),

            /*
             *   #756 EXPORT ONBOARDING WAS NOT A QUERY AT ALL.
             *
             *   The payload read `exportOnboarding: exportHubRes.count` — the
             *   SAME number as Export Hub, presented to an administrator as a
             *   second, independent figure. Two tiles, one measurement, and
             *   nothing on the screen to tell them apart. While both read 0
             *   that is invisible; the moment Export Hub is non-zero it becomes
             *   a duplicated count inside a breakdown that sums to a total.
             *
             *   It has its own query now, on the shape the cooperative pair
             *   already uses: the Hub counts settled registrations, Onboarding
             *   counts the ones still in flight. `pending_approval` is the
             *   value _ex_onboarding.ts actually writes.
             */
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->export->>status.in.(pending,pending_approval,under_review,revision_required)'),

            // Marketplace
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                //   #756 — `marketplace_seller` and `buyer` were missing.
                //   Both are in ALL_USER_ROLES, and the legacy import writes an
                //   accountType of "buyer", so sellers on the newer spelling
                //   and plain buyers went uncounted.
                .or(`${reg('marketplace')},${anyRole('seller', 'marketplace_seller', 'buyer', 'marketplace_buyer')}`)
        ]);

        return {
            wave: waveRes.count ?? 0,
            waveBriefing,
            academy: academyRes.count ?? 0,
            cooperatives: coopsRes.count ?? 0,
            cooperativeOnboarding: coopOnbRes.count ?? 0,
            farmNation: farmNationRes.count ?? 0,
            exportHub: exportHubRes.count ?? 0,
            exportOnboarding: exportOnbRes.count ?? 0,
            marketplace: marketplaceRes.count ?? 0
        };
    },
    ["module-registration-stats-service"],
    { revalidate: 60, tags: ["module-registration-stats-service"] }
);
