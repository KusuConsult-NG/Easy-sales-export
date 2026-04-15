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
    // We just compute monthlyRevenue here:
    let monthlyRevenue = 0;
    try {
        const [monthRevSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.TRANSACTIONS)
                .where("status", "==", "completed")
                .where("date", ">=", thisMonthStart)
                .aggregate({ total: AggregateField.sum("amount") }).get(),
        ]);
        monthlyRevenue = monthRevSnap.status === "fulfilled" ? (monthRevSnap.value.data().total ?? 0) : 0;
    } catch (_e) {
        // collection may not exist yet — leave as 0
    }

    // ── Revenue by month (last 6 months — all payment sources) ─────────────
    const revenueByMonth = await Promise.all(
        months.map(async ({ label, start, end }) => {
            try {
                const [p1] = await Promise.allSettled([
                    db.collection(COLLECTIONS.TRANSACTIONS)
                        .where("status", "==", "completed")
                        .where("date", ">=", start)
                        .where("date", "<=", end)
                        .aggregate({ total: AggregateField.sum("amount") }).get(),
                ]);
                const rev = p1.status === "fulfilled" ? (p1.value.data().total ?? 0) : 0;
                return { month: label, revenue: rev };
            } catch (_e) {
                return { month: label, revenue: 0 };
            }
        })
    );

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
            safeCount(
                db
                    .collection(COLLECTIONS.USERS)
                    .where("serviceRegistrations.farmNation.status", "in", ["pending", "approved"])
            ),
            safeCount(
                db
                    .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                    .where("status", "!=", "rejected")
            ),
            safeCount(
                db
                    .collection(COLLECTIONS.USERS)
                    .where("serviceRegistrations.export.status", "in", ["pending", "approved"])
            ),
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
        const txSnap = await db.collection(COLLECTIONS.TRANSACTIONS)
            .orderBy("date", "desc")
            .limit(15)
            .get();

        txSnap.docs.forEach(doc => {
            if (recentTransactions.length >= 8) return;
            const d = doc.data();
            const ts = d.date ?? null;
            if (Number(d.amount) > 0 || d.amount === undefined) {
                recentTransactions.push({
                    id: doc.id,
                    type: d.type ?? "Transaction",
                    amount: Number(d.amount) || 0,
                    date: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : new Date(0).toISOString())
                });
            }
        });
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

    const [allEscrowsR, completedEscrowsR, coopRevenueR] = await Promise.allSettled([
        db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).aggregate({ total: AggregateField.sum("amount") }).get(),
        db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "completed").aggregate({ total: AggregateField.sum("amount") }).get(),
        db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "==", "completed").aggregate({ total: AggregateField.sum("registrationFee") }).get(),
    ]);
    totalEscrowVolume = allEscrowsR.status === "fulfilled" ? (allEscrowsR.value.data().total ?? 0) : 0;
    const escrowRevenue = completedEscrowsR.status === "fulfilled" ? (completedEscrowsR.value.data().total ?? 0) * 0.025 : 0;
    const coopRevenue = coopRevenueR.status === "fulfilled" ? (coopRevenueR.value.data().total ?? 0) : 0;
    totalRevenue = escrowRevenue + coopRevenue;

    const loanR = await Promise.allSettled([
        db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "disbursed").aggregate({ total: AggregateField.sum("amount") }).get(),
    ]);
    totalLoansDisbursed = loanR[0].status === "fulfilled" ? (loanR[0].value.data().total ?? 0) : 0;

    try {
        // PRIMARY: processedPayments = every Paystack webhook payment (all 50 real transactions)
        // SECONDARY: escrow_transactions = marketplace escrow entries (created by marketplace_order handler)
        const [processedSnap, escrowSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).limit(200).get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).limit(100).get(),
        ]);

        const toTx = (doc: FirebaseFirestore.QueryDocumentSnapshot, typePrefix: string) => {
            const d = doc.data();
            const ts = d.processedAt ?? d.createdAt ?? d.requestedAt ?? d.timestamp ?? null;
            return {
                id: doc.id,
                type: d.type ?? d.action ?? typePrefix,
                amount: Number(d.amount) || 0,
                status: d.status ?? "completed",
                description: d.description ?? d.purpose ?? d.note ?? null,
                reference: d.reference ?? d.paymentReference ?? null,
                timestamp: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : null),
            };
        };

        const all: ReturnType<typeof toTx>[] = [];
        if (processedSnap.status === "fulfilled") all.push(...processedSnap.value.docs.map(d => toTx(d, "payment")));
        if (escrowSnap.status === "fulfilled") all.push(...escrowSnap.value.docs.map(d => toTx(d, "escrow")));

        all
            .filter(tx => tx.amount > 0)
            .sort((a, b) => {
                const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return tb - ta;
            })
            .slice(0, 50)
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
        const failedSnap = await db.collection(COLLECTIONS.FAILED_PAYMENTS).limit(100).get();
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

    return { success: true, totalRevenue, totalEscrowVolume, totalLoansDisbursed, pendingPayoutAmount, recentTransactions, failedTransactions };
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
            safeCount(db.collection(COLLECTIONS.USERS).where("serviceRegistrations.farmNation.status", "in", ["pending", "approved"])),
            safeCount(db.collection(COLLECTIONS.USERS).where("serviceRegistrations.export.status", "in", ["pending", "approved"])),
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
