"use server";

import { ZodError } from "zod";
import { withFlexibleSafeAction, ActionResponse, type ActionState } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransition } from "@/lib/status-transition";
import { createAdminAuditLog } from "@/lib/audit-log";
import { serializeDoc } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { WithdrawalProcessingSchema } from "@/lib/schemas";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { requireAdmin } from "@/lib/require-admin";

// ============================================
// Process Withdrawal Request
// ============================================

async function _processWithdrawalAction(
    withdrawalId: string,
    action: "approve" | "reject",
    reasoning?: string
): Promise<ActionState> {
    try {
        // Live role re-validation — bypasses stale JWT
        const adminCheck = await requireAdmin();
        if ("error" in adminCheck) return { error: adminCheck.error, success: false as const };

        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { error: "Unauthorized: Permission required - finance:process_withdrawals", success: false as const };
        }

        const valid = WithdrawalProcessingSchema.safeParse({ withdrawalId, action, reasoning });
        if (!valid.success) {
            return { error: (valid.error as ZodError).issues[0].message, success: false as const };
        }

        // Try standard withdrawals first, then cooperative_withdrawals.
        // The collection is tracked because the claim below needs to know which
        // one this withdrawal actually lives in.
        let withdrawalCollection: string = COLLECTIONS.WITHDRAWALS;
        let withdrawalRef = db.collection(COLLECTIONS.WITHDRAWALS).doc(withdrawalId);
        let withdrawalDoc = await withdrawalRef.get();

        if (!withdrawalDoc.exists) {
            withdrawalCollection = COLLECTIONS.COOPERATIVE_WITHDRAWALS;
            withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);
            withdrawalDoc = await withdrawalRef.get();
        }

        if (!withdrawalDoc.exists) {
            withdrawalCollection = COLLECTIONS.WAVE_WITHDRAWALS;
            withdrawalRef = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);
            withdrawalDoc = await withdrawalRef.get();
        }

        if (!withdrawalDoc.exists) {
            return { error: "Withdrawal request not found", success: false as const };
        }

        const withdrawalData = withdrawalDoc.data()!;

        if (action === "approve") {
            // ══════════════════════════════════════════════
            // 1. CLAIM THE PAYOUT — Mark as payout_initiated
            // ══════════════════════════════════════════════
            //
            // This was labelled a STATE LOCK and was not one. The status check
            // ran inside runTransaction, which takes no lock, so two admins
            // approving the same withdrawal both read "pending", both wrote
            // "payout_initiated", and both continued to the Paystack transfer
            // below — paying the user twice, out of the business's money.
            //
            // Same defect and same fix as the wallet withdrawal path.
            const claim = await claimStatusTransition({
                collection: withdrawalCollection,
                id: withdrawalId,
                from: "pending",
                to: "payout_initiated",
                patch: { processedBy: session.user.id, processedAt: new Date().toISOString() },
            });

            if (!claim.claimed) {
                return {
                    error: claim.status === null
                        ? "Withdrawal request not found"
                        : `Withdrawal is already ${claim.status}`,
                    success: false as const,
                };
            }

            // ══════════════════════════════════════════════
            // 2. PAYOUT — Trigger Paystack Transfer
            // ══════════════════════════════════════════════
            let payoutSuccess = false;
            let payoutError: string | undefined;
            let transferCode: string | undefined;

            try {
                const { paystackPayout } = await import("@/lib/paystack-transfer");

                // Get user bank details
                const userDoc = await db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId).get();
                const userData = userDoc.data();

                if (userData?.bankAccountNumber && userData?.bankCode) {
                    const payoutResult = await paystackPayout(
                        {
                            accountNumber: userData.bankAccountNumber,
                            bankCode: userData.bankCode,
                            accountName: userData.bankAccountName || userData.name,
                        },
                        withdrawalData.amount,
                        `Withdrawal payout - ${withdrawalId}`
                    );
                    payoutSuccess = payoutResult.success;
                    payoutError = payoutResult.error;
                    transferCode = payoutResult.transferCode;
                } else {
                    payoutError = "User bank details not configured";
                }
            } catch (payoutErr: any) {
                payoutError = payoutErr.message;
                logger.error(`Payout error for withdrawal ${withdrawalId}:`, payoutErr);
            }

            // ══════════════════════════════════════════════
            // 3. FINAL UPDATE & LEDGER RECORD
            // ══════════════════════════════════════════════
            await db.runTransaction(async (transaction) => {
                transaction.update(withdrawalRef, {
                    status: payoutSuccess ? "completed" : "approved_pending_payout",
                    adminNotes: reasoning || "",
                    updatedAt: FieldValue.serverTimestamp(),
                    ...(transferCode ? { paystackTransferCode: transferCode } : {}),
                    ...(payoutError && !payoutSuccess ? { payoutError, pendingManualPayout: true } : {}),
                });

                if (payoutSuccess) {
                    // Global Ledger Record (Unified Tracking)
                    const reference = transferCode || `WITHDRAW-${withdrawalId}`;
                    const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(reference);
                    transaction.set(globalTxRef, {
                        id: reference,
                        userId: withdrawalData.userId,
                        type: "withdrawal",
                        module: withdrawalRef.path.includes('cooperative') ? "cooperative" : "wallet",
                        amount: withdrawalData.amount,
                        currency: "NGN",
                        status: "completed",
                        date: FieldValue.serverTimestamp(),
                        reference,
                        description: `Withdrawal payout - ${withdrawalId}`
                    });
                }
            });
        } else {
            // Rejection — just update status atomically
            await db.runTransaction(async (transaction) => {
                const freshDoc = await transaction.get(withdrawalRef);
                if (!freshDoc.exists) throw new Error("Withdrawal request not found");
                transaction.update(withdrawalRef, {
                    status: "rejected",
                    processedBy: session.user.id,
                    processedAt: FieldValue.serverTimestamp(),
                    adminNotes: reasoning || "",
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });
        }

        // Create notification for user
        await createNotificationAction({
            userId: withdrawalData.userId,
            type: action === "approve" ? "success" : "warning",
            title: action === "approve" ? "Withdrawal Approved" : "Withdrawal Rejected",
            message: action === "approve"
                ? `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} has been approved and is being processed.`
                : `Your withdrawal request of ₦${withdrawalData.amount.toLocaleString()} was rejected. ${reasoning || ''}`,
            link: "/cooperatives",
            linkText: "View Dashboard",
        });

        // Log audit
        await createAdminAuditLog({
            action: action === "approve" ? "withdrawal_approve" : "withdrawal_reject",
            userId: session.user.id,
            targetId: withdrawalId,
            targetType: "withdrawal",
            metadata: { notes: reasoning },
        });

        try {
            await invalidateAdminGlobalStats();
        } catch (cacheError) {
            logger.error('[Process Withdrawal Stats] Cache clear error:', cacheError);
        }

        return {
            error: null,
            success: true as const,
            message: `Withdrawal ${action === "approve" ? "approved and payout initiated" : "rejected"} successfully`,
        };
    } catch (error: any) {
        logger.error("Process withdrawal error:", error);
        return { error: "Failed to process withdrawal", success: false as const };
    }
}

// ============================================
// Get Pending Withdrawals (Admin)
// ============================================

async function _getPendingWithdrawalsAction(
    limit = 50,
    lastCreatedAt?: Date | string,
    statusFilter: "pending" | "completed" | "rejected" | "approved_pending_payout" | "all" = "pending"
): Promise<ActionResponse<any[]>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user || !hasAdminPermission(session.user.roles, "finance:read")) {
            return { error: "Unauthorized: Permission required - finance:read", success: false as const, data: null };
        }

        // Helper to build a query per collection
        const buildQuery = (collectionName: string) => {
            return statusFilter === "all"
                ? db.collection(collectionName).orderBy("createdAt", "desc").limit(limit)
                : db.collection(collectionName)
                    .where("status", "==", statusFilter)
                    .orderBy("createdAt", "desc")
                    .limit(limit);
        };

        // Query standard withdrawals, cooperative_withdrawals AND wave_withdrawals
        const [stdSnap, coopSnap, waveSnap] = await Promise.all([
            buildQuery(COLLECTIONS.WITHDRAWALS).get(),
            buildQuery(COLLECTIONS.COOPERATIVE_WITHDRAWALS).get(),
            buildQuery(COLLECTIONS.WAVE_WITHDRAWALS).get(),
        ]);

        const toRecord = (doc: any, source: string) =>
            ({ ...serializeDoc(doc.id, doc.data()), source });

        const withdrawals = [
            ...stdSnap.docs.map(d => toRecord(d, "withdrawal")),
            ...coopSnap.docs.map(d => toRecord(d, "cooperative_withdrawal")),
            ...waveSnap.docs.map(d => toRecord(d, "wave_withdrawal")),
        ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, limit);

        // HYDRATION: Batch-resolve user bank details
        const userIds = [...new Set(withdrawals.map((w: any) => w.userId).filter(Boolean))];
        const userMap: Record<string, any> = {};

        if (userIds.length > 0) {
            const chunks = [];
            for (let i = 0; i < userIds.length; i += 30) {
                chunks.push(userIds.slice(i, i + 30));
            }

            const userSnapshots = await Promise.all(
                chunks.map(chunk => 
                    db.collection(COLLECTIONS.USERS)
                        .where(FieldPath.documentId(), "in", chunk)
                        .get()
                )
            );

            userSnapshots.forEach(snap => {
                snap.forEach(doc => {
                    const data = doc.data();
                    userMap[doc.id] = {
                        name: data.name || data.fullName || "Unknown",
                        email: data.email || "",
                        phone: data.phone || "",
                        bankDetails: {
                            bankName: data.bankName || data.bankAccount?.bankName || "",
                            accountNumber: data.bankAccountNumber || data.bankAccount?.accountNumber || "",
                            accountName: data.bankAccountName || data.bankAccount?.accountName || data.fullName || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : ""),
                            bankCode: data.bankCode || data.bankAccount?.bankCode || ""
                        }
                    };
                });
            });
        }

        const enrichedData = withdrawals.map((w: any) => ({
            ...w,
            user: userMap[w.userId] || null,
            // Standardize bankDetails at root for UI components
            bankDetails: userMap[w.userId]?.bankDetails || w.bankDetails || {
                bankName: w.bankName || "",
                accountNumber: w.bankAccountNumber || w.accountNumber || "",
                accountName: w.bankAccountName || w.accountName || (userMap[w.userId]?.name || ""),
                bankCode: w.bankCode || ""
            }
        }));

        return {
            error: null,
            success: true as const,
            data: enrichedData,
            hasMore: enrichedData.length === limit,
        };
    } catch (error: any) {
        logger.error("Get withdrawals error:", error);
        return { error: "Failed to fetch withdrawals", success: false as const, data: null };
    }
}

// --- SAFE ACTION WRAPPERS ---
export const processWithdrawalAction = withFlexibleSafeAction("processWithdrawalAction", _processWithdrawalAction);

export const getPendingWithdrawalsAction = withFlexibleSafeAction("getPendingWithdrawalsAction", _getPendingWithdrawalsAction);
