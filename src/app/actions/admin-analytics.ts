"use server";

import { db } from "@/lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

/**
 * Admin Analytics & Dashboard Data
 */


/**
 * Admin Analytics & Dashboard Data
 */

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
    revenueByMonth: Array<{ month: string; revenue: number }>;
    userGrowthByMonth: Array<{ month: string; users: number }>;
    moduleUsage: Array<{ name: string; value: number }>;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        createdAt: Date;
    }>;
}

export interface EngagementMetrics {
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    averageSessionDuration: number;
    topFeatures: Array<{ feature: string; usage: number }>;
}

export async function getDashboardStatsAction(): Promise<AnalyticsData | null> {
    try {
        // 1. Platform Overview
        const usersSnapshot = await db.collection("users").get();
        const totalUsers = usersSnapshot.size;

        // Active users (users with recent login audit logs in last 30d)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const activeUsersQuery = db.collection("audit_logs")
            .where("action", "==", "user_login")
            .where("timestamp", ">=", thirtyDaysAgo);
        const activeUsersSnapshot = await activeUsersQuery.get();
        const activeUsers = new Set(activeUsersSnapshot.docs.map(d => d.data().userId)).size;

        // Revenue & Transactions
        const transactionsSnapshot = await db.collection("escrow_transactions").get(); // Assuming this holds main revenue
        // Also check loan_applications for disbursed loans if that counts as platform volume/revenue
        // For now, let's use Escrow + Loans

        const loansSnapshot = await db.collection("loan_applications").get();

        let totalRevenue = 0;
        let monthlyRevenue = 0;
        let totalTransactions = 0;
        const currentMonth = new Date().getMonth();

        // Escrow Revenue (2.5% fee)
        transactionsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === "released" || data.status === "completed") {
                const fee = (data.amount || 0) * 0.025;
                totalRevenue += fee;
                totalTransactions++;

                const date = data.createdAt?.toDate();
                if (date && date.getMonth() === currentMonth) {
                    monthlyRevenue += fee;
                }
            }
        });

        // Pending Approvals
        const pendingWave = (await db.collection("wave_applications").where("status", "==", "pending").get()).size;
        const pendingLoans = (await db.collection("loan_applications").where("status", "==", "pending").get()).size;
        const pendingLand = (await db.collection("land_listings").where("verificationStatus", "==", "pending").get()).size;

        const pendingApprovals = pendingWave + pendingLoans + pendingLand;

        const pendingEscrows = (await db.collection("escrow_transactions").where("status", "==", "held").get()).size;
        const activeLandListings = (await db.collection("land_listings").where("status", "==", "verified").get()).size;

        // 2. Revenue By Month (Last 6 Months)
        const revenueByMonthMap = new Map<string, number>();
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);

        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        // Init last 6 months 0
        for (let i = 0; i < 6; i++) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const key = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
            revenueByMonthMap.set(key, 0);
        }

        transactionsSnapshot.docs.forEach(doc => {
            const data = doc.data();
            if (data.status === "released" || data.status === "completed") {
                const date = data.createdAt?.toDate();
                if (date && date >= sixMonthsAgo) {
                    const key = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
                    if (revenueByMonthMap.has(key)) {
                        revenueByMonthMap.set(key, revenueByMonthMap.get(key)! + ((data.amount || 0) * 0.025));
                    }
                }
            }
        });

        const revenueByMonth = Array.from(revenueByMonthMap.entries())
            .map(([month, revenue]) => ({ month, revenue }))
            .reverse();

        // 3. User Growth (Last 6 Months)
        const userGrowthMap = new Map<string, number>();
        // Init
        for (let i = 0; i < 6; i++) {
            const d = new Date();
            d.setMonth(d.getMonth() - i);
            const key = `${monthNames[d.getMonth()]}`;
            userGrowthMap.set(key, 0);
        }

        usersSnapshot.docs.forEach(doc => {
            const date = doc.data().createdAt?.toDate();
            if (date && date >= sixMonthsAgo) {
                const key = `${monthNames[date.getMonth()]}`;
                if (userGrowthMap.has(key)) {
                    userGrowthMap.set(key, userGrowthMap.get(key)! + 1);
                }
            }
        });
        const userGrowthByMonth = Array.from(userGrowthMap.entries())
            .map(([month, users]) => ({ month, users }))
            .reverse();


        // 4. Module Usage
        // Count documents in key collections
        const moduleUsage = [
            { name: "Farm Nation", value: (await db.collection("land_listings").get()).size },
            { name: "Academy", value: (await db.collection("course_enrollments").get()).size || 0 }, // Assuming collection exists
            { name: "WAVE", value: (await db.collection("wave_applications").get()).size },
            { name: "Cooperatives", value: (await db.collection("cooperatives").get()).size },
            { name: "Marketplace", value: (await db.collection("products").get()).size },
        ];

        // 5. Recent Transactions
        const recentAuditQuery = db.collection("audit_logs")
            .where("action", "in", ["payment_completed", "escrow_released", "loan_disbursed"])
            .orderBy("timestamp", "desc")
            .limit(5);
        const recentAudit = await recentAuditQuery.get();

        const recentTransactions = recentAudit.docs.map(doc => ({
            id: doc.id,
            type: formatActivityDescription(doc.data()),
            amount: doc.data().metadata?.amount || 0,
            createdAt: doc.data().timestamp?.toDate() || new Date(),
        }));

        return {
            platformOverview: {
                totalUsers,
                activeUsers,
                totalRevenue,
                monthlyRevenue,
                totalTransactions,
                pendingApprovals
            },
            counts: {
                pendingEscrows,
                activeLandListings,
                pendingLoans
            },
            revenueByMonth,
            userGrowthByMonth,
            moduleUsage,
            recentTransactions
        };

    } catch (error) {
        console.error("Failed to fetch dashboard stats:", error);
        return null;
    }
}

/**
 * Get financial overview
 */
export interface FinancialOverview {
    totalEscrowVolume: number;
    totalLoansDisbursed: number;
    totalRevenue: number;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        timestamp: Timestamp;
    }>;
}

export async function getFinancialOverviewAction(): Promise<FinancialOverview | null> {
    try {
        // Get all escrow transactions
        const escrowSnapshot = await db.collection("escrow_transactions").get();
        const totalEscrowVolume = escrowSnapshot.docs.reduce((sum, doc) => {
            const data = doc.data();
            return sum + (data.amount || 0);
        }, 0);

        // Get all disbursed loans
        const loansQuery = db.collection("loan_applications")
            .where("status", "in", ["approved", "disbursed"]);
        const loansSnapshot = await loansQuery.get();
        const totalLoansDisbursed = loansSnapshot.docs.reduce((sum, doc) => {
            const data = doc.data();
            return sum + (data.amount || 0);
        }, 0);

        // Get recent transactions
        const transactionsQuery = db.collection("audit_logs")
            .where("action", "in", ["payment_completed", "escrow_released", "loan_approved"])
            .orderBy("timestamp", "desc")
            .limit(20);
        const transactionsSnapshot = await transactionsQuery.get();
        const recentTransactions = transactionsSnapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                type: data.action,
                amount: data.metadata?.amount || 0,
                timestamp: data.timestamp,
            };
        });

        return {
            totalEscrowVolume,
            totalLoansDisbursed,
            totalRevenue: totalEscrowVolume * 0.025, // 2.5% platform fee estimate
            recentTransactions,
        };
    } catch (error) {
        console.error("Failed to fetch financial overview:", error);
        return null;
    }
}

/**
 * Get engagement metrics
 */
export async function getEngagementMetricsAction(): Promise<EngagementMetrics | null> {
    try {
        // Note: In a real implementation, you'd track these metrics properly
        // This is a simplified version using audit logs

        const now = new Date();
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        // Get daily active users
        const dailyQuery = db.collection("audit_logs")
            .where("timestamp", ">=", oneDayAgo);
        const dailyDocs = await dailyQuery.get();
        const dailyUsers = new Set(dailyDocs.docs.map((doc) => doc.data().userId));

        // Get weekly active users
        const weeklyQuery = db.collection("audit_logs")
            .where("timestamp", ">=", oneWeekAgo);
        const weeklyDocs = await weeklyQuery.get();
        const weeklyUsers = new Set(weeklyDocs.docs.map((doc) => doc.data().userId));

        // Get monthly active users
        const monthlyQuery = db.collection("audit_logs")
            .where("timestamp", ">=", oneMonthAgo);
        const monthlyDocs = await monthlyQuery.get();
        const monthlyUsers = new Set(monthlyDocs.docs.map((doc) => doc.data().userId));

        // Calculate top features by action count
        const featureCount: Record<string, number> = {};
        monthlyDocs.docs.forEach((doc) => {
            const action = doc.data().action;
            featureCount[action] = (featureCount[action] || 0) + 1;
        });

        const topFeatures = Object.entries(featureCount)
            .map(([feature, usage]) => ({ feature, usage }))
            .sort((a, b) => b.usage - a.usage)
            .slice(0, 5);

        return {
            dailyActiveUsers: dailyUsers.size,
            weeklyActiveUsers: weeklyUsers.size,
            monthlyActiveUsers: monthlyUsers.size,
            averageSessionDuration: 0, // Placeholder
            topFeatures,
        };
    } catch (error) {
        console.error("Failed to fetch engagement metrics:", error);
        return null;
    }
}

/**
 * Helper function to format activity description
 */
function formatActivityDescription(data: any): string {
    const actionMap: Record<string, string> = {
        user_login: "User logged in",
        user_register: "New user registered",
        loan_applied: "Loan application submitted",
        loan_approved: "Loan approved",
        escrow_created: "Escrow transaction created",
        payment_completed: "Payment completed",
        land_verified: "Land listing verified",
    };

    return actionMap[data.action] || data.action;
}
