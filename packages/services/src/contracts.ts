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
