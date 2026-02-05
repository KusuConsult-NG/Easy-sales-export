"use server";

import { doc, getDoc, collection, query, where, getDocs, Timestamp, orderBy, limit as firestoreLimit } from "firebase/firestore";
import { db } from "@/lib/firebase";

/**
 * Admin Analytics & Dashboard Data
 */

export interface DashboardStats {
    totalUsers: number;
    activeUsers: number;
    totalRevenue: number;
    pendingEscrows: number;
    activeLandListings: number;
    pendingLoans: number;
    totalCourseEnrollments: number;
    recentActivity: ActivityItem[];
}

export interface ActivityItem {
    id: string;
    type: string;
    description: string;
    timestamp: Timestamp;
    userId?: string;
}

export interface EngagementMetrics {
    dailyActiveUsers: number;
    weeklyActiveUsers: number;
    monthlyActiveUsers: number;
    averageSessionDuration: number;
    topFeatures: Array<{ feature: string; usage: number }>;
}

/**
 * Get dashboard statistics
 */
export async function getDashboardStatsAction(): Promise<DashboardStats | null> {
    try {
        // Count total users
        const usersSnapshot = await getDocs(collection(db, "users"));
        const totalUsers = usersSnapshot.size;

        // Count active users (logged in last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Note: In production, you'd have a lastLoginAt field
        const activeUsers = totalUsers; // Placeholder

        // Get pending escrows
        const pendingEscrowsQuery = query(
            collection(db, "escrow_transactions"),
            where("status", "==", "held")
        );
        const pendingEscrows = (await getDocs(pendingEscrowsQuery)).size;

        // Get active land listings
        const landQuery = query(
            collection(db, "land_listings"),
            where("status", "==", "verified")
        );
        const activeLandListings = (await getDocs(landQuery)).size;

        // Get pending loans
        const pendingLoansQuery = query(
            collection(db, "loan_applications"),
            where("status", "==", "pending")
        );
        const pendingLoans = (await getDocs(pendingLoansQuery)).size;

        // Get recent activity from audit logs
        const activityQuery = query(
            collection(db, "audit_logs"),
            orderBy("timestamp", "desc"),
            firestoreLimit(10)
        );
        const activitySnapshot = await getDocs(activityQuery);
        const recentActivity = activitySnapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                type: data.action,
                description: formatActivityDescription(data),
                timestamp: data.timestamp,
                userId: data.userId,
            };
        });

        return {
            totalUsers,
            activeUsers,
            totalRevenue: 0, // Placeholder
            pendingEscrows,
            activeLandListings,
            pendingLoans,
            totalCourseEnrollments: 0, // Placeholder
            recentActivity,
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
        const escrowSnapshot = await getDocs(collection(db, "escrow_transactions"));
        const totalEscrowVolume = escrowSnapshot.docs.reduce((sum, doc) => {
            const data = doc.data();
            return sum + (data.amount || 0);
        }, 0);

        // Get all disbursed loans
        const loansQuery = query(
            collection(db, "loan_applications"),
            where("status", "in", ["approved", "disbursed"])
        );
        const loansSnapshot = await getDocs(loansQuery);
        const totalLoansDisbursed = loansSnapshot.docs.reduce((sum, doc) => {
            const data = doc.data();
            return sum + (data.amount || 0);
        }, 0);

        // Get recent transactions
        const transactionsQuery = query(
            collection(db, "audit_logs"),
            where("action", "in", ["payment_completed", "escrow_released", "loan_approved"]),
            orderBy("timestamp", "desc"),
            firestoreLimit(20)
        );
        const transactionsSnapshot = await getDocs(transactionsQuery);
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
        const dailyQuery = query(
            collection(db, "audit_logs"),
            where("timestamp", ">=", Timestamp.fromDate(oneDayAgo))
        );
        const dailyDocs = await getDocs(dailyQuery);
        const dailyUsers = new Set(dailyDocs.docs.map((doc) => doc.data().userId));

        // Get weekly active users
        const weeklyQuery = query(
            collection(db, "audit_logs"),
            where("timestamp", ">=", Timestamp.fromDate(oneWeekAgo))
        );
        const weeklyDocs = await getDocs(weeklyQuery);
        const weeklyUsers = new Set(weeklyDocs.docs.map((doc) => doc.data().userId));

        // Get monthly active users
        const monthlyQuery = query(
            collection(db, "audit_logs"),
            where("timestamp", ">=", Timestamp.fromDate(oneMonthAgo))
        );
        const monthlyDocs = await getDocs(monthlyQuery);
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
