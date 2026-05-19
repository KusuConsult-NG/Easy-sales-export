import { getAdminDb } from "@/lib/firebase-admin";
import { AggregateField } from "firebase-admin/firestore";
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
        
        // Get total active users across the platform
        const usersSnap = await db.collection(COLLECTIONS.USERS).get();
        const activeUsers = usersSnap.docs.filter(d => d.data().status !== 'suspended').length;

        // Escrow health
        const escrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "locked").get();
        const activeEscrows = escrowSnap.size;

        return {
            totalUsers: usersSnap.size,
            activeUsers,
            activeEscrows,
            lastCalculatedAt: new Date().toISOString()
        };
    }

    async getPlatformHealthMetrics(): Promise<PlatformHealthMetrics> {
        return AnalyticsService.getPlatformHealthMetrics();
    }

    // Centralized Helper: Get Platform Metrics without session checks
    private async getPlatformMetrics(db: FirebaseFirestore.Firestore) {
        const [revenueSnap, allUsersSnap] = await Promise.allSettled([
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("status", "==", "completed")
                .select("amount")
                .get(),
            db.collection(COLLECTIONS.USERS).count().get()
        ]);

        let totalRevenue = 0;
        let totalTransactions = 0;
        
        if (revenueSnap.status === 'fulfilled') {
            revenueSnap.value.docs.forEach(d => {
                totalRevenue += (Number(d.data().amount) || 0);
            });
            totalTransactions = revenueSnap.value.docs.length;
        }

        const totalUsers = (allUsersSnap.status === 'fulfilled' ? allUsersSnap.value.data().count || 0 : 0);
        
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

        const [
            activeUsersSnap,
            pendingEscrowsCount,
            activeLandCount,
            pendingLoansCount,
        ] = await Promise.allSettled([
            db.collection(COLLECTIONS.USERS).where("lastLoginAt", ">=", filterFrom).count().get(),
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
                this.getGlobalPendingApprovals(db),
            ]);
            totalUsers = newUsersSnap.status === "fulfilled" ? (newUsersSnap.value.data().count ?? 0) : 0;
            totalRevenue = paymentsSnap.status === "fulfilled"
                ? paymentsSnap.value.docs.reduce((sum: number, d: any) => sum + (Number(d.data().amount) || 0), 0)
                : 0;
            totalTransactions = paymentsSnap.status === "fulfilled" ? paymentsSnap.value.size : 0;
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

        // Recent transactions
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
