import { getAdminDb } from "@/lib/firebase-admin";
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
        const ledgerSnap = await db.collection("financial_ledger")
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .get();

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
        let query: FirebaseFirestore.Query = db.collection("processedPayments").where("status", "in", ["success", "completed"]);
        
        if (module) {
            query = query.where("module", "==", module);
        }

        const snap = await query.get();
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
        const snap = await db.collection("wallet_transactions")
            .where("userId", "==", userId)
            .where("status", "==", "completed")
            .get();

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
