import { getAdminDb } from "@/lib/firebase-admin";
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
     * @param adminScope Optional cooperative ID to scope the query.
     */
    static async getCooperativeMemberMetrics(adminScope?: string) {
        const db = getAdminDb();
        
        const [membersSnap, paymentsSnap] = await Promise.all([
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
              .where("type", "==", "cooperative_membership_registration")
              .where("status", "==", "completed")
              .get()
        ]);

        const allMembers: any[] = membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const filteredMembers = adminScope 
            ? allMembers.filter(m => m.cooperativeId === adminScope)
            : allMembers;

        const totalApplications = filteredMembers.length;
        
        // PAYSTACK IS THE ONLY SOURCE OF TRUTH FOR PAYMENTS
        const validPaidUserIds = new Set<string>();
        paymentsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (data.userId) {
                validPaidUserIds.add(data.userId);
            }
        });

        let docBasedPaidCount = 0;
        let pendingCount = 0;
        let approvedCount = 0;

        filteredMembers.forEach((m: any) => {
            const uid = m.userId || m.id;
            
            // STRICT RULE: Membership status
            const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" || m.status === "active" || m.status === "approved";
            const isSuspended = m.membershipStatus === "suspended" || m.status === "suspended";
            const isPending = m.membershipStatus === "pending" || m.status === "pending" || (!m.membershipStatus && !m.status);

            if (isActive) {
                approvedCount++;
            } else if (isPending && !isSuspended) {
                pendingCount++;
            }
            
            // A member is paid if they have a Paystack processed payment OR they have a completed payment status on their doc (Legacy members)
            const isPaid = validPaidUserIds.has(uid) || m.paymentStatus === "completed";
            if (isPaid) {
                docBasedPaidCount++;
            }
        });

        let orphanedPaymentsCount = 0;
        if (!adminScope) {
            Array.from(validPaidUserIds).forEach(uid => {
                const hasDoc = filteredMembers.some((m: any) => (m.userId || m.id) === uid);
                if (!hasDoc) {
                    orphanedPaymentsCount++;
                }
            });
        }

        const paidMembersCount = docBasedPaidCount; // Do not add orphanedPaymentsCount to avoid inflating total beyond totalApplications
        const unpaidMembers = Math.max(0, totalApplications - docBasedPaidCount);

        return {
            totalApplications,
            paidMembersCount,
            unpaidMembers,
            pendingCount,
            approvedCount,
            orphanedPaymentsCount,
            suspendedCount: totalApplications - (approvedCount + pendingCount)
        };
    }

    /**
     * Gets the definitive Academy statistics directly from source collections.
     */
    static async getAcademyMetrics() {
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
