import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { normaliseAcademyPlan } from "@/lib/academy-plan";
import type { UserMetricsServiceContract, CooperativeMemberMetrics, AcademyMetrics } from "@easy-sales/services";

/**
 * User Metrics Service
 *
 * FIREBASE IS THE ONLY SOURCE OF TRUTH.
 * NO GUESS-BASED OR DERIVED UI LOGIC.
 * ALL DASHBOARDS MUST CONSUME THIS SERVICE FOR USER METRICS.
 */

async function fetchAllDocs(query: any): Promise<any[]> {
    const allDocs: any[] = [];
    let offset = 0;
    let keepFetching = true;
    while (keepFetching) {
        const snap = await query.limit(1000).offset(offset).get();
        if (snap.empty || snap.docs.length === 0) {
            break;
        }
        allDocs.push(...snap.docs);
        if (snap.docs.length < 1000) {
            keepFetching = false;
        } else {
            offset += 1000;
        }
    }
    return allDocs;
}

export class UserMetricsService implements UserMetricsServiceContract {
    /**
     * Gets the definitive count of cooperative members by strictly querying Firebase.
     *
     * Definitions:
     *   - totalApplications : every doc in COOPERATIVE_MEMBERS (scoped to cooperative if adminScope)
     *   - approvedCount      : docs where membershipStatus is "active" OR "approved" (admin has approved the application)
     *   - pendingCount       : docs where membershipStatus is "pending" OR membershipStatus is missing
     *   - suspendedCount     : docs where membershipStatus is "suspended"
     *   - paidMembersCount   : unique users that have a completed payment in PROCESSED_PAYMENTS
     *                          for type "cooperative_membership_registration" (Paystack verified)
     *                          + any legacy doc where paymentStatus === "completed"
     *   - unpaidMembers      : totalApplications − paidMembersCount
     *
     * @param adminScope Optional cooperative ID to scope the query.
     */
    static async getCooperativeMemberMetrics(adminScope?: string): Promise<CooperativeMemberMetrics> {
        const db = getAdminDb();

        let baseQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        if (adminScope) {
            baseQuery = baseQuery.where("cooperativeId", "==", adminScope);
        }

        const allMembers = await fetchAllDocs(baseQuery.select("status", "membershipStatus", "userId", "paymentStatus"));

        let totalApplications = 0;
        let approvedCount = 0;
        let pendingCount = 0;
        let suspendedCount = 0;
        const validPaidUserIds = new Set<string>();

        // Fetch all verified Paystack registration payments globally
        const paidPaymentsDocs = await fetchAllDocs(
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "cooperative_membership_registration")
                .where("status", "==", "completed")
                .select("userId")
        );

        paidPaymentsDocs.forEach(doc => {
            const data = doc.data();
            if (data.userId) validPaidUserIds.add(data.userId);
        });

        for (const doc of allMembers) {
            const m = doc.data();
            totalApplications++;
            
            const statusVal = m.status || m.membershipStatus || "pending";
            if (statusVal === "active" || statusVal === "approved") {
                approvedCount++;
            } else if (statusVal === "pending") {
                pendingCount++;
            } else if (statusVal === "suspended") {
                suspendedCount++;
            }

            const uid = m.userId || doc.id;
            if (m.paymentStatus === "completed" && uid) {
                validPaidUserIds.add(uid);
            }
        }

        let orphanedPaymentsCount = 0;
        if (!adminScope) {
            // Global: count Paystack payments with no member doc at all
            const allMemberUserIds = new Set<string>();
            allMembers.forEach(doc => {
                const uid = doc.data().userId || doc.id;
                if (uid) allMemberUserIds.add(uid);
            });

            validPaidUserIds.forEach(uid => {
                if (!allMemberUserIds.has(uid)) {
                    orphanedPaymentsCount++;
                }
            });
        }

        const paidMembersCount = Math.min(validPaidUserIds.size, totalApplications);
        const unpaidMembers = Math.max(0, totalApplications - paidMembersCount);

        return {
            totalApplications,
            paidMembersCount,
            unpaidMembers,
            pendingCount,
            approvedCount,
            orphanedPaymentsCount,
            suspendedCount,
        };
    }

    /**
     * Gets the definitive Academy statistics directly from source collections.
     */
    static async getAcademyMetrics(): Promise<AcademyMetrics> {
        const db = getAdminDb();
        const [coursesSnap, enrollmentsDocs, appsDocs] = await Promise.all([
            db.collection(COLLECTIONS.ACADEMY_COURSES).count().get(),
            fetchAllDocs(db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS)),
            fetchAllDocs(db.collection(COLLECTIONS.ACADEMY_APPLICATIONS))
        ]);

        const totalCourses = coursesSnap.data().count;
        const enrollments = enrollmentsDocs.map(d => d.data());
        const applications = appsDocs.map(d => d.data());

        const totalEnrollments = enrollments.length;
        const activeEnrollments = enrollments.filter(e => e.status === 'active').length;
        const completedCourses = enrollments.filter(e => e.status === 'completed').length;

        // Paid applications are strictly those with a 'completed' payment status
        let totalStudents = 0;
        let totalRegistrationRevenue = 0;
        const registrationStats: Record<string, { count: number, revenue: number }> = {
            foundation: { count: 0, revenue: 0 },
            standard: { count: 0, revenue: 0 },
            elite: { count: 0, revenue: 0 },
            advanced: { count: 0, revenue: 0 }
        };

        // Bucketed by a plan that is actually a plan.
        //
        // This read `(app.plan || "foundation").toLowerCase()` and, when the
        // value was not one of the four keys above, created a NEW bucket named
        // after it. _submitAcademyApplicationAction wrote `plan: "registration"`
        // on every application it ever created, so every paying learner landed
        // in a bucket called "registration" while foundation, standard, elite and
        // advanced all sat at zero — a per-plan breakdown in which no plan had
        // anybody in it.
        //
        // The write is fixed (see lib/academy-plan.ts), but every row already in
        // the database still carries the literal. normaliseAcademyPlan maps the
        // real spellings, including the legacy "advanced", and returns null for
        // anything else.
        //
        // Unresolvable rows go to `unknown` rather than being assumed to be
        // foundation. Guessing the cheapest plan for a learner who paid for elite
        // would move real revenue between products, which is worse than an
        // honest bucket the admin can see and act on. The totals are unaffected
        // either way: totalRegistrationRevenue sums every completed payment
        // regardless of which bucket it lands in.
        applications.forEach(app => {
            if (app.paymentStatus === 'completed') {
                totalStudents++;
                const plan = normaliseAcademyPlan(app.plan) ?? "unknown";
                const amount = Number(app.paymentAmount) || 0;
                totalRegistrationRevenue += amount;
                if (!registrationStats[plan]) {
                    registrationStats[plan] = { count: 0, revenue: 0 };
                }
                registrationStats[plan].count++;
                registrationStats[plan].revenue += amount;
            }
        });

        return {
            totalCourses,
            totalStudents,
            totalEnrollments,
            activeEnrollments,
            completedCourses,
            totalRegistrationRevenue,
            registrationStats
        };
    }

    async getCooperativeMemberMetrics(adminScope?: string): Promise<CooperativeMemberMetrics> {
        return UserMetricsService.getCooperativeMemberMetrics(adminScope);
    }

    async getAcademyMetrics(): Promise<AcademyMetrics> {
        return UserMetricsService.getAcademyMetrics();
    }
}
