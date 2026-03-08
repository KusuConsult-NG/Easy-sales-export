"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminFinancialAction } from "@/lib/audit-log-admin";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { createNotificationAction } from "@/app/actions/notifications";
import { verifyPaystackPayment } from "@/lib/paystack-server";
import { smsEscrowReleased, smsDisputeResolved } from "@/lib/termii";
import { pushEscrowReleased, pushDisputeResolved } from "@/lib/fcm";

/**
 * Marketplace Escrow System
 * Buyer → Escrow → Seller workflow with admin release
 *
 * All status-changing operations run inside Firestore transactions to prevent
 * race conditions. A plain .update() call is a last-write-wins operation; a
 * runTransaction() reads the current state and rejects the write if the
 * precondition is violated — turning a race condition into a clear error.
 */

export interface EscrowTransaction {
    id?: string;
    buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
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
    releasedBy?: string;
}

export interface Dispute {
    id?: string;
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
    createdAt: FieldValue | Timestamp;
}

export interface Message {
    id?: string;
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
    timestamp: FieldValue | Timestamp;
    read: boolean;
}

/**
 * Create escrow transaction
 */
export async function createEscrowAction(data: {
    buyerId: string;
    buyerEmail: string;
    sellerId: string;
    sellerEmail: string;
    amount: number;
    productName: string;
    productDescription: string;
}): Promise<{ success: boolean; error?: string; escrowId?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: (sessionResult.error as any)?.error ?? "Session expired" };
        }
        const { session } = sessionResult;
        if (!session?.user?.id || session.user.id !== data.buyerId) {
            return { success: false, error: "Unauthorized" };
        }

        const escrow: Omit<EscrowTransaction, "id"> = {
            ...data,
            // ✅ FIX: write participants array so array-contains queries in getUserEscrowTransactions work
            participants: [data.buyerId, data.sellerId],
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).add(escrow);

        await createAdminAuditLog({
            action: "escrow_created",
            userId: data.buyerId,
            targetId: docRef.id,
            targetType: "escrow_transaction",
            metadata: {
                amount: data.amount,
                seller: data.sellerId,
                product: data.productName,
            },
        });

        // Notify buyer that escrow has been created
        await createNotificationAction({
            userId: data.buyerId,
            type: "escrow",
            title: "Escrow Created",
            message: `Your escrow for "${data.productName}" (₦${data.amount.toLocaleString()}) has been created. Please complete payment to secure the transaction.`,
            link: `/escrow/${docRef.id}`,
            linkText: "View Escrow",
        }).catch((e) => logger.error("[createEscrowAction] Notification failed:", e));

        // Notify seller that a buyer has initiated escrow
        await createNotificationAction({
            userId: data.sellerId,
            type: "escrow",
            title: "New Escrow Transaction",
            message: `A buyer has initiated a secured escrow for "${data.productName}" (₦${data.amount.toLocaleString()}). Funds will be held until delivery is confirmed.`,
            link: `/escrow/${docRef.id}`,
            linkText: "View Escrow",
        }).catch((e) => logger.error("[createEscrowAction] Seller notification failed:", e));

        return { success: true, escrowId: docRef.id };
    } catch (error) {
        logger.error("Escrow creation error:", error);
        return { success: false, error: "Failed to create escrow transaction" };
    }
}

/**
 * Confirm payment and move to funded status.
 *
 * Runs inside a transaction to guard the state transition:
 * only `pending → funded` is valid.
 */
export async function confirmEscrowPaymentAction(
    escrowId: string,
    paymentReference: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // ── 1. Verify with Paystack before touching Firestore ─────────────────
        let paystackData: Awaited<ReturnType<typeof verifyPaystackPayment>>;
        try {
            paystackData = await verifyPaystackPayment(paymentReference);
        } catch (e: any) {
            logger.error("[confirmEscrowPayment] Paystack verification failed:", e);
            return { success: false, error: "Payment verification failed: " + (e.message ?? "Unknown error") };
        }

        if (paystackData.data.status !== "success") {
            return {
                success: false,
                error: `Payment not confirmed. Paystack status: '${paystackData.data.status}'. Please complete payment and try again.`
            };
        }

        // ── 2. Fetch the escrow doc to cross-check the amount ─────────────────
        const escrowSnap = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowSnap.exists) return { success: false, error: "Escrow transaction not found" };

        const escrowDoc = escrowSnap.data() as EscrowTransaction;

        // Paystack amounts are in kobo (1 naira = 100 kobo)
        const paidAmountNaira = paystackData.data.amount / 100;
        const expectedAmount = escrowDoc.amount;

        // Allow ±1 naira tolerance for rounding differences
        if (Math.abs(paidAmountNaira - expectedAmount) > 1) {
            logger.warn(
                `[confirmEscrowPayment] Amount mismatch on ${escrowId}: expected ₦${expectedAmount}, got ₦${paidAmountNaira}`
            );
            return {
                success: false,
                error: `Payment amount mismatch. Expected ₦${expectedAmount.toLocaleString()}, received ₦${paidAmountNaira.toLocaleString()}.`
            };
        }

        // ── 3. Firestore transaction: pending → funded ─────────────────────────
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

            tx.update(escrowRef, {
                status: "funded",
                paymentReference,
                paidAt: FieldValue.serverTimestamp(),
            });
        });

        if (escrowData) {
            const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "payment_completed",
                tx.buyerId,
                tx.amount,
                escrowId,
                { paymentReference, channel: paystackData.data.channel }
            );

            // Notify buyer: payment confirmed
            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Payment Confirmed",
                message: `Your payment of ₦${tx.amount.toLocaleString()} for "${tx.productName}" has been secured in escrow.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow",
            }).catch((e) => logger.error("[confirmEscrowPaymentAction] Buyer notification failed:", e));

            // Notify seller: funds are now held
            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funded",
                message: `Funds of ₦${tx.amount.toLocaleString()} for "${tx.productName}" have been secured in escrow. You can now proceed with delivery.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Escrow",
            }).catch((e) => logger.error("[confirmEscrowPaymentAction] Seller notification failed:", e));
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Payment confirmation error:", error);
        return { success: false, error: error.message || "Failed to confirm payment" };
    }
}

/**
 * Seller requests escrow release.
 *
 * Runs inside a transaction: only a `funded` escrow belonging to this seller
 * can be marked for release.
 */
export async function requestEscrowReleaseAction(
    escrowId: string,
    sellerId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        // Verify the caller is the actual seller
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: (sessionResult.error as any)?.error ?? "Session expired" };
        }
        if (sessionResult.session.user.id !== sellerId) {
            return { success: false, error: "Unauthorized" };
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

            tx.update(escrowRef, {
                releaseRequestedAt: FieldValue.serverTimestamp(),
                releaseRequestedBy: sellerId,
            });
        });

        if (escrowData) {
            const tx = escrowData as EscrowTransaction;

            // Notify buyer: seller has requested release
            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Release Requested",
                message: `The seller has requested release of escrow funds for "${tx.productName}". Please confirm delivery if you have received the goods.`,
                link: `/escrow/${escrowId}`,
                linkText: "Review Request",
            }).catch((e) => logger.error("[requestEscrowReleaseAction] Buyer notification failed:", e));
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Release request error:", error);
        return { success: false, error: error.message || "Failed to request release" };
    }
}

/**
 * Admin releases escrow to seller.
 *
 * Uses requireAdmin() for live role re-validation (not stale JWT).
 * Runs inside a transaction: only a `funded` escrow can be released.
 */
export async function releaseEscrowAction(
    escrowId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    // Live role re-validation — bypasses the stale JWT
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false, error: adminCheck.error };
    }

    try {
        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);

        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;
            if (data.status !== "funded") {
                throw new Error(
                    `Invalid state transition: expected 'funded', got '${data.status}'`
                );
            }

            escrowData = data;

            tx.update(escrowRef, {
                status: "released",
                releasedAt: FieldValue.serverTimestamp(),
                releasedBy: adminId,
            });
        });

        if (escrowData) {
            const tx = escrowData as EscrowTransaction;

            await logAdminFinancialAction(
                "escrow_released",
                adminId,
                tx.amount,
                escrowId,
                {
                    sellerId: tx.sellerId,
                    buyerId: tx.buyerId,
                }
            );

            // Notify seller: funds released
            await createNotificationAction({
                userId: tx.sellerId,
                type: "escrow",
                title: "Escrow Funds Released",
                message: `₦${tx.amount.toLocaleString()} for "${tx.productName}" has been released to you by an admin.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details",
            }).catch((e) => logger.error("[releaseEscrowAction] Seller notification failed:", e));

            // Notify buyer: release confirmed
            await createNotificationAction({
                userId: tx.buyerId,
                type: "escrow",
                title: "Transaction Completed",
                message: `The escrow for "${tx.productName}" has been completed and funds released to the seller.`,
                link: `/escrow/${escrowId}`,
                linkText: "View Details",
            }).catch((e) => logger.error("[releaseEscrowAction] Buyer notification failed:", e));

            // SMS + Push (non-fatal)
            const [sellerDoc, buyerDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(tx.sellerId).get(),
                db.collection(COLLECTIONS.USERS).doc(tx.buyerId).get(),
            ]);
            const sellerPhone: string | undefined = sellerDoc.data()?.phone ?? sellerDoc.data()?.phoneNumber;
            const orderRef = escrowId; // use escrow ID as order reference in SMS
            await Promise.allSettled([
                sellerPhone ? smsEscrowReleased(sellerPhone, orderRef, tx.amount) : Promise.resolve(),
                pushEscrowReleased(tx.sellerId, orderRef, tx.amount, escrowId),
                pushDisputeResolved(tx.buyerId, tx.sellerId, orderRef), // reuses push helper — just informs buyer
            ]);
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Escrow release error:", error);
        return { success: false, error: error.message || "Failed to release escrow" };
    }
}

/**
 * Create dispute.
 *
 * Uses a Firestore transaction to atomically create the dispute document AND
 * update the escrow status. Previously two separate writes could leave
 * the escrow in `funded` while a dispute existed (or vice versa).
 */
export async function createDisputeAction(data: {
    escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    reason: string;
}): Promise<{ success: boolean; error?: string; disputeId?: string }> {
    try {
        // Check if dispute already exists (outside transaction — read-only guard)
        const existingQuery = db.collection(COLLECTIONS.DISPUTES)
            .where("escrowId", "==", data.escrowId)
            .where("status", "in", ["open", "under_review"]);

        const existing = await existingQuery.get();
        if (!existing.empty) {
            return { success: false, error: "An active dispute already exists for this transaction" };
        }

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId);
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(); // auto-ID

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

            const dispute: Omit<Dispute, "id"> = {
                ...data,
                evidence: [],
                status: "open",
                createdAt: FieldValue.serverTimestamp(),
            };

            // Atomic: create dispute + update escrow status in one commit
            tx.set(disputeRef, dispute);
            tx.update(escrowRef, { status: "disputed", disputeId: disputeRef.id });
        });

        await createAdminAuditLog({
            action: "dispute_created",
            userId: data.initiatorId,
            targetId: disputeRef.id,
            targetType: "dispute",
            metadata: {
                escrowId: data.escrowId,
                initiatedBy: data.initiatedBy,
            },
        });

        if (escrowSnapData) {
            const tx = escrowSnapData as EscrowTransaction;

            // Notify respondent: a dispute has been raised
            await createNotificationAction({
                userId: data.respondentId,
                type: "dispute",
                title: "Dispute Raised",
                message: `A dispute has been opened for escrow transaction "${tx.productName}". Our team will review the case.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute",
            }).catch((e) => logger.error("[createDisputeAction] Respondent notification failed:", e));

            // Notify initiator: dispute confirmed
            await createNotificationAction({
                userId: data.initiatorId,
                type: "dispute",
                title: "Dispute Submitted",
                message: `Your dispute for "${tx.productName}" has been submitted. Our admin team will review and respond within 2–5 business days.`,
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute",
            }).catch((e) => logger.error("[createDisputeAction] Initiator notification failed:", e));
        }

        return { success: true, disputeId: disputeRef.id };
    } catch (error: any) {
        logger.error("Dispute creation error:", error);
        return { success: false, error: error.message || "Failed to create dispute" };
    }
}

/**
 * Admin resolves dispute.
 *
 * Uses requireAdmin() for live role re-validation.
 * Uses a transaction to atomically update both dispute and escrow documents.
 */
export async function resolveDisputeAction(
    disputeId: string,
    adminId: string,
    resolution: string,
    outcome: "release_to_seller" | "refund_to_buyer"
): Promise<{ success: boolean; error?: string }> {
    // Live role re-validation — bypasses the stale JWT
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false, error: adminCheck.error };
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
                throw new Error(
                    `Cannot resolve: dispute is already '${data.status}'`
                );
            }

            escrowId = data.escrowId;
            disputeData = data;
            const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId!);

            // Atomic: resolve dispute + update escrow in one commit
            tx.update(disputeRef, {
                status: "resolved",
                resolution,
                resolvedBy: adminId,
                resolvedAt: FieldValue.serverTimestamp(),
            });

            tx.update(escrowRef, {
                status: outcome === "release_to_seller" ? "released" : "refunded",
                releasedBy: adminId,
                [outcome === "release_to_seller" ? "releasedAt" : "refundedAt"]:
                    FieldValue.serverTimestamp(),
            });
        });

        await createAdminAuditLog({
            action: "dispute_resolved",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: {
                escrowId,
                outcome,
            },
        });

        if (disputeData) {
            const d = disputeData as Dispute;

            // Notify initiator
            await createNotificationAction({
                userId: d.initiatorId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_to_seller"
                    ? `Your dispute has been resolved. Funds have been released to the seller.`
                    : `Your dispute has been resolved. Funds will be refunded to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution",
            }).catch((e) => logger.error("[resolveDisputeAction] Initiator notification failed:", e));

            // Notify respondent
            await createNotificationAction({
                userId: d.respondentId,
                type: "dispute",
                title: "Dispute Resolved",
                message: outcome === "release_to_seller"
                    ? `The dispute for your escrow transaction has been resolved. Funds have been released to you.`
                    : `The dispute for your escrow transaction has been resolved. A refund will be issued to the buyer.`,
                link: `/escrow/${d.escrowId}`,
                linkText: "View Resolution",
            }).catch((e) => logger.error("[resolveDisputeAction] Respondent notification failed:", e));

            // SMS + Push to both parties (non-fatal)
            const [initiatorDoc, respondentDoc] = await Promise.all([
                db.collection(COLLECTIONS.USERS).doc(d.initiatorId).get(),
                db.collection(COLLECTIONS.USERS).doc(d.respondentId).get(),
            ]);
            const initiatorPhone: string | undefined = initiatorDoc.data()?.phone ?? initiatorDoc.data()?.phoneNumber;
            const respondentPhone: string | undefined = respondentDoc.data()?.phone ?? respondentDoc.data()?.phoneNumber;
            const outcomeLabel = outcome === "release_to_seller" ? "release_seller" : "refund_buyer";
            await Promise.allSettled([
                initiatorPhone ? smsDisputeResolved(initiatorPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                respondentPhone ? smsDisputeResolved(respondentPhone, escrowId ?? disputeId, outcomeLabel) : Promise.resolve(),
                pushDisputeResolved(d.initiatorId, d.respondentId, escrowId ?? disputeId),
            ]);
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Dispute resolution error:", error);
        return { success: false, error: error.message || "Failed to resolve dispute" };
    }
}

/**
 * Admin escalates an open or under_review dispute.
 * Sets escalated = true, changes status to under_review, logs audit, and
 * notifies both parties so they know their case is being prioritised.
 */
export async function escalateDisputeAction(
    disputeId: string
): Promise<{ success: boolean; error?: string }> {
    const adminCheck = await requireAdmin();
    if ("error" in adminCheck) {
        return { success: false, error: adminCheck.error };
    }

    try {
        const disputeRef = db.collection(COLLECTIONS.DISPUTES).doc(disputeId);
        const snap = await disputeRef.get();
        if (!snap.exists) return { success: false, error: "Dispute not found" };

        const data = snap.data() as Dispute;
        if (!(["open", "under_review"] as const).includes(data.status as "open" | "under_review")) {
            return { success: false, error: `Dispute cannot be escalated — current status: ${data.status}` };
        }
        if ((data as any).escalated) {
            return { success: false, error: "Dispute is already escalated" };
        }

        await disputeRef.update({
            escalated: true,
            escalatedAt: FieldValue.serverTimestamp(),
            escalatedBy: (adminCheck as { userId: string }).userId,
            status: "under_review",
        });

        await createAdminAuditLog({
            action: "dispute_escalated",
            userId: (adminCheck as { userId: string }).userId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: { escrowId: data.escrowId },
        });

        // Notify both parties
        await Promise.allSettled([
            createNotificationAction({
                userId: data.initiatorId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "Your dispute has been escalated to senior review. A decision will be reached within 1–3 business days.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute",
            }),
            createNotificationAction({
                userId: data.respondentId,
                type: "dispute",
                title: "Dispute Escalated ⚠️",
                message: "The dispute for your escrow transaction has been escalated to senior review.",
                link: `/escrow/${data.escrowId}`,
                linkText: "View Dispute",
            }),
        ]);

        return { success: true };
    } catch (error: any) {
        logger.error("Dispute escalation error:", error);
        return { success: false, error: error.message || "Failed to escalate dispute" };
    }
}

/**
 * Send message in escrow chat.
 * Validates both sender session and that they are a participant of the escrow.
 */
export async function sendEscrowMessageAction(data: {
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: (sessionResult.error as any)?.error ?? "Session expired" };
        }
        const { session } = sessionResult;
        // Verify the caller is actually the stated sender
        if (session.user.id !== data.senderId) {
            return { success: false, error: "Unauthorized" };
        }

        // Verify they are a participant in this escrow
        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(data.escrowId).get();
        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }
        const escrow = escrowDoc.data() as EscrowTransaction;
        if (escrow.buyerId !== data.senderId && escrow.sellerId !== data.senderId) {
            return { success: false, error: "Not a participant of this escrow" };
        }

        const messageData: Omit<Message, "id"> = {
            ...data,
            timestamp: FieldValue.serverTimestamp(),
            read: false,
        };

        await db.collection(COLLECTIONS.ESCROW_MESSAGES).add(messageData);

        return { success: true };
    } catch (error) {
        logger.error("Message send error:", error);
        return { success: false, error: "Failed to send message" };
    }
}

/**
 * Get escrow messages — only for escrow participants
 */
export async function getEscrowMessagesAction(escrowId: string): Promise<Message[]> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return [];
        const { session } = sessionResult;

        // Verify they are a participant
        const escrowDoc = await db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId).get();
        if (!escrowDoc.exists) return [];
        const escrow = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
            logger.warn(`[getEscrowMessages] Non-participant access attempt by ${userId} on escrow ${escrowId}`);
            return [];
        }

        const snapshot = await db.collection(COLLECTIONS.ESCROW_MESSAGES)
            .where("escrowId", "==", escrowId)
            .orderBy("timestamp", "asc")
            .get();

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Message[];
    } catch (error) {
        logger.error("Failed to fetch messages:", error);
        return [];
    }
}

/**
 * Get single escrow transaction by ID — only for participants or admins
 */
export async function getEscrowTransactionByIdAction(escrowId: string): Promise<{
    success: boolean;
    data?: EscrowTransaction;
    error?: string
}> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: (sessionResult.error as any)?.error ?? "Session expired" };
        }
        const { session } = sessionResult;

        const escrowRef = db.collection(COLLECTIONS.ESCROW_TRANSACTIONS).doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }

        const data = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        const isAdmin = session.user.roles?.includes("admin") || session.user.roles?.includes("super_admin");

        if (!isAdmin && data.buyerId !== userId && data.sellerId !== userId) {
            return { success: false, error: "Not authorized to view this escrow" };
        }

        return {
            success: true,
            data: {
                id: escrowDoc.id,
                ...data
            }
        };
    } catch (error) {
        logger.error("Error fetching escrow transaction:", error);
        return { success: false, error: "Failed to fetch escrow transaction" };
    }
}
