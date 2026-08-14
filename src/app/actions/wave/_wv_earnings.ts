"use server";

import { ActionResponse } from "@/lib/safe-action";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { debitJsonbBalance } from "@/lib/wallet-ledger";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { isAdmin } from "@/lib/role-utils";
import type { MemberEarnings } from "@/lib/types/wave-actions";

/**
 * Calculate member earnings from sales
 */
async function _calculateEarningsAction(userId: string): Promise<ActionResponse<MemberEarnings>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        if (session.user.id !== userId && (!isAdmin(session.user.roles))) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const userDoc = await userRef.get();
        const userData = userDoc.data();
        const waveReg = userData?.serviceRegistrations?.wave;

        // Source of Truth: Persistent Balance
        let availableBalance = waveReg?.waveEarningsBalance;

        // Heavy calculation for Transaction History and Initial Backfill
        const snapshot = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS)
            .where("sellerId", "==", userId)
            .get();

        const commissionRate = 0.05;
        let totalSales = 0;
        let totalEarnings = 0;
        let pendingAmount = 0;
        let calculatedPaidAmount = 0;
        const transactions: any[] = [];

        snapshot.docs.forEach(doc => {
            const order = doc.data();
            const saleAmount = order.totalAmount || 0;
            const commission = saleAmount * commissionRate;
            const isPaid = order.paymentStatus === "paid" || order.status === "completed";

            totalSales += saleAmount;
            totalEarnings += commission;

            if (isPaid) {
                calculatedPaidAmount += commission;
            } else {
                pendingAmount += commission;
            }

            transactions.push({
                date: order.createdAt?.toDate ? order.createdAt.toDate() : new Date(),
                orderId: doc.id,
                saleAmount,
                commission,
                status: isPaid ? "paid" : "pending"
            });
        });

        const withdrawalsSnap = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS)
            .where("userId", "==", userId)
            .where("status", "in", ["pending", "approved", "approved_pending_payout", "completed"])
            .get();
        
        let withdrawnAmount = 0;
        withdrawalsSnap.docs.forEach(doc => {
            const w = doc.data();
            withdrawnAmount += (w.amount || 0);
        });

        // AUTO-BACKFILL: If persistent balance is missing, initialize it
        if (availableBalance === undefined) {
            availableBalance = Math.max(0, calculatedPaidAmount - withdrawnAmount);
            await userRef.update({
                'serviceRegistrations.wave.waveEarningsBalance': availableBalance,
                updatedAt: FieldValue.serverTimestamp()
            });
            logger.info(`Backfilled WAVE earnings balance for user ${userId}: ${availableBalance}`);
        }

        const result: MemberEarnings = {
            memberId: userId,
            totalSales,
            totalEarnings,
            commissionRate,
            pendingAmount,
            paidAmount: availableBalance, // Use the persistent source
            totalWithdrawn: withdrawnAmount,
            transactions: transactions
                .sort((a: any, b: any) => b.date.getTime() - a.date.getTime())
                .map(t => ({
                    ...t,
                    date: t.date.toISOString()
                }))
        };

        const { serializeValue } = await import("@/lib/firestore-serialize");
        return { error: null, success: true as const, data: serializeValue(result) as any };
    } catch (error) {
        logger.error("Calculate earnings error:", error);
        return { success: false as const, error: "Failed to calculate earnings", data: null };
    }
}


export const calculateEarningsAction = withFlexibleSafeAction("calculateEarningsAction", _calculateEarningsAction);


// ============================================================================
// EARNINGS WITHDRAWAL
// ============================================================================

/**
 * Request an earnings withdrawal.
 * Creates a pending withdrawal record in Firestore for admin processing.
 */
async function _withdrawEarningsAction(
    amount: number
): Promise<ActionResponse<null>> {
    try {
        // WAVE withdrawals are currently disabled
        return { 
            success: false as const, 
            error: "WAVE earnings withdrawals are currently disabled for maintenance. Please try again later.", 
            data: null 
        };

        const sessionResult = await requireSession();
        if (!sessionResult.session?.user?.id) {
            return { 
                success: false as const, 
                error: sessionResult.error?.error ?? "Authentication required", 
                data: null 
            };
        }
        const session = sessionResult.session!;
        const userId = session.user.id;
        const userEmail = session.user.email || "";

        if (amount < 5000) {
            return { success: false as const, error: "Minimum withdrawal amount is ₦5,000", data: null };
        }

        // PHASE 1: Balance Calculation (Snapshot)
        // Note: We calculate before the transaction because Firestore queries are not supported inside transactions in Node SDK.
        // The transactional lock (hasPendingWithdrawal) prevents race conditions.
        const earnings = await _calculateEarningsAction(userId);
        if (!earnings.success || (earnings.data?.paidAmount || 0) < amount) {
            return { success: false as const, error: earnings.error || "Insufficient available balance", data: null };
        }

        const withdrawalId = `WAVE-WD-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
        const withdrawalRef = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
        const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);

        // PHASE 2: ATOMIC RESERVATION
        // Debit the earnings under a row lock, before recording anything.
        //
        // The sufficiency check above happens outside any transaction — it reads
        // a snapshot, releases it, and the decrement happens later. Two
        // withdrawals submitted at once both passed against the same snapshot
        // and both debited. The hasPendingWithdrawal flag was meant to prevent
        // that and could not: it was a check-then-write inside the same
        // lock-free transaction.
        //
        // Taking the money first means the second request is refused for
        // insufficient funds, which is the honest answer — the first one has it.
        const debit = await debitJsonbBalance({
            table: "users",
            id: userId,
            field: "serviceRegistrations.wave.waveEarningsBalance",
            amount,
        });

        if (!debit.ok) {
            return {
                success: false as const,
                error: debit.reason === "insufficient_funds"
                    ? "Insufficient available balance"
                    : "WAVE earnings record not found",
                data: null,
            };
        }

        await db.runTransaction(async (transaction) => {
            // Create WAVE Withdrawal Record
            transaction.set(withdrawalRef, {
                withdrawalId,
                userId,
                userEmail,
                amount,
                status: "pending",
                requestedAt: FieldValue.serverTimestamp(),
                processedAt: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });

            // Align with Wallet Ledger System
            transaction.set(walletTxnRef, {
                walletId: userId,
                userId,
                type: "withdrawal",
                module: "wave",
                amount: -amount, // Negative for withdrawal
                description: `WAVE Earnings Withdrawal - ${withdrawalId}`,
                status: "pending",
                reference: withdrawalId,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0
            });

            // Set the pending flag. The balance was already debited above,
            // under a lock — decrementing it here as well would take it twice.
            transaction.update(userRef, {
                'serviceRegistrations.wave.hasPendingWithdrawal': true,
                'serviceRegistrations.wave.lastWithdrawalRequestedAt': FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        // AUDIT LOG
        await createAdminAuditLog({
            action: "user_update",
            userId,
            targetId: withdrawalId,
            targetType: "wave_withdrawal",
            metadata: { amount, action: "withdrawal_requested" },
            details: `WAVE earnings withdrawal of ₦${amount.toLocaleString()} requested.`
        });

        return { success: true as const, error: null, data: null };
    } catch (error) { 
        const message = error instanceof Error ? error.message : "An unexpected error occurred";
        logger.error("Withdraw earnings error:", error);
        return { success: false as const, error: message, data: null };
    }
}


export const withdrawEarningsAction = withFlexibleSafeAction("withdrawEarningsAction", _withdrawEarningsAction);
