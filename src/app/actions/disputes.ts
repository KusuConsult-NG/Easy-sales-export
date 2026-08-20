/**
 * Server Actions for Dispute Resolution System
 */

"use server";

import { requireSession, isAdmin } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { creditWalletOnce } from "@/lib/wallet-ledger";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import type { Dispute, Order, DisputeReason, DisputeResolution } from "@/lib/types/marketplace";
import { hasRole } from "@/lib/role-utils";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { recordAdminAction } from "@/lib/audit-log";
import { FieldValue, Timestamp, FieldPath } from "@/lib/firestore-compat";
import { withFlexibleSafeAction } from "@/lib/safe-action";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { smsDisputeResolved } from "@/lib/africastalking";
import { pushDisputeResolved } from "@/lib/fcm";
import {
    ESCROW_FREEZABLE_STATUSES,
    ESCROW_RELEASABLE_FROM,
    ESCROW_REFUNDABLE_FROM,
    isActiveEscrowStatus,
    isFreezableEscrowStatus,
} from "@/lib/escrow-status";

function serializeTimestamp(ts: any): string | null {
    if (!ts) return null;
    if (typeof ts.toDate === "function") {
        return ts.toDate().toISOString();
    }
    const seconds = ts.seconds ?? ts._seconds;
    const nanoseconds = ts.nanoseconds ?? ts._nanoseconds;
    if (typeof seconds === "number") {
        return new Date(seconds * 1000 + Math.floor((nanoseconds || 0) / 1000000)).toISOString();
    }
    if (ts instanceof Date) {
        return ts.toISOString();
    }
    if (typeof ts === "string") {
        return ts;
    }
    if (typeof ts === "number") {
        return new Date(ts).toISOString();
    }
    return null;
}

function serializeDisputeDoc(docId: string, data: any): any {
    if (!data) return null;
    const timeline = Array.isArray(data.timeline)
        ? data.timeline.map((t: any) => ({
              ...t,
              timestamp: serializeTimestamp(t.timestamp)
          }))
        : [];
    return {
        ...data,
        id: docId,
        createdAt: serializeTimestamp(data.createdAt),
        updatedAt: serializeTimestamp(data.updatedAt),
        resolvedAt: serializeTimestamp(data.resolvedAt),
        timeline
    };
}


/**
 * Create a new dispute for an order
 */
async function _createDisputeAction(params: { orderId: string;
    reason: DisputeReason;
    description: string;
    evidenceUrls?: string[]; }) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const { orderId, reason, description, evidenceUrls = [] } = params;

        if (description.length < 50) { return { success: false as const, error: "Description must be at least 50 characters", data: null };
        }

        if (!evidenceUrls || evidenceUrls.length === 0) {
            return { success: false as const, error: "At least one image or document is required as evidence", data: null };
        }

        const orderDoc = await db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId).get();
        if (!orderDoc.exists) { return { success: false as const, error: "Order not found", data: null };
        }

        const order = orderDoc.data() as Order;
        if (order.buyerId !== userId) { return { success: false as const, error: "Not authorized", data: null };
        }

        if (order.status === "completed" || order.status === "cancelled") { return { success: false as const, error: "Cannot dispute completed or cancelled orders", data: null };
        }

        if (order.status === "pending_payment") { return { success: false as const, error: "Cannot dispute an unpaid order", data: null };
        }

        if (order.status === "disputed") { return { success: false as const, error: "Order already has an active dispute", data: null };
        }

        const existingDisputes = await db.collection(COLLECTIONS.DISPUTES)
            .where("orderId", "==", orderId)
            .where("status", "in", ["open", "under_review"])
            .get();

        if (!existingDisputes.empty) { return { success: false as const, error: "Active dispute already exists for this order", data: null };
        }

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();
        const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(orderId);

        // "Order already has an active dispute" was a check-then-write with no
        // lock: two disputes raised on one order both read a non-disputed
        // status and both created a DISPUTES row, leaving the order pointing at
        // whichever wrote its disputeId last and an orphan dispute nobody
        // resolves. Claiming the order's transition into "disputed" is what
        // makes that one dispute per order.
        const freshOrderDoc = await orderRef.get();
        if (!freshOrderDoc.exists) throw new Error("Order not found");
        const freshOrder = freshOrderDoc.data() as Order;

        const disputeClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.MARKETPLACE_ORDERS,
            id: orderId,
            fromAny: [
                "pending_payment", "payment_received", "confirmed",
                "processing", "shipped", "delivered",
            ],
            to: "disputed",
            patch: {
                disputeId: disputeRef.id,
                updatedAt: new Date().toISOString(),
            },
            // So the resolution path can put the order back where it came from
            // rather than guessing.
            recordPreviousAs: "statusBeforeDispute",
        });

        if (!disputeClaim.claimed) {
            throw new Error(disputeClaim.status === null
                ? "Order not found"
                : disputeClaim.status === "disputed"
                    ? "Order already has an active dispute"
                    : "Cannot dispute completed or cancelled orders");
        }

        /**
         * FREEZE THE MONEY, not just the order.
         *
         * THE DEFECT
         * ----------
         * This claimed the ORDER into "disputed" and never touched
         * ESCROW_TRANSACTIONS. The auto-release cron
         * (api/cron/release-escrow) selects escrows on
         *
         *     status == "funded" AND releaseRequestedAt <= threshold
         *
         * and its comment states the guard it relies on: "a buyer filing a
         * dispute moves the status off 'funded', and this then refuses to
         * release." That is true of the OTHER dispute path —
         * marketplace/_escrow_disputes.ts sets `status: "disputed"` on the escrow
         * — and it was false here.
         *
         * Both paths are live. /escrow/[id]/dispute uses the escrow-keyed one;
         * /dashboard/disputes/new uses this one. So a buyer who disputed from the
         * dashboard had the order marked disputed while the money stayed
         * releasable, and the cron paid the seller out from under an open
         * dispute.
         *
         * It then compounded: resolveDisputeAction claims the escrow from
         * ["funded", "disputed", "pending"], so once the cron had moved it to
         * "released" the dispute could not be resolved either — a refund decision
         * with no way to execute it.
         *
         * The escrow is located exactly as resolveDisputeAction locates it — by
         * orderId, taking the active row — so the two agree on which record the
         * money hangs off.
         */
        let escrowFrozen = false;
        let escrowAlreadySettled: string | null = null;

        try {
            const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
                .where("orderId", "==", orderId)
                .limit(10)
                .get();

            // EVERY active status, not three of them.
            //
            // This searched for `funded | disputed | pending` and froze only from
            // `"funded"`. An escrow at `in_transit` or `delivered` was not even
            // FOUND here, so a dispute raised after the goods shipped — or after
            // the buyer confirmed receipt, which is what moves an escrow to
            // "delivered" — froze nothing and recorded nothing.
            //
            // Both release paths (_escrow_actions.ts, order-management.ts) release
            // from "delivered". So the dispute existed, the escrow stayed
            // releasable, and the seller was paid anyway: the exact hole the
            // freeze was written to close, left open for two of the three
            // statuses a dispute can be raised from. See lib/escrow-status.ts.
            const activeEscrow = escrowQuery.docs.find(doc =>
                isActiveEscrowStatus(doc.data()?.status));

            if (activeEscrow) {
                const status = String(activeEscrow.data()?.status ?? "");

                if (isFreezableEscrowStatus(status)) {
                    const escrowClaim = await claimStatusTransitionFromAny({
                        collection: COLLECTIONS.ESCROW_TRANSACTIONS,
                        id: activeEscrow.id,
                        fromAny: [...ESCROW_FREEZABLE_STATUSES],
                        to: "disputed",
                        patch: {
                            disputeId: disputeRef.id,
                            disputedAt: new Date().toISOString(),
                        },
                    });
                    escrowFrozen = escrowClaim.claimed;

                    if (!escrowClaim.claimed) {
                        // It moved between the read and the claim. `released` here is
                        // the case that matters and is recorded below.
                        escrowAlreadySettled = escrowClaim.status ?? null;
                    }
                } else {
                    // `disputed` already — the other path got there first, which is
                    // fine. `pending` means the escrow was never funded, so there is
                    // nothing for the cron to release.
                    escrowFrozen = status === "disputed";
                }
            } else if (!escrowQuery.empty) {
                // Every escrow on this order is already released or refunded. The
                // dispute is still valid — a buyer may dispute a completed order —
                // but an admin resolving it cannot move money that has gone, and
                // must not discover that only when the refund fails.
                escrowAlreadySettled = String(escrowQuery.docs[0].data()?.status ?? "settled");
            }
        } catch (e) {
            logger.error("[createDispute] Could not freeze the escrow for the disputed order", {
                orderId,
                error: e instanceof Error ? e.message : String(e),
            });
        }

        {
            const disputeData: Partial<Dispute> = { orderId,
                buyerId: userId,
                sellerId: freshOrder.sellerId,
                reason,
                description,
                evidenceUrls,
                status: "open",
                _version: 0,
                // Recorded on the dispute so the admin resolving it knows whether
                // there is money left to move, before choosing a resolution.
                escrowFrozen,
                escrowAlreadySettled,
                createdAt: FieldValue.serverTimestamp() as any,
                updatedAt: FieldValue.serverTimestamp() as any };

            await disputeRef.set(disputeData);
            await orderRef.update({ _version: FieldValue.increment(1) });

            if (escrowAlreadySettled) {
                logger.warn(
                    `[createDispute] Dispute ${disputeRef.id} filed on order ${orderId} whose escrow ` +
                    `is already '${escrowAlreadySettled}'. The funds have left escrow; a refund ` +
                    `resolution cannot be executed against it.`
                );
            } else if (!escrowFrozen) {
                logger.warn(
                    `[createDispute] Dispute ${disputeRef.id} filed on order ${orderId} but no funded ` +
                    `escrow was frozen. Verify the auto-release cron cannot pay this out.`
                );
            }
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Create dispute error:", {
            userId: sessionResult?.session?.user?.id,
            orderId: params.orderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create dispute", data: null };
    }
}
export async function createDisputeAction(params: Parameters<typeof _createDisputeAction>[0]) {
    return withFlexibleSafeAction("createDisputeAction", _createDisputeAction)(params);
}

/**
 * Get buyer's disputes
 */
async function _getBuyerDisputesAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("buyerId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => serializeDisputeDoc(doc.id, doc.data())) as any[] as Dispute[];

        return { error: null, success: true as const, data: disputes };
    } catch (error) { logger.error("Get buyer disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes", data: null };
    }
}
export const getBuyerDisputesAction = withFlexibleSafeAction("getBuyerDisputesAction", _getBuyerDisputesAction);

/**
 * Get seller's disputes
 */
async function _getSellerDisputesAction() { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const snapshot = await db.collection(COLLECTIONS.DISPUTES)
            .where("sellerId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();

        const disputes: Dispute[] = snapshot.docs.map(doc => serializeDisputeDoc(doc.id, doc.data())) as any[] as Dispute[];

        return { error: null, success: true as const, data: disputes };
    } catch (error) { logger.error("Get seller disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes", data: null };
    }
}
export const getSellerDisputesAction = withFlexibleSafeAction("getSellerDisputesAction", _getSellerDisputesAction);

/**
 * Get all disputes (Admin only)
 */
async function _getAdminDisputesAction(options: { status?: "open" | "under_review" | "resolved" | "closed" | "all";
    escalated?: boolean;
    limit?: number;
    search?: string;
    lastDocId?: string;
    sortOrder?: "asc" | "desc"; } = {}) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        // A super_admin who does not also hold the plain 'admin' role was
        // refused here. hasRole is a literal includes(), so this is the same
        // lockout fixed in #115, #122 and #134 — and #122 fixed it in
        // assignDisputeAction, in this very codebase, while leaving these
        // siblings. The #138 ratchet did not catch them because it matches the
        // `roles.includes("admin")` spelling and these say `hasRole(...)`.
        //
        // Deliberately NOT switched to isAdmin(), which also admits moderator,
        // support and every module admin. Widening review moderation while
        // fixing a lockout would be a bad trade made quietly.
        //
        // Now asked of PERMISSION_MATRIX rather than by naming the two roles
        // here. "finance:resolve_disputes" is held by super_admin and admin and
        // nobody else, so the set is unchanged — but the eleven other lists
        // closed in #151 all ask the matrix, and a hand-written pair of role
        // names is how the same screen ends up gated two ways.
        const callerRoles = userData?.roles || [];
        if (!hasAdminPermission(callerRoles, "finance:resolve_disputes")) {
            return { success: false as const, error: "Not authorized as admin", data: null };
        }

        const fetchLimit = options.search ? 5000 : (options.limit || 50);
        const sortDirection = options.sortOrder || "desc";
        let queryRef = db.collection(COLLECTIONS.DISPUTES).orderBy("createdAt", sortDirection);

        if (options.status && options.status !== "all") { queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("status", "==", options.status)
                .orderBy("createdAt", sortDirection);
        }

        if (options.escalated !== undefined) { queryRef = db.collection(COLLECTIONS.DISPUTES)
                .where("escalated", "==", options.escalated)
                .orderBy("createdAt", sortDirection);
        }

        if (options.lastDocId) { const lastDoc = await db.collection(COLLECTIONS.DISPUTES).doc(options.lastDocId).get();
            if (lastDoc.exists) {
                queryRef = queryRef.startAfter(lastDoc);
            }
        }

        const snapshot = await queryRef.limit(fetchLimit).get();
        let disputes: (Dispute & { buyerDetails?: any; sellerDetails?: any })[] = snapshot.docs.map(doc => serializeDisputeDoc(doc.id, doc.data())) as any[];

        // 2. Batch fetch user profiles for bank details and contact info
        const participantIds = Array.from(new Set(disputes.flatMap((d: any) => [d.buyerId, d.sellerId].filter(Boolean))));
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

        // 3. Inject profiles into disputes
        disputes = disputes.map((d: any) => ({
            ...d,
            buyerDetails: d.buyerId ? userProfiles[d.buyerId] : null,
            sellerDetails: d.sellerId ? userProfiles[d.sellerId] : null
        }));

        if (options.search) { 
            const q = options.search.toLowerCase().trim();
            disputes = disputes.filter(d => {
                const searchString = [
                    d.id,
                    d.orderId,
                    d.reason,
                    d.description,
                    d.buyerDetails?.email,
                    d.sellerDetails?.email
                ].filter(Boolean).map(String).join(" ").toLowerCase();
                return searchString.includes(q);
            });
        }

        const nextCursor = snapshot.docs.length === fetchLimit ? snapshot.docs[snapshot.docs.length - 1].id : undefined;

        return { 
            success: true as const, 
            error: null, 
            data: disputes,
            disputes,
            lastDocId: nextCursor, 
            hasMore: !!nextCursor 
        };
    } catch (error) { logger.error("Get admin disputes error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch disputes for admin", data: null };
    }
}
export const getAdminDisputesAction = withFlexibleSafeAction("getAdminDisputesAction", _getAdminDisputesAction);

/**
 * Get single dispute by ID
 */
async function _getDisputeByIdAction(disputeId: string) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) { return { success: false as const, error: "Dispute not found", data: null };
        }

        const dispute = disputeDoc.data() as Dispute;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        const callerRoles = userData?.roles || [];
        // WHO SEES BANK DETAILS, AND WHO MERELY SEES THE DISPUTE.
        //
        // The admin arm was isAdmin(), true for all ten admin roles, where the
        // sibling getAdminDisputesAction requires admin or super_admin for the
        // very same fields. Matched to the sibling so one dispute cannot be read
        // two ways depending on which endpoint is asked.
        const isResolver = hasAdminPermission(callerRoles, "finance:resolve_disputes");
        const isAdminUser = isAdmin(callerRoles);
        const isBuyer = dispute.buyerId === userId;
        const isSeller = dispute.sellerId === userId;

        if (!isAdminUser && !isBuyer && !isSeller) { return { success: false as const, error: "Not authorized to view this dispute", data: null };
        }

        const disputeData: Dispute & { buyerDetails?: any; sellerDetails?: any } = serializeDisputeDoc(disputeDoc.id, dispute);

        /**
         * THE COUNTERPARTY'S BANK ACCOUNT IS NOT PART OF A DISPUTE.
         *
         * Both profile blocks below attached bankDetails — bank name, account
         * number, account name, bank code — unconditionally, to every caller the
         * check above admits. That includes the buyer and the seller. So filing
         * a dispute handed the buyer the seller's bank account number, and
         * handed the seller the buyer's.
         *
         * The details exist here for one reason: an admin resolving a dispute
         * may have to move money, and needs the destination. Nobody else does.
         * The parties keep the contact fields they need in order to be
         * identified in the dispute; the account numbers are attached only for a
         * caller who can actually resolve it.
         */
        const profileOf = (data: Record<string, any>) => {
            const profile: Record<string, unknown> = {
                firstName: data.firstName,
                lastName: data.lastName,
                email: data.email,
                phoneNumber: data.phoneNumber || data.phone || "N/A",
            };
            if (isResolver) {
                profile.bankDetails = data.bankDetails || {
                    bankName: data.bankName || data.bankAccount?.bankName || "N/A",
                    accountNumber: data.accountNumber || data.bankAccountNumber || data.bankAccount?.accountNumber || "N/A",
                    accountName: data.accountName || data.bankAccountName || data.bankAccount?.accountName || "N/A",
                    bankCode: data.bankCode || data.bankAccount?.bankCode || "N/A",
                };
            }
            return profile;
        };

        // Fetch profiles for detail view
        if (dispute.buyerId) {
            const buyerDoc = await db.collection(COLLECTIONS.USERS).doc(dispute.buyerId).get();
            if (buyerDoc.exists) {
                disputeData.buyerDetails = profileOf(buyerDoc.data()!);
            }
        }

        if (dispute.sellerId) {
            const sellerDoc = await db.collection(COLLECTIONS.USERS).doc(dispute.sellerId).get();
            if (sellerDoc.exists) {
                disputeData.sellerDetails = profileOf(sellerDoc.data()!);
            }
        }

        return { success: true as const, error: null, data: { dispute: disputeData } };
    } catch (error) { logger.error("Get dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to fetch dispute details", data: null };
    }
}
export const getDisputeByIdAction = withFlexibleSafeAction("getDisputeByIdAction", _getDisputeByIdAction);

/**
 * Update dispute status and resolve (Admin only)
 */
async function _updateDisputeStatusAction(
    disputeId: string,
    resolution: DisputeResolution,
    adminNotes: string,
    refundAmount?: number
) { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const userData = userDoc.data();
        // A super_admin who does not also hold the plain 'admin' role was
        // refused here. hasRole is a literal includes(), so this is the same
        // lockout fixed in #115, #122 and #134 — and #122 fixed it in
        // assignDisputeAction, in this very codebase, while leaving these
        // siblings. The #138 ratchet did not catch them because it matches the
        // `roles.includes("admin")` spelling and these say `hasRole(...)`.
        //
        // Deliberately NOT switched to isAdmin(), which also admits moderator,
        // support and every module admin. Widening review moderation while
        // fixing a lockout would be a bad trade made quietly.
        //
        // Now asked of PERMISSION_MATRIX rather than by naming the two roles
        // here. "finance:resolve_disputes" is held by super_admin and admin and
        // nobody else, so the set is unchanged — but the eleven other lists
        // closed in #151 all ask the matrix, and a hand-written pair of role
        // names is how the same screen ends up gated two ways.
        const callerRoles = userData?.roles || [];
        if (!hasAdminPermission(callerRoles, "finance:resolve_disputes")) {
            return { success: false as const, error: "Not authorized as admin", data: null };
        }

        const disputeDoc = await db.collection(COLLECTIONS.DISPUTES).doc(disputeId).get();
        if (!disputeDoc.exists) { return { success: false as const, error: "Dispute not found", data: null };
        }

        const dispute = disputeDoc.data() as Dispute;

        if (dispute.status === "resolved" || dispute.status === "closed") { return { success: false as const, error: `Dispute is already '${dispute.status}'` };
        }

        // Query the active escrow transaction prior to transaction block
        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", dispute.orderId)
            .limit(10)
            .get();

        if (escrowQuery.empty) {
            return { success: false as const, error: "Associated escrow transaction not found for this dispute", data: null };
        }

        // Find the active escrow transaction — every active status.
        //
        // The same three-status list createDisputeAction used, and it has to stay
        // the same, or the freeze and the resolution attach to different rows.
        // Neither included "in_transit" or "delivered", so a dispute on a shipped
        // or received order was resolved against whichever escrow happened to be
        // first in the result set.
        const escrowDocSnap = escrowQuery.docs.find(doc =>
            isActiveEscrowStatus(doc.data()?.status)) || escrowQuery.docs[0];
        const escrowId = escrowDocSnap.id;
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);

        // WHAT WAS WRONG HERE
        // -------------------
        // Two status checks — the dispute's and the escrow's — read inside
        // runTransaction, which takes no lock, and the money moved off the back
        // of them. Two admins resolving one dispute together both read
        // "disputed"/"funded", both passed, and both credited the beneficiary's
        // wallet. The escrow paid out twice.
        //
        // The ESCROW transition is the one claimed, not the dispute's. It is
        // the record the money hangs off, it is shared with the release and
        // refund paths that were already fixed, and claiming it means those
        // paths and this one cannot both pay for the same escrow either.
        const freshDisputeDoc = await disputeRef.get();
        if (!freshDisputeDoc.exists) throw new Error("Dispute not found");

        const freshDispute = freshDisputeDoc.data() as Dispute;
        if (freshDispute.status === "resolved" || freshDispute.status === "closed") {
            throw new Error(`Dispute is already '${freshDispute.status}'`);
        }

        const freshEscrowDoc = await escrowRef.get();
        if (!freshEscrowDoc.exists) throw new Error("Escrow transaction not found");
        const freshEscrow = freshEscrowDoc.data();
        if (!freshEscrow) throw new Error("Escrow transaction data not found");

        const targetId = resolution === "release_seller" ? freshDispute.sellerId : freshDispute.buyerId;
        if (!targetId) throw new Error("Target beneficiary ID not found on dispute");

        const escrowAmount = freshEscrow.amount ?? dispute.refundAmount ?? freshDispute.refundAmount ?? 0;
        const finalEscrowStatus = resolution === "release_seller" ? "released" : "refunded";
        const nowIso = new Date().toISOString();

        // FOUR RESOLUTIONS, TWO OF THEM EXECUTED.
        //
        // DisputeResolution is "refund_buyer" | "release_seller" |
        // "partial_refund" | "no_action", and everything below treated it as a
        // binary: anything that was not "release_seller" refunded the buyer
        // `escrowAmount` — the WHOLE escrow.
        //
        // The admin dispute detail page offers "Partial Refund" and collects an
        // amount. That amount was written onto the dispute as `refundAmount`
        // and then ignored, so a ₦5,000 partial refund on a ₦50,000 order paid
        // out ₦50,000 and recorded ₦5,000 beside it. The other admin dispute
        // list calls this action with no refundAmount at all.
        //
        // A partial refund is now executed as what the words mean and as what
        // the escrow requires: the buyer is credited the stated amount and the
        // seller the remainder, so the escrow is fully disbursed and nothing is
        // stranded in a row marked "refunded".
        //
        // "no_action" is REFUSED rather than guessed at. It has no caller and
        // no defined execution — dismissing a dispute without moving money
        // leaves the escrow frozen at "disputed", and choosing between that and
        // a release is a decision for the owner, not one to make silently
        // inside a bug fix. Refusing is what the old code should have done
        // instead of refunding in full.
        if (resolution === "no_action") {
            return {
                success: false as const,
                error: "\"No action\" has no defined outcome for the escrow. Use release to seller, refund to buyer, or a partial refund.",
                data: null,
            };
        }

        let buyerShare = 0;
        if (resolution === "partial_refund") {
            const requested = Number(refundAmount);
            if (!Number.isFinite(requested) || requested <= 0) {
                return {
                    success: false as const,
                    error: "A partial refund needs a refund amount greater than zero.",
                    data: null,
                };
            }
            if (requested > escrowAmount) {
                return {
                    success: false as const,
                    error: `A partial refund cannot exceed the escrow amount of ₦${Number(escrowAmount).toLocaleString()}.`,
                    data: null,
                };
            }
            buyerShare = requested;
        }

        // The shared sets, and NOT from "pending".
        //
        // This claimed `["funded", "disputed", "pending"]` for both outcomes.
        // Two problems.
        //
        // "pending" means the escrow was never funded — no money reached the
        // platform — and both branches below credit a wallet with
        // `freshEscrow.amount`, which is written at creation regardless. So
        // resolving a dispute on an unfunded escrow paid out real money for a
        // payment that never happened.
        //
        // And it omitted "in_transit" and "delivered", so a dispute on a shipped
        // or received order could not be resolved at all — the admin got
        // "Cannot transition" on the only escrows a dispute is usually about,
        // since confirming receipt is what moves an escrow to "delivered".
        const resolvableFrom = resolution === "release_seller"
            ? ESCROW_RELEASABLE_FROM
            : ESCROW_REFUNDABLE_FROM;

        const escrowClaim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.ESCROW_TRANSACTIONS,
            id: escrowId,
            fromAny: [...resolvableFrom],
            to: finalEscrowStatus,
            patch: {
                releasedBy: userId,
                [resolution === "release_seller" ? "releasedAt" : "refundedAt"]: nowIso,
                updatedAt: nowIso,
            },
        });

        if (!escrowClaim.claimed) {
            throw new Error(escrowClaim.status === null
                ? "Escrow transaction not found"
                : `Escrow is already ${escrowClaim.status} and cannot be resolved.`);
        }

        {
            // Money first, now that exactly one caller is here. creditWalletOnce
            // keyed on the escrow id: the balance moves in SQL, and the
            // reference makes a second attempt a no-op even if the claim above
            // were somehow bypassed.
            //
            // status is NOT "completed" — this is money leaving escrow to a
            // user, not revenue arriving, and platform_revenue_totals() sums
            // completed rows.
            // What the beneficiary of the primary credit receives. For a
            // partial refund that is the stated amount, not the whole escrow.
            const primaryAmount = resolution === "partial_refund" ? buyerShare : escrowAmount;

            const credit = await creditWalletOnce({
                reference: `DISPUTE-RES-${disputeId}`,
                userId: targetId,
                amount: primaryAmount,
                paymentType: resolution === "release_seller" ? "dispute_payout" : "dispute_refund",
                source: "escrow",
                status: resolution === "release_seller" ? "disbursement" : "refund",
                metadata: { disputeId, escrowId, orderId: freshDispute.orderId },
            });

            // The remainder of a partial refund goes to the seller. Without it
            // the escrow is marked "refunded" while part of the money it held
            // belongs to nobody — the balance simply disappears.
            //
            // Its own reference, so the two credits claim independently and a
            // retry cannot double either.
            const sellerShare = resolution === "partial_refund"
                ? Number((escrowAmount - buyerShare).toFixed(2))
                : 0;

            if (sellerShare > 0 && freshDispute.sellerId) {
                await creditWalletOnce({
                    reference: `DISPUTE-RES-SELLER-${disputeId}`,
                    userId: freshDispute.sellerId,
                    amount: sellerShare,
                    paymentType: "dispute_payout",
                    source: "escrow",
                    status: "disbursement",
                    metadata: { disputeId, escrowId, orderId: freshDispute.orderId, partial: true },
                });
            } else if (sellerShare > 0) {
                logger.error(
                    `[resolveDisputeAction] Partial refund on dispute ${disputeId} leaves ` +
                    `₦${sellerShare} with no seller recorded on the dispute. Needs manual settlement.`
                );
            }

            const balanceAfter = credit.balance;
            const balanceBefore = credit.claimed ? balanceAfter - primaryAmount : balanceAfter;

            const updateData: Record<string, unknown> = { status: "resolved",
                resolution,
                adminId: userId,
                adminNotes,
                resolvedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) };

            if (refundAmount !== undefined) { updateData.refundAmount = refundAmount;
            }

            await disputeRef.update(updateData);

            if (freshDispute.orderId) { const orderRef = db.collection(COLLECTIONS.MARKETPLACE_ORDERS).doc(freshDispute.orderId);
                let newOrderStatus: string;

                if (resolution === "refund_buyer") {
                    newOrderStatus = "cancelled";
                } else if (resolution === "release_seller") { newOrderStatus = "completed";
                } else { newOrderStatus = "completed";
                }

                await orderRef.update({ status: newOrderStatus,
                    updatedAt: FieldValue.serverTimestamp(),
                    _version: FieldValue.increment(1) });
            }

            // Ledger rows last, and only for the caller that moved the money.
            if (credit.claimed) {
                // Record transaction in target's wallet_transactions history.
                // The id is derived from the dispute rather than auto-generated,
                // so a retry cannot leave two credit records for one resolution.
                const targetTxnId = `DISPUTE-RES-${disputeId}`;
                const targetTxnRef = db.collection(COLLECTIONS.WALLET_TRANSACTIONS).doc(targetTxnId);
                await targetTxnRef.set({
                    id: targetTxnId,
                    walletId: targetId,
                    userId: targetId,
                    type: resolution === "release_seller" ? "funding" : "refund",
                    // The amount CREDITED, which for a partial refund is the
                    // buyer's share rather than the whole escrow.
                    amount: primaryAmount,
                    balanceBefore,
                    balanceAfter,
                    reference: escrowId,
                    orderId: freshDispute.orderId || undefined,
                    description: `Dispute Resolution (${resolution}) for order #${freshDispute.orderId || disputeId}`,
                    status: "completed",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });

                // Write the global ledger record under DISPUTE-RES-${disputeId}
                const txId = `DISPUTE-RES-${disputeId}`;
                const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
                await txRef.set({
                    id: txId,
                    userId: targetId,
                    type: resolution === "release_seller" ? "dispute_payout" : "dispute_refund",
                    module: "escrow",
                    amount: primaryAmount,
                    currency: "NGN",
                    status: "completed",
                    date: FieldValue.serverTimestamp(),
                    reference: escrowId,
                    description: `Dispute Resolution (${resolution}) for "${freshEscrow.productName || 'Marketplace Order'}"`
                });
            } else {
                logger.warn("[resolveDisputeAction] wallet credit was already claimed; ledger rows left untouched", {
                    disputeId, escrowId, targetId,
                });
            }
        }

        /**
         * THE RESOLUTION LEFT NO ADMIN RECORD.
         *
         * This action moves escrow money to a buyer or a seller, closes the
         * dispute and completes or cancels the order — and wrote nothing to the
         * admin audit log. Its sibling in marketplace/_escrow_actions.ts records
         * a mere status edit; the one that decides who keeps the money did not.
         *
         * The #66 ratchet did not see it: it matches permission-gated writes,
         * and until #151 this action named its two roles by hand, so the ratchet
         * read it as ungated and skipped it. Putting the gate on the matrix is
         * what surfaced this.
         *
         * After the money, so the record describes a resolution that happened;
         * before the notifications, so a failed SMS cannot skip it.
         */
        await recordAdminAction({
            action: 'dispute_resolved',
            userId,
            targetId: disputeId,
            targetType: 'dispute',
            metadata: {
                resolution,
                escrowId,
                orderId: freshDispute.orderId,
                amount: escrowAmount,
                refundAmount: refundAmount ?? null,
                beneficiaryId: targetId,
            },
        });

        // Post-transaction notifications (non-fatal)
        try {
            if (dispute.buyerId && dispute.sellerId) {
                const buyerIdStr = dispute.buyerId;
                const sellerIdStr = dispute.sellerId;
                const [buyerDoc, sellerDoc] = await Promise.all([
                    db.collection(COLLECTIONS.USERS).doc(buyerIdStr).get(),
                    db.collection(COLLECTIONS.USERS).doc(sellerIdStr).get(),
                ]);
                const buyerPhone = buyerDoc.data()?.phone ?? buyerDoc.data()?.phoneNumber;
                const sellerPhone = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
                
                await Promise.allSettled([
                    buyerPhone ? smsDisputeResolved(buyerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
                    sellerPhone ? smsDisputeResolved(sellerPhone, dispute.orderId || disputeId, resolution) : Promise.resolve(),
                    pushDisputeResolved(buyerIdStr, sellerIdStr, dispute.orderId || disputeId)
                ]);
            }
        } catch (notifErr) {
            logger.error("Failed to send post-transaction notifications:", notifErr);
        }

        // Invalidate Cache
        try { await invalidateAdminGlobalStats();
        } catch (err) { logger.error("Cache invalidation failed after dispute resolution", err);
        }

        return { error: null, success: true as const, data: null };
    } catch (error) { logger.error("Update dispute error:", {
            disputeId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to update dispute status", data: null };
    }
}
export const updateDisputeStatusAction = withFlexibleSafeAction("updateDisputeStatusAction", _updateDisputeStatusAction);
