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
        logger.info(`[getDashboardData] Loading data for user: ${userId}`);

        let membershipSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', userId)
            .get();

        // FALLBACK: If query by field fails, try direct document ID lookup (parity with layout guard)
        if (membershipSnapshot.empty) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                logger.info(`[getDashboardData] Found membership via DocID fallback for user: ${userId}`);
                // Mock a snapshot-like structure for the code below
                membershipSnapshot = {
                    empty: false,
                    size: 1,
                    docs: [docSnap]
                } as any;
            }
        }

        // Fetch recent 10 transactions
        const transactionsSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where('userId', '==', userId)
            .orderBy('date', 'desc')
            .limit(10)
            .get();

        if (membershipSnapshot.empty) {
            logger.warn(`[getDashboardData] No membership found in ${COLLECTIONS.COOPERATIVE_MEMBERS} for user: ${userId}`);
            return {
                success: false,
                error: `No cooperative membership found for ${userId}`,
            };
        }


        logger.info(`[getDashboardData] Found ${membershipSnapshot.size} membership docs for user: ${userId}`);



        const sortedDocs = membershipSnapshot.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
            const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const membershipDoc = sortedDocs[0];
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
