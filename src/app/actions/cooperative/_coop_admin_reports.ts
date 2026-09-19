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
        const cacheKey = adminScope ? `admin:coop-stats:v2:${adminScope}` : "admin:coop-stats:global:v2";

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

        /**
         *   #835 THE APPLICANT REGISTER, for the platform-wide view only.
         *
         *   COOPERATIVE_MEMBERS holds the detailed membership record and only for
         *   the route that writes one; `serviceRegistrations.cooperative(s).status`
         *   on the USER is maintained by every enrolment path including the legacy
         *   import, so it is the register of who actually applied.
         *
         *   ONLY WHEN UNSCOPED, and that restriction is the point.
         *   countModuleApplicants is platform-wide — the registration object on a
         *   user says WHICH MODULE, not which cooperative — so substituting it
         *   into a view scoped to one cooperative would report the whole
         *   platform's members as that cooperative's. A scoped admin keeps the
         *   metrics service's answer, which is the one that knows about scope.
         *
         *   This is the "correct rule applied to some of the places it names"
         *   shape running in reverse: the danger here is applying it to a place
         *   it does NOT name.
         */
        /*
         *   #905 THE TOTAL WAS SWAPPED FOR THE REGISTER'S AND THE BREAKDOWN WAS
         *   NOT, SO THE SCREEN ASKED FOR ARITHMETIC THAT CANNOT WORK.
         *
         *   THE OWNER, reading the members page:
         *
         *       Pending 98   Approved 1742
         *       Total Paid Members 1731   Out of 3110 applications
         *       Unpaid Members 109
         *
         *   98 + 1742 = 1840. 1731 + 109 = 1840. Neither is 3110, and 1,270
         *   applicants sat in no bucket at all.
         *
         *   #835 substituted the applicant register's total here — rightly, for
         *   the reason stated below — and left `pendingCount`, `approvedCount`
         *   and the subtraction behind `unpaidMembers` reading the
         *   COOPERATIVE_MEMBERS table. Three numbers on one card, drawn from two
         *   populations, presented as a breakdown of each other.
         *
         *   EVERY OTHER MODULE ALREADY DOES THIS WHOLE. wave/compliance,
         *   admin/_exports and academy/_ac_admin_applications each switch total,
         *   pending, approved AND rejected together on one `useRegister`, so
         *   their figures come from one population and add up. Farm Nation
         *   reports only a total and has nothing to contradict. Cooperative was
         *   the one module where the rule reached the headline and not the
         *   breakdown — #835's own note calls that shape out, in this very
         *   comment block, and then it happened here.
         */
        const { countModuleApplicants, registerIsUsable } = await import("@/lib/module-applicant-count");
        const applicants = !adminScope
            ? await countModuleApplicants("cooperative")
            : null;
        const applicantsCounted = Boolean(applicants && registerIsUsable(applicants, totalMembersCount));

        const reportedTotalMembers = applicantsCounted ? applicants!.total! : totalMembersCount;
        //   Switched WITH the total, never apart from it.
        const reportedPending = applicantsCounted ? applicants!.pending! : pendingMembers;
        const reportedApproved = applicantsCounted ? applicants!.approved! : activeMembers;
        /*
         *   AND THE SUBTRACTION FOLLOWS THE TOTAL IT SUBTRACTS FROM.
         *
         *   userMetrics derives `unpaidMembers` as `totalApplications −
         *   paidMembersCount` over the membership table, which is the right
         *   answer to a question this screen stopped asking the moment the
         *   headline became the register's. Recomputed here against the total
         *   actually reported, so "paid + unpaid" is the total above it.
         *
         *   A SCOPED ADMIN IS UNAFFECTED: `reportedTotalMembers` is
         *   `totalMembersCount` for them, so this reproduces the metrics
         *   service's own figure exactly.
         */
        const reportedUnpaid = Math.max(0, reportedTotalMembers - paidMembersCount);


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

        // THESE ARE MONEY TOTALS OVER A SILENTLY CAPPED QUERY.
        //
        // `.get()` with no `.limit()` stops at the adapter's DEFAULT_QUERY_LIMIT
        // — 5,000 rows — and returns them looking exactly like a complete
        // result. Every figure below is a running sum over whatever came back:
        // totalContributions, totalSavings, totalTransactionAmount, the 30-day
        // and 60-day buckets that produce monthlyGrowth.
        //
        // So on the day cooperative_transactions passed five thousand rows, the
        // admin dashboard began under-reporting the cooperative's contributions,
        // with nothing on the screen to say so and no figure moving in a way
        // anybody would notice. The rows it drops are the OLDEST or newest
        // depending on nothing in particular — there is no orderBy either.
        //
        // `.all()` is the adapter's own answer for a caller that genuinely needs
        // every row — an aggregation is exactly that — and it reports at error
        // level if it hits its far higher runaway ceiling. The snapshot's
        // `truncated` flag is surfaced in the payload as well, so a partial total
        // can be told from a complete one by the caller rather than only in a log.
        const txnSnapshot = await txnQuery.select("type", "status", "amount", "date").all().get();
        const txnTruncated = Boolean((txnSnapshot as any).truncated);
        for (const doc of txnSnapshot.docs) {
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
        const loansStream = await loansQuery.all().get();
        const loansTruncated = Boolean((loansStream as any).truncated);

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
                    totalMembers: reportedTotalMembers,
                    //   The membership-record count, kept and named for what it
                    //   counts, and a flag for whether the register was reachable.
                    detailedMembershipRecords: totalMembersCount,
                    applicantsCounted,
                    scopedToCooperative: Boolean(adminScope),
                    paidMembers: paidMembersCount,
                    unpaidMembers: reportedUnpaid,
                    activeMembers: reportedApproved,
                    pendingMembers: reportedPending,
                    //   The membership-table figures, kept and named for what
                    //   they count — the pattern _exports and academy use.
                    detailedUnpaidMembers: unpaidMembers,
                    detailedApprovedMembers: activeMembers,
                    detailedPendingMembers: pendingMembers,
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
                    // A partial total must be distinguishable from a complete one.
                    truncated: txnTruncated || loansTruncated,
                }
            },
            meta: null
        };

        if (txnTruncated || loansTruncated) {
            logger.error(
                "[getCooperativeStats] hit the row ceiling — the cooperative financial totals on the "
                + "admin dashboard are INCOMPLETE and understate the real figures.",
                { txnTruncated, loansTruncated, adminScope }
            );
        }

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

/**
 * A `month`/`year` parameter used to sit on this signature and filter nothing.
 *
 * Neither value was read anywhere in the body, and the Redis key is
 * `admin:coop-reports:{scope}` with no month in it — so a caller passing
 * `{ month: 3 }` received the all-time report, and would have received a CACHED
 * all-time report even if the filtering were added later without touching the
 * key. Both callers, /admin/cooperatives/contributions and the admin dashboard,
 * pass nothing.
 *
 * Removed rather than implemented: a parameter that quietly ignores what it is
 * given is worse than one that does not exist, and adding month filtering is a
 * feature decision, not an audit fix. The six-month trend below already answers
 * the question it was presumably reaching for.
 */
export async function getContributionReportsAction(): Promise<ActionResponse<any>> {
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

        // .all(), for the reason set out in getCooperativeStatsAction above:
        // totalContributions, memberCount, averageContribution, topContributors
        // and every month of the trend are sums over this stream, and a plain
        // .get() stops at the adapter's default cap without saying so.
        const stream = await q.select("type", "amount", "userId", "date", "paidAt").all().get();
        const reportTruncated = Boolean((stream as any).truncated);
        const seenUserIds = new Set<string>();

        for (const doc of stream.docs) {
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
                    truncated: reportTruncated,
                }
            },
            meta: null
        };

        if (reportTruncated) {
            logger.error(
                "[getContributionReports] hit the row ceiling — the contribution report is INCOMPLETE.",
                { adminScope }
            );
        }

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
