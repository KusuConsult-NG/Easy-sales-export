"use server";

import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { analyticsService } from "@/services";

// ─────────────────────────────────────────────────────────────────────────────
// Types (Preserved for backwards compatibility with front-end imports)
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
        /** False when revenue could not be determined. Do not render totalRevenue as a figure when this is false. */
        revenueAvailable: boolean;
        pendingApprovals: number;
        recentActivityCount: number;
    };
    counts: {
        pendingEscrows: number;
        activeLandListings: number;
        pendingLoans: number;
    };
    revenueByMonth: Array<{ month: string; revenue: number }>;
    userGrowthByMonth: Array<{ month: string; users: number }>;
    moduleUsage: Array<{ module: string; count: number }>;
    userSegments: UserSegments;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        date: string;
    }>;
}

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
        userId?: string | null;
    }>;
    failedTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        status: "failed" | "abandoned";
        gatewayResponse: string | null;
        timestamp: string | null;
        phone?: string | null;
        userId?: string | null;
    }>;
    totalSuccessfulCount?: number;
    totalAbandonedCount?: number;
    totalFailedCount?: number;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// Server Actions (Delegated strictly to analyticsService)
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
        } catch (e) {
            // quiet fail on cache read
        }
    }

    const payload = await analyticsService.getDashboardStats(options);

    try {
        await setCache(cacheKey, payload, 120); // Cache for 2 minutes
    } catch (e) {}

    return payload;
}

export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return {
            success: false,
            error: "Session expired. Please log in again.",
            totalRevenue: 0,
            totalEscrowVolume: 0,
            totalLoansDisbursed: 0,
            pendingPayoutAmount: 0,
            recentTransactions: [],
            failedTransactions: []
        };
    }
    const { session } = sessionResult;

    if (!isAdmin(session.user.roles)) {
        return {
            success: false,
            error: "You do not have admin access to view financial data.",
            totalRevenue: 0,
            totalEscrowVolume: 0,
            totalLoansDisbursed: 0,
            pendingPayoutAmount: 0,
            recentTransactions: [],
            failedTransactions: []
        };
    }

    const { getCached, setCache } = await import("@/lib/redis");
    const cacheKey = "admin:finance-overview:global";

    try {
        const cached = await getCached<FinancialOverview>(cacheKey);
        if (cached) return cached;
    } catch (e) {
        // quiet fail on cache read
    }

    const payload = await analyticsService.getFinancialOverview();

    try {
        await setCache(cacheKey, payload, 120); // Cache for 2 minutes
    } catch (e) {}

    return payload;
}

export async function getModuleRegistrationStatsAction(): Promise<ModuleRegistrationStats> {
    const sessionResult = await requireSession();
    if (!sessionResult.session) throw new Error("Unauthorized");
    const { session } = sessionResult;
    if (!isAdmin(session.user.roles)) {
        throw new Error("Unauthorized");
    }
    return analyticsService.getModuleRegistrationStats();
}
