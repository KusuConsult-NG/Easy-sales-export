"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { COLLECTIONS } from "@/lib/types/firestore";

/**
 * Server Actions for Dashboard Data
 * 
 * Fetches aggregated data for user dashboard including stats,
 * recent activity, and escrow information.
 */

// Type definitions
export type DashboardStats = {
    totalExports: number;
    activeOrders: number;
    totalEscrow: number;
    cooperativeSavings: number;
    academyEnrollments: number;
    onboardingCompleted: boolean;
};

export type RecentActivity = {
    id: string;
    type: "export" | "cooperative" | "academy" | "wave";
    title: string;
    description: string;
    timestamp: Date;
    status?: string;
}[];

export type EscrowStatus = {
    totalLocked: number;
    pendingRelease: number;
    nextReleaseDate: Date | null;
    upcomingReleases: {
        amount: number;
        releaseDate: Date;
        orderId: string;
    }[];
};

type DashboardActionState = {
    error: string | null;
    success: boolean;
    data?: DashboardStats;
};

type ActivityActionState = {
    error: string | null;
    success: boolean;
    data?: RecentActivity;
};

type EscrowActionState = {
    error: string | null;
    success: boolean;
    data?: EscrowStatus;
};

// ============================================
// Dashboard Stats Action
// ============================================

// ============================================
// Dashboard Stats Action
// ============================================

export async function getDashboardStatsAction(): Promise<DashboardActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // ⚡️ PERFORMANCE FIX: Parallel Fetching & Count Aggregations
        // 1. Total Exports (Use Count)
        const totalExportsPromise = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .count()
            .get();

        // 2. Active Orders (Pending/In_Transit) (Use Count)
        const activeOrdersPromise = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "in_transit"])
            .count()
            .get();

        // 3. Academy Enrollments (Use Count)
        const enrollmentsPromise = db.collection(COLLECTIONS.ENROLLMENTS)
            .where("userId", "==", userId)
            .count()
            .get();

        // 4. Cooperative Savings (Direct Doc Fetch)
        const userDocPromise = db.collection(COLLECTIONS.USERS).doc(userId).get();

        // 5. Total Escrow (Must fetch docs to sum amount, but filter strictly)
        // We only fetch minimal fields if possible, but Firestore Admin doesn't support select() well in Node client 
        // without check (it does, but let's just fetch).
        // Optimization: Only fetch 'in_transit' or 'delivered' which should be smaller subset than 'all'
        const escrowDocsPromise = db.collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .where("status", "in", ["in_transit", "delivered"])
            .get();

        // EXECUTE PARALLEL
        const [
            totalExportsSnap,
            activeOrdersSnap,
            enrollmentsSnap,
            userDoc,
            escrowDocsSnap
        ] = await Promise.all([
            totalExportsPromise,
            activeOrdersPromise,
            enrollmentsPromise,
            userDocPromise,
            escrowDocsPromise
        ]);

        // Process Restults
        const totalExports = totalExportsSnap.data().count;
        const activeOrders = activeOrdersSnap.data().count;
        const academyEnrollments = enrollmentsSnap.data().count;

        const totalEscrow = escrowDocsSnap.docs
            .reduce((sum, doc) => sum + (doc.data().amount || 0), 0);

        let cooperativeSavings = 0;
        const userData = userDoc.data();
        const cooperativeId = userData?.cooperativeId;

        if (cooperativeId) {
            const memberDoc = await db
                .collection(COLLECTIONS.COOPERATIVES)
                .doc(cooperativeId)
                .collection("members")
                .doc(userId)
                .get();

            if (memberDoc.exists) {
                cooperativeSavings = memberDoc.data()?.balance || 0;
            }
        }

        return {
            error: null,
            success: true,
            data: {
                totalExports,
                activeOrders,
                totalEscrow,
                cooperativeSavings,
                academyEnrollments,
                onboardingCompleted: userData?.onboardingCompleted ?? false,
            },
        };
    } catch (error: any) {
        logger.error("Dashboard stats error:", error);
        return { error: "Failed to fetch dashboard stats", success: false };
    }
}

// ============================================
// Recent Activity Action
// ============================================

export async function getRecentActivityAction(): Promise<ActivityActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;
        const activities: RecentActivity = [];

        // Fetch recent export windows
        const exportsSnapshot = await db
            .collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(3)
            .get();

        exportsSnapshot.forEach(doc => {
            const data = doc.data();
            activities.push({
                id: doc.id,
                type: "export",
                title: `Export Order ${data.orderId}`,
                description: `${data.commodity} - ${data.quantity}`,
                timestamp: data.createdAt?.toDate() || new Date(),
                status: data.status,
            });
        });

        // Fetch recent notifications
        const notificationsSnapshot = await db
            .collection(COLLECTIONS.NOTIFICATIONS)
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(2)
            .get();

        notificationsSnapshot.forEach(doc => {
            const data = doc.data();
            activities.push({
                id: doc.id,
                type: data.type || "export",
                title: data.title,
                description: data.message,
                timestamp: data.createdAt?.toDate() || new Date(),
            });
        });

        // Sort all activities by timestamp
        activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        return {
            error: null,
            success: true,
            data: activities.slice(0, 5), // Return top 5
        };
    } catch (error: any) {
        logger.error("Recent activity error:", error);
        return { error: "Failed to fetch recent activity", success: false };
    }
}

// ============================================
// Escrow Status Action
// ============================================

export async function getEscrowStatusAction(): Promise<EscrowActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Fetch all export windows with escrow
        const exportsSnapshot = await db
            .collection(COLLECTIONS.EXPORT_WINDOWS)
            .where("userId", "==", userId)
            .where("status", "in", ["in_transit", "delivered"])
            .get();

        let totalLocked = 0;
        let pendingRelease = 0;
        const upcomingReleases: EscrowStatus["upcomingReleases"] = [];
        let nextReleaseDate: Date | null = null;

        const now = new Date();

        exportsSnapshot.forEach(docSnapshot => {
            const data = docSnapshot.data();
            const amount = data.amount || 0;
            const escrowReleaseDate = data.escrowReleaseDate?.toDate();

            totalLocked += amount;

            if (escrowReleaseDate) {
                if (escrowReleaseDate <= now) {
                    // Ready for release
                    pendingRelease += amount;
                } else {
                    // Future release
                    upcomingReleases.push({
                        amount,
                        releaseDate: escrowReleaseDate,
                        orderId: data.orderId,
                    });

                    // Track next release date
                    if (!nextReleaseDate || escrowReleaseDate < nextReleaseDate) {
                        nextReleaseDate = escrowReleaseDate;
                    }
                }
            }
        });

        // Sort upcoming releases by date
        upcomingReleases.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());

        return {
            error: null,
            success: true,
            data: {
                totalLocked,
                pendingRelease,
                nextReleaseDate,
                upcomingReleases: upcomingReleases.slice(0, 5), // Top 5
            },
        };
    } catch (error: any) {
        logger.error("Escrow status error:", error);
        return { error: "Failed to fetch escrow status", success: false };
    }
}
