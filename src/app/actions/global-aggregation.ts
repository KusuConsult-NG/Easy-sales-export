"use server";

import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { AggregateField } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Returns exact system-wide analytics pulling Exclusively from the 
 * single-source-of-truth TRANSACTIONS collection and aggregated pending applications.
 */
export async function getPlatformMetricsAction() { try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        // 1. Transactions - Aggregate from actual historical collections 
        const [revenueSnap, allUsersSnap, usersSnap2] = await Promise.allSettled([
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS)
                .where("status", "==", "completed")
                .select("amount")
                .get(),
            db.collection(COLLECTIONS.USERS).count().get(),
            db.collection(COLLECTIONS.PROCESSED_PAYMENTS).count().get()
        ]);

        let totalRevenue = 0;
        let totalTransactions = 0;
        
        if (revenueSnap.status === 'fulfilled') { revenueSnap.value.docs.forEach(d => {
                totalRevenue += (Number(d.data().amount) || 0);
            });
            totalTransactions = revenueSnap.value.docs.length;
        }

        const totalUsers = (allUsersSnap.status === 'fulfilled' ? allUsersSnap.value.data().count || 0 : 0);
        
        return { 
            error: null, 
            success: true as const, 
            data: {
                totalRevenue,
                totalTransactions,
                totalUsers
            }
        };
    } catch (error: any) { logger.error("Failed to aggregate platform metrics:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Computes exactly how many pending approvals exist across the ENTIRE stack.
 * Ensures Analytics, Dashboard, and Modules ALWAYS hit the exact same number.
 */
export async function getGlobalPendingApprovalsAction() { try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        const [
            wave,
            cooperative,
            exportOnboarding,
            sellers,
            land,
            loans,
            waveWithdrawals,
            cooperativeWithdrawals
        ] = await Promise.all([
            db.collection(COLLECTIONS.WAVE_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).where("membershipStatus", "==", "pending").count().get(),
            db.collection(COLLECTIONS.EXPORT_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.LOAN_APPLICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.WAVE_WITHDRAWALS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).where("status", "==", "pending").count().get()
        ]);

        const counts = { wave: wave.data().count || 0,
            cooperative: cooperative.data().count || 0,
            export: exportOnboarding.data().count || 0,
            sellers: sellers.data().count || 0,
            land: land.data().count || 0,
            loans: loans.data().count || 0,
            withdrawals: (waveWithdrawals.data().count || 0) + (cooperativeWithdrawals.data().count || 0)
        };

        const totalPending = Object.values(counts).reduce((sum, count) => sum + count, 0);

        return { 
            error: null, 
            success: true as const, 
            data: {
                totalPending,
                counts
            }
        };
    } catch (error: any) { logger.error("Failed to compute pending approvals:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Computes exact user metrics.
 */
export async function getUserMetricsAction() {
    try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [totalSnap, activeSnap, verifiedSnap] = await Promise.all([
            db.collection(COLLECTIONS.USERS).count().get(),
            db.collection(COLLECTIONS.USERS).where("updatedAt", ">=", thirtyDaysAgo).count().get(),
            db.collection(COLLECTIONS.USERS).where("isVerified", "==", true).count().get()
        ]);

        const total = totalSnap.data().count || 0;
        const active = activeSnap.data().count || 0;
        const verified = verifiedSnap.data().count || 0;

        return {
            success: true as const,
            error: null,
            data: {
                total,
                active,
                verified,
                unverified: total - verified,
            }
        };
    } catch (error: any) {
        logger.error("Failed to compute user metrics:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Computes exact marketplace metrics.
 */
export async function getMarketplaceMetricsAction() {
    try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        const [
            totalSellersSnap,
            pendingSellersSnap,
            totalEscrowsSnap,
            pendingEscrowsSnap,
            completedEscrowsSnap,
            totalOrdersSnap
        ] = await Promise.all([
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).count().get(),
            db.collection(COLLECTIONS.SELLER_VERIFICATIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).count().get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "completed").count().get(),
            db.collection(COLLECTIONS.MARKETPLACE_ORDERS).count().get()
        ]);

        return {
            success: true as const,
            error: null,
            data: {
                totalSellers: totalSellersSnap.data().count || 0,
                pendingSellers: pendingSellersSnap.data().count || 0,
                totalEscrows: totalEscrowsSnap.data().count || 0,
                pendingEscrows: pendingEscrowsSnap.data().count || 0,
                completedEscrows: completedEscrowsSnap.data().count || 0,
                totalOrders: totalOrdersSnap.data().count || 0
            }
        };
    } catch (error: any) {
        logger.error("Failed to compute marketplace metrics:", error);
        return { success: false as const, error: error.message, data: null };
    }
}

/**
 * Computes exact communications metrics.
 */
export async function getCommunicationsMetricsAction() {
    try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        const [totalDisputesSnap, openDisputesSnap, resolvedDisputesSnap] = await Promise.all([
            db.collection(COLLECTIONS.DISPUTES).count().get(),
            db.collection(COLLECTIONS.DISPUTES).where("status", "in", ["open", "pending"]).count().get(),
            db.collection(COLLECTIONS.DISPUTES).where("status", "==", "resolved").count().get()
        ]);

        return {
            success: true as const,
            error: null,
            data: {
                totalDisputes: totalDisputesSnap.data().count || 0,
                openDisputes: openDisputesSnap.data().count || 0,
                resolvedDisputes: resolvedDisputesSnap.data().count || 0
            }
        };
    } catch (error: any) {
        logger.error("Failed to compute communications metrics:", error);
        return { success: false as const, error: error.message, data: null };
    }
}
