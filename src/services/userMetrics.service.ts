import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { UserMetricsServiceContract, CooperativeMemberMetrics, AcademyMetrics } from "@easy-sales/services";

/**
 * User Metrics Service
 *
 * FIREBASE IS THE ONLY SOURCE OF TRUTH.
 * NO GUESS-BASED OR DERIVED UI LOGIC.
 * ALL DASHBOARDS MUST CONSUME THIS SERVICE FOR USER METRICS.
 */

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

        // Build base query, scoped to cooperative when adminScope is provided
        let baseQuery: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS);
        if (adminScope) {
            baseQuery = baseQuery.where("cooperativeId", "==", adminScope);
        }

        // Run all count queries in parallel for performance
        const [
            totalSnap,
            approvedSnap,       // "active" is the canonical approved state (set by approve-member route)
            legacyApprovedSnap, // "approved" is a legacy value written before May 2026
            pendingSnap,
            suspendedSnap,
            paidPaymentsSnap,
        ] = await Promise.all([
            baseQuery.count().get(),
            baseQuery.where("membershipStatus", "==", "active").count().get(),
            baseQuery.where("membershipStatus", "==", "approved").count().get(),
            baseQuery.where("membershipStatus", "==", "pending").count().get(),
            baseQuery.where("membershipStatus", "==", "suspended").count().get(),
            // Completed registration payments — global (no cooperative scope on PROCESSED_PAYMENTS)
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("type", "==", "cooperative_membership_registration")
                .where("status", "==", "completed")
                .get(),
        ]);

        const totalApplications = totalSnap.data().count ?? 0;
        const approvedCount = (approvedSnap.data().count ?? 0) + (legacyApprovedSnap.data().count ?? 0);
        const pendingCount = pendingSnap.data().count ?? 0;
        const suspendedCount = suspendedSnap.data().count ?? 0;

        // Build set of userIds with verified Paystack payments
        const validPaidUserIds = new Set<string>();
        paidPaymentsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.userId) validPaidUserIds.add(data.userId);
        });

        // For legacy members paid outside Paystack, fetch their member docs to check paymentStatus.
        // Only fetch docs that are scoped to adminScope (if provided) and not already in the payment set.
        // We use a separate lightweight query for this to avoid pulling the entire collection.
        let legacyPaidCount = 0;
        let orphanedPaymentsCount = 0;

        if (adminScope) {
            // Scoped: count legacy-paid members within this cooperative
            const legacyPaidSnap = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("cooperativeId", "==", adminScope)
                .where("paymentStatus", "==", "completed")
                .count()
                .get();
            // These may overlap with Paystack-paid members; we rely on userId deduplication below
            // We'll fetch userId list to dedup properly
            const legacyDocs = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("cooperativeId", "==", adminScope)
                .where("paymentStatus", "==", "completed")
                .select("userId")
                .get();
            legacyDocs.docs.forEach(doc => {
                const uid = doc.data().userId || doc.id;
                if (!validPaidUserIds.has(uid)) {
                    validPaidUserIds.add(uid);
                    legacyPaidCount++;
                }
            });

            // Orphaned = Paystack payments that have no matching member doc in this cooperative
            // (skip for scoped queries: too expensive to cross-reference without cooperative on payments)
            orphanedPaymentsCount = 0;
        } else {
            // Global: count legacy-paid members across all cooperatives
            const legacyDocs = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where("paymentStatus", "==", "completed")
                .select("userId")
                .get();
            legacyDocs.docs.forEach(doc => {
                const uid = doc.data().userId || doc.id;
                if (!validPaidUserIds.has(uid)) {
                    validPaidUserIds.add(uid);
                    legacyPaidCount++;
                }
            });

            // Orphaned = Paystack payments with no member doc at all
            // We need member userId set for this — fetch only userId field for efficiency
            const allMemberUserIds = new Set<string>();
            const allMembersDocs = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .select("userId")
                .get();
            allMembersDocs.docs.forEach(doc => {
                const uid = doc.data().userId || doc.id;
                if (uid) allMemberUserIds.add(uid);
            });

            validPaidUserIds.forEach(uid => {
                if (!allMemberUserIds.has(uid)) {
                    orphanedPaymentsCount++;
                }
            });
        }

        // paidMembersCount = distinct members who paid via Paystack OR have legacy paymentStatus="completed"
        // Capped at totalApplications to avoid inflating beyond total
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
        const [coursesSnap, enrollmentsSnap, appsSnap] = await Promise.all([
            db.collection(COLLECTIONS.ACADEMY_COURSES).count().get(),
            db.collection(COLLECTIONS.ACADEMY_ENROLLMENTS).get(),
            db.collection(COLLECTIONS.ACADEMY_APPLICATIONS).get()
        ]);

        const totalCourses = coursesSnap.data().count;
        const enrollments = enrollmentsSnap.docs.map(d => d.data());
        const applications = appsSnap.docs.map(d => d.data());

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

        applications.forEach(app => {
            if (app.paymentStatus === 'completed') {
                totalStudents++;
                const plan = (app.plan || "foundation").toLowerCase();
                const amount = Number(app.paymentAmount) || 0;
                totalRegistrationRevenue += amount;
                if (registrationStats[plan]) {
                    registrationStats[plan].count++;
                    registrationStats[plan].revenue += amount;
                } else {
                    registrationStats[plan] = { count: 1, revenue: amount };
                }
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
