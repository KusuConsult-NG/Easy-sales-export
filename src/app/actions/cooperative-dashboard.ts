"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { CooperativeMembership, CooperativeTransaction } from "@/lib/types/cooperative";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

/**
 * Optimized dashboard data loader
 * Combines membership and transaction queries into a single server action
 * for improved performance
 */
export async function getDashboardDataAction() {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user) {
            return {
                success: false,
                error: "Not authenticated",
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
            };
        }

        const membershipDoc = membershipSnapshot.docs[0];
        const membership = serializeDoc<CooperativeMembership>(membershipDoc.id, membershipDoc.data());

        const transactions = serializeDocs<CooperativeTransaction>(transactionsSnapshot.docs);

        return {
            success: true,
            data: { membership, transactions },
            meta: null,
            error: null
        };

    } catch (error) {
        logger.error("Dashboard data fetch error:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to load dashboard data",
        };
    }
}
