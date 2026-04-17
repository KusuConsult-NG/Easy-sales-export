"use server";

import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { AggregateField } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

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

export async function getDashboardStatsAction(): Promise<AnalyticsData | null> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null;
    const { session } = sessionResult;
    if (
        !session?.user?.roles?.includes("admin") &&
        !session?.user?.roles?.includes("super_admin")
    ) {
        return null;
    }

    const months = lastNMonths(6);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

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
        db.collection(COLLECTIONS.USERS).where("lastLoginAt", ">=", thirtyDaysAgo).count().get(),
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

    const [metricsResult, pendingResult] = await Promise.all([
        getPlatformMetricsAction(),
        getGlobalPendingApprovalsAction()
    ]);

    const totalUsers = metricsResult.success ? (metricsResult.data?.totalUsers ?? 0) : 0;
    const totalTransactions = metricsResult.success ? (metricsResult.data?.totalTransactions ?? 0) : 0;
    const totalRevenue = metricsResult.success ? (metricsResult.data?.totalRevenue ?? 0) : 0;
    const pendingApprovals = pendingResult.success ? (pendingResult.data?.totalPending ?? 0) : 0;

    // Active users: fall back to totalUsers for now since we rely on lastLoginAt which may be sparse
    const rawActiveUsers = activeUsersSnap.status === "fulfilled" ? (activeUsersSnap.value.data().count ?? 0) : 0;
    const activeUsers = rawActiveUsers > 0 ? rawActiveUsers : totalUsers;

    const pendingEscrows = pendingEscrowsCount.status === "fulfilled" ? pendingEscrowsCount.value : 0;
    const activeLandListings = activeLandCount.status === "fulfilled" ? activeLandCount.value : 0;
    const pendingLoans = pendingLoansCount.status === "fulfilled" ? pendingLoansCount.value : 0;

    // Revenue is already computed in getPlatformMetricsAction (totalRevenue)
    // Fetch base paid cooperative members to aggregate without needing a new date index
    let paidCoops: any[] = [];
    try {
        const coopSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "==", "completed").get();
        paidCoops = coopSnap.docs.map(d => d.data());
    } catch(_e) {}

    let monthlyRevenue = 0;
    try {
        const monthRevSnap = await db.collection(COLLECTIONS.TRANSACTIONS)
            .where("status", "==", "completed")
            .where("date", ">=", thisMonthStart)
            .aggregate({ total: AggregateField.sum("amount") }).get();

        monthlyRevenue += monthRevSnap.data().total ?? 0;
    } catch (_e) {
        // collection may not exist yet
    }

    // ── Revenue by month (last 6 months — all payment sources) ─────────────
    // Fetch recent completed payments once to avoid composite index requirements
    let recentPayments: any[] = [];
    try {
        const pSnap = await db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
            .where("status", "==", "completed")
            .limit(5000)
            .get();
        recentPayments = pSnap.docs.map(d => d.data());
    } catch (_e) {}

    const revenueByMonth = months.map(({ label, start, end }) => {
        let rev = 0;
        recentPayments.forEach(d => {
            const pAt = d.processedAt?.toDate ? d.processedAt.toDate() : new Date(d.processedAt);
            if (pAt >= start && pAt <= end) {
                rev += (Number(d.amount) || 0);
            }
        });
        return { month: label, revenue: rev };
    });

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
    const [waveCount, academyCount, cooperativeCount, farmNationCount, marketplaceCount, exportCount] =
        await Promise.allSettled([
            safeCount(db.collection(COLLECTIONS.WAVE_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)),
            safeCount(
                db
                    .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                    .where("paymentStatus", "==", "completed")
            ),
            safeCount(db.collection(COLLECTIONS.FARM_NATION_INQUIRIES)),
            safeCount(
                db
                    .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("status", "!=", "rejected")
            ),
            safeCount(db.collection(COLLECTIONS.EXPORT_APPLICATIONS)),
        ]);

    const moduleUsage = [
        { module: "WAVE", count: waveCount.status === "fulfilled" ? waveCount.value : 0 },
        { module: "Academy", count: academyCount.status === "fulfilled" ? academyCount.value : 0 },
        { module: "Cooperative", count: cooperativeCount.status === "fulfilled" ? cooperativeCount.value : 0 },
        { module: "Farm Nation", count: farmNationCount.status === "fulfilled" ? farmNationCount.value : 0 },
        { module: "Marketplace", count: marketplaceCount.status === "fulfilled" ? marketplaceCount.value : 0 },
        { module: "Export Hub", count: exportCount.status === "fulfilled" ? exportCount.value : 0 },
    ].filter((m) => m.count > 0);

    // ── Recent transactions: pulling completely from unified platform ledger
    const recentTransactions: AnalyticsData["recentTransactions"] = [];

    try {
        const [txSnap, coopSnap, escrowSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).orderBy("processedAt", "desc").limit(15).get(),
            db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).orderBy("createdAt", "desc").limit(15).get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).orderBy("createdAt", "desc").limit(15).get()
        ]);

        const allDocs: any[] = [];
        
        if (txSnap.status === "fulfilled") {
            txSnap.value.docs.forEach(d => allDocs.push(d.data()));
        }

        // Sort unified pool by date descending
        allDocs.sort((a, b) => {
            const tsa = a.processedAt ?? a.createdAt ?? a.date ?? 0;
            const tsb = b.processedAt ?? b.createdAt ?? b.date ?? 0;
            const ta = tsa?.toDate ? tsa.toDate().getTime() : new Date(tsa).getTime();
            const tb = tsb?.toDate ? tsb.toDate().getTime() : new Date(tsb).getTime();
            return tb - ta;
        });

        // Pick top 8 latest valid transactions
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
        recentTransactions,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Financial Overview (separate action used by finance page)
// ─────────────────────────────────────────────────────────────────────────────

export interface FinancialOverview {
    success: boolean;
    error?: string;
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
    }>;
    failedTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        status: "failed" | "abandoned";
        gatewayResponse: string | null;
        timestamp: string | null;
    }>;
    totalSuccessfulCount?: number;
    totalAbandonedCount?: number;
    totalFailedCount?: number;
}


export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { success: false, error: "Session expired. Please log in again.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [], failedTransactions: [] };
    }
    const { session } = sessionResult;

    // Verify admin role from Firestore directly (avoids stale JWT claims causing false "no access" errors)
    let isAdmin = session?.user?.roles?.includes("admin") || session?.user?.roles?.includes("super_admin");
    if (!isAdmin) {
        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const roles: string[] = userDoc.data()?.roles ?? [];
            isAdmin = roles.includes("admin") || roles.includes("super_admin");
        } catch {
            // fall through — isAdmin stays false
        }
    }
    if (!isAdmin) {
        return { success: false, error: "You do not have admin access to view financial data.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [], failedTransactions: [] };
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
        db.collection(COLLECTIONS.WITHDRAWAL_REQUESTS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
        db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "approved_pending_payout").aggregate({ total: AggregateField.sum("amount") }).get(),
    ]);
    pendingPayoutAmount =
        (coopPayoutsR.status === "fulfilled" ? (coopPayoutsR.value.data().total ?? 0) : 0) +
        (wavePayoutsR.status === "fulfilled" ? (wavePayoutsR.value.data().total ?? 0) : 0);

    // Fetch failed/abandoned transactions (from failedPayments collection)
    const failedTransactions: FinancialOverview["failedTransactions"] = [];
    try {
        const failedSnap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).orderBy("failedAt", "desc").limit(1000).get();
        failedSnap.docs.forEach(doc => {
            const d = doc.data();
            const ts = d.failedAt ?? d.abandonedAt ?? null;
            failedTransactions.push({
                id: doc.id,
                type: d.type ?? "unknown",
                amount: Number(d.amount) || 0,
                status: (d.status === "abandoned" ? "abandoned" : "failed") as "failed" | "abandoned",
                gatewayResponse: d.gatewayResponse ?? null,
                timestamp: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : null),
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

    return { success: true, totalRevenue, totalEscrowVolume, totalLoansDisbursed, pendingPayoutAmount, recentTransactions, failedTransactions, totalSuccessfulCount, totalAbandonedCount, totalFailedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module Registration Stats (cached, for admin charts)
// ─────────────────────────────────────────────────────────────────────────────

export interface ModuleRegistrationStats {
    hub: number;
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
            hub,
            wave,
            waveBriefing,
            academy,
            cooperatives,
            cooperativeOnboarding,
            farmNation,
            exportHub,
            exportOnboarding,
            marketplace,
        ] = await Promise.all([
            safeCount(db.collection(COLLECTIONS.USERS)),
            safeCount(db.collection(COLLECTIONS.WAVE_APPLICATIONS).where("status", "in", ["pending", "submitted", "under_review", "approved", "rejected"])),
            safeCount(db.collection(COLLECTIONS.WAVE_BRIEFING_REGISTRATIONS)),
            safeCount(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "==", "completed").where("membershipStatus", "!=", "rejected")),
            safeCount(db.collection(COLLECTIONS.COOPERATIVE_ONBOARDING).where("status", "==", "pending")),
            safeCount(db.collection(COLLECTIONS.FARM_NATION_INQUIRIES)),
            safeCount(db.collection(COLLECTIONS.EXPORT_APPLICATIONS)),
            safeCount(db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending_review")),
            safeCount(db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "!=", "rejected")),
        ]);
        return { hub, wave, waveBriefing, academy, cooperatives, cooperativeOnboarding, farmNation, exportHub, exportOnboarding, marketplace };
    },
    ["module-registration-stats"],
    { revalidate: 300, tags: ["module-registration-stats"] }
);

export async function getModuleRegistrationStatsAction(): Promise<ModuleRegistrationStats> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) return null as any;
    const { session } = sessionResult;
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
    }
    return fetchModuleRegistrationStats();
}
