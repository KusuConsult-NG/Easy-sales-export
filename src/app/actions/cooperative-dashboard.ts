"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { CooperativeMembership, CooperativeTransaction } from "@/lib/types/cooperative";

/**
 * Optimized dashboard data loader
 * Combines membership and transaction queries into a single server action
 * for improved performance
 */
export async function getDashboardDataAction() {
    try {
        const session = await auth();
        if (!session?.user) {
            return {
                success: false,
                error: "Not authenticated",
                membership: null,
                transactions: []
            };
        }

        const userId = session.user.id;

        // Parallel queries for optimal performance
        const [membershipSnapshot, transactionsSnapshot] = await Promise.all([
            // Fetch membership data
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where('userId', '==', userId)
                .limit(1)
                .get(),

            // Fetch recent 10 transactions only
            db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
                .where('userId', '==', userId)
                .orderBy('date', 'desc')
                .limit(10)
                .get()
        ]);

        if (membershipSnapshot.empty) {
            return {
                success: false,
                error: "No cooperative membership found",
                membership: null,
                transactions: []
            };
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membership: CooperativeMembership = {
            id: membershipDoc.id,
            ...membershipDoc.data()
        } as CooperativeMembership;

        const transactions: CooperativeTransaction[] = transactionsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as CooperativeTransaction));

        return {
            success: true,
            membership,
            transactions,
            error: null
        };

    } catch (error) {
        console.error("Dashboard data fetch error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to load dashboard data",
            membership: null,
            transactions: []
        };
    }
}
