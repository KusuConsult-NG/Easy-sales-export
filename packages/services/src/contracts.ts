/**
 * Central Platform Services Contracts
 *
 * @easy-sales/services/contracts
 */

// User type inlined to avoid cross-package import issues in Docker build environment.
// This is structurally compatible with @easy-sales/types User.
 
type User = Record<string, any> & { uid: string; email: string; fullName: string; roles: string[] };

export interface CooperativeMemberMetrics {
    totalApplications: number;
    paidMembersCount: number;
    unpaidMembers: number;
    pendingCount: number;
    approvedCount: number;
    orphanedPaymentsCount: number;
    suspendedCount: number;
}

export interface AcademyMetrics {
    totalCourses: number;
    totalStudents: number;
    totalEnrollments: number;
    activeEnrollments: number;
    completedCourses: number;
    totalRegistrationRevenue: number;
    registrationStats: Record<string, { count: number; revenue: number }>;
}

export interface UserMetricsServiceContract {
    getCooperativeMemberMetrics(adminScope?: string): Promise<CooperativeMemberMetrics>;
    getAcademyMetrics(): Promise<AcademyMetrics>;
}

export interface RevenueMetrics {
    verifiedRevenue: number;
    transactionCount: number;
}

export interface FinanceServiceContract {
    deriveUserBalance(userId: string): Promise<number>;
    getVerifiedRevenueMetrics(module?: string): Promise<RevenueMetrics>;
    deriveMarketplaceWalletBalance(userId: string): Promise<number>;
}

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
        /**
         * False when revenue could not be determined from Paystack or the
         * database. Render "unavailable" rather than totalRevenue when this is
         * false — a confident zero is indistinguishable from a day with no sales.
         */
        revenueAvailable: boolean;
        /**
         * True when `totalRevenue` is a FLOOR rather than a total — the Paystack
         * sweep stopped at its ceiling (MAX_REVENUE_PAGES × 100 = ten thousand
         * transactions) and reported what it had.
         *
         *   #665 THIS FIELD DID NOT EXIST, AND THAT IS WHY NOTHING RENDERED IT.
         *
         *   getPlatformMetrics has computed and returned `revenueIsPartial`
         *   throughout, under a comment reading "an admin reading this figure
         *   needs to know it is a floor, not a total. Surfaced on the payload
         *   below, not only logged." It was true of that payload and of no
         *   other: getDashboardStats copied `revenueAvailable` out of the same
         *   object and dropped this one, because THIS INTERFACE had no field to
         *   put it in — so the compiler enforced its absence all the way to the
         *   screen.
         *
         *   `monthlyRevenueIsPartial` below is the same idea for the chart, was
         *   added to this contract, and IS rendered. One of the two made it into
         *   the type. Render the figure as a floor — "at least ₦X" — when this
         *   is set; do NOT render "unavailable", which throws away a real number
         *   that is merely too low.
         *
         *   Optional so existing callers compile unchanged, matching the field
         *   below.
         */
        revenueIsPartial?: boolean;
        pendingApprovals: number;
        recentActivityCount: number;
    };
    counts: {
        pendingEscrows: number;
        activeLandListings: number;
        pendingLoans: number;
    };
    revenueByMonth: Array<{ month: string; revenue: number }>;
    /**
     * True when the monthly revenue series was read up to its page cap,
     * so earlier months are under-reported. Optional so existing callers
     * compile unchanged; the chart should say so when it is set.
     */
    monthlyRevenueIsPartial?: boolean;
    userGrowthByMonth: Array<{ month: string; users: number }>;
    /**
     * True when at least one month's user count could not be read — #517.
     *
     * Its catch returned `{ users: 0 }`, so a failed count drew a month in
     * which nobody joined. Optional so existing callers compile unchanged.
     */
    userGrowthIsPartial?: boolean;
    /**
     * Month labels whose own query failed, across either series — #517.
     *
     * A bar of zero and a bar that could not be drawn look identical, and only
     * one of them is a fact about the business.
     */
    unavailableMonths?: string[];
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
    /**
     * True when revenue paging stopped at its ceiling, so totalRevenue is a
     * floor rather than a total. Optional so existing callers compile
     * unchanged; the admin surface should show it when set.
     */
    revenueIsPartial?: boolean;
    /**
     * Figures in this payload that could NOT be read, by name — #516.
     *
     * getFinancialOverview reads its aggregates through Promise.allSettled and
     * every rejection used to become `0`, so an escrow query that timed out
     * reached the admin's finance screen as ₦0 of escrow volume with nothing
     * saying so. A name in here means the accompanying number is not a
     * measurement. Optional, so existing callers compile unchanged.
     */
    unavailable?: string[];
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

export interface CommunicationsServiceContract {
    getTargetedUsers(
        audience: "all" | "cooperative" | "marketplace" | "academy" | "wave" | "active" | "verified" | "sellers" | string,
        status?: "approved" | "pending" | "rejected" | string
    ): Promise<string[]>;
}

export interface PlatformHealthMetrics {
    totalUsers: number;
    activeUsers: number;
    activeEscrows: number;
    lastCalculatedAt: string;
    /**
     * Figures that could NOT be read, by name — #518.
     *
     * The catch here returned three zeros with a fresh lastCalculatedAt, so a
     * total outage was indistinguishable from an empty platform AND carried a
     * timestamp asserting it had just been measured. A name in here means the
     * accompanying number is not a measurement.
     */
    unavailable?: string[];
}

export interface AnalyticsServiceContract {
    getPlatformHealthMetrics(): Promise<PlatformHealthMetrics>;
    getDashboardStats(options?: { dateFrom?: string; dateTo?: string }): Promise<AnalyticsData>;
    getFinancialOverview(): Promise<FinancialOverview>;
    getModuleRegistrationStats(): Promise<ModuleRegistrationStats>;
}

export interface UserServiceContract {
    atomicUpdateUser(userId: string, updates: Record<string, any>): Promise<User>;
}
