import { getAdminDb } from "@/lib/supabase-db";
import { AggregateField, FieldPath } from "@/lib/firestore-compat";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { UNKNOWN_DATE_ISO, dateRangeEnd, dateRangeStart } from "@/lib/date-utils";
import { AWAITING_REVIEW_STATUSES } from "@/lib/land-listing-status";
import { RECENT_ACTIVITY_DAYS } from "@/lib/recent-activity";
import { eachPaystackSuccess } from "@/lib/paystack-sweep";
import type {
    AnalyticsServiceContract,
    PlatformHealthMetrics,
    AnalyticsData,
    FinancialOverview,
    ModuleRegistrationStats,
    UserSegments
} from "@easy-sales/services";
import { paystackBaseUrl } from "@/lib/paystack-host";

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
            const [totalUsersSnap, activeUsersSnap, fundedEscrowsSnap] = await Promise.all([
                db.collection(COLLECTIONS.USERS).count().get(),
                db.collection(COLLECTIONS.USERS).where("updatedAt", ">=", activeSince).count().get(),
                // An escrow holding money is `funded`: marketplace/_payment.ts
                // sets it when payment clears, and it stays there until a
                // release, a refund or a dispute moves it on.
                db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "funded").count().get()
            ]);

            return {
                totalUsers: totalUsersSnap.data().count ?? 0,
                activeUsers: activeUsersSnap.data().count ?? 0,
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
        const allUsersSnap = await db.collection(COLLECTIONS.USERS).count().get();
        const totalUsers = allUsersSnap.data().count ?? 0;

        let totalRevenue = 0;
        let totalTransactions = 0;
        // True when paging stopped at its ceiling, so totalRevenue is a floor.
        let revenueIsPartial = false;

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;

        if (secretKey) {
            try {
                // The pages were previously fetched 2..pageCount all at once with
                // Promise.all and no bound. On a platform this size that is a
                // burst of hundreds of concurrent requests at whatever Paystack's
                // rate limit is, so it now reads sequentially with a ceiling.
                const sweep = await eachPaystackSuccess(
                    secretKey,
                    { dateFrom: options?.dateFrom, dateTo: options?.dateTo, label: "PlatformMetrics" },
                    (tx) => {
                        totalRevenue += (tx.amount / 100);
                        totalTransactions++;
                    },
                );
                revenueIsPartial = sweep.truncated;
                paystackSuccess = true;
            } catch (e: any) {
                logger.error(`[PlatformMetrics] Live Paystack revenue fetch failed, falling back to Firestore: ${e.message}`);
            }
        }

        let revenueSource: "paystack" | "database" | null = paystackSuccess ? "paystack" : null;

        if (!paystackSuccess) {
            // Discard any partial Paystack total before falling back.
            //
            // Page 1's transactions are added before the remaining pages are
            // fetched, so a failure part-way through left a partial sum behind.
            // If the fallback below also failed, that partial figure was
            // returned as the platform's revenue.
            totalRevenue = 0;
            totalTransactions = 0;
            // The aggregate below is computed by the database over the whole
            // table, so the fallback figure is never a partial one.
            revenueIsPartial = false;

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
                    .select("raw_data->serviceRegistrations, raw_data->verificationProfile, raw_data->bankDetails, raw_data->address")
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
            totalUsers = newUsersSnap.status === "fulfilled" ? (newUsersSnap.value.data().count ?? 0) : 0;
            if (metricsResult.status === "fulfilled") {
                totalRevenue = metricsResult.value.totalRevenue;
                totalTransactions = metricsResult.value.totalTransactions;
                revenueAvailable = metricsResult.value.revenueAvailable;
                //   #665 — copied beside its sibling, which is where it was dropped.
                revenueIsPartial = metricsResult.value.revenueIsPartial;
            } else {
                // A rejected metrics call is not zero revenue, it is no answer.
                totalRevenue = 0;
                totalTransactions = 0;
                revenueAvailable = false;
            }
            pendingApprovals = pendingRes.status === "fulfilled" ? pendingRes.value.totalPending : 0;
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
                totalUsers = 0;
                totalTransactions = 0;
                totalRevenue = 0;
                revenueAvailable = false;
            }
            pendingApprovals = pendingResult.status === "fulfilled" ? pendingResult.value.totalPending : 0;
        }

        const activeUsers = activeUsersSnap.status === "fulfilled" ? (activeUsersSnap.value.data().count ?? 0) : 0;
        const pendingEscrows = pendingEscrowsCount.status === "fulfilled" ? pendingEscrowsCount.value : 0;
        const activeLandListings = activeLandCount.status === "fulfilled" ? activeLandCount.value : 0;
        const pendingLoans = pendingLoansCount.status === "fulfilled" ? pendingLoansCount.value : 0;
        const recentActivity = recentActivityCount.status === "fulfilled" ? recentActivityCount.value : 0;

        // Revenue by month
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;
        let revenueByMonth: Array<{ month: string; revenue: number }> = [];
        // True when the monthly chart hit its page cap, so earlier months read
        // low. Surfaced rather than left for the reader to infer from a dip.
        let monthlyRevenueIsPartial = false;
        //   Months whose own query failed, by label — the difference between a
        //   flat bar and a bar nobody could draw.
        const unavailableMonths: string[] = [];

        if (secretKey) {
            try {
                // Initialize monthly buckets with 0
                const buckets = months.map(m => ({ label: m.label, start: m.start, end: m.end, revenue: 0 }));
                
                // The 5-page cap below is somebody's deliberate latency decision
                // ("to prevent slow API response or timeouts", at 3s per page)
                // and is kept as it was. Only the stop CONDITION is fixed: a
                // missing meta.pageCount used to cut this to 1 page rather than
                // the 5 that were intended, so a chart already limited to 500
                // transactions could quietly be drawn from 100.
                //
                // WORTH A DECISION, NOT CHANGED HERE: 500 transactions across
                // twelve months means the monthly chart is drawn from the most
                // recent 500 only, so early months read low. Raising the cap
                // costs 3s per extra page on a dashboard load; summing from
                // processed_payments instead would be exact and fast. That is a
                // product call, so it is reported rather than taken.
                const MONTHLY_REVENUE_PAGE_CAP = 5;
                const monthlySweep = await eachPaystackSuccess(
                    secretKey,
                    {
                        dateFrom: months[0].start,
                        dateTo: months[months.length - 1].end,
                        maxPages: MONTHLY_REVENUE_PAGE_CAP,
                        timeoutMs: 3000,
                        label: "DashboardStats.monthlyRevenue",
                        capIsIntentional: true,
                    },
                    (tx) => {
                        const paidAtStr = tx.paid_at || tx.paidAt || tx.created_at || tx.createdAt;
                        if (!paidAtStr) return;
                        const txDate = new Date(paidAtStr);
                        for (const bucket of buckets) {
                            if (txDate >= bucket.start && txDate <= bucket.end) {
                                bucket.revenue += (tx.amount / 100);
                                break;
                            }
                        }
                    },
                );
                if (monthlySweep.truncated) {
                    logger.warn(
                        `[DashboardStats] Monthly revenue chart read its ${MONTHLY_REVENUE_PAGE_CAP}-page cap ` +
                        `(${MONTHLY_REVENUE_PAGE_CAP * 100} transactions). Earlier months are under-reported.`
                    );
                    monthlyRevenueIsPartial = true;
                }
                
                revenueByMonth = buckets.map(b => ({ month: b.label, revenue: b.revenue }));
                paystackSuccess = true;
            } catch (e: any) {
                logger.error(`[DashboardStats] Live Paystack monthly revenue fetch failed, falling back to Firestore: ${e.message}`);
            }
        }

        if (!paystackSuccess) {
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
        let revenueIsPartial = false;
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
        const unavailable: string[] = [];
        totalEscrowVolume = allEscrowsR.status === "fulfilled" ? (allEscrowsR.value.data().total ?? 0) : 0;
        if (allEscrowsR.status !== "fulfilled") {
            unavailable.push("totalEscrowVolume");
            logger.error("[FinancialOverview] escrow aggregate failed", { reason: String(allEscrowsR.reason) });
        }
        totalLoansDisbursed = loanR.status === "fulfilled" ? (loanR.value.data().total ?? 0) : 0;
        if (loanR.status !== "fulfilled") {
            unavailable.push("totalLoansDisbursed");
            logger.error("[FinancialOverview] disbursed-loans aggregate failed", { reason: String(loanR.reason) });
        }

        // 2. Fetch revenue and counts from Paystack API as the source of truth
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;

        if (secretKey) {
            try {
                // Fetch counts using single quick requests for counts first
                const [successMetaRes, failedMetaRes, abandonedMetaRes] = await Promise.all([
                    fetch(`${paystackBaseUrl()}/transaction?perPage=1&page=1&status=success`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    }),
                    fetch(`${paystackBaseUrl()}/transaction?perPage=1&page=1&status=failed`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    }),
                    fetch(`${paystackBaseUrl()}/transaction?perPage=1&page=1&status=abandoned`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    }),
                ]);

                if (successMetaRes.ok) {
                    const json = await successMetaRes.json();
                    if (json && json.status) {
                        totalSuccessfulCount = json.meta?.total ?? 0;
                    }
                }
                if (failedMetaRes.ok) {
                    const json = await failedMetaRes.json();
                    if (json && json.status) {
                        totalFailedCount = json.meta?.total ?? 0;
                    }
                }
                if (abandonedMetaRes.ok) {
                    const json = await abandonedMetaRes.json();
                    if (json && json.status) {
                        totalAbandonedCount = json.meta?.total ?? 0;
                    }
                }

                // Fetch and sum all successful transaction amounts to calculate
                // exact total revenue.
                //
                // This was the third copy of the same paging bug in this file —
                // `json.meta?.pageCount ?? 1`, which stops after ONE page when
                // the API sends no page count and reports the hundred most
                // recent transactions as the platform's lifetime revenue. The
                // loop lived here, in getPlatformMetrics, and in the monthly
                // chart. All three now share eachPaystackSuccess above, because
                // fixing one copy and leaving its siblings is how this class
                // keeps surviving in this codebase.
                const sweep = await eachPaystackSuccess(
                    secretKey,
                    { label: "FinancialOverview", timeoutMs: 3000 },
                    (tx) => { totalRevenue += (tx.amount / 100); },
                );
                // Reported rather than swallowed: an admin reading this figure
                // needs to know it is a floor, not a total. Surfaced on the
                // payload below, not only logged.
                revenueIsPartial = sweep.truncated;

                paystackSuccess = true;
            } catch (e: any) {
                logger.error(`[FinancialOverview] Paystack API fetch failed, using Firestore fallback: ${e.message}`);
            }
        }

        // Always calculate accurate counts from database collections
        const [countAbandonedR, countFailedR, countSuccessR] = await Promise.allSettled([
            db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "abandoned").count().get(),
            db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "failed").count().get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").count().get(),
        ]);
        if (totalAbandonedCount === 0 || totalAbandonedCount === undefined) {
            totalAbandonedCount = countAbandonedR.status === "fulfilled" ? (countAbandonedR.value.data().count ?? 0) : 0;
        }
        if (totalFailedCount === 0 || totalFailedCount === undefined) {
            totalFailedCount = countFailedR.status === "fulfilled" ? (countFailedR.value.data().count ?? 0) : 0;
        }
        const dbSuccessCount = countSuccessR.status === "fulfilled" ? (countSuccessR.value.data().count ?? 0) : 0;
        if (countSuccessR.status !== "fulfilled" && !paystackSuccess) {
            //   Neither source could count. Left at 0 and NAMED — this is the
            //   case the removed `totalSuccessfulCount = recentTransactions.length`
            //   fallback used to paper over, reporting the size of one page as
            //   the platform's lifetime total.
            unavailable.push("totalSuccessfulCount");
            logger.error("[FinancialOverview] successful-payment count failed and Paystack was unavailable");
        }
        if (dbSuccessCount > 0) {
            totalSuccessfulCount = Math.max(totalSuccessfulCount, dbSuccessCount);
        }

        if (!paystackSuccess) {
            const [allTxnsR] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").aggregate({ totalRevenue: AggregateField.sum("amount") }).get(),
            ]);

            totalSuccessfulCount = countSuccessR.status === "fulfilled" ? (countSuccessR.value.data().count ?? 0) : totalSuccessfulCount;
            totalRevenue = allTxnsR.status === "fulfilled" ? (Number(allTxnsR.value.data().totalRevenue) || 0) : 0;
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
        pendingPayoutAmount =
            (coopPayoutsR.status === "fulfilled" ? (coopPayoutsR.value.data().total ?? 0) : 0) +
            (wavePayoutsR.status === "fulfilled" ? (wavePayoutsR.value.data().total ?? 0) : 0);
        if (coopPayoutsR.status !== "fulfilled" || wavePayoutsR.status !== "fulfilled") {
            // A SUM of two halves where one failed is not a smaller sum, it is
            // an unknown one — and this figure is what an admin pays out against.
            unavailable.push("pendingPayoutAmount");
            logger.error("[FinancialOverview] pending-payout aggregate failed", {
                cooperative: coopPayoutsR.status, wave: wavePayoutsR.status,
            });
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

        const [
            waveBriefing,
            waveRes,
            academyRes,
            coopsRes,
            coopOnbRes,
            farmNationRes,
            exportHubRes,
            marketplaceRes
        ] = await Promise.all([
            // WAVE Briefing registrations (keep direct dedicated table count)
            safeCount(db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)),

            // WAVE Applications
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->wave->>status.in.(pending,under_review,approved,active,paid,completed,suspended),roles.cs.{"wave_participant"}'),

            // Academy
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->academy->>status.in.(pending,under_review,approved,active,paid,completed,suspended),roles.cs.{"academy_participant"}'),

            // Cooperatives (active/approved)
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->cooperatives->>status.in.(approved,active,paid,completed,suspended),raw_data->serviceRegistrations->cooperative->>status.in.(approved,active,paid,completed,suspended),roles.cs.{"cooperative_member"}'),

            // Cooperative Onboarding (pending)
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->cooperatives->>status.in.(pending,legacy_pending_onboarding),raw_data->serviceRegistrations->cooperative->>status.in.(pending,legacy_pending_onboarding)'),

            // Farm Nation
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->farmNation->>status.in.(pending,under_review,approved,active,paid,completed,suspended),raw_data->serviceRegistrations->farm_nation->>status.in.(pending,under_review,approved,active,paid,completed,suspended),roles.cs.{"farm-nation-buyer"},roles.cs.{"farm-nation-seller"}'),

            // Export Hub
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->export->>status.in.(pending,under_review,approved,active,paid,completed,suspended),roles.cs.{"export_participant"}'),

            // Marketplace
            supabaseAdmin
                .from('users')
                .select('*', { count: 'exact', head: true })
                .or('raw_data->serviceRegistrations->marketplace->>status.in.(pending,under_review,approved,active,paid,completed,suspended),roles.cs.{"seller"},roles.cs.{"marketplace_buyer"}')
        ]);

        return {
            wave: waveRes.count ?? 0,
            waveBriefing,
            academy: academyRes.count ?? 0,
            cooperatives: coopsRes.count ?? 0,
            cooperativeOnboarding: coopOnbRes.count ?? 0,
            farmNation: farmNationRes.count ?? 0,
            exportHub: exportHubRes.count ?? 0,
            exportOnboarding: exportHubRes.count ?? 0,
            marketplace: marketplaceRes.count ?? 0
        };
    },
    ["module-registration-stats-service"],
    { revalidate: 60, tags: ["module-registration-stats-service"] }
);
