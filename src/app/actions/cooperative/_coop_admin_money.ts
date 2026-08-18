"use server";

import { dateRangeStart, dateRangeEnd } from "@/lib/date-utils";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";
import { FieldPath } from "@/lib/firestore-compat";
import { logAuditAction } from "@/lib/audit-log";
import { claimStatusTransition } from "@/lib/status-transition";
import { ActionResponse, withFlexibleSafeAction } from "@/lib/safe-action";
import {
    sendWithdrawalApprovedEmail,
    sendWithdrawalRejectedEmail
} from "@/lib/email-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { getAdminScope } from "@/lib/cooperative-admin-scope";
import { balanceFieldOf } from "@/lib/cooperative-member-balance";
import { createAdminAuditLog } from "@/lib/audit-log";
import { extractCanonicalUser } from "@/lib/canonical/normalizer";

// ============================================================================
// TRANSACTION MONITORING
// ============================================================================

async function _getAllTransactionsAction(options?: {
    type?: "all" | "contribution" | "withdrawal" | "loan" | "fixed_savings" | "membership_registration";
    status?: "all" | "pending" | "completed" | "failed";
    limit?: number;
    lastDocId?: string;
    search?: string;   // Search by user name, userId, description, or reference
    dateFrom?: string; // YYYY-MM-DD
    dateTo?: string;   // YYYY-MM-DD
}): Promise<ActionResponse<{ transactions: any[] }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        // Audit logging
        await createAdminAuditLog({
            userId: session.user.id,
            userEmail: session.user.email ?? "unknown",
            action: "FETCH_COOPERATIVE_TRANSACTIONS",
            targetType: "COOPERATIVE_TRANSACTIONS",
            details: JSON.stringify({ type: options?.type, status: options?.status })
        });

        const adminScope = await getAdminScope(session.user.id, roles);

        let q: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS);

        if (adminScope) {
            q = q.where("cooperativeId", "==", adminScope);
        }

        if (options?.type && options.type !== "all") {
            q = q.where("type", "==", options.type);
        } else {
            // "fixed_savings" is not a type anything writes — the ledger row is
            // `fixed_savings_lock`, which is also what forensics.ts reconciles
            // against. So every fixed savings plan was excluded from the admin
            // transactions list by a filter that looked like it included them.
            q = q.where("type", "in", ["contribution", "withdrawal", "loan", "fixed_savings_lock"]);
        }

        if (options?.status && options.status !== "all") {
            q = q.where("status", "==", options.status);
        }

        // Date range filters — must be added BEFORE orderBy() for Firestore compliance.
        // Firestore requires all where() on a field to precede orderBy() on that field.
        if (options?.dateFrom) {
            q = q.where("date", ">=", dateRangeStart(options.dateFrom));
        }
        if (options?.dateTo) {
            q = q.where("date", "<=", dateRangeEnd(options.dateTo));
        }

        q = q.orderBy("date", "desc");

        const fetchLimit = (options?.search || options?.dateFrom || options?.dateTo) ? 5000 : (options?.limit || 100);
        let query = q;

        if (options?.lastDocId && !options?.search && !options?.dateFrom && !options?.dateTo) {
            const lastDoc = await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        let snapshot;
        try {
            snapshot = await query.limit(fetchLimit + 1).get();
        } catch (error: any) {
            if (error.code === 9 || error.message?.includes("FAILED_PRECONDITION")) {
                logger.error("Firestore Index Missing for Cooperative Transactions:", error.message);
                return { 
                    success: false, 
                    error: "Administrative index is currently being provisioned. Please try again in 5 minutes.", 
                    data: null 
                };
            }
            throw error;
        }

        const hasMore = snapshot.docs.length > fetchLimit;
        const docs = hasMore ? snapshot.docs.slice(0, fetchLimit) : snapshot.docs;

        const rawDocs = docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // HYDRATION: Batch-resolve user profiles and bank details
        const userIds = [...new Set(rawDocs.map((d: any) => d.userId).filter(id => id && typeof id === 'string' && id.trim().length > 0))];
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
                    userMap[doc.id] = extractCanonicalUser(uData);
                });
            });
        }

        const transactions = rawDocs.map((raw: any) => {
            const dateVal = raw.date?.toDate ? raw.date.toDate() : (raw.date ? new Date(raw.date) : new Date());
            const canonical = userMap[raw.userId] || null;
            
            return {
                id: raw.id,
                userId: raw.userId || "",
                userName: canonical?.name || raw.userId || "Unknown",
                user: canonical,
                bankDetails: canonical?.bankDetails || {
                    bankName: raw.bankName || "",
                    accountNumber: raw.accountNumber || "",
                    accountName: raw.accountName || "",
                    bankCode: raw.bankCode || ""
                },
                type: raw.type || "unknown",
                amount: Number(raw.amount) || 0,
                status: raw.status || "unknown",
                date: dateVal.toISOString(),
                description: raw.description || raw.notes || raw.purpose || undefined,
                reference: raw.reference || raw.paymentReference || raw.id?.slice(0, 12) || undefined,
                metadata: raw,
            };
        });

        for (const tx of transactions) {
            if (tx.metadata) {
                tx.metadata = JSON.parse(JSON.stringify(tx.metadata, (_key, value) => {
                    if (value && typeof value === "object" && typeof value.toDate === "function") {
                        return value.toDate().toISOString();
                    }
                    if (value && typeof value === "object" && value._seconds !== undefined) {
                        return new Date(value._seconds * 1000).toISOString();
                    }
                    return value;
                }));
            }
        }

        // In-memory search filter (applied after user enrichment so userName is available)
        let finalTransactions = transactions;
        if (options?.search) {
            const s = options.search.toLowerCase().trim();
            finalTransactions = transactions.filter(tx => {
                const searchable = [
                    tx.userName,
                    tx.userId,
                    tx.description,
                    tx.reference,
                    tx.type,
                    tx.status
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchable.includes(s);
            });
        }

        const nextCursor = hasMore && docs.length > 0 ? docs[docs.length - 1].id : null;

        return { error: null, success: true as const, data: { transactions: finalTransactions }, meta: { hasMore, lastDocId: nextCursor } };
    } catch (error) {
        logger.error("Get all transactions error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch transactions", data: null };
    }
}

export const getAllTransactionsAction = withFlexibleSafeAction("getAllTransactionsAction", _getAllTransactionsAction);


// ============================================================================
// WITHDRAWAL MANAGEMENT (ADMIN)
// ============================================================================

/**
 * Approve Withdrawal
 * - Confirms the funds removal (already locked/debited)
 * - Decrements lockedBalance
 * - Updates status to approved
 */
export async function approveWithdrawalAction(
    withdrawalId: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, roles);

        // The status check below used to read "pending" and write "approved"
        // inside runTransaction, which takes no lock. This is the same defect
        // the wallet withdrawal state machine had, and it is worse here because
        // approval and rejection compete for the same field: an approve and a
        // reject arriving together both read "pending" and both proceeded, so
        // the member's locked funds were released AND refunded to savings.
        //
        // The transition is claimed now, so exactly one of them wins.
        const notificationData = await (async () => {
            const withdrawalDoc = await withdrawalRef.get();
            if (!withdrawalDoc.exists) {
                throw new Error("Withdrawal request not found");
            }

            // Narrowed once, here, rather than left ambiguous.
            //
            // The code below mixed `withdrawalData?.field` with
            // `withdrawalData.field` on the same value — optional access for
            // the IDOR check, direct access for the userId and amount that
            // decide whose money moves. That inconsistency is the author not
            // being sure, and with strict null checks off the compiler could
            // not say. A missing document here would have thrown
            // "Cannot read properties of undefined" mid-way through a
            // withdrawal, after the exists check had already passed.
            const withdrawalData = withdrawalDoc.data();
            if (!withdrawalData) {
                throw new Error("Withdrawal request has no data");
            }

            // 🔒 Prevent IDOR on Approval
            if (adminScope && withdrawalData?.cooperativeId && withdrawalData.cooperativeId !== adminScope) {
                throw new Error("Unauthorized: Cannot approve withdrawal for another cooperative");
            }

            const requestTime = withdrawalData?.requestedAt || withdrawalData?.createdAt;
            const requestDate = requestTime && typeof (requestTime as any).toDate === "function"
                ? (requestTime as any).toDate()
                : (requestTime ? new Date(requestTime) : new Date());

            const durationMs = Date.now() - requestDate.getTime();
            const durationHours = durationMs / (1000 * 60 * 60);

            if (durationHours < 24) {
                throw new Error(`Withdrawals require a 24-hour pending hold. Please wait ${Math.ceil(24 - durationHours)} more hours.`);
            }

            const userId = withdrawalData.userId;
            const amount = withdrawalData.amount;

            // Claim BEFORE the balance moves. A crash between the two leaves the
            // request approved with the funds still locked — visible to an admin
            // and correctable. Releasing first and claiming second would let a
            // lost claim release the same funds twice.
            const nowIso = new Date().toISOString();
            const claim = await claimStatusTransition({
                collection: COLLECTIONS.COOPERATIVE_WITHDRAWALS,
                id: withdrawalId,
                from: "pending",
                to: "approved",
                patch: {
                    approvedBy: adminId,
                    approvedAt: nowIso,
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Withdrawal request not found"
                    : `Request is already ${claim.status}`);
            }

            // Fetch user for details
            let email = "";
            let name = "Member";

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (userDoc.exists) {
                email = userDoc.data()?.email || "";
                name = userDoc.data()?.fullName || "Member";
            }

            const coopMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const coopMemberDoc = await coopMemberRef.get();

            if (coopMemberDoc.exists) {
                await coopMemberRef.update({
                    lockedBalance: FieldValue.increment(-amount),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                if (withdrawalData.cooperativeId) {
                    const nestedMemberRef = db
                        .collection(COLLECTIONS.COOPERATIVES)
                        .doc(withdrawalData.cooperativeId)
                        .collection("members")
                        .doc(userId);

                    const nestedDoc = await nestedMemberRef.get();
                    if (nestedDoc.exists) {
                        await nestedMemberRef.update({
                            lockedBalance: FieldValue.increment(-amount),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
                }
            }

            // THE MONEY LEFT AND THE LEDGER NEVER RECORDED IT.
            //
            // NOTHING in this codebase writes a `withdrawal` row to
            // cooperative_transactions. Every writer of that collection produces
            // contribution, membership_registration, fixed_savings_lock or
            // deposit — and three separate readers depend on a withdrawal row
            // that was never there:
            //
            //   forensics.ts        DEBIT_TYPES = ["withdrawal",
            //                       "fixed_savings_lock"]. It reconciles
            //                       savingsBalance + lockedBalance against the
            //                       ledger. At request time the debit moves
            //                       savings into lockedBalance so the sum is
            //                       unchanged and reconciliation holds — but
            //                       HERE, on approval, lockedBalance drops with
            //                       nothing accounting for it. Every member who
            //                       has completed a withdrawal reported a
            //                       permanent balance mismatch, correctly,
            //                       because the ledger genuinely did not account
            //                       for the money. That is the same defect the
            //                       fixed-savings pass fixed for its own rows:
            //                       "a reconciliation check that always fails
            //                       for a whole class of member is a check
            //                       nobody reads".
            //
            //   getCooperativeStats `else if (t.type === "withdrawal")
            //                       totalSavings -= amount` — a branch that
            //                       never fired, so the admin dashboard reported
            //                       the cooperative still holding money it had
            //                       paid out.
            //
            //   the member history  its "Withdrawals" filter returned nothing.
            //
            // Written here rather than at request time because this is the point
            // the money actually leaves: a rejection puts it back, and a pending
            // request is still the member's. Keyed on the withdrawal id so a
            // retry overwrites rather than duplicates, as the fixed-savings row
            // is keyed on its plan id.
            const ledgerReference = `coopwd_${withdrawalId}`;
            await db.collection(COLLECTIONS.COOPERATIVE_TRANSACTIONS).doc(ledgerReference).set({
                id: ledgerReference,
                userId,
                cooperativeId: withdrawalData.cooperativeId || "default",
                type: "withdrawal",
                amount,
                currency: "NGN",
                reference: ledgerReference,
                description: "Cooperative savings withdrawal",
                status: "completed",
                date: FieldValue.serverTimestamp(),
            });

            return { email, name, amount, userId };
        })();

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            if (notificationData) {
                await Promise.allSettled([
                    logAuditAction({
                        userId: adminId,
                        action: "APPROVE_WITHDRAWAL",
                        details: `Approved withdrawal of ₦${notificationData.amount} for user ${notificationData.email}`,
                        metadata: { withdrawalId, amount: notificationData.amount }
                    }),
                    notificationData.email ? sendWithdrawalApprovedEmail(
                        notificationData.email,
                        notificationData.name,
                        notificationData.amount,
                        withdrawalId
                    ) : Promise.resolve()
                ]);
            }
        } catch (sideEffectError) {
            logger.error("[approveWithdrawalAction] Post-commit side effects failed:", sideEffectError);
        }

        return { error: null, success: true as const, data: null, meta: null };

    } catch (error: any) {
        logger.error("Approve withdrawal error:", error);
        return { success: false as const, error: (error as any).message || "Failed to approve withdrawal", data: null };
    }
}


/**
 * Reject Withdrawal
 * - REFUNDS the funds: Increment savingsBalance, Decrement lockedBalance
 * - Updates status to rejected
 */
export async function rejectWithdrawalAction(
    withdrawalId: string,
    reason: string
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Unauthorized", data: null };
        }

        let roles = session.user.roles;
        if (!isAdmin(roles)) {
            const liveUserDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
            const liveRoles = liveUserDoc.data()?.roles;
            if (isAdmin(liveRoles)) {
                roles = liveRoles;
            } else {
                return { success: false as const, error: "Unauthorized", data: null };
            }
        }

        const adminId = session.user.id;
        const withdrawalRef = db.collection(COLLECTIONS.COOPERATIVE_WITHDRAWALS).doc(withdrawalId);

        const adminScope = await getAdminScope(adminId, roles);

        // This one REFUNDS, which makes the unguarded check-then-write worse
        // than on the approval side. The status was read, compared to
        // "pending", and the refund written — inside runTransaction, which
        // takes no lock. Two rejections of one request both passed and both
        // credited savingsBalance: the member's savings grew by twice what was
        // ever withdrawn. Migration 010 made that reliable rather than lossy —
        // before it, one of the two increments was silently dropped, which
        // accidentally hid the double refund.
        //
        // The transition is claimed now, and claimed BEFORE the money moves: a
        // crash between the two leaves the request rejected with the funds
        // still locked, which an admin can see and correct. Refunding first
        // would let a lost claim refund twice — the exact bug.
        const notificationData = await (async () => {
            const withdrawalDoc = await withdrawalRef.get();
            if (!withdrawalDoc.exists) {
                throw new Error("Withdrawal request not found");
            }

            // Narrowed once, here, rather than left ambiguous.
            //
            // The code below mixed `withdrawalData?.field` with
            // `withdrawalData.field` on the same value — optional access for
            // the IDOR check, direct access for the userId and amount that
            // decide whose money moves. That inconsistency is the author not
            // being sure, and with strict null checks off the compiler could
            // not say. A missing document here would have thrown
            // "Cannot read properties of undefined" mid-way through a
            // withdrawal, after the exists check had already passed.
            const withdrawalData = withdrawalDoc.data();
            if (!withdrawalData) {
                throw new Error("Withdrawal request has no data");
            }

            // 🔒 Prevent IDOR on Rejection
            if (adminScope && withdrawalData?.cooperativeId && withdrawalData.cooperativeId !== adminScope) {
                throw new Error("Unauthorized: Cannot reject withdrawal for another cooperative");
            }

            const userId = withdrawalData.userId;
            const amount = withdrawalData.amount;

            const nowIso = new Date().toISOString();
            const claim = await claimStatusTransition({
                collection: COLLECTIONS.COOPERATIVE_WITHDRAWALS,
                id: withdrawalId,
                from: "pending",
                to: "rejected",
                patch: {
                    rejectionReason: reason,
                    rejectedBy: adminId,
                    rejectedAt: nowIso,
                    updatedAt: nowIso,
                },
            });

            if (!claim.claimed) {
                throw new Error(claim.status === null
                    ? "Withdrawal request not found"
                    : `Request is already ${claim.status}`);
            }

            // Fetch user for details
            let email = "";
            let name = "Member";

            const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
            if (userDoc.exists) {
                email = userDoc.data()?.email || "";
                name = userDoc.data()?.fullName || "Member";
            }

            const coopMemberRef = db.collection(COLLECTIONS.COOPERATIVE_MEMBERS).doc(userId);
            const coopMemberDoc = await coopMemberRef.get();

            if (coopMemberDoc.exists) {
                await coopMemberRef.update({
                    savingsBalance: FieldValue.increment(amount),
                    lockedBalance: FieldValue.increment(-amount),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else {
                if (withdrawalData.cooperativeId) {
                    const nestedMemberRef = db
                        .collection(COLLECTIONS.COOPERATIVES)
                        .doc(withdrawalData.cooperativeId)
                        .collection("members")
                        .doc(userId);

                    const nestedDoc = await nestedMemberRef.get();
                    if (nestedDoc.exists) {
                        // Refunded `balance` while the branch above refunds
                        // `savingsBalance`, and cron/release-escrow credits
                        // `savingsBalance` on this very same document. One
                        // member's savings under two names, with the writers
                        // split between them — the refund goes to whichever
                        // field the document actually carries. See
                        // lib/cooperative-member-balance.ts.
                        await nestedMemberRef.update({
                            [balanceFieldOf(nestedDoc.data())]: FieldValue.increment(amount),
                            lockedBalance: FieldValue.increment(-amount),
                            updatedAt: FieldValue.serverTimestamp(),
                        });
                    }
                }
            }

            return { email, name, amount, userId };
        })();

        // 🚀 POST-COMMIT SIDE EFFECTS (Non-blocking)
        try {
            if (notificationData) {
                await Promise.allSettled([
                    logAuditAction({
                        userId: adminId,
                        action: "REJECT_WITHDRAWAL",
                        details: `Rejected withdrawal of ₦${notificationData.amount} for user ${notificationData.userId}. Reason: ${reason}`,
                        metadata: { withdrawalId, amount: notificationData.amount, reason }
                    }),
                    notificationData.email ? sendWithdrawalRejectedEmail(
                        notificationData.email,
                        notificationData.name,
                        notificationData.amount,
                        reason
                    ) : Promise.resolve()
                ]);
            }
        } catch (sideEffectError) {
            logger.error("[rejectWithdrawalAction] Post-commit side effects failed:", sideEffectError);
        }

        return { error: null, success: true as const, data: null, meta: null };

    } catch (error: any) {
        logger.error("Reject withdrawal error:", error);
        return { success: false as const, error: (error as any).message || "Failed to reject withdrawal", data: null };
    }
}
