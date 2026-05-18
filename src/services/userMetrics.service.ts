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
}
