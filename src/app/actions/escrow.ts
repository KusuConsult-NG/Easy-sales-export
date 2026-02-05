"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createAuditLog, logFinancialAction } from "@/lib/audit-log";

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
    createdAt: Timestamp;
    paidAt?: Timestamp;
    releasedAt?: Timestamp;
    refundedAt?: Timestamp;
    releaseRequestedAt?: Timestamp;
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
    resolvedAt?: Timestamp;
    createdAt: Timestamp;
}

export interface Message {
    id?: string;
    escrowId: string;
    senderId: string;
    senderName: string;
    message: string;
    timestamp: Timestamp;
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
            createdAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "escrow_transactions"), escrow);

        await createAuditLog({
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
        console.error("Escrow creation error:", error);
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
        const escrowRef = doc(db, "escrow_transactions", escrowId);
        const escrowDoc = await getDoc(escrowRef);

        if (!escrowDoc.exists()) {
            return { success: false, error: "Escrow transaction not found" };
        }

        await updateDoc(escrowRef, {
            status: "held",
            paymentReference,
            paidAt: Timestamp.now(),
        });

        const escrowData = escrowDoc.data() as EscrowTransaction;

        await logFinancialAction(
            "payment_completed",
            escrowData.buyerId,
            escrowData.amount,
            escrowId,
            { paymentReference }
        );

        return { success: true };
    } catch (error) {
        console.error("Payment confirmation error:", error);
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
        const escrowRef = doc(db, "escrow_transactions", escrowId);
        const escrowDoc = await getDoc(escrowRef);

        if (!escrowDoc.exists()) {
            return { success: false, error: "Escrow transaction not found" };
        }

        const escrowData = escrowDoc.data() as EscrowTransaction;

        if (escrowData.sellerId !== sellerId) {
            return { success: false, error: "Unauthorized" };
        }

        if (escrowData.status !== "held") {
            return { success: false, error: "Escrow must be in held status" };
        }

        await updateDoc(escrowRef, {
            releaseRequestedAt: Timestamp.now(),
            releaseRequestedBy: sellerId,
        });

        return { success: true };
    } catch (error) {
        console.error("Release request error:", error);
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
        const escrowRef = doc(db, "escrow_transactions", escrowId);
        const escrowDoc = await getDoc(escrowRef);

        if (!escrowDoc.exists()) {
            return { success: false, error: "Escrow transaction not found" };
        }

        const escrowData = escrowDoc.data() as EscrowTransaction;

        await updateDoc(escrowRef, {
            status: "released",
            releasedAt: Timestamp.now(),
            releasedBy: adminId,
        });

        await logFinancialAction(
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
        console.error("Escrow release error:", error);
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
        const existingQuery = query(
            collection(db, "disputes"),
            where("escrowId", "==", data.escrowId),
            where("status", "in", ["open", "under_review"])
        );
        const existing = await getDocs(existingQuery);

        if (!existing.empty) {
            return { success: false, error: "An active dispute already exists for this transaction" };
        }

        const dispute: Omit<Dispute, "id"> = {
            ...data,
            evidence: [],
            status: "open",
            createdAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "disputes"), dispute);

        // Update escrow status
        await updateDoc(doc(db, "escrow_transactions", data.escrowId), {
            status: "disputed",
        });

        await createAuditLog({
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
        console.error("Dispute creation error:", error);
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
        const disputeRef = doc(db, "disputes", disputeId);
        const disputeDoc = await getDoc(disputeRef);

        if (!disputeDoc.exists()) {
            return { success: false, error: "Dispute not found" };
        }

        const disputeData = disputeDoc.data() as Dispute;

        await updateDoc(disputeRef, {
            status: "resolved",
            resolution,
            resolvedBy: adminId,
            resolvedAt: Timestamp.now(),
        });

        // Update escrow based on outcome
        const escrowRef = doc(db, "escrow_transactions", disputeData.escrowId);
        await updateDoc(escrowRef, {
            status: outcome === "release_to_seller" ? "released" : "refunded",
            releasedBy: adminId,
            [outcome === "release_to_seller" ? "releasedAt" : "refundedAt"]: Timestamp.now(),
        });

        await createAuditLog({
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
        console.error("Dispute resolution error:", error);
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
            timestamp: Timestamp.now(),
            read: false,
        };

        await addDoc(collection(db, "escrow_messages"), messageData);

        return { success: true };
    } catch (error) {
        console.error("Message send error:", error);
        return { success: false, error: "Failed to send message" };
    }
}

/**
 * Get escrow messages
 */
export async function getEscrowMessagesAction(escrowId: string): Promise<Message[]> {
    try {
        const q = query(
            collection(db, "escrow_messages"),
            where("escrowId", "==", escrowId)
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Message[];
    } catch (error) {
        console.error("Failed to fetch messages:", error);
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
        const escrowRef = doc(db, "escrow", escrowId);
        const escrowDoc = await getDoc(escrowRef);

        if (!escrowDoc.exists()) {
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
        console.error("Error fetching escrow transaction:", error);
        return { success: false, error: "Failed to fetch escrow transaction" };
    }
}
