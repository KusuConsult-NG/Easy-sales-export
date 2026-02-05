"use server";

import { db } from "@/lib/firebase";
import {
    collection,
    query,
    where,
    getDocs,
    doc,
    getDoc,
    orderBy,
    limit
} from "firebase/firestore";
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

export async function getDashboardStatsAction(): Promise<DashboardActionState> {
    try {
        const session = await auth();
        if (!session?.user) {
            return { error: "Authentication required", success: false };
        }

        const userId = session.user.id;

        // Fetch total exports
        const exportsQuery = query(
            collection(db, COLLECTIONS.EXPORT_WINDOWS),
            where("userId", "==", userId)
        );
        const exportsSnapshot = await getDocs(exportsQuery);
        const totalExports = exportsSnapshot.size;

        // Count active orders (pending or in_transit)
        const activeOrders = exportsSnapshot.docs.filter(
            doc => ["pending", "in_transit"].includes(doc.data().status)
        ).length;

        // Calculate total escrow (orders in transit or delivered but not released)
        const totalEscrow = exportsSnapshot.docs
            .filter(doc => ["in_transit", "delivered"].includes(doc.data().status))
            .reduce((sum, doc) => sum + (doc.data().amount || 0), 0);

        // Fetch cooperative savings (if user is a member)
        let cooperativeSavings = 0;
        const userDoc = await getDoc(doc(db, COLLECTIONS.USERS, userId));
        const cooperativeId = userDoc.data()?.cooperativeId;

        if (cooperativeId) {
            const memberDoc = await getDoc(
                doc(db, COLLECTIONS.COOPERATIVES, cooperativeId, "members", userId)
            );
            if (memberDoc.exists()) {
                cooperativeSavings = memberDoc.data().balance || 0;
            }
        }

        // Count academy enrollments
        const enrollmentsQuery = query(
            collection(db, COLLECTIONS.ENROLLMENTS),
            where("userId", "==", userId)
        );
        const enrollmentsSnapshot = await getDocs(enrollmentsQuery);
        const academyEnrollments = enrollmentsSnapshot.size;

        return {
            error: null,
            success: true,
            data: {
                totalExports,
                activeOrders,
                totalEscrow,
                cooperativeSavings,
                academyEnrollments,
            },
        };
    } catch (error: any) {
        console.error("Dashboard stats error:", error);
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
        const exportsQuery = query(
            collection(db, COLLECTIONS.EXPORT_WINDOWS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(3)
        );
        const exportsSnapshot = await getDocs(exportsQuery);

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
        const notificationsQuery = query(
            collection(db, COLLECTIONS.NOTIFICATIONS),
            where("userId", "==", userId),
            orderBy("createdAt", "desc"),
            limit(2)
        );
        const notificationsSnapshot = await getDocs(notificationsQuery);

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
        console.error("Recent activity error:", error);
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
        const exportsQuery = query(
            collection(db, COLLECTIONS.EXPORT_WINDOWS),
            where("userId", "==", userId),
            where("status", "in", ["in_transit", "delivered"])
        );
        const exportsSnapshot = await getDocs(exportsQuery);

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
        console.error("Escrow status error:", error);
        return { error: "Failed to fetch escrow status", success: false };
    }
}
