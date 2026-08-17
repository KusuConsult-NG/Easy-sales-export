import { getAdminDb } from "@/lib/supabase-db";
import { AggregateField, FieldPath } from "@/lib/firestore-compat";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { AWAITING_REVIEW_STATUSES } from "@/lib/land-listing-status";
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

/**
 * How many pages of Paystack transactions any one revenue sweep will read.
 * 100 pages x 100 per page = 10,000 transactions.
 */
const MAX_REVENUE_PAGES = 100;

/**
 * Read every successful Paystack transaction, handing each one to `onTransaction`.
 *
 * This exists because the same paging bug was written three times in this file.
 * Each site decided when to stop with
 *
 *     const totalPages = json.meta?.pageCount ?? 1;
 *
 * which cannot tell "the API sent no page count" apart from "there is one page".
 * When Paystack omits the field, every one of those loops stopped after page 1
 * and reported the hundred most recent transactions as the platform's lifetime
 * revenue — silently, with nothing marking the figure as partial.
 *
 * The end-of-data signal used here is a SHORT PAGE, which is a fact about the
 * response rather than about its metadata. `pageCount` is still used when it is
 * actually present, because paging to the ceiling on every call would be slow,
 * but it can no longer end the sweep by being absent.
 *
 * `truncated` is returned rather than logged-and-forgotten so callers can label
 * the number instead of presenting a floor as a total.
 */
async function eachPaystackSuccess(
    secretKey: string,
    opts: {
        dateFrom?: Date;
        dateTo?: Date;
        maxPages?: number;
        timeoutMs?: number;
        label: string;
        /**
         * Set when the cap is a deliberate product limit rather than a safety
         * ceiling, so hitting it is expected and should not log an error every
         * call. `truncated` is still returned either way — the caller is
         * expected to label the figure.
         */
        capIsIntentional?: boolean;
    },
    onTransaction: (tx: any) => void,
): Promise<{ pagesRead: number; truncated: boolean }> {
    const maxPages = opts.maxPages ?? MAX_REVENUE_PAGES;
    const timeoutMs = opts.timeoutMs ?? 6000;
    const PER_PAGE = 100;

    let page = 1;
    let truncated = false;

    while (page <= maxPages) {
        let url = `https://api.paystack.co/transaction?perPage=${PER_PAGE}&page=${page}&status=success`;
        if (opts.dateFrom) url += `&from=${encodeURIComponent(opts.dateFrom.toISOString())}`;
        if (opts.dateTo) url += `&to=${encodeURIComponent(opts.dateTo.toISOString())}`;

        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${secretKey}`,
                "Content-Type": "application/json",
            },
            cache: "no-store",
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) throw new Error(`Paystack API returned status ${res.status}`);

        const json = await res.json();
        const data = json.data ?? [];
        for (const tx of data) onTransaction(tx);

        // A short page is the end of the data, whatever the metadata says.
        if (data.length < PER_PAGE) return { pagesRead: page, truncated: false };

        // Honoured when present; unable to end the sweep by being absent.
        const reportedPages = Number(json.meta?.pageCount);
        if (Number.isFinite(reportedPages) && page >= reportedPages) {
            return { pagesRead: page, truncated: false };
        }

        if (page === maxPages) {
            truncated = true;
            if (!opts.capIsIntentional) {
                logger.error(
                    `[${opts.label}] Paystack paging hit the ${maxPages}-page ceiling. ` +
                    `The revenue total is INCOMPLETE — raise the ceiling or sum from processed_payments.`
                );
            }
        }
        page++;
    }

    return { pagesRead: maxPages, truncated };
}

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

export class AnalyticsService implements AnalyticsServiceContract {
    /**
     * Aggregates key system health and usage metrics.
     */
    static async getPlatformHealthMetrics(): Promise<PlatformHealthMetrics> {
        const db = getAdminDb();
        
        try {
            const [totalUsersSnap, suspendedUsersSnap, lockedEscrowsSnap] = await Promise.all([
                db.collection(COLLECTIONS.USERS).count().get(),
                db.collection(COLLECTIONS.USERS).where("status", "==", "suspended").count().get(),
                // "locked" is not an escrow status and never was. The string
                // appears exactly once in this codebase — here, in this query —
                // so `activeEscrows` on the platform health panel has always
                // read 0, whatever was actually held.
                //
                // An escrow holding money is `funded`: marketplace/_payment.ts
                // sets it when payment clears, and it stays there until a
                // release, a refund or a dispute moves it on.
                db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "funded").count().get()
            ]);

            const totalUsers = totalUsersSnap.data().count ?? 0;
            const suspendedUsers = suspendedUsersSnap.data().count ?? 0;
            const activeUsers = totalUsers - suspendedUsers;
            const activeEscrows = lockedEscrowsSnap.data().count ?? 0;

            return {
                totalUsers,
                activeUsers,
                activeEscrows,
                lastCalculatedAt: new Date().toISOString()
            };
        } catch (error) {
            logger.error("Failed to fetch platform health metrics:", error);
            return {
                totalUsers: 0,
                activeUsers: 0,
                activeEscrows: 0,
                lastCalculatedAt: new Date().toISOString()
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

    private async getUserSegmentsCached(): Promise<UserSegments> {
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

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
            } else {
                // A rejected metrics call is not zero revenue, it is no answer.
                totalRevenue = 0;
                totalTransactions = 0;
                revenueAvailable = false;
            }
            pendingApprovals = pendingRes.status === "fulfilled" ? pendingRes.value.totalPending : 0;
        } else {
            const [metricsResult, pendingResult] = await Promise.all([
                this.getPlatformMetrics(db),
                this.getGlobalPendingApprovals(db),
            ]);
            totalUsers = metricsResult.totalUsers;
            totalTransactions = metricsResult.totalTransactions;
            totalRevenue = metricsResult.totalRevenue;
            revenueAvailable = metricsResult.revenueAvailable;
            pendingApprovals = pendingResult.totalPending;
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
                    return { month: label, revenue: total };
                } catch (e) {
                    return { month: label, revenue: 0 };
                }
            });

            revenueByMonth = await Promise.all(revenuePromises);
            // Per-month database aggregates are exact, so this path is complete.
            monthlyRevenueIsPartial = false;
        }

        const monthlyRevenue = revenueByMonth.length > 0 ? revenueByMonth[revenueByMonth.length - 1].revenue : 0;

        // User growth by month
        const userGrowthByMonth = await Promise.all(
            months.map(async ({ label, start, end }) => {
                try {
                    const snap = await db
                        .collection(COLLECTIONS.USERS)
                        .where("createdAt", ">=", start)
                        .where("createdAt", "<=", end)
                        .count()
                        .get();
                    return { month: label, users: snap.data().count ?? 0 };
                } catch (_e) {
                    return { month: label, users: 0 };
                }
            })
        );

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
                        date: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : new Date(0).toISOString())
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
        
        totalEscrowVolume = allEscrowsR.status === "fulfilled" ? (allEscrowsR.value.data().total ?? 0) : 0;
        totalLoansDisbursed = loanR.status === "fulfilled" ? (loanR.value.data().total ?? 0) : 0;

        // 2. Fetch revenue and counts from Paystack API as the source of truth
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;

        if (secretKey) {
            try {
                // Fetch counts using single quick requests for counts first
                const [successMetaRes, failedMetaRes, abandonedMetaRes] = await Promise.all([
                    fetch(`https://api.paystack.co/transaction?perPage=1&page=1&status=success`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    }),
                    fetch(`https://api.paystack.co/transaction?perPage=1&page=1&status=failed`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                        signal: AbortSignal.timeout(3000),
                    }),
                    fetch(`https://api.paystack.co/transaction?perPage=1&page=1&status=abandoned`, {
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
            const [txSnap] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).orderBy("processedAt", "desc").get()
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

            if (recentTransactions.length > totalSuccessfulCount) {
                totalSuccessfulCount = recentTransactions.length;
            }
        } catch (e: any) {
            console.error("[FINANCE SERVICE] Transactions fetch error:", e.message);
        }

        let pendingPayoutAmount = 0;
        const [coopPayoutsR, wavePayoutsR] = await Promise.allSettled([
            db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
        ]);
        pendingPayoutAmount =
            (coopPayoutsR.status === "fulfilled" ? (coopPayoutsR.value.data().total ?? 0) : 0) +
            (wavePayoutsR.status === "fulfilled" ? (wavePayoutsR.value.data().total ?? 0) : 0);

        const failedTransactions: FinancialOverview["failedTransactions"] = [];
        try {
            const failedSnap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).get();
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
        } catch (_e) {
            // Silently skip
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
                        db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get()
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
            totalFailedCount
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
