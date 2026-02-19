"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";

export interface AnalyticsData {
    platformOverview: {
        totalUsers: number;
        activeUsers: number;
        totalRevenue: number;
    };
    counts: {
        pendingEscrows: number;
        activeLandListings: number;
        pendingLoans: number;
    };
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        date: string;
    }>;
}

export async function getDashboardStatsAction(): Promise<AnalyticsData> {
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
    }

    // Get total users
    const usersSnap = await db.collection("users").count().get();
    const totalUsers = usersSnap.data().count;

    // Get active users (users with lastLoginAt in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    let activeUsers = 0;
    try {
        const activeSnap = await db.collection("users")
            .where("lastLoginAt", ">=", thirtyDaysAgo)
            .count().get();
        activeUsers = activeSnap.data().count;
    } catch {
        activeUsers = totalUsers; // Fallback
    }

    // Get pending escrows
    let pendingEscrows = 0;
    try {
        const escrowSnap = await db.collection("escrows")
            .where("status", "==", "pending")
            .count().get();
        pendingEscrows = escrowSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get active land listings
    let activeLandListings = 0;
    try {
        const landSnap = await db.collection("land_listings")
            .where("status", "==", "active")
            .count().get();
        activeLandListings = landSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get pending loans
    let pendingLoans = 0;
    try {
        const loanSnap = await db.collection("loan_applications")
            .where("status", "==", "pending")
            .count().get();
        pendingLoans = loanSnap.data().count;
    } catch {
        // Collection may not exist
    }

    // Get recent audit logs as "transactions"
    let recentTransactions: AnalyticsData["recentTransactions"] = [];
    try {
        const logsSnap = await db.collection("audit_logs")
            .orderBy("timestamp", "desc")
            .limit(10)
            .get();
        recentTransactions = logsSnap.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                type: data.action || "unknown",
                amount: data.amount || 0,
                date: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
            };
        });
    } catch {
        // Collection may not exist
    }

    return {
        platformOverview: {
            totalUsers,
            activeUsers,
            totalRevenue: 0, // Will accumulate as transactions flow
        },
        counts: {
            pendingEscrows,
            activeLandListings,
            pendingLoans,
        },
        recentTransactions,
    };
}

export interface FinancialOverview {
    totalRevenue: number;
    totalEscrowVolume: number;
    totalLoansDisbursed: number;
    recentTransactions: Array<{
        id: string;
        type: string;
        amount: number;
        timestamp: any;
    }>;
}

export async function getFinancialOverviewAction(): Promise<FinancialOverview> {
    const session = await auth();
    if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
        throw new Error("Unauthorized");
    }

    let totalRevenue = 0;
    let totalEscrowVolume = 0;
    let totalLoansDisbursed = 0;
    const recentTransactions: FinancialOverview["recentTransactions"] = [];

    // Sum escrow volumes
    try {
        const escrowSnap = await db.collection("escrows").get();
        escrowSnap.docs.forEach(doc => {
            const data = doc.data();
            const amount = Number(data.amount) || 0;
            totalEscrowVolume += amount;
            if (data.status === "completed") {
                totalRevenue += amount * 0.025; // 2.5% commission
            }
        });
    } catch {
        // Collection may not exist
    }

    // Sum loans disbursed
    try {
        const loanSnap = await db.collection("loan_applications")
            .where("status", "==", "disbursed")
            .get();
        loanSnap.docs.forEach(doc => {
            totalLoansDisbursed += Number(doc.data().amount) || 0;
        });
    } catch {
        // Collection may not exist
    }

    // Get recent financial transactions from audit logs
    try {
        const logsSnap = await db.collection("audit_logs")
            .orderBy("timestamp", "desc")
            .limit(20)
            .get();
        logsSnap.docs.forEach(doc => {
            const data = doc.data();
            recentTransactions.push({
                id: doc.id,
                type: data.action || "unknown",
                amount: Number(data.amount) || 0,
                timestamp: data.timestamp || null,
            });
        });
    } catch {
        // Collection may not exist
    }

    return {
        totalRevenue,
        totalEscrowVolume,
        totalLoansDisbursed,
        recentTransactions,
    };
}
