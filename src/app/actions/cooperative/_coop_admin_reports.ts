"use server";

import { userMetricsService } from "@/services";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { isAdmin } from "@/lib/admin-permissions";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getAdminScope } from "@/lib/cooperative-admin-scope";

// ============================================================================
// ============================================================================
// HELPER: Admin Scoping (IDOR Fix)
// ============================================================================

/**
 * Determines the scope of access for an admin.
 * Returns `cooperativeId` if scoped, or `null` if global (Platform Admin/Super Admin).
 */

// ============================================================================
// ADMIN DASHBOARD STATS
// ============================================================================

async function _getCooperativeStatsAction(): Promise<ActionResponse<any>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = adminScope ? `admin:coop-stats:${adminScope}` : "admin:coop-stats:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        const [metrics, paymentsSnapR] = await Promise.allSettled([
            userMetricsService.getCooperativeMemberMetrics(adminScope || undefined),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "cooperative_membership_registration")
                .where("status", "==", "completed")
                .select("userId")
                .get()
        ]);

        const metricsData = metrics.status === "fulfilled" ? metrics.value : {
            totalApplications: 0,
            paidMembersCount: 0,
            unpaidMembers: 0,
            pendingCount: 0,
            approvedCount: 0,
            suspendedCount: 0,
            orphanedPaymentsCount: 0
        };

        const {
            totalApplications: totalMembersCount,
            paidMembersCount,
            unpaidMembers,
            pendingCount: pendingMembers,
            approvedCount: activeMembers,
            suspendedCount: suspendedMembers,
            orphanedPaymentsCount
        } = metricsData;


        let txnQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);
        if (adminScope) {
            txnQuery = txnQuery.where("cooperativeId", "==", adminScope);
        }

        let totalTransactions = 0;
        let totalTransactionAmount = 0;
        let completedTransactions = 0;
        let pendingTransactions = 0;
        let failedTransactions = 0;

        let totalContributions = 0;
        let monthlyContributions = 0;
        let previousMonthContributions = 0;
        let totalSavings = 0;

        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

        const txnStream = txnQuery.select("type", "status", "amount", "date").get();
        for (const doc of (await txnStream).docs) {
            const t = doc.data();
            
            // Exclude platform onboarding fees from cooperative financial stats
            if (t.type === "membership_registration" || t.type === "registration_fee") {
                continue;
            }

            totalTransactions++;
            const amount = Number(t.amount) || 0;
            totalTransactionAmount += amount;

            if (t.status === "completed") completedTransactions++;
            else if (t.status === "pending") pendingTransactions++;
            else if (t.status === "failed") failedTransactions++;

            if (t.status === "completed") {
                if (t.type === "fixed_savings") {
                    totalSavings += amount;
                } else if (t.type === "contribution") {
                    totalContributions += amount;
                    totalSavings += amount;
                    if (t.date) {
                        const date = t.date.toDate ? t.date.toDate() : new Date(t.date);
                        if (date >= thirtyDaysAgo) {
                            monthlyContributions += amount;
                        } else if (date >= sixtyDaysAgo && date < thirtyDaysAgo) {
                            previousMonthContributions += amount;
                        }
                    }
                } else if (t.type === "withdrawal") {
                    totalSavings -= amount;
                }
            }
        }

        let loansQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_LOANS).select("memberId", "amount", "status");
        if (adminScope) {
            loansQuery = loansQuery.where("cooperativeId", "==", adminScope);
        }
        const loansStream = await loansQuery.get();
        
        let totalLoans = 0;
        let activeLoans = 0;
        let pendingLoans = 0;

        for (const doc of loansStream.docs) {
            const l = doc.data();
            totalLoans += Number(l.amount) || 0;
            if (l.status === "disbursed" || l.status === "approved") {
                activeLoans++;
            } else if (l.status === "pending") {
                pendingLoans++;
            }
        }

        const monthlyGrowth =
            previousMonthContributions > 0
                ? ((monthlyContributions - previousMonthContributions) / previousMonthContributions) * 100
                : 0;

        const payload = {
            error: null, success: true as const,
            data: {
                stats: {
                    totalMembers: totalMembersCount,
                    paidMembers: paidMembersCount,
                    unpaidMembers,
                    activeMembers,
                    pendingMembers,
                    suspendedMembers,
                    orphanedPaymentsCount,
                    totalContributions,
                    monthlyContributions,
                    totalLoans,
                    activeLoans,
                    pendingLoans,
                    totalSavings,
                    monthlyGrowth,
                    totalTransactions,
                    totalTransactionAmount,
                    completedTransactions,
                    pendingTransactions,
                    failedTransactions,
                }
            },
            meta: null
        };

        try {
            await setCache(cacheKey, payload, 120);
        } catch (e) {}

        return payload;
    } catch (error) {
        logger.error("Get cooperative stats error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch statistics", data: null };
    }
}

export const getCooperativeStatsAction = withFlexibleSafeAction("getCooperativeStatsAction", _getCooperativeStatsAction);


// ============================================================================
// CONTRIBUTION REPORTS
// ============================================================================

export async function getContributionReportsAction(options?: {
    month?: number;
    year?: number;
}): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        const { getCached, setCache } = await import("@/lib/redis");
        const cacheKey = adminScope ? `admin:coop-reports:${adminScope}` : "admin:coop-reports:global";

        try {
            const cached = await getCached<any>(cacheKey);
            if (cached) return cached;
        } catch (e) {}

        // memberCount and averageContribution are derived from cooperative_transactions
        // (the Paystack-authoritative collection) — never from a different collection
        // to avoid cross-collection count drift.

        // Get all completed cooperative transactions for amount/trend reporting
        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where("status", "==", "completed");

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        let totalContributions = 0;
        let transactionCount = 0; // count from the same source as totalContributions
        const contributorMap = new Map<string, number>();
        const monthlyTrendData: Array<{ month: string; mKey: number; yKey: number; amount: number }> = [];

        // Initialize last 6 months buckets
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
            monthlyTrendData.push({
                month: date.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
                mKey: date.getMonth(),
                yKey: date.getFullYear(),
                amount: 0
            });
        }

        const stream = q.select("type", "amount", "userId", "date", "paidAt").get();
        const seenUserIds = new Set<string>();

        for (const doc of (await stream).docs) {
            const t = doc.data();
            if (t.type === "contribution") {
                const amount = Number(t.amount) || 0;
                const uid = t.userId as string | undefined;

                totalContributions += amount;
                transactionCount++;
                if (uid) {
                    seenUserIds.add(uid);
                    contributorMap.set(uid, (contributorMap.get(uid) || 0) + amount);
                }

                // Prefer paidAt (Paystack-sourced) over date field
                const rawDate = t.paidAt || t.date;
                if (rawDate) {
                    const cDate = rawDate.toDate ? rawDate.toDate() : new Date(rawDate);
                    const bucket = monthlyTrendData.find(b => b.mKey === cDate.getMonth() && b.yKey === cDate.getFullYear());
                    if (bucket) bucket.amount += amount;
                }
            }
        }

        const memberCount = seenUserIds.size;
        const averageContribution = memberCount > 0 ? totalContributions / memberCount : 0;

        const topContributors = Array.from(contributorMap.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([userId, total]) => ({
                userId,
                name: "Member",
                total,
            }));

        const monthlyTrend = monthlyTrendData.map(b => ({ month: b.month, amount: b.amount }));

        const payload = {
            error: null, success: true as const,
            data: {
                reports: {
                    totalContributions,
                    memberCount,
                    averageContribution,
                    topContributors,
                    monthlyTrend,
                }
            },
            meta: null
        };

        try {
            await setCache(cacheKey, payload, 120);
        } catch (e) {}

        return payload;
    } catch (error) {
        logger.error("Get contribution reports error:", error);
        return { success: false as const, error: "Failed to generate report", data: null };
    }
}


// ============================================================================
// RECENT ACTIVITY
// ============================================================================

export async function getRecentActivityAction(): Promise<ActionResponse<any>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminScope = await getAdminScope(session.user.id, roles);

        // Build query: where() MUST precede orderBy()
        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        q = q.orderBy("date", "desc").limit(10);

        const transactionsSnap = await q.get();

        const activities = transactionsSnap.docs.map((doc) => {
            const data = doc.data();
            const dateVal = data.date?.toDate ? data.date.toDate() : (data.date ? new Date(data.date) : new Date());
            return {
                type: data.type,
                description: `${data.type} of ₦${data.amount?.toLocaleString()}`,
                timestamp: dateVal.toISOString(),
                userId: data.userId,
            };
        });

        return { error: null, success: true as const, data: { activities }, meta: null };
    } catch (error) {
        logger.error("Get recent activity error:", error);
        return { success: false as const, error: "Failed to fetch activity", data: null };
    }
}
