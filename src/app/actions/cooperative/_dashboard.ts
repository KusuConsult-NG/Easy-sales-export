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
export async function getDashboardDataAction() { try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user) { return { success: false as const, error: "Not authenticated", data: null };
        }

        const userId = session.user.id;
        logger.info(`[getDashboardData] Loading data for user: ${userId}`);

        let membershipSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
            .where('userId', '==', userId)
            .get();

        // FALLBACK: If query by field fails, try direct document ID lookup or email query
        if (membershipSnapshot.empty) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const docSnap = await docRef.get();
            if (docSnap.exists) {
                logger.info(`[getDashboardData] Found membership via DocID fallback for user: ${userId}`);
                // Heal the document by adding the userId field on-the-fly
                const docData = docSnap.data()!;
                if (!docData.userId) {
                    await docRef.update({ userId });
                }
                membershipSnapshot = { empty: false,
                    size: 1,
                    docs: [docSnap]
                } as any;
            } else {
                // Fetch email from users collection to query by email
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                const userEmail = userDoc.exists ? userDoc.data()?.email : null;
                if (userEmail) {
                    const emailQuery = await db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userEmail.toLowerCase())
                        .limit(1)
                        .get();
                    if (!emailQuery.empty) {
                        logger.info(`[getDashboardData] Found membership via Email query fallback for user: ${userId}`);
                        const memberDoc = emailQuery.docs[0];
                        const docData = memberDoc.data();
                        if (!docData.userId) {
                            await memberDoc.ref.update({ userId });
                        }
                        membershipSnapshot = { empty: false,
                            size: 1,
                            docs: [memberDoc]
                        } as any;
                    }
                }
            }
        }

        // Fetch recent 10 transactions
        // Note: Removed .orderBy('date') to bypass missing index error while index is provisioning
        const transactionsSnapshot = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
            .where('userId', '==', userId)
            .limit(50) // Fetch a few more to allow for meaningful sorting
            .get();

        if (membershipSnapshot.empty) {
            logger.warn(`[getDashboardData] No membership found in ${COLLECTIONS.COOPERATIVE_MEMBERS} for user: ${userId}`);
            return { success: false as const, error: `No cooperative membership found for ${userId}` };
        }

        logger.info(`[getDashboardData] Found ${membershipSnapshot.size} membership docs for user: ${userId}`);

        const sortedDocs = membershipSnapshot.docs.sort((a, b) => { const aTime = a.data().createdAt?.toMillis?.() || a.data().createdAt?.seconds * 1000 || 0;
            const bTime = b.data().createdAt?.toMillis?.() || b.data().createdAt?.seconds * 1000 || 0;
            return bTime - aTime;
        });
        const membershipDoc = sortedDocs[0];
        const membership = serializeDoc<CooperativeMembership>(membershipDoc.id, membershipDoc.data());

        // Memory sort transactions since DB index is missing
        const rawTransactions = serializeDocs<CooperativeTransaction>(transactionsSnapshot.docs);
        const transactions = rawTransactions.sort((a, b) => { const aTime = new Date(a.date).getTime();
            const bTime = new Date(b.date).getTime();
            return bTime - aTime;
        }).slice(0, 10); // Keep only recent 10

        return {
            success: true as const,
            error: null,
            data: {
                membership,
                transactions
            }
        };


    } catch (error) { logger.error("Dashboard data fetch error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to load dashboard data", data: null };
    }
}
