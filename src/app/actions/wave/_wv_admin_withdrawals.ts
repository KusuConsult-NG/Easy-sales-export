"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { serializeDocs } from "@/lib/firestore-serialize";
import { FieldValue, FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { createAdminAuditLog } from "@/lib/audit-log";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { paystackPayout } from "@/lib/paystack-transfer";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";

async function _getStandardWaveWithdrawalsAction(options: {
    status?: "pending" | "processing" | "approved" | "approved_pending_payout" | "completed" | "rejected" | "all";
    limit?: number;
    lastDocId?: string;
    search?: string;
    sortOrder?: "asc" | "desc";
    dateFrom?: string;
    dateTo?: string;
} = {}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false as const, error: "Not authenticated" };

        if (!isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 25);
        const orderDirection = options.sortOrder || "desc";
        let q: any = db.collection(COLLECTIONS.WAVE_WITHDRAWALS);
        if (options.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        if (options.dateFrom) {
            const fromTs = dateRangeStart(options.dateFrom);
            q = q.where("requestedAt", ">=", fromTs);
        }
        if (options.dateTo) {
            const toTs = dateRangeEnd(options.dateTo);
            q = q.where("requestedAt", "<=", toTs);
        }

        q = q.orderBy("requestedAt", orderDirection);

        if (options.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }
        q = q.limit(fetchLimit + 1);

        const snapshot = await q.get();
        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const withdrawals = serializeDocs(docs);

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
                    const uData = doc.data();
                    const canonical = extractCanonicalUser(uData);
                    userMap[doc.id] = {
                        name: canonical.name,
                        email: canonical.email,
                        phone: canonical.phone,
                        bankDetails: canonical.bankDetails
                    };
                });
            });
        }

        let enrichedWithdrawals = withdrawals.map((w: any) => ({
            ...w,
            user: userMap[w.userId] || null,
            bankDetails: userMap[w.userId]?.bankDetails || {
                bankName: "",
                accountNumber: "",
                accountName: "",
                bankCode: ""
            }
        }));

        if (options.search) {
            const s = options.search.toLowerCase().trim();
            enrichedWithdrawals = enrichedWithdrawals.filter((w: any) => {
                const searchString = [
                    w.id,
                    w.userId,
                    w.user?.name,
                    w.user?.email,
                    w.user?.phone,
                    w.bankDetails?.bankName,
                    w.bankDetails?.accountNumber,
                    w.bankDetails?.accountName,
                    w.reference,
                    w.status,
                    w.type
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const limit = options.limit || 25;
        let page = 0;
        if ((options as any).page !== undefined) {
            page = Number((options as any).page);
        } else if (options.lastDocId && /^\d+$/.test(options.lastDocId)) {
            page = Number(options.lastDocId);
        }

        const offset = page * limit;
        const paged = options.search ? enrichedWithdrawals.slice(offset, offset + limit) : enrichedWithdrawals;
        const _hasMore = options.search 
            ? (offset + limit < enrichedWithdrawals.length) 
            : hasMore;
            
        const nextCursor = options.search 
            ? (_hasMore ? String(page + 1) : null)
            : (_hasMore && docs.length > 0 ? docs[docs.length - 1].id : undefined);

        return { 
            error: null, success: true as const, 
            data: paged,
            lastDocId: nextCursor,
            hasMore: _hasMore,
            meta: {
                totalFetched: enrichedWithdrawals.length,
                hasMore: _hasMore
            }
        };
    } catch (error) {
        logger.error("Get standard WAVE withdrawals error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch WAVE withdrawals" };
    }
}

export const getStandardWaveWithdrawalsAction = withFlexibleSafeAction("getStandardWaveWithdrawalsAction", _getStandardWaveWithdrawalsAction);


/**
 * processWaveWithdrawalAction
 * Standardized hardened action for processing WAVE withdrawals.
 * Handles approve (auto-payout via Paystack), reject, and complete actions.
 */
async function _processWaveWithdrawalAction(data: {
    withdrawalId: string;
    action: "approve" | "reject" | "complete";
    adminNotes?: string;
    transactionReference?: string;
}): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required" };
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles) || !hasAdminPermission(session.user.roles, "finance:process_withdrawals")) {
            return { success: false as const, error: "Unauthorized: finance:process_withdrawals permission required" };
        }

        const { withdrawalId, action, adminNotes, transactionReference } = data;
        const ref = db.collection(COLLECTIONS.WAVE_WITHDRAWALS).doc(withdrawalId);

        let withdrawalData: any = null;

        // PHASE 1: STATE TRANSITION
        //
        // This was labelled "ATOMIC STATE TRANSITION & LOCKING", and the approve
        // branch's own comment said "Lock for processing to prevent
        // double-payouts". Neither was true: every branch read the status,
        // compared it, and wrote — inside runTransaction, which takes no lock.
        //
        // Two of the three branches move money:
        //
        //   reject   restores waveEarningsBalance. Two rejections of one
        //            withdrawal both read "pending" and both restored it, so the
        //            member's earnings grew by the withdrawn amount twice.
        //   approve  moves the request into the state the automated payout runs
        //            from, so two approvals set up two payouts of one request.
        //
        // Each transition is claimed now, which is the locking the comment
        // promised. Claim FIRST, then move the balance: a crash between the two
        // leaves a rejected withdrawal whose funds have not been returned —
        // visible and correctable — where restoring first would let a lost
        // claim restore twice.
        const snap = await ref.get();
        if (!snap.exists) throw new Error("Withdrawal not found");
        withdrawalData = snap.data();

        const nowIso = new Date().toISOString();
        const userRef = db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId);
        const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);

        if (action === "complete") {
            const claim = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.WAVE_WITHDRAWALS,
                id: withdrawalId,
                fromAny: ["approved_pending_payout", "approved"],
                to: "completed",
                patch: {
                    completedBy: session.user.id,
                    completedAt: nowIso,
                    ...(adminNotes ? { adminNotes } : {}),
                    ...(transactionReference ? { transactionReference } : {}),
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Withdrawal not found"
                    : "Can only complete approved withdrawals");
            }

            // Clear the lock on user doc
            await userRef.update({
                'serviceRegistrations.wave.hasPendingWithdrawal': false,
                updatedAt: FieldValue.serverTimestamp()
            });

            await walletTxnRef.update({
                status: "completed",
                updatedAt: FieldValue.serverTimestamp()
            });
        } else if (action === "reject") {
            const claim = await claimStatusTransition({
                collection: COLLECTIONS.WAVE_WITHDRAWALS,
                id: withdrawalId,
                from: "pending",
                to: "rejected",
                patch: {
                    processedBy: session.user.id,
                    processedAt: nowIso,
                    ...(adminNotes ? { adminNotes } : {}),
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Withdrawal not found"
                    : "Only pending withdrawals can be rejected");
            }

            // Clear the lock on user doc AND restore the balance
            await userRef.update({
                'serviceRegistrations.wave.hasPendingWithdrawal': false,
                'serviceRegistrations.wave.waveEarningsBalance': FieldValue.increment(withdrawalData.amount),
                updatedAt: FieldValue.serverTimestamp()
            });

            await walletTxnRef.update({
                status: "rejected",
                updatedAt: FieldValue.serverTimestamp()
            });
        } else if (action === "approve") {
            // The real lock for processing, this time.
            const claim = await claimStatusTransition({
                collection: COLLECTIONS.WAVE_WITHDRAWALS,
                id: withdrawalId,
                from: "pending",
                to: "approved_processing",
                patch: {
                    processedBy: session.user.id,
                    processedAt: nowIso,
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + "Locking for automated payout...",
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Withdrawal not found"
                    : "Only pending withdrawals can be approved");
            }
        }

        // AUDIT LOG (First Phase)
        await createAdminAuditLog({
            userId: session.user.id,
            action: `wave_withdrawal_${action}` as any,
            targetId: withdrawalId,
            targetType: "wave_withdrawal",
            metadata: { action, adminNotes },
            details: `WAVE withdrawal ${action}ed by admin ${session.user.id}`,
        });

        if (action !== "approve") {
             // Invalidate cache for user
             if (withdrawalData?.userId) {
                 try {
                     const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                     await invalidateServiceCache(withdrawalData.userId, 'wave');
                 } catch (e) { }
             }
             return { error: null, success: true as const, data: null };
        }

        // PHASE 2: SIDE-EFFECT (PAYOUT)
        // If we reached here, the action is "approve" and the record is locked as 'approved_processing'
        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId).get();
            const userData = userDoc.data();
            if (!userData?.bankAccountNumber || !userData?.bankCode) {
                // Rollback to pending
                await ref.update({ 
                    status: "pending", 
                    payoutError: "User bank details not configured",
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + "Payout failed: Missing bank details.",
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: "User bank details missing" };
            }

            const payoutResult = await paystackPayout(
                 {
                     accountNumber: userData.bankAccountNumber,
                     bankCode: userData.bankCode,
                     accountName: userData.bankAccountName || userData.name,
                 },
                 withdrawalData.amount,
                 `WAVE Withdrawal payout - ${withdrawalId}`
            );

            if (!payoutResult.success) {
                // Rollback status to pending with error message
                await ref.update({ 
                    status: "pending", 
                    payoutError: payoutResult.error,
                    adminNotes: (adminNotes ? adminNotes + " - " : "") + `Payout failed: ${payoutResult.error}`,
                    updatedAt: FieldValue.serverTimestamp(),
                });
                return { success: false as const, error: `Paystack payout failed: ${payoutResult.error}` };
            }

            // PHASE 3: FINAL COMMIT
            // Payout succeeded! Mark as completed and clear user lock.
            const batch = db.batch();
            
            batch.update(ref, {
                status: "completed",
                completedBy: session.user.id,
                completedAt: FieldValue.serverTimestamp(),
                transactionReference: payoutResult.reference,
                adminNotes: (adminNotes ? adminNotes + " - " : "") + "Auto-paid via Paystack.",
                payoutError: null,
                updatedAt: FieldValue.serverTimestamp(),
            });

            // Clear the lock on user doc
            const userRef = db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId);
            batch.update(userRef, {
                'serviceRegistrations.wave.hasPendingWithdrawal': false,
                updatedAt: FieldValue.serverTimestamp()
            });

            // Update Wallet Transaction
            const walletTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId);
            batch.update(walletTxnRef, {
                status: "completed",
                updatedAt: FieldValue.serverTimestamp()
            });

            await batch.commit();

            // Invalidate cache
            if (withdrawalData?.userId) {
                try {
                    const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                    await invalidateServiceCache(withdrawalData.userId, 'wave');
                } catch (e) { }
            }

            return { error: null, success: true as const, data: null };

        } catch (error: any) {
            logger.error(`[WAVE:Payout] Critical error during payout for ${withdrawalId}:`, error);
            // Revert to pending so it can be re-tried
            await ref.update({ 
                status: "pending", 
                payoutError: "Critical error during payout side-effect",
                updatedAt: FieldValue.serverTimestamp(),
            }).catch(e => logger.error(`[WAVE:Rollback] Failed to rollback status for ${withdrawalId}:`, e));
            return { success: false as const, error: "Critical payout failure. Status reverted to pending." , data: null };
        }

    } catch (error: any) {
        logger.error("Process WAVE withdrawal error:", error);
        return { success: false as const, error: error.message || "Failed to process withdrawal" , data: null };
    }
}


export const processWaveWithdrawalAction = withFlexibleSafeAction("processWaveWithdrawalAction", _processWaveWithdrawalAction);
