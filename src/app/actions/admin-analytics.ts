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
    } catch {
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

    const totalUsers =
        totalUsersSnap.status === "fulfilled" ? (totalUsersSnap.value.data().count ?? 0) : 0;
    const activeUsers =
        activeUsersSnap.status === "fulfilled" ? (activeUsersSnap.value.data().count ?? 0) : totalUsers;

    const pendingEscrows = pendingEscrowsCount.status === "fulfilled" ? pendingEscrowsCount.value : 0;
    const activeLandListings = activeLandCount.status === "fulfilled" ? activeLandCount.value : 0;
    const pendingLoans = pendingLoansCount.status === "fulfilled" ? pendingLoansCount.value : 0;
    const pendingSellers = pendingSellersCount.status === "fulfilled" ? pendingSellersCount.value : 0;
    const pendingWithdrawals = pendingWithdrawalsCount.status === "fulfilled" ? pendingWithdrawalsCount.value : 0;
    const totalOrders = totalOrdersCount.status === "fulfilled" ? totalOrdersCount.value : 0;
    const totalEscrows = totalEscrowsCount.status === "fulfilled" ? totalEscrowsCount.value : 0;
    const totalTransactions = totalOrders + totalEscrows;
    const pendingApprovals = pendingEscrows + pendingSellers + pendingWithdrawals + pendingLoans;

    // ── Revenue: completed escrow commissions + cooperative fees ─────────────
    let totalRevenue = 0;
    let monthlyRevenue = 0;
    try {
        const [allRevResult, monthRevResult, allCoopResult, monthCoopResult] = await Promise.allSettled([
            db
                .collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("status", "==", "completed")
                .aggregate({ total: AggregateField.sum("amount") })
                .get(),
            db
                .collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("status", "==", "completed")
                .where("completedAt", ">=", thisMonthStart)
                .aggregate({ total: AggregateField.sum("amount") })
                .get(),
            db
                .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("paymentStatus", "==", "completed")
                .aggregate({ total: AggregateField.sum("registrationFee") })
                .get(),
            db
                .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("paymentStatus", "==", "completed")
                .where("updatedAt", ">=", thisMonthStart)
                .aggregate({ total: AggregateField.sum("registrationFee") })
                .get(),
        ]);
        
        const escrowRev = allRevResult.status === "fulfilled" ? (allRevResult.value.data().total ?? 0) * 0.025 : 0;
        const escrowMonthRev = monthRevResult.status === "fulfilled" ? (monthRevResult.value.data().total ?? 0) * 0.025 : 0;
        const coopRev = allCoopResult.status === "fulfilled" ? (allCoopResult.value.data().total ?? 0) : 0;
        const coopMonthRev = monthCoopResult.status === "fulfilled" ? (monthCoopResult.value.data().total ?? 0) : 0;
        
        totalRevenue = escrowRev + coopRev;
        monthlyRevenue = escrowMonthRev + coopMonthRev;
    } catch {
        // collections may not exist yet — leave as 0
    }

    // ── Revenue by month (last 6 months) ────────────────────────────────────
    const revenueByMonth = await Promise.all(
        months.map(async ({ label, start, end }) => {
            try {
                const [snap, coopSnap] = await Promise.all([
                    db
                        .collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                        .where("status", "==", "completed")
                        .where("completedAt", ">=", start)
                        .where("completedAt", "<=", end)
                        .aggregate({ total: AggregateField.sum("amount") })
                        .get(),
                    db
                        .collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("paymentStatus", "==", "completed")
                        .where("updatedAt", ">=", start)
                        .where("updatedAt", "<=", end)
                        .aggregate({ total: AggregateField.sum("registrationFee") })
                        .get()
                ]);
                const escrowRev = (snap.data().total ?? 0) * 0.025;
                const coopRev = coopSnap.data().total ?? 0;
                return { month: label, revenue: escrowRev + coopRev };
            } catch {
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
            } catch {
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

    // ── Recent transactions from financial collections (no orderBy — avoids missing-field drops) ──
    const recentTransactions: AnalyticsData["recentTransactions"] = [];

    try {
        const [escrowSnap, coopTxSnap, walletSnap, waveWdSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).limit(50).get(),
            db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).limit(50).get(),
            db.collection(COLLECTIONS.WALLET_TRANSACTIONS).limit(50).get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).limit(50).get(),
        ]);

        const toTx = (doc: FirebaseFirestore.QueryDocumentSnapshot, typeLabel: string) => {
            const d = doc.data();
            const ts = d.createdAt ?? d.requestedAt ?? d.timestamp ?? d.updatedAt ?? null;
            return {
                id: doc.id,
                type: d.type ?? d.action ?? typeLabel,
                amount: Number(d.amount ?? d.registrationFee) || 0,
                date: ts?.toDate ? ts.toDate().toISOString() : (ts ? new Date(ts).toISOString() : new Date(0).toISOString()),
            };
        };

        const allTx: Array<{ id: string; type: string; amount: number; date: string }> = [];

        if (escrowSnap.status === "fulfilled") allTx.push(...escrowSnap.value.docs.map(d => toTx(d, "Escrow Transaction")));
        if (coopTxSnap.status === "fulfilled") allTx.push(...coopTxSnap.value.docs.map(d => toTx(d, "Cooperative Transaction")));
        if (walletSnap.status === "fulfilled") allTx.push(...walletSnap.value.docs.map(d => toTx(d, "Wallet Transaction")));
        if (waveWdSnap.status === "fulfilled") allTx.push(...waveWdSnap.value.docs.map(d => toTx(d, "WAVE Withdrawal")));

        allTx
            .filter(tx => tx.amount > 0)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 8)
            .forEach(tx => recentTransactions.push(tx));
    } catch (e) {
        logger.error("Failed to fetch recent transactions:", e);
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
}


export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return { success: false, error: "Session expired. Please log in again.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [] };
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
        return { success: false, error: "You do not have admin access to view financial data.", totalRevenue: 0, totalEscrowVolume: 0, totalLoansDisbursed: 0, pendingPayoutAmount: 0, recentTransactions: [] };
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
        // Pull real transactions from actual payment collections (no orderBy — avoids missing-field drops)
        const [escrowSnap, coopTxSnap, walletSnap, waveWdSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).limit(100).get(),
            db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).limit(100).get(),
            db.collection(COLLECTIONS.WALLET_TRANSACTIONS).limit(100).get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).limit(100).get(),
        ]);

        const toTx = (doc: FirebaseFirestore.QueryDocumentSnapshot, typePrefix: string) => {
            const d = doc.data();
            const ts = d.createdAt ?? d.requestedAt ?? d.timestamp ?? null;
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
        if (escrowSnap.status === "fulfilled") all.push(...escrowSnap.value.docs.map(d => toTx(d, "escrow")));
        if (coopTxSnap.status === "fulfilled") all.push(...coopTxSnap.value.docs.map(d => toTx(d, "cooperative_transaction")));
        if (walletSnap.status === "fulfilled") all.push(...walletSnap.value.docs.map(d => toTx(d, "wallet_transaction")));
        if (waveWdSnap.status === "fulfilled") all.push(...waveWdSnap.value.docs.map(d => toTx(d, "wave_withdrawal")));

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

    return { success: true, totalRevenue, totalEscrowVolume, totalLoansDisbursed, pendingPayoutAmount, recentTransactions };
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
