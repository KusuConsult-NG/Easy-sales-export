"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { creditWalletOnce } from "@/lib/wallet-ledger";
import { z } from "zod";
import type { EscrowStatus, EscrowTransaction } from "@/types/escrow";
import { FieldValue, Timestamp, FieldPath } from "@/lib/firestore-compat";
import { createAdminAuditLog } from "@/lib/audit-log";
import { createNotificationAction } from "@/app/actions/notifications";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { serializeValue, serializeDocs } from "@/lib/firestore-serialize";
import { smsEscrowReleased } from "@/lib/africastalking";
import { pushEscrowReleased } from "@/lib/fcm";
import { isAdmin } from "@/lib/admin-permissions";

// Validation schemas
const escrowAmountSchema = z.number().min(100).max(100000000); // ₦100 to ₦100M
const escrowStatusSchema = z.enum(["pending", "funded", "in_transit", "delivered", "released", "refunded", "disputed", "cancelled"]);

/**
 * Get user's escrow transactions
 */
async function _getUserEscrowTransactions() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Query transactions where user is participant (buyer OR seller)
        const snapshot = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("participants", "array-contains", userId)
            .orderBy("createdAt", "desc")
            .get();

        const transactions = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                ...serializeValue(data),
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                paidAt: data.paidAt ? (data.paidAt as Timestamp).toDate().toISOString() : null,
                releasedAt: data.releasedAt ? (data.releasedAt as Timestamp).toDate().toISOString() : null,
                refundedAt: data.refundedAt ? (data.refundedAt as Timestamp).toDate().toISOString() : null,
                releaseRequestedAt: data.releaseRequestedAt ? (data.releaseRequestedAt as Timestamp).toDate().toISOString() : null };
        });

        return { success: true as const, error: null, data: { transactions: transactions as any as EscrowTransaction[] } };
    } catch (error: any) { logger.error("Get escrow transactions error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getUserEscrowTransactions = withFlexibleSafeAction("getUserEscrowTransactions", _getUserEscrowTransactions);

/**
 * Get ALL escrow transactions (Admin only)
 * Used by the admin escrow management dashboard.
 */
async function _getAllEscrowTransactionsAdmin(options: { status?: EscrowStatus;
    limit?: number;
    lastDocId?: string;
    search?: string;
    sortOrder?: "asc" | "desc"; } = {}) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Live role re-validation
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];
        if (!isAdmin(callerRoles)) { return { success: false as const, error: "Admin access required", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
        const sortDirection = options.sortOrder || "desc";
        let q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS);

        if (options.status && (options.status as string) !== "all") { q = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("status", "==", options.status);
        }

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        q = q.limit(fetchLimit);
        const snapshot = await q.get();

        let transactions = snapshot.docs.map(doc => { const data = doc.data();
            return {
                id: doc.id,
                // DISEASE 5 FIX: serializeValue catches ALL Timestamp fields (including any
                // future ones like disputedAt, completedAt) — not just the named ones below
                ...serializeValue(data),
                createdAt: data.createdAt ? (data.createdAt as Timestamp).toDate().toISOString() : null,
                updatedAt: data.updatedAt ? (data.updatedAt as Timestamp).toDate().toISOString() : null,
                paidAt: data.paidAt ? (data.paidAt as Timestamp).toDate().toISOString() : null,
                releasedAt: data.releasedAt ? (data.releasedAt as Timestamp).toDate().toISOString() : null,
                refundedAt: data.refundedAt ? (data.refundedAt as Timestamp).toDate().toISOString() : null,
                releaseRequestedAt: data.releaseRequestedAt ? (data.releaseRequestedAt as Timestamp).toDate().toISOString() : null 
            } as any;
        });

        // Sort in memory to guarantee that corrupt or empty createdAt fields don't exclude documents from index
        transactions.sort((a: any, b: any) => {
            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return sortDirection === "desc" ? dateB - dateA : dateA - dateB;
        });

        // 2. Batch fetch user profiles for bank details and contact info
        const participantIds = Array.from(new Set(transactions.flatMap((t: any) => [t.buyerId, t.sellerId].filter(Boolean))));
        const userProfiles: Record<string, any> = {};

        if (participantIds.length > 0) {
            const userPromises = [];
            for (let i = 0; i < participantIds.length; i += 30) {
                const chunk = participantIds.slice(i, i + 30);
                if (chunk.length > 0) {
                    userPromises.push(db.collection(COLLECTIONS.USERS).where(FieldPath.documentId(), "in", chunk).get());
                }
            }
            const userSnapsArray = await Promise.all(userPromises);
            userSnapsArray.forEach(snap => snap.docs.forEach(doc => {
                const data = doc.data();
                userProfiles[doc.id] = {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    email: data.email,
                    phoneNumber: data.phoneNumber || data.phone || "N/A",
                    bankDetails: data.bankDetails || {
                        bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                        accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                        accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName || "N/A",
                        bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A"
                    }
                };
            }));
        }

        // 3. Inject profiles into transactions
        transactions = transactions.map((t: any) => ({
            ...t,
            buyerDetails: t.buyerId ? userProfiles[t.buyerId] : null,
            sellerDetails: t.sellerId ? userProfiles[t.sellerId] : null
        }));

        // Client-side search if specified
        if (options.search) { 
            const s = options.search.toLowerCase().trim();
            transactions = transactions.filter((t: any) => {
                const searchString = [
                    t.buyerEmail,
                    t.sellerEmail,
                    t.productName,
                    t.paymentReference,
                    t.buyerDetails?.email,
                    t.sellerDetails?.email,
                    t.buyerDetails?.phoneNumber,
                    t.sellerDetails?.phoneNumber,
                    t.buyerDetails?.firstName,
                    t.sellerDetails?.firstName
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(s);
            });
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            error: null, 
            data: { 
                transactions,
                lastDocId: nextCursor,
                hasMore: !!nextCursor
            } 
        };
    } catch (error: any) { logger.error("Get all escrow transactions admin error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const getAllEscrowTransactionsAdmin = withFlexibleSafeAction("getAllEscrowTransactionsAdmin", _getAllEscrowTransactionsAdmin);

/**
 * Update escrow status
 */
async function _updateEscrowStatus(
    transactionId: string,
    status: EscrowStatus
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        // Validate status
        escrowStatusSchema.parse(status);

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);

        await db.runTransaction(async (tx) => { const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;

            // Verify user is participant
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to update this transaction");
            }

            // Validate state transitions
            const currentStatus = txData.status;
            const validTransitions: Record<string, string[]> = { pending: ["funded", "cancelled"],
                funded: ["in_transit", "disputed", "cancelled"],
                in_transit: ["delivered", "disputed"],
                delivered: ["completed", "disputed"],
                completed: [],
                disputed: ["completed", "cancelled"],
                cancelled: [] };

            if (!validTransitions[currentStatus]?.includes(status)) {
                throw new Error(`Invalid status transition from ${currentStatus} to ${status}`);
            }

            if (
                (currentStatus === "disputed" || status === "completed") &&
                !isAdmin(session.user.roles)
            ) { throw new Error("Admin access required to perform this transition");
            }

            tx.update(txRef, {
                status,
                updatedAt: FieldValue.serverTimestamp(),
                [`${status}At`]: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        // Notifications
        const txDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId).get();
        if (txDoc.exists) { const txData = txDoc.data()!;
            const otherPartyId = txData.buyerId === userId ? txData.sellerId : txData.buyerId;
            const statusLabels: Record<string, string> = {
                funded: "Funded",
                in_transit: "In Transit",
                delivered: "Delivered",
                completed: "Completed",
                disputed: "Disputed",
                cancelled: "Cancelled" };
            await createNotificationAction({
                userId: otherPartyId,
                type: "escrow",
                title: `Escrow ${statusLabels[status] ?? status}`,
                message: `The escrow for "${txData.productName}" has been updated to status: ${statusLabels[status] ?? status}.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[updateEscrowStatus] Notification failed:", e));
        }

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Update escrow status error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });

        if (error instanceof z.ZodError) { return { success: false as const, error: "Invalid status value"};
        }

        return { success: false as const, error: error.message};
    }
}
export const updateEscrowStatus = withFlexibleSafeAction("updateEscrowStatus", _updateEscrowStatus);

/**
 * Create escrow dispute
 */
async function _createEscrowDispute(
    transactionId: string,
    reason: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;
        const userId = session.user.id;

        if (!reason.trim() || reason.length < 10 || reason.length > 1000) { return { success: false as const, error: "Dispute reason must be 10-1000 characters"};
        }

        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();

        await db.runTransaction(async (tx) => { const txDoc = await tx.get(txRef);
            if (!txDoc.exists) throw new Error("Transaction not found");

            const txData = txDoc.data()!;
            if (txData.buyerId !== userId && txData.sellerId !== userId) {
                throw new Error("Not authorized to dispute this transaction");
            }

            const disputeableStatuses = ["funded", "in_transit", "delivered"];
            if (!disputeableStatuses.includes(txData.status)) {
                throw new Error(`Cannot dispute transaction in ${txData.status} status`);
            }

            tx.set(disputeRef, { escrowId: transactionId,
                buyerId: txData.buyerId,
                sellerId: txData.sellerId,
                reason,
                description: reason,
                raisedBy: userId,
                status: "open",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: 0 });

            tx.update(txRef, { status: "disputed",
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Create escrow dispute error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message};
    }
}
export const createEscrowDispute = withFlexibleSafeAction("createEscrowDispute", _createEscrowDispute);

/**
 * Release escrow funds (Admin only)
 */
async function _releaseEscrowFunds(
    transactionId: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) { return { success: false as const, error: "Admin access required"};
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        const txDoc = await txRef.get();
        if (!txDoc.exists) return { success: false as const, error: "Transaction not found" };
        const data = txDoc.data()!;

        const escrowAmount = data.amount || data.grossAmount || 0;
        if (escrowAmount <= 0) return { success: false as const, error: "Invalid transaction amount" };

        const orderId = data.orderId;

        // The order's sibling escrows are deliberately NOT read here. A snapshot
        // taken before the claim answers "were they released before I started?",
        // which is the wrong question and is what left multi-seller orders stuck
        // at "delivered". The read happens after the claim, at step 5.

        // Claim the release before creating a payout or crediting anyone.
        //
        // The status check used to sit entirely OUTSIDE the transaction — a
        // plain read, followed by a blind write. Two admins releasing the same
        // escrow both passed it, and both created a payout instruction and
        // credited the seller.
        //
        // Release is valid from three states, so each is attempted in turn.
        // Once one wins the row holds "released" and every other attempt fails,
        // including a concurrent caller's.
        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: transactionId,
            fromAny: ["delivered", "disputed", "funded"],
            to: "released",
            patch: { releasedBy: userId, releasedAt: new Date().toISOString() },
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                error: claim.status === "released"
                    ? "Escrow already released"
                    : `Cannot release escrow in ${claim.status ?? "missing"} status.`,
            };
        }

        // Credit the seller through the ledger primitive, not by hand.
        //
        // This used to read the wallet and write a computed balance:
        //
        //     if (!walletSnap.exists) tx.set(walletRef, { balance: escrowAmount })
        //     else                    tx.update(walletRef, { balance: increment(...) })
        //
        // The increment branch is safe. The other one is not: two escrows for
        // the SAME seller released at the same time, before that seller has a
        // wallet row, both take it and both set the balance to their own amount.
        // Last write wins and one release is simply gone. db.runTransaction on
        // this adapter takes no lock and cannot roll back, so it does not help.
        //
        // credit_wallet_once does the whole thing in one statement —
        //     INSERT INTO wallets ... ON CONFLICT (id)
        //     DO UPDATE SET balance = wallets.balance + EXCLUDED.balance
        // — which is an upsert AND an increment, and it claims the reference in
        // processed_payments first so a repeat cannot pay twice.
        //
        // status is "disbursement", NOT "completed". platform_revenue_totals()
        // sums processed_payments rows whose status is 'completed', and an
        // escrow release is platform-held money going OUT to a seller. Recording
        // it as completed would have added every payout to reported revenue.
        const credit = await creditWalletOnce({
            reference: `escrow-release:${transactionId}`,
            userId: data.sellerId,
            amount: escrowAmount,
            paymentType: "escrow_release",
            source: "marketplace_escrow",
            status: "disbursement",
            metadata: { escrowId: transactionId, orderId, productName: data.productName ?? "" },
        });

        // claimed:false means an earlier attempt already credited this escrow.
        // That is success, not an error — the money is where it should be.
        const balanceAfter = credit.balance;
        const balanceBefore = credit.claimed ? balanceAfter - escrowAmount : balanceAfter;

        await db.runTransaction(async (tx) => {
            // Create payout instruction
            const paymentInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(paymentInstructionRef, {
                type: "escrow_release",
                escrowId: transactionId,
                recipientId: data.sellerId,
                recipientEmail: data.sellerEmail || "",
                amount: escrowAmount,
                status: "pending_admin_action",
                description: `Release escrow funds for ${data.productName}`,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: userId,
                _version: 0 });

            // 3. Record the credit in the seller's wallet_transactions history.
            //
            // The money itself moved above, through credit_wallet_once. This row
            // is the history entry, and its id is derived from the escrow rather
            // than random so that a retry overwrites it instead of showing the
            // seller the same payout twice.
            const sellerTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
                .doc(`escrow-release-${transactionId}`);
            tx.set(sellerTxnRef, {
                id: sellerTxnRef.id,
                walletId: data.sellerId,
                userId: data.sellerId,
                type: "funding",
                amount: escrowAmount,
                balanceBefore,
                balanceAfter,
                reference: transactionId,
                description: `Payout for order #${data.orderId} (Escrow released)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 4. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${transactionId}`;
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(globalTxRef, {
                id: txId,
                userId: data.sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: escrowAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: transactionId,
                description: `Escrow Payout for "${data.productName}"`
            });

            // 5. Update Order Status if all escrows for this order are released
            //
            // WHY THIS RE-READS INSTEAD OF USING orderEscrowsQuery
            // ----------------------------------------------------
            // orderEscrowsQuery is fetched near the top of this function, BEFORE
            // the release is claimed. Using it here asks "were the sibling
            // escrows released before I started?", which is not the question.
            //
            // On a multi-seller order with two escrows released at the same
            // time, both callers held a snapshot taken before either claim. Each
            // saw the other as unreleased, so NEITHER completed the order: every
            // seller was paid and the order sat at "delivered" indefinitely —
            // where disputes.ts still permits a dispute, because it only refuses
            // "completed" and "cancelled". An order whose sellers have all been
            // paid remaining disputable is the part that costs money.
            //
            // Re-reading after the claim closes it, and not only narrows it.
            // Each caller reads strictly after its own claim commits, so for any
            // two callers the later read follows both claims — whoever reads
            // last sees every release and completes the order.
            const freshEscrows = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .get();

            const allOthersReleased = freshEscrows.docs
                .filter(d => d.id !== transactionId)
                .every(d => d.data().status === "released");

            if (allOthersReleased) {
                const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);
                tx.update(orderRef, {
                    status: "completed",
                    paymentStatus: "paid_to_seller",
                    escrowReleased: true,
                    escrowReleasedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1)
                });
            }
        });

        await createAdminAuditLog({
            userId,
            action: 'escrow_released',
            targetId: transactionId,
            targetType: "escrow",
            metadata: { sellerId: data.sellerId, amount: escrowAmount }
        });

        await Promise.allSettled([
            createNotificationAction({
                userId: data.sellerId,
                type: "escrow",
                title: "Escrow Funds Released",
                message: `₦${escrowAmount.toLocaleString()} for "${data.productName}" has been released.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Details" }),
            createNotificationAction({
                userId: data.buyerId,
                type: "escrow",
                title: "Transaction Completed",
                message: `Escrow for "${data.productName}" completed and funds released.`,
                link: `/escrow/${transactionId}`,
                linkText: "View Details" }),
        ]).catch((e) => logger.error("[releaseEscrowFunds] Notifications failed:", e));

        // Send SMS & Push notifications
        const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(data.sellerId).get();
        const sellerPhone: string | undefined = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
        const orderRef = data.orderId;

        await Promise.allSettled([
            sellerPhone ? smsEscrowReleased(sellerPhone, orderRef, escrowAmount) : Promise.resolve(),
            pushEscrowReleased(data.sellerId, orderRef, escrowAmount, transactionId),
        ]).catch((e) => logger.error("[releaseEscrowFunds] SMS/Push notifications failed:", e));

        return { error: null,  success: true as const, data: null };
    } catch (error: any) { logger.error("Release escrow funds error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message};
    }
}
export const releaseEscrowFunds = withFlexibleSafeAction("releaseEscrowFunds", _releaseEscrowFunds);

/**
 * Refund escrow to buyer (Admin only)
 */
async function _refundEscrowToBuyer(
    transactionId: string
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        if (!isAdmin(session.user.roles)) { return { success: false as const, error: "Admin access required"};
        }

        const userId = session.user.id;
        const txRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(transactionId);
        let txData: any = null;
        let escrowAmount = 0;

        // Claim the refund before creating a refund instruction.
        //
        // The status check and the `refundedAt` guard both ran inside
        // runTransaction, which takes no lock, so two refunds issued at once
        // both passed and both created an instruction — refunding the buyer
        // twice out of the business's money.
        //
        // Moving to "refunded" is itself the guard: `refundedAt` was only ever
        // a second check on the same unlocked read.
        const preRefund = await txRef.get();
        if (!preRefund.exists) {
            return { success: false as const, error: "Transaction not found" };
        }

        escrowAmount = preRefund.data()?.amount || preRefund.data()?.grossAmount || 0;
        if (escrowAmount <= 0) {
            return { success: false as const, error: "Invalid transaction amount" };
        }

        const refundClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: transactionId,
            fromAny: ["funded", "in_transit", "disputed"],
            to: "refunded",
            patch: { refundedAt: new Date().toISOString(), refundedBy: userId },
        });

        if (!refundClaim.claimed) {
            return {
                success: false as const,
                error: refundClaim.status === "refunded"
                    ? "Escrow already refunded"
                    : `Cannot refund escrow in ${refundClaim.status ?? "missing"} status`,
            };
        }

        // Return the money through the ledger primitive — same reasoning as the
        // release path. The hand-rolled version set a computed balance whenever
        // the buyer had no wallet row yet, which loses one of two concurrent
        // refunds to the same buyer.
        //
        // status is "refund" so platform_revenue_totals() does not count money
        // going back to a buyer as income.
        const refundBuyerId = preRefund.data()?.buyerId;
        const refundCredit = await creditWalletOnce({
            reference: `escrow-refund:${transactionId}`,
            userId: refundBuyerId,
            amount: escrowAmount,
            paymentType: "escrow_refund",
            source: "marketplace_escrow",
            status: "refund",
            metadata: { escrowId: transactionId, orderId: preRefund.data()?.orderId ?? "" },
        });

        const refundBalanceAfter = refundCredit.balance;
        const refundBalanceBefore = refundCredit.claimed
            ? refundBalanceAfter - escrowAmount
            : refundBalanceAfter;

        await db.runTransaction(async (tx) => {
            const txDoc = await tx.get(txRef);
            const data = txDoc.data()!;

            txData = data;
            const refundInstructionRef = db.collection(COLLECTIONS.PAYMENT_INSTRUCTIONS).doc();
            tx.set(refundInstructionRef, {
                type: "escrow_refund",
                escrowId: transactionId,
                recipientId: data.buyerId,
                recipientEmail: data.buyerEmail,
                amount: escrowAmount,
                status: "pending_admin_action",
                description: `Refund escrow for ${data.productName}`,
                createdAt: FieldValue.serverTimestamp(),
                createdBy: userId,
                _version: 0 });

            // 1. Credit Buyer's Wallet directly
            // 2. Record the refund in the buyer's wallet_transactions history.
            //
            // As with the release path, the money moved through
            // credit_wallet_once above and this is the history entry, keyed on
            // the escrow so a retry cannot show the same refund twice.
            const buyerTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS)
                .doc(`escrow-refund-${transactionId}`);
            tx.set(buyerTxnRef, {
                id: buyerTxnRef.id,
                walletId: data.buyerId,
                userId: data.buyerId,
                type: "refund",
                amount: escrowAmount,
                balanceBefore: refundBalanceBefore,
                balanceAfter: refundBalanceAfter,
                reference: transactionId,
                description: `Refund for order #${data.orderId} (Escrow refunded)`,
                status: "completed",
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });

            // 3. Record in Global Ledger
            const globalTxId = `ESCROW-REFUND-${transactionId}`;
            const globalTxRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(globalTxId);
            tx.set(globalTxRef, {
                id: globalTxId,
                userId: data.buyerId,
                type: "escrow_refund",
                module: "escrow",
                amount: escrowAmount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: transactionId,
                description: `Escrow Refund for "${data.productName}"`
            });

            // 4. Update Escrow status
            tx.update(txRef, { status: "refunded",
                refundedAt: FieldValue.serverTimestamp(),
                refundedBy: userId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (txData) { await createAdminAuditLog({
                userId,
                action: 'escrow_refunded',
                targetId: transactionId,
                targetType: "escrow",
                metadata: { buyerId: txData.buyerId, amount: escrowAmount }
            });

            await Promise.allSettled([
                createNotificationAction({
                    userId: txData.buyerId,
                    type: "escrow",
                    title: "Escrow Refunded",
                    message: `Your escrow of ₦${escrowAmount.toLocaleString()} for "${txData.productName}" has been refunded.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
                createNotificationAction({
                    userId: txData.sellerId,
                    type: "escrow",
                    title: "Escrow Cancelled",
                    message: `The escrow for "${txData.productName}" has been cancelled and funds returned to buyer.`,
                    link: `/escrow/${transactionId}`,
                    linkText: "View Details" }),
            ]).catch((e) => logger.error("[refundEscrowToBuyer] Notifications failed:", e));
        }

        return { success: true as const, error: null, data: null };
    } catch (error: any) { logger.error("Refund escrow error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error.message, data: null };
    }
}
export const refundEscrowToBuyer = withFlexibleSafeAction("refundEscrowToBuyer", _refundEscrowToBuyer);

