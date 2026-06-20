import { getAdminDb } from "@/lib/firebase-admin";
import { AggregateField, FieldPath } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
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
    ref: FirebaseFirestore.Query | FirebaseFirestore.CollectionReference
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
                db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "locked").count().get()
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
    private async getPlatformMetrics(db: FirebaseFirestore.Firestore, options?: { dateFrom?: Date; dateTo?: Date }) {
        const allUsersSnap = await db.collection(COLLECTIONS.USERS).count().get();
        const totalUsers = allUsersSnap.data().count ?? 0;

        let totalRevenue = 0;
        let totalTransactions = 0;

        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;

        if (secretKey) {
            try {
                let page = 1;
                while (true) {
                    let url = `https://api.paystack.co/transaction?perPage=100&page=${page}&status=success`;
                    if (options?.dateFrom) {
                        url += `&from=${encodeURIComponent(options.dateFrom.toISOString())}`;
                    }
                    if (options?.dateTo) {
                        url += `&to=${encodeURIComponent(options.dateTo.toISOString())}`;
                    }
                    const res = await fetch(url, {
                        headers: {
                            Authorization: `Bearer ${secretKey}`,
                            "Content-Type": "application/json",
                        },
                        cache: "no-store",
                    });
                    if (!res.ok) throw new Error(`Paystack API returned status ${res.status}`);
                    const json = await res.json();
                    const data = json.data ?? [];
                    for (const tx of data) {
                        totalRevenue += (tx.amount / 100);
                        totalTransactions++;
                    }
                    const totalPages = json.meta?.pageCount ?? 1;
                    if (page >= totalPages || data.length === 0) break;
                    page++;
                }
                paystackSuccess = true;
            } catch (e: any) {
                logger.error(`[PlatformMetrics] Live Paystack revenue fetch failed, falling back to Firestore: ${e.message}`);
            }
        }

        if (!paystackSuccess) {
            try {
                let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
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
            } catch (e: any) {
                logger.error(`[PlatformMetrics] Firestore fallback aggregate query failed: ${e.message}`);
            }
        }

        return {
            totalRevenue,
            totalTransactions,
            totalUsers
        };
    }

    // Centralized Helper: Get Global Pending Approvals without session checks
    private async getGlobalPendingApprovals(db: FirebaseFirestore.Firestore) {
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
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending").count().get(),
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

    // Centralized Helper: Get User Metrics without session checks
    private async getUserMetrics(db: FirebaseFirestore.Firestore) {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [totalSnap, activeSnap, verifiedSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).count().get(),
            db.collection(COLLECTIONS.USERS).where("lastLoginAt", ">=", thirtyDaysAgo).count().get(),
            db.collection(COLLECTIONS.USERS).where("isVerified", "==", true).count().get()
        ]);

        const total = totalSnap.data().count || 0;
        const active = activeSnap.data().count || 0;
        const verified = verifiedSnap.data().count || 0;

        return {
            total,
            active,
            verified,
            unverified: total - verified,
        };
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

        // Active users always uses a fixed 30-day window — this is a health
        // indicator, not a date-filtered KPI. It must NOT use filterFrom.
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [
            activeUsersSnap,
            pendingEscrowsCount,
            activeLandCount,
            pendingLoansCount,
        ] = await Promise.allSettled([
            db.collection(COLLECTIONS.USERS).where("lastLoginAt", ">=", thirtyDaysAgo).count().get(),
            safeCount(db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "pending")),
            safeCount(db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "active")),
            safeCount(db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending")),
        ]);

        const isDateFiltered = !!(options?.dateFrom || options?.dateTo);

        let totalUsers: number;
        let totalRevenue: number;
        let totalTransactions: number;
        let pendingApprovals: number;

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
            } else {
                totalRevenue = 0;
                totalTransactions = 0;
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
            pendingApprovals = pendingResult.totalPending;
        }

        const activeUsers = activeUsersSnap.status === "fulfilled" ? (activeUsersSnap.value.data().count ?? 0) : 0;
        const pendingEscrows = pendingEscrowsCount.status === "fulfilled" ? pendingEscrowsCount.value : 0;
        const activeLandListings = activeLandCount.status === "fulfilled" ? activeLandCount.value : 0;
        const pendingLoans = pendingLoansCount.status === "fulfilled" ? pendingLoansCount.value : 0;

        // Revenue by month
        const secretKey = process.env.PAYSTACK_SECRET_KEY;
        let paystackSuccess = false;
        let revenueByMonth: Array<{ month: string; revenue: number }> = [];

        if (secretKey) {
            try {
                // Initialize monthly buckets with 0
                const buckets = months.map(m => ({ label: m.label, start: m.start, end: m.end, revenue: 0 }));
                
                let page = 1;
                const fromStr = months[0].start.toISOString();
                const toStr = months[months.length - 1].end.toISOString();
                
                while (true) {
                    const url = `https://api.paystack.co/transaction?perPage=100&page=${page}&status=success&from=${encodeURIComponent(fromStr)}&to=${encodeURIComponent(toStr)}`;
                    const res = await fetch(url, {
                        headers: {
                            Authorization: `Bearer ${secretKey}`,
                            "Content-Type": "application/json",
                        },
                        cache: "no-store",
                    });
                    if (!res.ok) throw new Error(`Paystack API returned status ${res.status}`);
                    const json = await res.json();
                    const data = json.data ?? [];
                    for (const tx of data) {
                        const paidAtStr = tx.paid_at || tx.paidAt || tx.created_at || tx.createdAt;
                        if (!paidAtStr) continue;
                        const txDate = new Date(paidAtStr);
                        
                        for (const bucket of buckets) {
                            if (txDate >= bucket.start && txDate <= bucket.end) {
                                bucket.revenue += (tx.amount / 100);
                                break;
                            }
                        }
                    }
                    const totalPages = json.meta?.pageCount ?? 1;
                    // Guard: Cap at 5 pages (500 transactions) to prevent slow API response or timeouts
                    if (page >= 5 || page >= totalPages || data.length === 0) break;
                    page++;
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
            let txQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed");
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
        const userMetrics = await this.getUserMetrics(db);
        const userSegments: UserSegments = {
            active: userMetrics.active,
            pending: userMetrics.unverified,
            stalled: Math.max(0, userMetrics.total - userMetrics.active - userMetrics.unverified),
            ghost: 0
        };

        return {
            platformOverview: {
                totalUsers,
                activeUsers,
                totalRevenue,
                monthlyRevenue,
                totalTransactions,
                pendingApprovals,
            },
            counts: {
                pendingEscrows,
                activeLandListings,
                pendingLoans,
            },
            revenueByMonth,
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
                    }),
                    fetch(`https://api.paystack.co/transaction?perPage=1&page=1&status=failed`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
                    }),
                    fetch(`https://api.paystack.co/transaction?perPage=1&page=1&status=abandoned`, {
                        headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
                        cache: "no-store",
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

                // Fetch and sum all successful transaction amounts to calculate exact total revenue
                let page = 1;
                while (true) {
                    const url = `https://api.paystack.co/transaction?perPage=100&page=${page}&status=success`;
                    const res = await fetch(url, {
                        headers: {
                            Authorization: `Bearer ${secretKey}`,
                            "Content-Type": "application/json",
                        },
                        cache: "no-store",
                    });
                    if (!res.ok) throw new Error(`Paystack total revenue API error: ${res.status}`);
                    const json = await res.json();
                    const data = json.data ?? [];
                    for (const tx of data) {
                        totalRevenue += (tx.amount / 100);
                    }
                    const totalPages = json.meta?.pageCount ?? 1;
                    if (page >= totalPages || data.length === 0) break;
                    page++;
                }

                paystackSuccess = true;
            } catch (e: any) {
                logger.error(`[FinancialOverview] Paystack API fetch failed, using Firestore fallback: ${e.message}`);
            }
        }

        // 3. Firestore fallbacks if Paystack API was not reached/failed
        if (!paystackSuccess) {
            const [countSuccessR, countAbandonedR, countFailedR, allTxnsR] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").count().get(),
                db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "abandoned").count().get(),
                db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "failed").count().get(),
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").aggregate({ totalRevenue: AggregateField.sum("amount") }).get(),
            ]);

            totalSuccessfulCount = countSuccessR.status === "fulfilled" ? (countSuccessR.value.data().count ?? 0) : 0;
            totalAbandonedCount = countAbandonedR.status === "fulfilled" ? (countAbandonedR.value.data().count ?? 0) : 0;
            totalFailedCount = countFailedR.status === "fulfilled" ? (countFailedR.value.data().count ?? 0) : 0;
            totalRevenue = allTxnsR.status === "fulfilled" ? (Number(allTxnsR.value.data().totalRevenue) || 0) : 0;
        }

        try {
            const [txSnap] = await Promise.allSettled([
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS).orderBy("processedAt", "desc").limit(1000).get()
            ]);

            const toTx = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
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
            const failedSnap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).orderBy("failedAt", "desc").limit(1000).get();
            failedSnap.docs.forEach((doc: any) => {
                const d = doc.data();
                const ts = d.failedAt ?? d.abandonedAt ?? null;
                failedTransactions.push({
                    id: doc.id,
                    type: d.type ?? "unknown",
                    amount: Number(d.amount) || 0,
                    status: (d.status === "abandoned" ? "abandoned" : "failed") as "failed" | "abandoned",
                    gatewayResponse: d.gatewayResponse ?? null,
                    timestamp: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : null),
                    phone: d.phone ?? d.userPhone ?? d.customerPhone ?? d.metadata?.phone ?? d.customer?.phone ?? null,
                    userId: d.userId ?? d.metadata?.userId ?? null,
                });
            });
            failedTransactions.sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
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
        const [
            waveBriefing,
            waveApplications,
            cooperativeOnboarding,
            exportOnboarding,
            academySnap,
            cooperativesSnap,
            farmNationSnap,
            marketplaceSnap,
        ] = await Promise.all([
            safeCount(db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)),
            safeCount(db.collection(COLLECTIONS.WAVE_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_ONBOARDING)),
            safeCount(db.collection(COLLECTIONS.EXPORT_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)),
            safeCount(db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.SELLER_VERIFICATIONS)),
        ]);

        return {
            wave: waveApplications,
            waveBriefing,
            academy: academySnap,
            cooperatives: cooperativesSnap,
            cooperativeOnboarding,
            farmNation: farmNationSnap,
            exportHub: exportOnboarding,
            exportOnboarding,
            marketplace: marketplaceSnap
        };
    },
    ["module-registration-stats-service"],
    { revalidate: 60, tags: ["module-registration-stats-service"] }
);
