/**
 * Admin Server Actions for Cooperative Management
 * Provides admin-level oversight and management capabilities
 */

"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import {
    collection,
    getDocs,
    getDoc,
    doc,
    query,
    where,
    orderBy,
    updateDoc,
    Timestamp,
    limit,
} from "firebase/firestore";

// ============================================================================
// ADMIN DASHBOARD STATS
// ============================================================================

export async function getCooperativeStatsAction(): Promise<{
    success: boolean;
    data?: {
        totalMembers: number;
        activeMembers: number;
        pendingMembers: number;
        suspendedMembers: number;
        totalContributions: number;
        monthlyContributions: number;
        totalLoans: number;
        activeLoans: number;
        pendingLoans: number;
        totalSavings: number;
        monthlyGrowth: number;
    };
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        // Get all members
        const membersSnap = await getDocs(collection(db, "cooperative_members"));
        const members = membersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        const totalMembers = members.length;
        const activeMembers = members.filter((m: any) => m.membershipStatus === "active").length;
        const pendingMembers = members.filter((m: any) => m.membershipStatus === "pending").length;
        const suspendedMembers = members.filter((m: any) => m.membershipStatus === "suspended").length;

        // Get all transactions
        const transactionsSnap = await getDocs(collection(db, "cooperative_transactions"));
        const transactions = transactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        // Calculate contribution totals
        const contributionTxns = transactions.filter(
            (t: any) => t.type === "contribution" && t.status === "completed"
        );
        const totalContributions = contributionTxns.reduce(
            (sum: number, t: any) => sum + (t.amount || 0),
            0
        );

        // Monthly contributions (last 30 days)
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const monthlyContributions = contributionTxns
            .filter((t: any) => {
                const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
                return date >= thirtyDaysAgo;
            })
            .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        // Get all loans
        const loansSnap = await getDocs(collection(db, "cooperative_loans"));
        const loans = loansSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

        const totalLoans = loans.reduce((sum: number, l: any) => sum + (l.amount || 0), 0);
        const activeLoans = loans.filter(
            (l: any) => l.status === "disbursed" || l.status === "approved"
        ).length;
        const pendingLoans = loans.filter((l: any) => l.status === "pending").length;

        // Calculate total savings
        const savingsTxns = transactions.filter(
            (t: any) => t.type === "fixed_savings" && t.status === "completed"
        );
        const totalSavings = savingsTxns.reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        // Calculate monthly growth (compare last 30 days vs previous 30 days)
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        const previousMonthContributions = contributionTxns
            .filter((t: any) => {
                const date = t.date?.toDate ? t.date.toDate() : new Date(t.date);
                return date >= sixtyDaysAgo && date < thirtyDaysAgo;
            })
            .reduce((sum: number, t: any) => sum + (t.amount || 0), 0);

        const monthlyGrowth =
            previousMonthContributions > 0
                ? ((monthlyContributions - previousMonthContributions) / previousMonthContributions) * 100
                : 0;

        return {
            success: true,
            data: {
                totalMembers,
                activeMembers,
                pendingMembers,
                suspendedMembers,
                totalContributions,
                monthlyContributions,
                totalLoans,
                activeLoans,
                pendingLoans,
                totalSavings,
                monthlyGrowth,
            },
        };
    } catch (error) {
        console.error("Get cooperative stats error:", error);
        return { success: false, error: "Failed to fetch statistics" };
    }
}

// ============================================================================
// MEMBER MANAGEMENT
// ============================================================================

export async function getAllMembersAction(options?: {
    status?: "all" | "active" | "pending" | "suspended";
    limit?: number;
}): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        let q = query(collection(db, "cooperative_members"), orderBy("createdAt", "desc"));

        if (options?.status && options.status !== "all") {
            q = query(q, where("membershipStatus", "==", options.status));
        }

        if (options?.limit) {
            q = query(q, limit(options.limit));
        }

        const snapshot = await getDocs(q);
        const members = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, data: members };
    } catch (error) {
        console.error("Get all members error:", error);
        return { success: false, error: "Failed to fetch members" };
    }
}

export async function updateMemberStatusAction(
    memberId: string,
    status: "active" | "suspended"
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(doc(db, "cooperative_members", memberId), {
            membershipStatus: status,
            updatedAt: Timestamp.now(),
        });

        return { success: true };
    } catch (error) {
        console.error("Update member status error:", error);
        return { success: false, error: "Failed to update member status" };
    }
}

// ============================================================================
// TRANSACTION MONITORING
// ============================================================================

export async function getAllTransactionsAction(options?: {
    type?: "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings";
    status?: "all" | "pending" | "completed" | "failed";
    limit?: number;
}): Promise<{
    success: boolean;
    data?: any[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        let q = query(collection(db, "cooperative_transactions"), orderBy("date", "desc"));

        if (options?.type && options.type !== "all") {
            q = query(q, where("type", "==", options.type));
        }

        if (options?.status && options.status !== "all") {
            q = query(q, where("status", "==", options.status));
        }

        if (options?.limit) {
            q = query(q, limit(options.limit));
        }

        const snapshot = await getDocs(q);
        const transactions = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        return { success: true, data: transactions };
    } catch (error) {
        console.error("Get all transactions error:", error);
        return { success: false, error: "Failed to fetch transactions" };
    }
}

// ============================================================================
// CONTRIBUTION REPORTS
// ============================================================================

export async function getContributionReportsAction(options?: {
    month?: number;
    year?: number;
}): Promise<{
    success: boolean;
    data?: {
        totalContributions: number;
        memberCount: number;
        averageContribution: number;
        topContributors: Array<{ userId: string; name: string; total: number }>;
        monthlyTrend: Array<{ month: string; amount: number }>;
    };
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        // Get all contributions
        const transactionsSnap = await getDocs(
            query(
                collection(db, "cooperative_transactions"),
                where("type", "==", "contribution"),
                where("status", "==", "completed")
            )
        );

        const contributions = transactionsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // Calculate totals
        const totalContributions = contributions.reduce(
            (sum: number, c: any) => sum + (c.amount || 0),
            0
        );

        // Get unique members
        const uniqueMembers = new Set(contributions.map((c: any) => c.userId));
        const memberCount = uniqueMembers.size;

        const averageContribution = memberCount > 0 ? totalContributions / memberCount : 0;

        // Calculate top contributors
        const contributorMap = new Map<string, number>();
        for (const c of contributions as any[]) {
            const current = contributorMap.get(c.userId) || 0;
            contributorMap.set(c.userId, current + c.amount);
        }

        const topContributors = Array.from(contributorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, total]) => ({
                userId,
                name: "Member", // Would need to join with members collection
                total,
            }));

        // Monthly trend (last 6 months)
        const monthlyTrend: Array<{ month: string; amount: number }> = [];
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const monthName = date.toLocaleDateString("en-US", { month: "short", year: "numeric" });

            const monthContributions = contributions.filter((c: any) => {
                const cDate = c.date?.toDate ? c.date.toDate() : new Date(c.date);
                return (
                    cDate.getMonth() === date.getMonth() && cDate.getFullYear() === date.getFullYear()
                );
            });

            const amount = monthContributions.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
            monthlyTrend.push({ month: monthName, amount });
        }

        return {
            success: true,
            data: {
                totalContributions,
                memberCount,
                averageContribution,
                topContributors,
                monthlyTrend,
            },
        };
    } catch (error) {
        console.error("Get contribution reports error:", error);
        return { success: false, error: "Failed to generate report" };
    }
}

// ============================================================================
// RECENT ACTIVITY
// ============================================================================

export async function getRecentActivityAction(): Promise<{
    success: boolean;
    data?: Array<{
        type: string;
        description: string;
        timestamp: Date;
        userId?: string;
    }>;
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await getDoc(doc(db, "users", session.user.id));
        if (!userDoc.exists() || userDoc.data().role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        // Get recent transactions
        const transactionsSnap = await getDocs(
            query(collection(db, "cooperative_transactions"), orderBy("date", "desc"), limit(10))
        );

        const activities = transactionsSnap.docs.map((doc) => {
            const data = doc.data();
            return {
                type: data.type,
                description: `${data.type} of ₦${data.amount?.toLocaleString()}`,
                timestamp: data.date?.toDate ? data.date.toDate() : new Date(data.date),
                userId: data.userId,
            };
        });

        return { success: true, data: activities };
    } catch (error) {
        console.error("Get recent activity error:", error);
        return { success: false, error: "Failed to fetch activity" };
    }
}
