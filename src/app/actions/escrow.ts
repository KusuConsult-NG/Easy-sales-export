"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { requireAdmin } from "@/lib/require-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminFinancialAction } from "@/lib/audit-log-admin";
import { requireSession } from "@/lib/session-guard";

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
    status: "pending_payment" | "held" | "released" | "refunded" | "disputed";
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
            status: "pending_payment",
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection("escrow_transactions").add(escrow);

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

        return { success: true, escrowId: docRef.id };
    } catch (error) {
        logger.error("Escrow creation error:", error);
        return { success: false, error: "Failed to create escrow transaction" };
    }
}

/**
 * Confirm payment and move to held status.
 *
 * Runs inside a transaction to guard the state transition:
 * only `pending_payment → held` is valid.
 */
export async function confirmEscrowPaymentAction(
    escrowId: string,
    paymentReference: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);

        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;
            if (data.status !== "pending_payment") {
                throw new Error(
                    `Invalid state transition: expected 'pending_payment', got '${data.status}'`
                );
            }

            escrowData = data;

            tx.update(escrowRef, {
                status: "held",
                paymentReference,
                paidAt: FieldValue.serverTimestamp(),
            });
        });

        if (escrowData) {
            await logAdminFinancialAction(
                "payment_completed",
                (escrowData as EscrowTransaction).buyerId,
                (escrowData as EscrowTransaction).amount,
                escrowId,
                { paymentReference }
            );
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
 * Runs inside a transaction: only a `held` escrow belonging to this seller
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

        const escrowRef = db.collection("escrow_transactions").doc(escrowId);

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;

            if (data.sellerId !== sellerId) throw new Error("Unauthorized");
            if (data.status !== "held") {
                throw new Error(
                    `Invalid state transition: expected 'held', got '${data.status}'`
                );
            }

            tx.update(escrowRef, {
                releaseRequestedAt: FieldValue.serverTimestamp(),
                releaseRequestedBy: sellerId,
            });
        });

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
 * Runs inside a transaction: only a `held` escrow can be released.
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
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);

        let escrowData: EscrowTransaction | null = null;

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const data = escrowDoc.data() as EscrowTransaction;
            if (data.status !== "held") {
                throw new Error(
                    `Invalid state transition: expected 'held', got '${data.status}'`
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
            await logAdminFinancialAction(
                "escrow_released",
                adminId,
                (escrowData as EscrowTransaction).amount,
                escrowId,
                {
                    sellerId: (escrowData as EscrowTransaction).sellerId,
                    buyerId: (escrowData as EscrowTransaction).buyerId,
                }
            );
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
 * the escrow in `held` while a dispute existed (or vice versa).
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
        const existingQuery = db.collection("disputes")
            .where("escrowId", "==", data.escrowId)
            .where("status", "in", ["open", "under_review"]);

        const existing = await existingQuery.get();
        if (!existing.empty) {
            return { success: false, error: "An active dispute already exists for this transaction" };
        }

        const escrowRef = db.collection("escrow_transactions").doc(data.escrowId);
        const disputeRef = db.collection("disputes").doc(); // auto-ID

        await db.runTransaction(async (tx) => {
            const escrowDoc = await tx.get(escrowRef);
            if (!escrowDoc.exists) throw new Error("Escrow transaction not found");

            const escrowData = escrowDoc.data() as EscrowTransaction;
            if (escrowData.status !== "held") {
                throw new Error(
                    `Cannot dispute: escrow must be in 'held' state, currently '${escrowData.status}'`
                );
            }

            const dispute: Omit<Dispute, "id"> = {
                ...data,
                evidence: [],
                status: "open",
                createdAt: FieldValue.serverTimestamp(),
            };

            // Atomic: create dispute + update escrow status in one commit
            tx.set(disputeRef, dispute);
            tx.update(escrowRef, { status: "disputed" });
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
        const disputeRef = db.collection("disputes").doc(disputeId);

        let escrowId: string | null = null;

        await db.runTransaction(async (tx) => {
            const disputeDoc = await tx.get(disputeRef);
            if (!disputeDoc.exists) throw new Error("Dispute not found");

            const disputeData = disputeDoc.data() as Dispute;

            if (!["open", "under_review"].includes(disputeData.status)) {
                throw new Error(
                    `Cannot resolve: dispute is already '${disputeData.status}'`
                );
            }

            escrowId = disputeData.escrowId;
            const escrowRef = db.collection("escrow_transactions").doc(escrowId);

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

        return { success: true };
    } catch (error: any) {
        logger.error("Dispute resolution error:", error);
        return { success: false, error: error.message || "Failed to resolve dispute" };
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
        const escrowDoc = await db.collection("escrow_transactions").doc(data.escrowId).get();
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

        await db.collection("escrow_messages").add(messageData);

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
        const escrowDoc = await db.collection("escrow_transactions").doc(escrowId).get();
        if (!escrowDoc.exists) return [];
        const escrow = escrowDoc.data() as EscrowTransaction;
        const userId = session.user.id;
        if (escrow.buyerId !== userId && escrow.sellerId !== userId) {
            logger.warn(`[getEscrowMessages] Non-participant access attempt by ${userId} on escrow ${escrowId}`);
            return [];
        }

        const snapshot = await db.collection("escrow_messages")
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

        const escrowRef = db.collection("escrow_transactions").doc(escrowId);
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
