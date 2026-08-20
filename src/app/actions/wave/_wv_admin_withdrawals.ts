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
    // The union the admin screen can filter by. `approved_processing` and
    // `payout_dispatched_unconfirmed` are both states this file WRITES, and
    // neither was selectable — so a withdrawal stuck mid-payout, which is exactly
    // the one an admin needs to find, appeared only under "all".
    status?: "pending" | "processing" | "approved" | "approved_processing"
        | "approved_pending_payout" | "payout_dispatched_unconfirmed"
        | "completed" | "rejected" | "all";
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

        /**
         * Bank details go only to the callers who can pay a withdrawal out.
         *
         * This list hydrates every WAVE member's account number, account name
         * and bank code, and its gate was isAdmin() — true for all TEN admin
         * roles — while processWaveWithdrawalAction, the only thing this screen
         * does, requires "finance:process_withdrawals". Reader wider than
         * writer on the same rows, for the sixth time: the admin withdrawal
         * list, the marketplace escrow list, the farm-nation transaction list,
         * the farm-nation registrant list and the land verification queue were
         * each closed the same way.
         */
        const maySeeBankDetails = hasAdminPermission(session.user.roles, "finance:process_withdrawals");

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
            bankDetails: !maySeeBankDetails ? undefined : userMap[w.userId]?.bankDetails || {
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
 * Mirrors the outcome onto the WALLET_TRANSACTIONS row, without being able to fail
 * the action.
 *
 * WHY NON-FATAL
 * -------------
 * These updates ran after the status claim and after the balance restore, with no
 * catch, so a missing or unwritable mirror row threw from inside the try and the
 * admin was told the action failed — when the withdrawal had in fact been
 * rejected or completed and, for a rejection, the member's balance had already
 * been restored. Retrying then hit the claim and reported "Only pending
 * withdrawals can be rejected", which is true and completely unhelpful.
 *
 * The row can legitimately be absent: it is written by _withdrawEarningsAction,
 * which has been disabled, so any withdrawal created outside that path — or before
 * it wrote one — has no mirror. The withdrawal record is the authoritative one;
 * this is a copy for the wallet view.
 */
async function mirrorWithdrawalStatus(withdrawalId: string, status: string): Promise<void> {
    try {
        await db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(withdrawalId).update({
            status,
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (e) {
        logger.warn(
            `[WAVE:Withdrawal] Could not mirror status '${status}' onto wallet transaction ` +
            `${withdrawalId}; the withdrawal record itself is correct.`,
            { error: e instanceof Error ? e.message : String(e) }
        );
    }
}

/**
 * Returns a locked withdrawal to `pending`, so it can be retried.
 *
 * ONLY safe when nothing has been dispatched to Paystack. The caller tracks that;
 * see `payoutDispatched`.
 *
 * A compare-and-swap FROM `approved_processing`, not a blind write. The three
 * rollback sites each did `ref.update({ status: "pending" })` unconditionally,
 * which is the same shape as the writes the claim above replaced: if anything had
 * moved the record on — a `complete` from another admin, a second approval that
 * had already dispatched — this reopened it regardless, and reopening a
 * withdrawal is reopening a payment.
 *
 * A refused claim is logged rather than thrown: the caller is already returning an
 * error about the payout, and a rollback that could not apply because the record
 * moved on is information, not a second failure to report.
 */
async function returnWithdrawalToPending(
    ref: { id: string },
    reason: string,
    adminNotes?: string,
): Promise<void> {
    const claim = await claimStatusTransition({
        collection: COLLECTIONS.WAVE_WITHDRAWALS,
        id: ref.id,
        from: "approved_processing",
        to: "pending",
        patch: {
            payoutError: reason,
            adminNotes: (adminNotes ? adminNotes + " - " : "") + `Payout failed: ${reason}`,
            updatedAt: new Date().toISOString(),
        },
    });

    if (!claim.claimed) {
        logger.warn(
            `[WAVE:Payout] Could not return ${ref.id} to pending: it is now '${claim.status}'. ` +
            `Reason for the rollback was: ${reason}`
        );
    }
}


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

            await mirrorWithdrawalStatus(withdrawalId, "completed");
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

            await mirrorWithdrawalStatus(withdrawalId, "rejected");
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
        //
        /**
         * Whether the transfer has been handed to Paystack.
         *
         * THE DEFECT THIS EXISTS FOR
         * --------------------------
         * The catch at the bottom of this block reverted the withdrawal to
         * `pending` on ANY throw. But `paystackPayout` sits inside that block, and
         * so does the batch.commit() that records its success. So the sequence
         *
         *     payout succeeds  →  batch.commit() throws  →  catch  →  status: "pending"
         *
         * left the money gone and the request back in the queue, where an admin
         * could approve it again — a second Paystack transfer for one withdrawal.
         * The compare-and-swap above exists specifically to make double payouts
         * impossible, and the error handler undid it.
         *
         * Once this flag is set, the record is NEVER returned to a payable state.
         * A finalisation failure after a successful transfer is a reconciliation
         * problem for a human, not a retry.
         */
        let payoutDispatched = false;
        let dispatchedReference: string | null = null;

        try {
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(withdrawalData.userId).get();
            const userData = userDoc.data();

            /**
             * Bank details read through the canonical resolver.
             *
             * This read `userData.bankCode` — a TOP-LEVEL field that no WAVE path
             * writes. The application stores `bankDetails.bankCode`, and the admin
             * approval stores `bankDetails.bankCode` too; the only writers of the
             * top-level field are the legacy provisioning tool and the admin
             * correction screen.
             *
             * So for a member enrolled through the WAVE application the guard below
             * could not pass, and every automated payout returned "User bank
             * details missing" — the whole Paystack path unreachable for the people
             * it was built for.
             *
             * extractCanonicalUser is this file's own resolver: it is already
             * imported and already used, forty lines up, to build the bank details
             * shown in the admin LIST. The list could see the account and the
             * payout could not.
             */
            const canonical = extractCanonicalUser(userData ?? {});
            const accountNumber = canonical.bankDetails.accountNumber || userData?.bankAccountNumber || "";
            const bankCode = canonical.bankDetails.bankCode || "";
            const accountName = canonical.bankDetails.accountName || userData?.bankAccountName || canonical.name;

            if (!accountNumber || !bankCode) {
                // Returned to pending — nothing has been dispatched, so this is a
                // legitimate retry once the details are filled in. Named precisely,
                // because "missing bank details" was reported for an account number
                // that was present and a code that was stored elsewhere.
                const missing = [
                    !accountNumber ? "account number" : null,
                    !bankCode ? "bank code" : null,
                ].filter(Boolean).join(" and ");

                await returnWithdrawalToPending(
                    ref,
                    `User bank details incomplete: no ${missing} on record`,
                    adminNotes,
                );
                return { success: false as const, error: `Cannot pay out: no ${missing} on record for this member.` };
            }

            payoutDispatched = true;
            const payoutResult = await paystackPayout(
                 {
                     accountNumber,
                     bankCode,
                     accountName,
                 },
                 withdrawalData.amount,
                 `WAVE Withdrawal payout - ${withdrawalId}`
            );

            if (!payoutResult.success) {
                // Paystack answered, and the answer was no. Nothing left the
                // account, so returning it to pending is correct here.
                payoutDispatched = false;
                await returnWithdrawalToPending(ref, payoutResult.error ?? "unknown error", adminNotes);
                return { success: false as const, error: `Paystack payout failed: ${payoutResult.error}` };
            }

            dispatchedReference = payoutResult.reference ?? null;

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

            await batch.commit();

            // Mirrored after the commit, and non-fatal. It was inside the batch,
            // so a missing wallet row failed the whole commit — including the
            // record of a payout that had already been made.
            await mirrorWithdrawalStatus(withdrawalId, "completed");

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

            if (payoutDispatched) {
                /**
                 * The transfer was handed to Paystack and we do not know the
                 * outcome. This must NOT go back to pending.
                 *
                 * Reverting here is what turned a finalisation failure into a
                 * second transfer: the money may well have left, and an admin
                 * looking at a pending withdrawal would approve it again.
                 *
                 * Parked in a terminal state instead, naming what has to be
                 * checked. No status guard on this write on purpose — the record
                 * is in `approved_processing` and only this code path leaves it, so
                 * there is no competing writer, and refusing to record the parked
                 * state because of a status mismatch would be strictly worse than
                 * recording it.
                 */
                await ref.update({
                    status: "payout_dispatched_unconfirmed",
                    payoutError:
                        `Transfer was submitted to Paystack but the result could not be recorded: ` +
                        `${error?.message ?? String(error)}`,
                    payoutReference: dispatchedReference,
                    needsReconciliation: true,
                    needsReconciliationAt: FieldValue.serverTimestamp(),
                    adminNotes: (adminNotes ? adminNotes + " - " : "") +
                        "PAYOUT DISPATCHED, RESULT UNRECORDED — verify on Paystack before any retry.",
                    updatedAt: FieldValue.serverTimestamp(),
                }).catch(e => logger.error(`[WAVE:Payout] Failed to park ${withdrawalId} for reconciliation:`, e));

                logger.error(
                    `[WAVE:Payout] RECONCILE ${withdrawalId}: transfer submitted for ` +
                    `₦${withdrawalData.amount} to user ${withdrawalData.userId}, reference ` +
                    `${dispatchedReference ?? "unknown"}, but the completion could not be written. ` +
                    `Do NOT re-approve until checked against Paystack.`
                );

                return {
                    success: false as const,
                    error:
                        "The transfer was submitted but its result could not be recorded. This " +
                        "withdrawal has been held for reconciliation — check Paystack before retrying.",
                    data: null,
                };
            }

            // Nothing was dispatched, so a retry is safe.
            await returnWithdrawalToPending(ref, "Critical error before the transfer was submitted", adminNotes);
            return { success: false as const, error: "Critical payout failure. Status reverted to pending." , data: null };
        }

    } catch (error: any) {
        logger.error("Process WAVE withdrawal error:", error);
        return { success: false as const, error: error.message || "Failed to process withdrawal" , data: null };
    }
}


export const processWaveWithdrawalAction = withFlexibleSafeAction("processWaveWithdrawalAction", _processWaveWithdrawalAction);
