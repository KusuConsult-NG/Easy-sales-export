"use server";

import { requireSession } from "@/lib/session-guard";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseDb as db } from "@/lib/supabase-db";
import { supabaseAdmin } from "@/lib/supabase";
import { AggregateField } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import { AWAITING_REVIEW_STATUSES } from "@/lib/land-listing-status";

/**
 * Returns exact system-wide analytics pulling Exclusively from the 
 * single-source-of-truth TRANSACTIONS collection and aggregated pending applications.
 */
export async function getPlatformMetricsAction() { try {
        const sessionResult = await requireAdmin();
        if ('error' in sessionResult) return { success: false as const, error: sessionResult.error, data: null };

        // Revenue is summed in the database, not by fetching rows.
        //
        // This previously pulled every completed payment and added the amounts
        // up in JavaScript. The query had no .limit(), so it inherited the
        // 5,000-row default cap: total revenue was the sum of at most 5,000
        // payments however many existed, and totalTransactions came from that
        // same truncated array — while a .count() query ran alongside it and
        // had its result thrown away.
        const [totals, usersCount] = await Promise.all([
            supabaseAdmin.rpc("platform_revenue_totals"),
            db.collection(COLLECTIONS.USERS).count().get(),
        ]);

        if (totals.error) {
            // Deliberately an error, not a zero.
            //
            // The old code used Promise.allSettled and returned
            // success: true, error: null with the totals left at 0, so a failed
            // query displayed as ₦0 revenue — indistinguishable from a quiet
            // day, and impossible for anyone to notice.
            logger.error("[platform-metrics] platform_revenue_totals failed", { error: totals.error });
            return {
                success: false as const,
                error: "Could not calculate platform revenue. The figures shown would be wrong, so none are shown.",
                data: null,
            };
        }

        const row = Array.isArray(totals.data) ? totals.data[0] : totals.data;

        return {
            error: null,
            success: true as const,
            data: {
                totalRevenue: Number(row?.total_revenue ?? 0),
                totalTransactions: Number(row?.transaction_count ?? 0),
                totalUsers: usersCount.data().count || 0,
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
            // `pending` is not "awaiting approval" for a land listing — it is
            // what farm-nation sets when a BUYER reserves one mid-purchase (see
            // land-listing-status.ts). So this counted reserved properties as
            // outstanding approvals and reported zero for the listings actually
            // waiting to be reviewed, while farm-nation-admin.ts and
            // admin-content.ts, which query `pending_verification`, showed the
            // real queue. Three screens, two answers, and this is the one on the
            // global dashboard.
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", AWAITING_REVIEW_STATUSES[0]).count().get(),
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
            // An escrow is never `completed`. Its statuses are pending, funded,
            // released, refunded and disputed — the type in marketplace/_escrow.ts
            // says so, and `released` is what order-management.ts and the
            // dispute resolution both transition to. So `completedEscrows` was
            // structurally always 0, however many had been paid out.
            //
            // `completed` does appear next to escrow code, which is how this
            // survived: it is the status of the WALLET_TRANSACTIONS and
            // TRANSACTIONS rows written when an escrow is released, a few lines
            // apart in the same function.
            db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).where("status", "==", "released").count().get(),
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
