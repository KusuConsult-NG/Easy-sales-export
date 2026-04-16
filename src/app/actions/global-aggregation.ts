"use server";

import { requireSession } from "@/lib/session-guard";
import { db } from "@/lib/firebase-admin";
import { AggregateField } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Returns exact system-wide analytics pulling Exclusively from the 
 * single-source-of-truth TRANSACTIONS collection and aggregated pending applications.
 */
export async function getPlatformMetricsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error };

        // 1. Transactions - Aggregate from actual historical collections 
        const [paystackSnap, escrowsR, coopRevR, allUsersSnap, usersSnap2] = await Promise.allSettled([
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed").limit(10000).get(), // Using .get to manually sum without composite index, and fast enough for ~5000 docs
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "completed").aggregate({ total: AggregateField.sum("amount") }).get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("paymentStatus", "==", "completed").aggregate({ total: AggregateField.sum("registrationFee") }).get(),
            db.collection(COLLECTIONS.USERS).count().get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).count().get()
        ]);

        let totalRevenue = 0;
        let totalTransactions = 0;
        
        if (paystackSnap.status === 'fulfilled') {
            paystackSnap.value.docs.forEach(d => {
                totalRevenue += (Number(d.data().amount) || 0);
            });
            totalTransactions += paystackSnap.value.docs.length;
        }

        const totalUsers = (allUsersSnap.status === 'fulfilled' ? allUsersSnap.value.data().count || 0 : 0);
        
        // Excluded Escrow and Coop revenues from literal addition because they were paid through Paystack,
        // so `PROCESSED_PAYMENTS` ALREADY has them. Adding them would double-count.
        
        return {
            success: true,
            data: {
                totalUsers,
                totalTransactions,
                totalRevenue
            }
        };
    } catch (error: any) {
        logger.error("Failed to aggregate platform metrics:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Computes exactly how many pending approvals exist across the ENTIRE stack.
 * Ensures Analytics, Dashboard, and Modules ALWAYS hit the exact same number.
 */
export async function getGlobalPendingApprovalsAction() {
    try {
        const [
            wave,
            cooperative,
            exportOnboarding,
            sellers,
            land,
            loans
        ] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("membershipStatus", "==", "pending").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending").count().get()
        ]);

        const counts = {
            wave: wave.data().count || 0,
            cooperative: cooperative.data().count || 0,
            export: exportOnboarding.data().count || 0,
            sellers: sellers.data().count || 0,
            land: land.data().count || 0,
            loans: loans.data().count || 0
        };

        const totalPending = Object.values(counts).reduce((sum, count) => sum + count, 0);

        return {
            success: true,
            data: {
                totalPending,
                breakdown: counts
            }
        };
    } catch (error: any) {
        logger.error("Failed to compute pending approvals:", error);
        return { success: false, error: error.message };
    }
}
