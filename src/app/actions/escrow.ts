"use server";

import { db } from "@/lib/firebase-admin";
import { logger } from '@/lib/logger';
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminFinancialAction } from "@/lib/audit-log-admin";

/**
 * Marketplace Escrow System
 * Buyer → Escrow → Seller workflow with admin release
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
 * Confirm payment and move to held status
 */
export async function confirmEscrowPaymentAction(
    escrowId: string,
    paymentReference: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }

        await escrowRef.update({
            status: "held",
            paymentReference,
            paidAt: FieldValue.serverTimestamp(),
        });

        const escrowData = escrowDoc.data() as EscrowTransaction;

        await logAdminFinancialAction(
            "payment_completed",
            escrowData.buyerId,
            escrowData.amount,
            escrowId,
            { paymentReference }
        );

        return { success: true };
    } catch (error) {
        logger.error("Payment confirmation error:", error);
        return { success: false, error: "Failed to confirm payment" };
    }
}

/**
 * Seller requests escrow release
 */
export async function requestEscrowReleaseAction(
    escrowId: string,
    sellerId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }

        const escrowData = escrowDoc.data() as EscrowTransaction;

        if (escrowData.sellerId !== sellerId) {
            return { success: false, error: "Unauthorized" };
        }

        if (escrowData.status !== "held") {
            return { success: false, error: "Escrow must be in held status" };
        }

        await escrowRef.update({
            releaseRequestedAt: FieldValue.serverTimestamp(),
            releaseRequestedBy: sellerId,
        });

        return { success: true };
    } catch (error) {
        logger.error("Release request error:", error);
        return { success: false, error: "Failed to request release" };
    }
}

/**
 * Admin releases escrow to seller
 */
export async function releaseEscrowAction(
    escrowId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }

        const escrowData = escrowDoc.data() as EscrowTransaction;

        await escrowRef.update({
            status: "released",
            releasedAt: FieldValue.serverTimestamp(),
            releasedBy: adminId,
        });

        await logAdminFinancialAction(
            "escrow_released",
            adminId,
            escrowData.amount,
            escrowId,
            {
                sellerId: escrowData.sellerId,
                buyerId: escrowData.buyerId,
            }
        );

        return { success: true };
    } catch (error) {
        logger.error("Escrow release error:", error);
        return { success: false, error: "Failed to release escrow" };
    }
}

/**
 * Create dispute
 */
export async function createDisputeAction(data: {
    escrowId: string;
    initiatedBy: "buyer" | "seller";
    initiatorId: string;
    respondentId: string;
    reason: string;
}): Promise<{ success: boolean; error?: string; disputeId?: string }> {
    try {
        // Check if dispute already exists
        const existingQuery = db.collection("disputes")
            .where("escrowId", "==", data.escrowId)
            .where("status", "in", ["open", "under_review"]);

        const existing = await existingQuery.get();

        if (!existing.empty) {
            return { success: false, error: "An active dispute already exists for this transaction" };
        }

        const dispute: Omit<Dispute, "id"> = {
            ...data,
            evidence: [],
            status: "open",
            createdAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection("disputes").add(dispute);

        // Update escrow status
        await db.collection("escrow_transactions").doc(data.escrowId).update({
            status: "disputed",
        });

        await createAdminAuditLog({
            action: "dispute_created",
            userId: data.initiatorId,
            targetId: docRef.id,
            targetType: "dispute",
            metadata: {
                escrowId: data.escrowId,
                initiatedBy: data.initiatedBy,
            },
        });

        return { success: true, disputeId: docRef.id };
    } catch (error) {
        logger.error("Dispute creation error:", error);
        return { success: false, error: "Failed to create dispute" };
    }
}

/**
 * Admin resolves dispute
 */
export async function resolveDisputeAction(
    disputeId: string,
    adminId: string,
    resolution: string,
    outcome: "release_to_seller" | "refund_to_buyer"
): Promise<{ success: boolean; error?: string }> {
    try {
        const disputeRef = db.collection("disputes").doc(disputeId);
        const disputeDoc = await disputeRef.get();

        if (!disputeDoc.exists) {
            return { success: false, error: "Dispute not found" };
        }

        const disputeData = disputeDoc.data() as Dispute;

        await disputeRef.update({
            status: "resolved",
            resolution,
            resolvedBy: adminId,
            resolvedAt: FieldValue.serverTimestamp(),
        });

        // Update escrow based on outcome
        const escrowRef = db.collection("escrow_transactions").doc(disputeData.escrowId);
        await escrowRef.update({
            status: outcome === "release_to_seller" ? "released" : "refunded",
            releasedBy: adminId,
            [outcome === "release_to_seller" ? "releasedAt" : "refundedAt"]: FieldValue.serverTimestamp(),
        });

        await createAdminAuditLog({
            action: "dispute_resolved",
            userId: adminId,
            targetId: disputeId,
            targetType: "dispute",
            metadata: {
                escrowId: disputeData.escrowId,
                outcome,
            },
        });

        return { success: true };
    } catch (error) {
        logger.error("Dispute resolution error:", error);
        return { success: false, error: "Failed to resolve dispute" };
    }
}

/**
 * Send message in escrow chat
 */
export async function sendEscrowMessageAction(data: {
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
}): Promise<{ success: boolean; error?: string }> {
    try {
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
 * Get escrow messages
 */
export async function getEscrowMessagesAction(escrowId: string): Promise<Message[]> {
    try {
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
 * Get single escrow transaction by ID
 */
export async function getEscrowTransactionByIdAction(escrowId: string): Promise<{
    success: boolean;
    data?: EscrowTransaction;
    error?: string
}> {
    try {
        const escrowRef = db.collection("escrow_transactions").doc(escrowId);
        const escrowDoc = await escrowRef.get();

        if (!escrowDoc.exists) {
            return { success: false, error: "Escrow transaction not found" };
        }

        return {
            success: true,
            data: {
                id: escrowDoc.id,
                ...escrowDoc.data() as Omit<EscrowTransaction, 'id'>
            }
        };
    } catch (error) {
        logger.error("Error fetching escrow transaction:", error);
        return { success: false, error: "Failed to fetch escrow transaction" };
    }
}
