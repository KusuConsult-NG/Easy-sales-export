"use server";
import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";

import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { AggregateField } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { isAdmin } from "@/lib/admin-permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UserSegments {
    active: number;
    pending: number;
    stalled: number;
    ghost: number;
}

export interface AnalyticsData {
    platformOverview: {
        totalUsers: number;
        activeUsers: number;
        totalRevenue: number;
        monthlyRevenue: number;
        totalTransactions: number;
        pendingApprovals: number;
    };
    counts: {
        pendingEscrows: number;
        activeLandListings: number;
        pendingLoans: number;
    };
    /** Last 6 calendar months, revenue from completed escrows (2.5% commission) */
    revenueByMonth: Array<{ month: string; revenue: number }>;
    /** Last 6 calendar months, new user registrations */
    userGrowthByMonth: Array<{ month: string; users: number }>;
    /** Module participation breakdown for the pie chart */
    moduleUsage: Array<{ module: string; count: number }>;
    userSegments: UserSegments;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        date: string;
    }>;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Main dashboard stats action
// ─────────────────────────────────────────────────────────────────────────────

export async function getDashboardStatsAction(options?: {
    dateFrom?: string; // ISO date string e.g. "2026-01-01"
    dateTo?: string;   // ISO date string e.g. "2026-03-31"
}): Promise<AnalyticsData | null> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null;
    const { session } = sessionResult;
    if (!isAdmin(session.user.roles)) {
        return null;
    }

    const { getCached, setCache } = await import("@/lib/redis");
    // Include date range in cache key so filtered results don't pollute global cache
    const cacheKey = options?.dateFrom || options?.dateTo
        ? `admin:dashboard-stats:${options.dateFrom ?? "all"}_${options.dateTo ?? "all"}`
        : "admin:dashboard-stats:global";

    // Only use cache for the global (no date filter) view
    if (!options?.dateFrom && !options?.dateTo) {
        try {
            const cached = await getCached(cacheKey);
            if (cached) return cached as AnalyticsData;
        } catch(e) {
            // quiet fail on cache read
        }
    }

    const months = lastNMonths(6);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Respect date filter or default to last 30 days
    const filterFrom = options?.dateFrom ? dateRangeStart(options.dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const filterTo   = options?.dateTo   ? dateRangeEnd(options.dateTo) : now;
    const thirtyDaysAgo = filterFrom;

    // ── Parallel Firestore queries ───────────────────────────────────────────
    const [
        totalUsersSnap,
        activeUsersSnap,
        pendingEscrowsCount,
        activeLandCount,
        pendingLoansCount,
        pendingSellersCount,
        pendingWithdrawalsCount,
        totalOrdersCount,
        totalEscrowsCount,
        recentLogsSnap,
    ] = await Promise.allSettled([
        db.collection(COLLECTIONS.USERS).count().get(),
        db.collection(COLLECTIONS.USERS).where("lastLoginAt", ">=", filterFrom).count().get(),
        safeCount(db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "pending")),
        safeCount(db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "active")),
        safeCount(db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending")),
        safeCount(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "==", "pending")),
        safeCount(db.collection(COLLECTIONS.WALLET_TRANSACTIONS).where("type", "==", "withdrawal").where("status", "==", "pending")),
        safeCount(db.collection(COLLECTIONS.MARKETPLACE_ORDERS)),
        safeCount(db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)),
        db.collection(COLLECTIONS.AUDIT_LOGS).orderBy("timestamp", "desc").limit(10).get(),
    ]);


    const { getPlatformMetricsAction, getGlobalPendingApprovalsAction } = await import("./global-aggregation");

    const isDateFiltered = !!(options?.dateFrom || options?.dateTo);

    let totalUsers: number;
    let totalRevenue: number;
    let totalTransactions: number;
    let pendingApprovals: number;

    if (isDateFiltered) {
        // When a date range is active, count NEW registrations and revenue within that window
        const [newUsersSnap, paymentsSnap, pendingRes] = await Promise.allSettled([
            db.collection(COLLECTIONS.USERS)
                .where("createdAt", ">=", filterFrom)
                .where("createdAt", "<=", filterTo)
                .count()
                .get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("status", "==", "completed")
                .where("processedAt", ">=", filterFrom)
                .where("processedAt", "<=", filterTo)
                .select("amount")
                .get(),
            getGlobalPendingApprovalsAction(),
        ]);
        totalUsers = newUsersSnap.status === "fulfilled" ? (newUsersSnap.value.data().count ?? 0) : 0;
        totalRevenue = paymentsSnap.status === "fulfilled"
            ? paymentsSnap.value.docs.reduce((sum: number, d: any) => sum + (Number(d.data().amount) || 0), 0)
            : 0;
        totalTransactions = paymentsSnap.status === "fulfilled" ? paymentsSnap.value.size : 0;
        pendingApprovals = pendingRes.status === "fulfilled" && pendingRes.value.success ? (pendingRes.value.data?.totalPending ?? 0) : 0;
    } else {
        const [metricsResult, pendingResult] = await Promise.all([
            getPlatformMetricsAction(),
            getGlobalPendingApprovalsAction(),
        ]);
        totalUsers = metricsResult.success ? (metricsResult.data?.totalUsers ?? 0) : 0;
        totalTransactions = metricsResult.success ? (metricsResult.data?.totalTransactions ?? 0) : 0;
        totalRevenue = metricsResult.success ? (metricsResult.data?.totalRevenue ?? 0) : 0;
        pendingApprovals = pendingResult.success ? (pendingResult.data?.totalPending ?? 0) : 0;
    }

    // Active users: users who logged in within the filter window
    const activeUsers = activeUsersSnap.status === "fulfilled" ? (activeUsersSnap.value.data().count ?? 0) : 0;

    const pendingEscrows = pendingEscrowsCount.status === "fulfilled" ? pendingEscrowsCount.value : 0;
    const activeLandListings = activeLandCount.status === "fulfilled" ? activeLandCount.value : 0;
    const pendingLoans = pendingLoansCount.status === "fulfilled" ? pendingLoansCount.value : 0;

    // ── Revenue by month (last 6 months — all payment sources) ─────────────
    const revenuePromises = months.map(async ({ label, start, end }) => {
        try {
            const snap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("status", "==", "completed")
                .where("processedAt", ">=", start)
                .where("processedAt", "<=", end)
                .select("amount")
                .get();
            let total = 0;
            snap.docs.forEach((doc: any) => total += (Number(doc.data().amount) || 0));
            return { month: label, revenue: total };
        } catch (e) {
            return { month: label, revenue: 0 };
        }
    });

    const revenueByMonth = await Promise.all(revenuePromises);
    
    // Monthly revenue (current month)
    const monthlyRevenue = revenueByMonth.length > 0 ? revenueByMonth[revenueByMonth.length - 1].revenue : 0;

    // ── User growth by month (last 6 months) ────────────────────────────────
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

    // ── Module usage (for pie chart) ─────────────────────────────────────────
    // WE USE THE CANONICAL COUNTS FROM THE USERS COLLECTION
    const canonicalStats = await fetchModuleRegistrationStats();

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


    // ── Recent transactions: filtered by date range when active ────────────
    const recentTransactions: AnalyticsData["recentTransactions"] = [];

    try {
        let txQuery: FirebaseFirestore.Query = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).orderBy("processedAt", "desc");
        if (isDateFiltered) {
            txQuery = txQuery
                .where("processedAt", ">=", filterFrom)
                .where("processedAt", "<=", filterTo);
        }
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
        logger.error("Failed to fetch unified recent transactions:", e);
    }

    // ── User Segmentation (Mutually Exclusive) ──────────────────────────────
    const { getUserMetricsAction } = await import("./global-aggregation");
    const userMetricsRes = await getUserMetricsAction();
    const userSegments = { active: 0, pending: 0, stalled: 0, ghost: 0 };
    
    if (userMetricsRes.success && userMetricsRes.data) {
        // Fast O(1) aggregation mapping
        userSegments.active = userMetricsRes.data.active;
        userSegments.pending = userMetricsRes.data.unverified;
        userSegments.stalled = Math.max(0, userMetricsRes.data.total - userMetricsRes.data.active - userMetricsRes.data.unverified);
        userSegments.ghost = 0; // Deprecated due to memory overhead
    }

    const payload: AnalyticsData = {
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

    try {
        await setCache(cacheKey, payload, 120); // Cache for 2 minutes
    } catch(e) {}

    return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Overview (separate action used by finance page)
// ─────────────────────────────────────────────────────────────────────────────

export interface FinancialOverview {
    error: string | null;
    success: boolean;
    totalRevenue: number;
    totalEscrowVolume: number;
    totalLoansDisbursed: number;
    pendingPayoutAmount: number;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        status?: string;
        description?: string | null;
        reference?: string | null;
        timestamp: string | null;
        phone?: string | null;
    }>;
    failedTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        status: "failed" | "abandoned";
        gatewayResponse: string | null;
        timestamp: string | null;
        phone?: string | null;
    }>;
    totalSuccessfulCount?: number;
    totalAbandonedCount?: number;
    totalFailedCount?: number;
}


export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { success: false as const, error: "Session expired. Please log in again.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [], failedTransactions: [] };
    }
    const { session } = sessionResult;

    if (!isAdmin(session.user.roles)) {
        return { success: false as const, error: "You do not have admin access to view financial data.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [], failedTransactions: [] };
    }

    const { getCached, setCache } = await import("@/lib/redis");
    const cacheKey = "admin:finance-overview:global";

    try {
        const cached = await getCached<FinancialOverview>(cacheKey);
        if (cached) return cached;
    } catch(e) {
        // quiet fail on cache read
    }

    let totalRevenue = 0;
    let totalEscrowVolume = 0;
    let totalLoansDisbursed = 0;
    const recentTransactions: FinancialOverview["recentTransactions"] = [];

    const [allEscrowsR, allTxnsR, countSuccessR, countAbandonedR, countFailedR] = await Promise.allSettled([
        db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).aggregate({ total: AggregateField.sum("amount") }).get(),
        db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").limit(10000).get(),
        db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").count().get(),
        db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "abandoned").count().get(),
        db.collection(COLLECTIONS.FAILED_PAYMENTS).where("status", "==", "failed").count().get(),
    ]);
    totalEscrowVolume = allEscrowsR.status === "fulfilled" ? (allEscrowsR.value.data().total ?? 0) : 0;
    if (allTxnsR.status === "fulfilled") {
        allTxnsR.value.docs.forEach(d => { totalRevenue += (Number(d.data().amount) || 0); });
    }
    const totalSuccessfulCount = countSuccessR.status === "fulfilled" ? (countSuccessR.value.data().count ?? 0) : 0;
    const totalAbandonedCount = countAbandonedR.status === "fulfilled" ? (countAbandonedR.value.data().count ?? 0) : 0;
    const totalFailedCount = countFailedR.status === "fulfilled" ? (countFailedR.value.data().count ?? 0) : 0;

    const loanR = await Promise.allSettled([
        db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "disbursed").aggregate({ total: AggregateField.sum("amount") }).get(),
    ]);
    totalLoansDisbursed = loanR[0].status === "fulfilled" ? (loanR[0].value.data().total ?? 0) : 0;

    try {
        // PRIMARY: processedPayments = NO, fetching directly from TRANSACTIONS avoids exact duplication
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
        console.error("[FINANCE] Transactions fetch error:", e.message);
    }

    let pendingPayoutAmount = 0;
    const [coopPayoutsR, wavePayoutsR] = await Promise.allSettled([
        db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
        db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
    ]);
    pendingPayoutAmount =
        (coopPayoutsR.status === "fulfilled" ? (coopPayoutsR.value.data().total ?? 0) : 0) +
        (wavePayoutsR.status === "fulfilled" ? (wavePayoutsR.value.data().total ?? 0) : 0);

    // Fetch failed/abandoned transactions (from failedPayments collection)
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
            });
        });
        failedTransactions.sort((a, b) => {
            const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return tb - ta;
        });
    } catch (_e) {
        // Silently skip — collection may not exist yet
    }

    const payload: FinancialOverview = { error: null, success: true as const, totalRevenue, totalEscrowVolume, totalLoansDisbursed, pendingPayoutAmount, recentTransactions, failedTransactions, totalSuccessfulCount, totalAbandonedCount, totalFailedCount };

    try {
        await setCache(cacheKey, payload, 120); // Cache for 2 minutes
    } catch(e) {}

    return payload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Registration Stats (cached, for admin charts)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleRegistrationStats {
    wave: number;
    waveBriefing: number;
    academy: number;
    cooperatives: number;
    cooperativeOnboarding: number;
    farmNation: number;
    exportHub: number;
    exportOnboarding: number;
    marketplace: number;
}

const fetchModuleRegistrationStats = unstable_cache(
    async (): Promise<ModuleRegistrationStats> => {
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

        const stats: ModuleRegistrationStats = {
            wave: waveApplications,
            waveBriefing,
            academy: academySnap,
            cooperatives: cooperativesSnap,
            cooperativeOnboarding,
            farmNation: farmNationSnap,
            exportHub: exportOnboarding, // Represents Export Hub registrants
            exportOnboarding,
            marketplace: marketplaceSnap
        };

        return stats;
    },
    ["module-registration-stats"],
    { revalidate: 60, tags: ["module-registration-stats"] }
);

export async function getModuleRegistrationStatsAction(): Promise<ModuleRegistrationStats> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
    if (!isAdmin(session.user.roles)) {
        throw new Error("Unauthorized");
    }
    return fetchModuleRegistrationStats();
}
