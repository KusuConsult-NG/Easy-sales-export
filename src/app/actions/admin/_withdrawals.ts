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
import { stripPii } from "@/lib/admin-pii";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";
import { requireAdmin } from "@/lib/require-admin";

/**
 * The first bank block that actually carries an account number.
 *
 * Every hydrator on this screen produces an object whether or not it found
 * anything, so a plain `a || b || c` chain always stops at the first one and
 * never reaches a populated fallback.
 */
function firstWithAccount(
    ...candidates: Array<Record<string, any> | null | undefined>
): Record<string, unknown> {
    for (const c of candidates) {
        if (c && String(c.accountNumber ?? "").trim() !== "") return c;
    }
    return candidates[candidates.length - 1] ?? {};
}

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
        const adminCheck = await requireAdmin("finance:process_withdrawals");
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

        // ONE WITHDRAWAL, TWO ADMIN SCREENS, TWO DIFFERENT OUTCOMES.
        //
        // This action pays through Paystack and writes a row to the global
        // TRANSACTIONS ledger. That is correct for a wallet withdrawal and
        // wrong for the other two collections it was reaching into, because
        // each of those has a dedicated action that does strictly more:
        //
        //   COOPERATIVE_WITHDRAWALS
        //     cooperative/_coop_admin_money.ts approveWithdrawalAction applies a
        //     24-hour pending hold, checks the admin's cooperative scope against
        //     the request (an IDOR guard this action has no equivalent of),
        //     decrements the member's lockedBalance, and writes the
        //     `withdrawal` row to COOPERATIVE_TRANSACTIONS that forensics.ts,
        //     getCooperativeStats and the member's own history all read.
        //
        //     Processed HERE instead, a cooperative withdrawal paid out and
        //     lockedBalance was never released — the amount stayed locked out
        //     of the member's savings permanently, with forensics still
        //     counting it as held and the ledger never recording that the money
        //     had left. The 24-hour hold and the scope check were skipped too.
        //
        //     It also pays the WRONG WAY. mark-withdrawal-completed's own
        //     comment records the cooperative flow as "pending → approved, with
        //     the payout made by hand", then marked completed once the bank
        //     transfer is done. Firing a Paystack transfer at a withdrawal whose
        //     settlement process is manual is how the same money goes out twice.
        //
        //   WAVE_WITHDRAWALS
        //     wave/_wv_admin_withdrawals.ts processWaveWithdrawalAction pays
        //     through Paystack too, but returns the request to `pending` when
        //     the transfer fails — the rollback an earlier pass added after a
        //     failed payout could be retried into a double payout. This action
        //     has no such rollback: a failed transfer here parks the row at
        //     approved_pending_payout instead.
        //
        // Both claim `from: "pending"`, so the two paths race on the same field
        // and which behaviour a member got depended on which screen an admin
        // happened to open. This action now owns WITHDRAWALS alone and refuses
        // the other two rather than half-completing them. It is the narrower
        // path being withdrawn, not a new one being invented: nothing in the UI
        // calls this action, and each module's own screen already does the whole
        // job.
        if (withdrawalCollection !== COLLECTIONS.WITHDRAWALS) {
            const owner = withdrawalCollection === COLLECTIONS.COOPERATIVE_WITHDRAWALS
                ? "the Cooperative admin screen, which releases the member's locked balance and records the ledger entry"
                : "the WAVE admin screen, which rolls the request back if the transfer fails";
            return {
                error: `This is not a wallet withdrawal. Process it from ${owner}.`,
                success: false as const,
            };
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
                const { paystackPayout, payoutReference } = await import("@/lib/paystack-transfer");

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
                        `Withdrawal payout - ${withdrawalId}`,
                        // Stable across retries of THIS withdrawal (#249), so a
                        // manual re-run cannot become a second transfer.
                        payoutReference("WITHDRAW", withdrawalId),
                        // #208 — the stored record, so its resolution stamp is
                        // checked. A member onboarded through the simulated
                        // verification has an account nobody confirmed.
                        userData,
                    );
                    payoutSuccess = payoutResult.success;
                    payoutError = payoutResult.error;
                    transferCode = payoutResult.transferCode;

                    // A duplicate reference is proof the first attempt went
                    // through — the payee HAS been paid. Recording it as an
                    // ordinary payout failure is what sends an admin back to
                    // pay them again (#249).
                    if (payoutResult.duplicate) {
                        payoutError = "Already transferred under this reference — verify with Paystack before retrying";
                    } else if (payoutResult.indeterminate) {
                        payoutError = `Payout outcome UNKNOWN (${payoutResult.error || "no response"}). `
                            + "The money may have moved — reconcile the reference with Paystack before retrying.";
                    }
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

        /**
         * "finance:read" is held by super_admin, admin, support,
         * cooperative_admin and marketplace_admin — five of the ten roles, and
         * this action returns the bank account of every withdrawer across the
         * standard, cooperative AND wave queues at once. Paying any of them
         * requires "finance:process_withdrawals": super_admin and admin.
         *
         * The counterpart list in wave/_wv_admin_withdrawals.ts was closed on
         * the same permission (#149) and the wallet queue before it (#92); this
         * one reads all three collections, so it was the widest of the three.
         * The rows stay visible to everyone with finance:read — amounts, status
         * and who requested — because reconciling a total does not need an
         * account number.
         */
        const maySeeBankDetails = hasAdminPermission(session.user.roles, "finance:process_withdrawals");

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
                    /**
                     * THE DESTINATION ACCOUNT WAS BLANK FOR HALF THE PLATFORM.
                     *
                     * This hydration was hand-written and read
                     * `bankAccountNumber` and `bankAccount.accountNumber` — and
                     * never `bankDetails`, the canonical block that
                     * marketplace/_mp_onboarding.ts and export/_ex_onboarding.ts
                     * are the sole writers of. So a marketplace seller or an
                     * export member requesting a withdrawal appeared in this
                     * queue with an empty account number, and the admin
                     * approving it had nothing to pay into.
                     *
                     * Worse, the empty object it produced is TRUTHY, so the
                     * `userMap[...] || w.bankDetails` fallback below never ran:
                     * the account the member typed onto their own withdrawal
                     * request was shadowed by the blank hydrated one.
                     *
                     * extractCanonicalUser is what wave/_wv_admin_withdrawals.ts
                     * and cooperative/_coop_admin_money.ts already use for the
                     * same field. This action was the last hand-written copy.
                     */
                    const canonical = extractCanonicalUser(data);
                    userMap[doc.id] = {
                        name: canonical.name,
                        email: canonical.email,
                        phone: canonical.phone,
                        ...(maySeeBankDetails ? { bankDetails: canonical.bankDetails } : {}),
                    };
                });
            });
        }

        const enrichedData = withdrawals.map((w: any) => ({
            // The withdrawal row itself carries bankAccountNumber, accountName
            // and bankCode at its root for the cooperative and WAVE queues, so
            // gating only the hydrated `bankDetails` block below would have left
            // the same values in the spread beside it.
            ...(maySeeBankDetails ? w : stripPii(w)),
            user: userMap[w.userId] || null,
            // Chosen on whether an account number is actually PRESENT, not on
            // whether an object is non-null: the hydrated block is always an
            // object, so `a || b` silently preferred a blank one over the
            // account the member typed onto the request itself.
            ...(maySeeBankDetails ? {
                bankDetails: firstWithAccount(
                    userMap[w.userId]?.bankDetails,
                    w.bankDetails,
                    {
                        bankName: w.bankName || "",
                        accountNumber: w.bankAccountNumber || w.accountNumber || "",
                        accountName: w.bankAccountName || w.accountName || (userMap[w.userId]?.name || ""),
                        bankCode: w.bankCode || ""
                    },
                ),
            } : {}),
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
