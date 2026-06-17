"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminFinancialAction } from "@/lib/audit-log";
import { requireSession, isAdmin } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createNotificationAction } from "@/app/actions/notifications";
import { verifyPaystackPayment } from "@/lib/paystack-server";
import { smsEscrowReleased, smsDisputeResolved } from "@/lib/africastalking";
import { pushEscrowReleased, pushDisputeResolved } from "@/lib/fcm";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction } from "@/lib/safe-action";

/**
 * Marketplace Escrow System
 * Buyer → Escrow → Seller workflow with admin release
 *
 * All status-changing operations run inside Firestore transactions to prevent
 * race conditions. A plain .update() call is a last-write-wins operation; a
 * runTransaction() reads the current state and rejects the write if the
 * precondition is violated — turning a race condition into a clear error.
 */

export interface EscrowTransaction { id?: string;
    buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    grossAmount?: number;
    productName: string;
    productDescription: string;
    /** participants[] is required so getUserEscrowTransactions' array-contains query resolves correctly */
    participants: string[];
    status: "pending" | "funded" | "released" | "refunded" | "disputed";
    paymentReference?: string;
    createdAt: FieldValue | Timestamp;
    paidAt?: FieldValue | Timestamp;
    releasedAt?: FieldValue | Timestamp;
    refundedAt?: FieldValue | Timestamp;
    releaseRequestedAt?: FieldValue | Timestamp;
    releaseRequestedBy?: string;
    releasedBy?: string; }

export interface Dispute { id?: string;
    escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    reason: string;
    evidence: string[];
    status: "open" | "under_review" | "resolved" | "closed";
    resolution?: string;
    resolvedBy?: string;
    resolvedAt?: FieldValue | Timestamp;
    createdAt: FieldValue | Timestamp; }

export interface Message { id?: string;
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
    timestamp: FieldValue | Timestamp;
    read: boolean; }

/**
 * Create escrow transaction
 */
async function _createEscrowAction(data: { buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    productName: string;
    productDescription: string; }): Promise<{ success: true; error: null; data: { escrowId: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== data.buyerId) { return { success: false as const, error: "Unauthorized", data: null };
        }

        const escrow: Omit<EscrowTransaction, "id"> & { _version: number } = { ...data,
            participants: [data.buyerId, data.sellerId],
            status: "pending",
            _version: 0,
            createdAt: FieldValue.serverTimestamp() };

        const docRef = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).add(escrow);

        (async () => { try {
                await createAdminAuditLog({
                    action: "escrow_created",
                    userId: data.buyerId,
                    targetId: docRef.id,
                    targetType: "escrow_transaction",
                    metadata: {
                        amount: data.amount,
                        seller: data.sellerId,
                        product: data.productName } });

                await createNotificationAction({
                    userId: data.buyerId,
                    type: "escrow",
                    title: "Escrow Created",
                    message: `Your escrow for "${data.productName}" (₦${data.amount.toLocaleString()}) has been created. Please complete payment to secure the transaction.`,
                    link: `/escrow/${docRef.id}`,
                    linkText: "View Escrow" });

                await createNotificationAction({
                    userId: data.sellerId,
                    type: "escrow",
                    title: "New Escrow Transaction",
                    message: `A buyer has initiated a secured escrow for "${data.productName}" (₦${data.amount.toLocaleString()}). Funds will be held until delivery is confirmed.`,
                    link: `/escrow/${docRef.id}`,
                    linkText: "View Escrow" });
            } catch (sideEffectError) { logger.error("[createEscrowAction] Side effects failed:", sideEffectError);
            }
        })();

        return { error: null, success: true as const, data: { escrowId: docRef.id } };
    } catch (error) { logger.error("Escrow creation error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to create escrow transaction"};
    }
}
export const createEscrowAction = withFlexibleSafeAction("createEscrowAction", _createEscrowAction);

/**
 * Confirm payment and move to funded status.
 *
 * Runs inside a transaction to guard the state transition:
 * only `pending → funded` is valid.
 */
async function _confirmEscrowPaymentAction(
    escrowId: string,
    paymentReference: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession().catch(() => null);

        let paystackData: Awaited<ReturnType<typeof verifyPaystackPayment>>;
        try {
            paystackData = await verifyPaystackPayment(paymentReference);
        } catch (e: any) { logger.error("[confirmEscrowPayment] Paystack verification failed:", e);
            return { success: false as const, error: "Payment verification failed: " + (e.message ?? "Unknown error")};
        }

        if (paystackData.data.status !== "success") { return { success: false as const, error: `Payment not confirmed. Paystack status: '${paystackData.data.status}'. Please complete payment and try again.`
            };
        }

        const escrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowSnap.exists) return { success: false as const, error: "Escrow transaction not found"};

        const escrowDoc = escrowSnap.data() as EscrowTransaction;

        const paidAmountNaira = paystackData.data.amount / 100;
        const expectedAmount = escrowDoc.amount;

        if (Math.abs(paidAmountNaira - expectedAmount) > 1) {
            logger.warn(
                `[confirmEscrowPayment] Amount mismatch on ${escrowId}: expected ₦${expectedAmount}, got ₦${paidAmountNaira}`
            );
            return { success: false as const, error: `Payment amount mismatch. Expected ₦${expectedAmount.toLocaleString()}, received ₦${paidAmountNaira.toLocaleString()}.`
            };
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc2 = await tx.get(escrowRef);
            if (!escrowDoc2.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc2.data() as EscrowTransaction;
            if (data.status !== "pending") {
                throw new Error(
                    `Invalid state transition: expected 'pending', got '${data.status}'`
                );
            }

            escrowData = data;

            tx.update(escrowRef, { status: "funded",
                paymentReference,
                paidAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (escrowData) { const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "payment_completed",
                tx.buyerId,
                tx.amount,
                escrowId,
                { paymentReference, channel: paystackData.data.channel }
            );

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Payment Confirmed",
                message: `Your payment of ₦${tx.amount.toLocaleString()} for "${tx.productName}" has been secured in escrow.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[confirmEscrowPaymentAction] Buyer notification failed:", e));

            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funded",
                message: `Funds of ₦${tx.amount.toLocaleString()} for "${tx.productName}" have been secured in escrow. You can now proceed with delivery.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow" }).catch((e) => logger.error("[confirmEscrowPaymentAction] Seller notification failed:", e));
        }

        return { error: null, success: true as const, data: { message: "Payment confirmed" } };
    } catch (error) { logger.error("Payment confirmation error:", {
            escrowId,
            paymentReference,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to confirm payment"};
    }
}
export const confirmEscrowPaymentAction = withFlexibleSafeAction("confirmEscrowPaymentAction", _confirmEscrowPaymentAction);

/**
 * Seller requests escrow release.
 *
 * Runs inside a transaction: only a `funded` escrow belonging to this seller
 * can be marked for release.
 */
async function _requestEscrowReleaseAction(
    escrowId: string,
    sellerId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired"};
        }
        if (sessionResult.session.user.id !== sellerId) { return { success: false as const, error: "Unauthorized"};
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;

            if (data.sellerId !== sellerId) throw new Error("Unauthorized");
            if (data.status !== "funded") {
                throw new Error(
                    `Invalid state transition: expected 'funded', got '${data.status}'`
                );
            }

            escrowData = data;

            tx.update(escrowRef, { releaseRequestedAt: FieldValue.serverTimestamp(),
                releaseRequestedBy: sellerId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        if (escrowData) {
            const tx = escrowData as EscrowTransaction;

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Release Requested",
                message: `The seller has requested release of escrow funds for "${tx.productName}". Please confirm delivery if you have received the goods.`,
                link: `/escrow/${escrowId}`,
                linkText: "Review Request" }).catch((e) => logger.error("[requestEscrowReleaseAction] Buyer notification failed:", e));
        }

        return { error: null, success: true as const, data: { message: "Release requested" } };
    } catch (error) { logger.error("Release request error:", {
            escrowId,
            sellerId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to request release"};
    }
}
export const requestEscrowReleaseAction = withFlexibleSafeAction("requestEscrowReleaseAction", _requestEscrowReleaseAction);

/**
 * Admin releases escrow to seller.
 *
 * Uses requireAdmin() for live role re-validation (not stale JWT).
 * Runs inside a transaction: only a `funded` escrow can be released.
 */
async function _releaseEscrowAction(
    escrowId: string,
    adminId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    try {
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;
            if (data.status !== "funded") {
                throw new Error(`Invalid state transition: expected 'funded', got '${data.status}'`);
            }

            escrowData = data;

            // 1. Update Escrow Status
            tx.update(escrowRef, { 
                status: "released",
                releasedAt: FieldValue.serverTimestamp(),
                releasedBy: adminId,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) 
            });

            // 2. Credit Seller's Wallet
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(data.sellerId);
            const walletSnap = await tx.get(walletRef);
            
            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: data.sellerId,
                    balance: data.amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                tx.update(walletRef, {
                    balance: FieldValue.increment(data.amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // 3. Record in Global Ledger
            const txId = `ESCROW-RELEASE-${escrowId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: data.sellerId,
                type: "escrow_payout",
                module: "escrow",
                amount: data.amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Escrow Payout for "${data.productName}"`
            });
        });

        if (escrowData) { const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "escrow_released",
                adminId,
                tx.amount,
                escrowId,
                {
                    sellerId: tx.sellerId,
                    buyerId: tx.buyerId }
            );

            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funds Released",
                message: `₦${tx.amount.toLocaleString()} for "${tx.productName}" has been released to you by an admin.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details" }).catch((e) => logger.error("[releaseEscrowAction] Seller notification failed:", e));

            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Transaction Completed",
                message: `The escrow for "${tx.productName}" has been completed and funds released to the seller.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details" }).catch((e) => logger.error("[releaseEscrowAction] Buyer notification failed:", e));

            const [sellerDoc, buyerDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(tx.sellerId).get(),
                db.collection(COLLECTIONS.USERS).doc(tx.buyerId).get(),
            ]);
            const sellerPhone: string | undefined = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
            const orderRef = escrowId; 
            await Promise.allSettled([
                sellerPhone ? smsEscrowReleased(sellerPhone, orderRef, tx.amount) : Promise.resolve(),
                pushEscrowReleased(tx.sellerId, orderRef, tx.amount, escrowId),
                pushDisputeResolved(tx.buyerId, tx.sellerId, orderRef),
            ]);
        }

        return { error: null, success: true as const, data: { message: "Escrow released" } };
    } catch (error) { logger.error("Escrow release error:", {
            escrowId,
            adminId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to release escrow"};
    }
}
export const releaseEscrowAction = withFlexibleSafeAction("releaseEscrowAction", _releaseEscrowAction);

/**
 * Create dispute.
 *
 * Uses a Firestore transaction to atomically create the dispute document AND
 * update the escrow status. Previously two separate writes could leave
 * the escrow in `funded` while a dispute existed (or vice versa).
 */
async function _createDisputeAction(data: { escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    reason: string; }): Promise<{ success: true; error: null; data: { disputeId: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required"};
        const { session } = sessionResult;

        const existingQuery = db.collection(COLLECTIONS.DISPUTES)
            .where("escrowId", "==", data.escrowId)
            .where("status", "in", ["open", "under_review"]);

        const existing = await existingQuery.get();
        if (!existing.empty) { return { success: false as const, error: "An active dispute already exists for this transaction"};
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId);
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc();

        let escrowSnapData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const escrowData = escrowDoc.data() as EscrowTransaction;
            if (escrowData.status !== "funded") {
                throw new Error(
                    `Cannot dispute: escrow must be in 'funded' state, currently '${escrowData.status}'`
                );
            }

            escrowSnapData = escrowData;

            const dispute: Omit<Dispute, "id"> & { _version: number } = { ...data,
                evidence: [],
                status: "open",
                _version: 0,
                createdAt: FieldValue.serverTimestamp() };

            tx.set(disputeRef, dispute);
            tx.update(escrowRef, { status: "disputed", 
                disputeId: disputeRef.id,
                updatedAt: FieldValue.serverTimestamp(),
                _version: FieldValue.increment(1) });
        });

        await createAdminAuditLog({ action: "dispute_created",
            userId: data.initiatorId,
            targetId: disputeRef.id,
            targetType: "dispute",
            metadata: {
                escrowId: data.escrowId,
                initiatedBy: data.initiatedBy } });

        if (escrowSnapData) {
            const tx = escrowSnapData as EscrowTransaction;

            await createNotificationAction({
                userId: data.respondentId,
                type: "dispute",
                title: "Dispute Raised",
                message: `A dispute has been opened for escrow transaction "${tx.productName}". Our team will review the case.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }).catch((e) => logger.error("[createDisputeAction] Respondent notification failed:", e));

            await createNotificationAction({
                userId: data.initiatorId,
                type: "dispute",
                title: "Dispute Submitted",
                message: `Your dispute for "${tx.productName}" has been submitted. Our admin team will review and respond within 2–5 business days.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }).catch((e) => logger.error("[createDisputeAction] Initiator notification failed:", e));
        }

        return { error: null, success: true as const, data: { disputeId: disputeRef.id } };
    } catch (error) { logger.error("Dispute creation error:", {
            escrowId: data.escrowId,
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to create dispute"};
    }
}
export async function createDisputeAction(data: Parameters<typeof _createDisputeAction>[0]) {
    return withFlexibleSafeAction("createDisputeAction", _createDisputeAction)(data);
}

/**
 * Admin resolves dispute.
 *
 * Uses requireAdmin() for live role re-validation.
 * Uses a transaction to atomically update both dispute and escrow documents.
 */
async function _resolveDisputeAction(
    disputeId: string,
    adminId: string,
    resolution: string,
    outcome: "release_seller" | "refund_buyer"  // matches DisputeResolution type in marketplace.ts
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { // Live role re-validation — bypasses the stale JWT
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    try {
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);

        let escrowId: string | null = null;
        let disputeData: Dispute | null = null;

        await db.runTransaction(async (tx) => {
            const disputeDoc = await tx.get(disputeRef);
            if (!disputeDoc.exists) throw new Error("Dispute not found");

            const data = disputeDoc.data() as Dispute;
            if (!["open", "under_review"].includes(data.status)) {
                throw new Error(`Cannot resolve: dispute is already '${data.status}'`);
            }

            escrowId = data.escrowId;
            disputeData = data;
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId!);
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");
            const escrowData = escrowDoc.data() as EscrowTransaction;

            // 1. Resolve dispute
            tx.update(disputeRef, { 
                status: "resolved",
                resolution,
                resolvedBy: adminId,
                resolvedAt: FieldValue.serverTimestamp() 
            });

            // 2. Update escrow status
            const finalStatus = outcome === "release_seller" ? "released" : "refunded";
            tx.update(escrowRef, { 
                status: finalStatus,
                releasedBy: adminId,
                [outcome === "release_seller" ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp() 
            });

            // 3. Financial Action (Wallet Credit/Refund)
            const targetId = outcome === "release_seller" ? escrowData.sellerId : escrowData.buyerId;
            const walletRef = db.collection(COLLECTIONS.WALLETS).doc(targetId);
            const walletSnap = await tx.get(walletRef);

            if (!walletSnap.exists) {
                tx.set(walletRef, {
                    userId: targetId,
                    balance: escrowData.amount,
                    currency: "NGN",
                    createdAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp()
                });
            } else {
                tx.update(walletRef, {
                    balance: FieldValue.increment(escrowData.amount),
                    updatedAt: FieldValue.serverTimestamp()
                });
            }

            // 4. Record in Global Ledger
            const txId = `DISPUTE-RES-${disputeId}`;
            const txRef = db.collection(COLLECTIONS.TRANSACTIONS).doc(txId);
            tx.set(txRef, {
                id: txId,
                userId: targetId,
                type: outcome === "release_seller" ? "dispute_payout" : "dispute_refund",
                module: "escrow",
                amount: escrowData.amount,
                currency: "NGN",
                status: "completed",
                date: FieldValue.serverTimestamp(),
                reference: escrowId,
                description: `Dispute Resolution (${outcome}) for "${escrowData.productName}"`
            });
        });

        await createAdminAuditLog({ action: "dispute_resolved",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: {
                escrowId,
                outcome } });

        if (disputeData) {
            const d = disputeData as Dispute;

            // Notify initiator
            await createNotificationAction({
                userId: d.initiatorId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_seller"
                    ? `Your dispute has been resolved. Funds have been released to the seller.`
                    : `Your dispute has been resolved. Funds will be refunded to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution" }).catch((e) => logger.error("[resolveDisputeAction] Initiator notification failed:", e));

            // Notify respondent
            await createNotificationAction({
                userId: d.respondentId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_seller"
                    ? `The dispute for your escrow transaction has been resolved. Funds have been released to you.`
                    : `The dispute for your escrow transaction has been resolved. A refund will be issued to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution" }).catch((e) => logger.error("[resolveDisputeAction] Respondent notification failed:", e));

            // SMS + Push to both parties (non-fatal)
            const [initiatorDoc, respondentDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(d.initiatorId).get(),
                db.collection(COLLECTIONS.USERS).doc(d.respondentId).get(),
            ]);
            const initiatorPhone: string | undefined = initiatorDoc.data()?.phone ?? initiatorDoc.data()?.phoneNumber;
            const respondentPhone: string | undefined = respondentDoc.data()?.phone ?? respondentDoc.data()?.phoneNumber;
            const outcomeLabel = outcome === "release_seller" ? "release_seller" : "refund_buyer";
            await Promise.allSettled([
                initiatorPhone ? smsDisputeResolved(initiatorPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                respondentPhone ? smsDisputeResolved(respondentPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                pushDisputeResolved(d.initiatorId, d.respondentId, escrowId ?? disputeId),
            ]);
        }

        return { error: null, success: true as const, data: { message: "Dispute resolved" } };
    } catch (error) { logger.error("Dispute resolution error:", {
            disputeId,
            adminId,
            outcome,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to resolve dispute"};
    }
}
export const resolveDisputeAction = withFlexibleSafeAction("resolveDisputeAction", _resolveDisputeAction);

/**
 * Admin escalates an open or under_review dispute.
 * Sets escalated = true, changes status to under_review, logs audit, and
 * notifies both parties so they know their case is being prioritised.
 */
async function _escalateDisputeAction(
    disputeId: string
): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false as const, error: adminCheck.error};
    }

    try {
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
        let disputeData: Dispute | null = null;

        // Atomic read-validate-write inside a transaction to eliminate the
        // double-escalation race condition that existed with a bare .update().
        await db.runTransaction(async (tx) => {
            const snap = await tx.get(disputeRef);
            if (!snap.exists) throw new Error("Dispute not found");

            const data = snap.data() as Dispute;
            if (!(["open", "under_review"] as const).includes(data.status as "open" | "under_review")) {
                throw new Error(`Dispute cannot be escalated — current status: ${data.status}`);
            }
            if ((data as any).escalated) { throw new Error("Dispute is already escalated");
            }

            disputeData = data;

            tx.update(disputeRef, { escalated: true,
                escalatedAt: FieldValue.serverTimestamp(),
                escalatedBy: (adminCheck as { userId: string }).userId,
                status: "under_review" });
        });

        const data = disputeData as unknown as Dispute;

        await createAdminAuditLog({ action: "dispute_escalated",
            userId: (adminCheck as { userId: string }).userId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { escrowId: data.escrowId } });

        // Notify both parties
        await Promise.allSettled([
            createNotificationAction({
                userId: data.initiatorId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "Your dispute has been escalated to senior review. A decision will be reached within 1–3 business days.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }),
            createNotificationAction({
                userId: data.respondentId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "The dispute for your escrow transaction has been escalated to senior review.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute" }),
        ]);

        return { error: null, success: true as const, data: { message: "Dispute escalated" } };
    } catch (error) { logger.error("Dispute escalation error:", {
            disputeId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: error instanceof Error ? error.message : "Failed to escalate dispute"};
    }
}
export const escalateDisputeAction = withFlexibleSafeAction("escalateDisputeAction", _escalateDisputeAction);

/**
 * Send message in escrow chat.
 * Validates both sender session and that they are a participant of the escrow.
 */
async function _sendEscrowMessageAction(data: { escrowId: string;
    senderId: string;
    senderName: string;
    message: string; }): Promise<{ success: true; error: null; data: { message: string }; meta?: any }
    | { success: false; error: string; data?: null; meta?: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired"};
        }
        const { session } = sessionResult;
        // Verify the caller is actually the stated sender
        if (session.user.id !== data.senderId) { return { success: false as const, error: "Unauthorized"};
        }

        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId).get();
        if (!escrowDoc.exists) { return { success: false as const, error: "Escrow transaction not found"};
        }
        const escrow = escrowDoc.data() as EscrowTransaction;

        const isAdminUser = isAdmin(session.user.roles);
        if (escrow.buyerId !== data.senderId && escrow.sellerId !== data.senderId && !isAdminUser) {
            return { success: false as const, error: "Not a participant of this escrow"};
        }

        const messageData: Omit<Message, "id"> & { createdAt: any } = { ...data,
            timestamp: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
            read: false };

        await db.collection(COLLECTIONS.ESCROW_MESSAGES).add(messageData);

        return { error: null, success: true as const, data: { message: "Message sent" } };
    } catch (error) { logger.error("Message send error:", {
            escrowId: data.escrowId,
            senderId: data.senderId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to send message"};
    }
}
export async function sendEscrowMessageAction(data: Parameters<typeof _sendEscrowMessageAction>[0]) {
    return withFlexibleSafeAction("sendEscrowMessageAction", _sendEscrowMessageAction)(data);
}

/**
 * Get escrow messages — only for escrow participants
 */
export async function getEscrowMessagesAction(escrowId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: "Unauthorized" };
        const { session } = sessionResult;

        // Verify they are a participant or admin
        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowDoc.exists) return { success: false as const, data: null, error: "Escrow not found" };
        const escrow = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdminUser = isAdmin(session.user.roles);
        if (escrow.buyerId !== userId && escrow.sellerId !== userId && !isAdminUser) {
            logger.warn(`[getEscrowMessages] Non-participant access attempt by ${userId} on escrow ${escrowId}`);
            return { success: false as const, data: null, error: "Access denied" };
        }

        const snapshot = await db.collection(COLLECTIONS.ESCROW_MESSAGES)
            .where("escrowId", "==", escrowId)
            .orderBy("createdAt", "asc")
            .get();

        const messages = serializeDocs(snapshot.docs) as unknown as Message[];
        return { error: null, success: true as const, data: messages };
    } catch (error) { logger.error("Failed to fetch messages:", error);
        return { success: false as const, data: null, error: "Failed to fetch messages" };
    }
}

/**
 * Get single escrow transaction by ID — only for participants or admins
 */
export async function getEscrowTransactionByIdAction(escrowId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> { try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) { return { success: false as const, error: "Escrow transaction not found", data: null };
        }

        const data = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

        if (!isAdmin && data.buyerId !== userId && data.sellerId !== userId) { return { success: false as const, error: "Not authorized to view this escrow", data: null };
        }

        return { error: null, success: true as const, data: serializeDoc(escrowDoc.id, data) };
    } catch (error) { logger.error("Error fetching escrow transaction:", error);
        return { success: false as const, error: "Failed to fetch escrow transaction", data: null };
    }
}

/**
 * Get single escrow transaction by order ID — only for participants or admins
 */
export async function getEscrowTransactionByOrderIdAction(orderId: string): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: (sessionResult.error as any)?.error ?? "Session expired", data: null };
        }
        const { session } = sessionResult;

        const escrowQuery = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS)
            .where("orderId", "==", orderId)
            .limit(1)
            .get();

        if (escrowQuery.empty) {
            return { success: false as const, error: "Escrow transaction not found", data: null };
        }

        const escrowDoc = escrowQuery.docs[0];
        const data = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdminUser = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

        if (!isAdminUser && data.buyerId !== userId && data.sellerId !== userId) {
            return { success: false as const, error: "Not authorized to view this escrow", data: null };
        }

        return { error: null, success: true as const, data: serializeDoc(escrowDoc.id, data) };
    } catch (error) {
        logger.error("Error fetching escrow transaction by order ID:", error);
        return { success: false as const, error: "Failed to fetch escrow transaction", data: null };
    }
}

