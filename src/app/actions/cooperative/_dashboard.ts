"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { CooperativeMembership, CooperativeTransaction } from "@/lib/types/cooperative";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { runQueryWithRetry } from "@/lib/firestore-utils";

/**
 * Optimized dashboard data loader
 * Combines membership and transaction queries into a single server action
 * for improved performance.
 *
 * Fallback chain (in order):
 *  1. Query cooperative_members by userId field
 *  2. Direct doc lookup by doc ID === userId
 *  3. Email query against cooperative_members
 *  4. processed_payments lookup → find orphaned member doc by paymentReference
 *     → if still not found, synthesise a member doc from the payment record
 *
 * Fallbacks 1-4 also heal the doc by writing the userId field so future
 * reads hit the fast path (Fallback 1).
 */
export async function getDashboardDataAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;
        if (!session?.user) {
            return { success: false as const, error: "Not authenticated", data: null };
        }

        const userId = session.user.id;
        logger.info(`[getDashboardData] Loading data for user: ${userId}`);

        // ── FALLBACK 1: Query by userId field ──────────────────────────────────
        let membershipSnapshot = await runQueryWithRetry(() =>
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                .where('userId', '==', userId)
                .get()
        );

        // ── FALLBACK 2: Direct document ID lookup ──────────────────────────────
        if (membershipSnapshot.empty) {
            const docRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const docSnap = await runQueryWithRetry(() => docRef.get());
            if (docSnap.exists) {
                logger.info(`[getDashboardData] Found membership via DocID fallback for user: ${userId}`);
                const docData = docSnap.data()!;
                if (!docData.userId) {
                    await docRef.update({ userId });
                }
                membershipSnapshot = { empty: false, size: 1, docs: [docSnap] } as any;
            }
        }

        // ── FALLBACK 3: Email query ────────────────────────────────────────────
        if (membershipSnapshot.empty) {
            const userDoc = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(userId).get());
            const userEmail = userDoc.exists ? userDoc.data()?.email : null;
            if (userEmail) {
                const emailQuery = await runQueryWithRetry(() =>
                    db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("email", "==", userEmail.toLowerCase())
                        .limit(1)
                        .get()
                );
                if (!emailQuery.empty) {
                    logger.info(`[getDashboardData] Found membership via Email fallback for user: ${userId}`);
                    const memberDoc = emailQuery.docs[0];
                    if (!memberDoc.data().userId) {
                        await memberDoc.ref.update({ userId });
                    }
                    membershipSnapshot = { empty: false, size: 1, docs: [memberDoc] } as any;
                }
            }
        }

        // ── FALLBACK 4: processed_payments ────────────────────────────────────
        // User paid but member doc link is broken. This happens when the Paystack
        // webhook used a membershipId (e.g. a generated form-submission doc ID)
        // that differs from userId and the member doc's userId field was never set.
        if (membershipSnapshot.empty) {
            logger.warn(`[getDashboardData] All direct lookups failed for ${userId} — checking processed_payments`);

            const paymentSnap = await runQueryWithRetry(() =>
                db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                    .where("userId", "==", userId)
                    .where("type", "==", "cooperative_membership_registration")
                    .where("status", "==", "completed")
                    .limit(1)
                    .get()
            );

            if (!paymentSnap.empty) {
                const paymentData = paymentSnap.docs[0].data();
                const paymentReference = paymentData.reference;
                logger.info(`[getDashboardData] Found completed payment ${paymentReference} for ${userId} — locating member doc by paymentReference`);

                // Try to find the orphaned member doc by paymentReference
                const memberByRefQuery = await runQueryWithRetry(() =>
                    db.collection(COLLECTIONS.COOPERATIVE_MEMBERS)
                        .where("paymentReference", "==", paymentReference)
                        .limit(1)
                        .get()
                );

                if (!memberByRefQuery.empty) {
                    // Found the orphaned doc — heal the userId link so future reads are fast
                    const memberDoc = memberByRefQuery.docs[0];
                    logger.info(`[getDashboardData] Healed orphaned member doc ${memberDoc.id} → userId=${userId}`);
                    await memberDoc.ref.update({ userId, updatedAt: FieldValue.serverTimestamp() });
                    membershipSnapshot = { empty: false, size: 1, docs: [memberDoc] } as any;
                } else {
                    // Member doc is completely missing despite a confirmed payment.
                    // Synthesise a minimal doc so the user can access their dashboard.
                    // Admin will still need to approve them. _healedFromPayment=true lets
                    // admins filter for these in Firestore console if needed.
                    logger.info(`[getDashboardData] No member doc found — synthesising from payment for ${userId}`);
                    const newMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
                    const userDocSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
                    const userData = userDocSnap.data() || {};
                    await newMemberRef.set({
                        userId,
                        email: userData.email || "",
                        firstName: userData.firstName || "",
                        lastName: userData.lastName || "",
                        fullName: userData.fullName || userData.displayName || "",
                        phone: userData.phone || "",
                        paymentStatus: "completed",
                        paymentReference,
                        membershipStatus: "pending",
                        membershipTier: paymentData.tier || "Member",
                        createdAt: paymentData.processedAt || FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp(),
                        _healedFromPayment: true,
                    }, { merge: true });
                    const healedSnap = await newMemberRef.get();
                    membershipSnapshot = { empty: false, size: 1, docs: [healedSnap] } as any;
                }
            }
        }

        // ── Transactions ───────────────────────────────────────────────────────
        // Note: Removed .orderBy('date') to bypass missing index error while index is provisioning
        const transactionsSnapshot = await runQueryWithRetry(() =>
            db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS)
                .where('userId', '==', userId)
                .limit(50) // Fetch extra to allow in-memory sort
                .get()
        );

        if (membershipSnapshot.empty) {
            // Check if user is an active premium/paid plan subscriber in the Academy
            const userDoc = await runQueryWithRetry(() => db.collection(COLLECTIONS.USERS).doc(userId).get());
            const userData = userDoc.exists ? userDoc.data() : null;
            const userPlan = (userData?.serviceRegistrations?.academy?.plan || "free").toLowerCase();
            const isPremiumSubscriber = ["elite", "standard", "foundation", "advanced"].includes(userPlan);

            if (isPremiumSubscriber) {
                logger.info(`[getDashboardData] No membership found but user is premium subscriber — synthesizing for ${userId}`);
                const membership: CooperativeMembership = {
                    id: userId,
                    cooperativeId: "easy-sales-cooperative",
                    cooperativeName: "Easy Sales Cooperative",
                    savingsBalance: 0,
                    loanBalance: 0,
                    memberSince: userData?.createdAt?.toDate ? userData.createdAt.toDate() : new Date(),
                    monthlyTarget: 0,
                    membershipTier: "Member",
                    membershipStatus: "active",
                    paymentStatus: "completed"
                };

                return {
                    success: true as const,
                    error: null,
                    data: { membership, transactions: [] }
                };
            }

            logger.warn(`[getDashboardData] No membership found anywhere for user: ${userId}`);
            return { success: false as const, error: `No cooperative membership found for ${userId}` };
        }

        logger.info(`[getDashboardData] Found ${membershipSnapshot.size} membership docs for user: ${userId}`);

        const sortedDocs = membershipSnapshot.docs.sort((a, b) => {
            const aTime = a.data().createdAt?.toMillis?.() || (a.data().createdAt?.seconds ?? 0) * 1000;
            const bTime = b.data().createdAt?.toMillis?.() || (b.data().createdAt?.seconds ?? 0) * 1000;
            return bTime - aTime;
        });
        const membershipDoc = sortedDocs[0];
        const membership = serializeDoc<CooperativeMembership>(membershipDoc.id, membershipDoc.data());

        const rawTransactions = serializeDocs<CooperativeTransaction>(transactionsSnapshot.docs);
        const transactions = rawTransactions
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .slice(0, 10);

        return {
            success: true as const,
            error: null,
            data: { membership, transactions }
        };

    } catch (error) {
        logger.error("Dashboard data fetch error:", error);
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to load dashboard data", data: null };
    }
}
