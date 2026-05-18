import { getAdminDb } from "@/lib/firebase-admin";

/**
 * User Metrics Service
 * 
 * FIREBASE IS THE ONLY SOURCE OF TRUTH.
 * NO GUESS-BASED OR DERIVED UI LOGIC.
 * ALL DASHBOARDS MUST CONSUME THIS SERVICE FOR USER METRICS.
 */

export class UserMetricsService {
    /**
     * Gets the definitive count of cooperative members by strictly querying Firebase.
     * @param adminScope Optional cooperative ID to scope the query.
     */
    static async getCooperativeMemberMetrics(adminScope?: string) {
        const db = getAdminDb();
        let query: FirebaseFirestore.Query = db.collection("cooperative_members");
        
        if (adminScope) {
            query = query.where("cooperativeId", "==", adminScope);
        }

        const snap = await query.get();
        const allMembers = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        const totalApplications = allMembers.length;
        let paidMembersCount = 0;
        let pendingCount = 0;
        let approvedCount = 0;

        allMembers.forEach((m: any) => {
            // STRICT RULE: Payment Status must be explicitly 'completed'
            if (m.paymentStatus === 'completed') {
                paidMembersCount++;
            }
            
            // STRICT RULE: Membership status
            const isActive = m.membershipStatus === "active" || m.membershipStatus === "approved" || m.status === "active" || m.status === "approved";
            const isSuspended = m.membershipStatus === "suspended" || m.status === "suspended";
            const isPending = m.membershipStatus === "pending" || m.status === "pending" || (!m.membershipStatus && !m.status);

            if (isActive) {
                approvedCount++;
            } else if (isPending && !isSuspended) {
                pendingCount++;
            }
        });

        const unpaidMembers = Math.max(0, totalApplications - paidMembersCount);

        return {
            totalApplications,
            paidMembersCount,
            unpaidMembers,
            pendingCount,
            approvedCount,
            suspendedCount: totalApplications - (approvedCount + pendingCount)
        };
    }

    /**
     * Gets the definitive Academy statistics directly from source collections.
     */
    static async getAcademyMetrics() {
        const db = getAdminDb();
        const [coursesSnap, enrollmentsSnap, appsSnap] = await Promise.all([
            db.collection("academy_courses").count().get(),
            db.collection("academy_enrollments").get(),
            db.collection("academy_applications").get()
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
}
