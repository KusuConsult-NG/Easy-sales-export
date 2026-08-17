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

        /**
         * Commission is computed from the ESCROW rows, not from the order.
         *
         * FOUR DEFECTS IN THE OLD BASIS
         * -----------------------------
         * It queried MARKETPLACE_ORDERS on `sellerId` and took 5% of
         * `order.totalAmount`. Both halves were wrong, in four separate ways.
         *
         * 1. AN ORDER HAS SEVERAL SELLERS. `_payment_orders.ts` writes
         *    `sellerIds` — an array — and then `sellerId: sellerIds[0]`, purely as
         *    a convenience field. So this credited whoever happened to be listed
         *    FIRST with 5% of every other seller's items.
         *
         * 2. AND THE OTHER SELLERS GOT NOTHING. The query filters the scalar
         *    `sellerId`, so a WAVE member who was the second seller on an order
         *    earned no commission at all from a sale she genuinely made.
         *
         * 3. CANCELLATION DID NOT REMOVE IT. `isPaid` was
         *    `paymentStatus === "paid" || status === "completed"`, and
         *    cancelOrder claims the ORDER to "cancelled" without touching
         *    `paymentStatus`. A paid-then-cancelled order kept paying 5%.
         *
         * 4. NEITHER DID A REFUND. refundEscrowToBuyer updates the ESCROW row
         *    only — the order keeps `paymentStatus: "paid"` forever — so a fully
         *    refunded sale still earned commission.
         *
         * And `totalAmount` includes the whole delivery fee, so the programme
         * paid a commission on shipping.
         *
         * WHY ESCROW IS THE RIGHT SOURCE
         * ------------------------------
         * `_payment_orders.ts` already computes the per-seller split — the same
         * `sellerTotals` map, three lines after it sets that scalar `sellerId` —
         * and writes one ESCROW_TRANSACTIONS row per seller carrying `sellerId`,
         * `amount` (that seller's goods plus her share of delivery) and a status
         * that tracks the money: pending → funded → released, or refunded.
         *
         * So the escrow row answers all four questions the order could not: whose
         * sale it was, how much of it was hers, whether the money reached her, and
         * whether it was given back.
         *
         * `amount` rather than `netAmount` keeps a single-seller order's figure
         * identical to what it was before — for one seller, her gross IS the order
         * total — so this corrects the multi-seller and refund cases without
         * silently restating everybody else's history.
         */
        const ESCROW_PAID_STATUSES = ["released"];
        const ESCROW_PENDING_STATUSES = ["pending", "funded", "delivered", "disputed", "processing"];

        // Bounded, and it says so when it truncates.
        //
        // The old query had no limit and returned every order plus a transaction
        // row for each, so a busy seller's response grew without bound. A silent
        // cap would be worse than no cap: the totals would quietly stop being
        // totals.
        const ESCROW_SCAN_LIMIT = 2000;

        const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("sellerId", "==", userId)
            .limit(ESCROW_SCAN_LIMIT + 1)
            .get();

        const escrowDocs = snapshot.docs.slice(0, ESCROW_SCAN_LIMIT);
        const truncated = snapshot.docs.length > ESCROW_SCAN_LIMIT;
        if (truncated) {
            logger.warn(
                `[WAVE Earnings] Seller ${userId} has more than ${ESCROW_SCAN_LIMIT} escrow rows; ` +
                `the figures below cover the first ${ESCROW_SCAN_LIMIT} only and are UNDERSTATED.`
            );
        }

        const commissionRate = 0.05;
        let totalSales = 0;
        let totalEarnings = 0;
        let pendingAmount = 0;
        let calculatedPaidAmount = 0;
        const transactions: any[] = [];

        escrowDocs.forEach(doc => {
            const escrow = doc.data();
            const status = String(escrow.status ?? "");

            const isPaid = ESCROW_PAID_STATUSES.includes(status);
            const isPending = ESCROW_PENDING_STATUSES.includes(status);

            // Anything else — refunded, cancelled, or a status this list does not
            // know — earns nothing and is not shown as pending either. Unrecognised
            // is treated as "not owed", which is the safe direction for a balance
            // somebody can withdraw against.
            if (!isPaid && !isPending) return;

            const saleAmount = Number(escrow.amount ?? escrow.grossAmount ?? 0);
            if (!Number.isFinite(saleAmount) || saleAmount <= 0) return;

            const commission = saleAmount * commissionRate;

            totalSales += saleAmount;
            totalEarnings += commission;

            if (isPaid) {
                calculatedPaidAmount += commission;
            } else {
                pendingAmount += commission;
            }

            transactions.push({
                date: escrow.createdAt?.toDate ? escrow.createdAt.toDate() : new Date(escrow.createdAt ?? Date.now()),
                // The order, so a member can still tie a row back to a purchase.
                orderId: escrow.orderId || doc.id,
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

        const entitlement = Math.max(0, calculatedPaidAmount - withdrawnAmount);

        // AUTO-BACKFILL: If persistent balance is missing, initialize it
        //
        // Skipped when the scan truncated. Writing a persistent balance from
        // figures known to be understated would turn a display problem into a
        // stored one, and the field is only initialised once.
        if (availableBalance === undefined && !truncated) {
            availableBalance = entitlement;
            await userRef.update({
                'serviceRegistrations.wave.waveEarningsBalance': availableBalance,
                updatedAt: FieldValue.serverTimestamp()
            });
            logger.info(`Backfilled WAVE earnings balance for user ${userId}: ${availableBalance}`);
        } else if (availableBalance === undefined) {
            availableBalance = entitlement;
        }

        /**
         * A stored balance above the recomputed entitlement is REPORTED, not
         * corrected.
         *
         * Balances backfilled before this function's basis was fixed were
         * computed from whole multi-seller order totals and counted cancelled and
         * refunded sales, so some are too high. Silently writing the lower number
         * would be adjusting somebody's money on the strength of a calculation
         * change, inside a read action, with no audit entry and no decision from
         * anyone. That is not this function's call to make.
         *
         * Logged so the discrepancy is findable, and left alone so it is the
         * owner's to resolve. Withdrawals are disabled, so nothing can be paid
         * out against the difference in the meantime.
         */
        const storedBalance = Number(availableBalance);
        if (Number.isFinite(storedBalance) && !truncated && storedBalance > entitlement + 1) {
            logger.warn(
                `[WAVE Earnings] Stored balance for ${userId} is ₦${storedBalance.toFixed(2)} but the ` +
                `escrow-derived entitlement is ₦${entitlement.toFixed(2)} ` +
                `(paid commission ₦${calculatedPaidAmount.toFixed(2)} less withdrawals ₦${withdrawnAmount.toFixed(2)}). ` +
                `Left unchanged — balances backfilled from the old order-total basis are overstated.`
            );
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
