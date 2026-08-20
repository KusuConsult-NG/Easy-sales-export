import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";
import type { FinanceServiceContract, RevenueMetrics } from "@easy-sales/services";

/**
 * Finance Service
 * 
 * PAYSTACK IS THE ONLY SOURCE OF TRUTH FOR PAYMENTS.
 * IMMUTABLE LEDGER ARCHITECTURE: Balances must be derived from ledger totals only.
 */

export class FinanceService implements FinanceServiceContract {
    /**
     * Derives a user's balance purely from immutable ledger entries.
     */
    static async deriveUserBalance(userId: string): Promise<number> {
        const db = getAdminDb();
        // .all(), not a bare .get().
        //
        // This class opens with "Balances must be derived from ledger totals
        // only", and a bare .get() on an unbounded query stops at
        // DEFAULT_QUERY_LIMIT (5,000) and returns a snapshot indistinguishable
        // from a complete one. A total derived from the first 5,000 of a
        // member's ledger is not that member's balance — it is a smaller number
        // that looks exactly like one. .all() is the escape hatch the adapter
        // provides for genuine aggregations, and this is one.
        const ledgerSnap = await db.collection("financial_ledger")
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .all()
            .get();
        if (ledgerSnap.truncated) {
            logger.error(`[FinanceService] financial_ledger sweep truncated for user ${userId} — derived balance understates the true figure.`);
        }

        let balance = 0;
        ledgerSnap.docs.forEach(doc => {
            const data = doc.data();
            // Assuming positive for deposits/credits, negative for withdrawals/debits
            if (data.type === 'credit' || data.type === 'deposit' || data.type === 'commission') {
                balance += (data.amount || 0);
            } else if (data.type === 'debit' || data.type === 'withdrawal' || data.type === 'escrow_lock') {
                balance -= (data.amount || 0);
            }
        });

        return balance;
    }

    /**
     * Cross-checks Firebase stored payments against actual successful transaction states.
     */
    static async getVerifiedRevenueMetrics(module?: string) {
        const db = getAdminDb();
        // NOTE: processedPayments only ever writes status="completed".
        // "success" was a Paystack API status that was historically confused with our internal status.
        // Using COLLECTIONS constant to prevent hardcoded string drift.
        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.PROCESSED_PAYMENTS).where("status", "==", "completed");
        
        if (module) {
            query = query.where("module", "==", module);
        }

        // .all() — see deriveUserBalance. This one is the platform's TOTAL
        // revenue and its total transaction count, and both were capped at
        // 5,000 completed payments: the figure the finance dashboard showed,
        // and the figure the Paystack reconciliation diffs against, silently
        // stopped counting there. Every payment beyond the cap was money the
        // platform had taken and did not report.
        const snap = await query.all().get();
        if (snap.truncated) {
            logger.error("[FinanceService] processed_payments sweep truncated — verifiedRevenue and transactionCount both understate the true figures.");
        }
        let totalRevenue = 0;
        
        snap.docs.forEach(doc => {
            const data = doc.data();
            // Verified amounts only
            totalRevenue += (data.amount || 0);
        });

        return {
            verifiedRevenue: totalRevenue,
            transactionCount: snap.size
        };
    }

    async deriveUserBalance(userId: string): Promise<number> {
        return FinanceService.deriveUserBalance(userId);
    }

    async getVerifiedRevenueMetrics(module?: string): Promise<RevenueMetrics> {
        return FinanceService.getVerifiedRevenueMetrics(module);
    }

    /**
     * Derives a user's marketplace wallet balance purely from immutable completed ledger entries.
     */
    static async deriveMarketplaceWalletBalance(userId: string): Promise<number> {
        const db = getAdminDb();
        // .all() — see deriveUserBalance.
        const snap = await db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .all()
            .get();
        if (snap.truncated) {
            logger.error(`[FinanceService] wallet_transactions sweep truncated for user ${userId} — derived balance understates the true figure.`);
        }

        let balance = 0;
        snap.docs.forEach(doc => {
            const data = doc.data();
            balance += (data.amount || 0);
        });

        return balance;
    }

    async deriveMarketplaceWalletBalance(userId: string): Promise<number> {
        return FinanceService.deriveMarketplaceWalletBalance(userId);
    }
}
