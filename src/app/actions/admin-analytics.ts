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
