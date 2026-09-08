"use server";

import { requireSession } from "@/lib/session-guard";
import { isAdmin } from "@/lib/admin-permissions";
import { analyticsService } from "@/services";


/**
 *   #517 THESE CONTRACTS ARE RE-EXPORTED, NOT RESTATED.
 *
 *   AnalyticsData and FinancialOverview were declared here AND in
 *   packages/services/src/contracts.ts — two hand-maintained copies of the same
 *   shape, character for character. They had not drifted, which is precisely the
 *   state lib/recent-activity.ts describes a duplicate sitting in "right up
 *   until somebody changes one of them".
 *
 *   Adding userGrowthIsPartial and unavailableMonths to the service's contract
 *   made me that somebody: the field existed on one copy, the dashboard imported
 *   the other, and the build failed. It failed loudly, which is luck — a widened
 *   OPTIONAL field on the copy nobody imports is silent.
 *
 *   The service implements the package's contract, so the package's is the one
 *   that is true. This module re-exports it, and callers importing from here are
 *   unchanged.
 */
import type { AnalyticsData, FinancialOverview } from "@easy-sales/services";
export type { AnalyticsData, FinancialOverview };

// ─────────────────────────────────────────────────────────────────────────────
// Types (Preserved for backwards compatibility with front-end imports)
// ─────────────────────────────────────────────────────────────────────────────

export interface UserSegments {
    active: number;
    pending: number;
    stalled: number;
    ghost: number;
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
