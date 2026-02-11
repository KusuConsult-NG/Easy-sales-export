"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    getDoc,
    query,
    where,
    getDocs,
    orderBy,
    Timestamp,
import { COLLECTIONS } from "@/lib/types/firestore";
import { z } from "zod";
import type { EscrowStatus, EscrowTransaction } from "@/types/escrow";

// Validation schemas
const escrowAmountSchema = z.number().min(100).max(100000000); // ₦100 to ₦100M
const escrowStatusSchema = z.enum(["pending", "funded", "in_transit", "delivered", "completed", "disputed", "cancelled"]);

/**
 * Get user's escrow transactions
 */
export async function getUserEscrowTransactions(): Promise<{ success: boolean; transactions?: EscrowTransaction[]; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        const userId = session.user.id;

        // Query transactions where user is buyer OR seller
        const q = query(
            collection(db, COLLECTIONS.ESCROW_TRANSACTIONS),
            where("participants", "array-contains", userId),
            orderBy("createdAt", "desc")
        );

        const snapshot = await getDocs(q);

        const transactions = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                buyerId: data.buyerId,
                buyerEmail: data.buyerEmail,
                sellerId: data.sellerId,
                sellerEmail: data.sellerEmail,
                amount: data.amount,
                productName: data.productName,
                productDescription: data.productDescription,
                status: data.status,
                paymentReference: data.paymentReference,
                releaseRequestedBy: data.releaseRequestedBy,
                releasedBy: data.releasedBy,
                createdAt: data.createdAt?.toDate(),
                updatedAt: data.updatedAt?.toDate(),
                paidAt: data.paidAt?.toDate(),
                releasedAt: data.releasedAt?.toDate(),
                refundedAt: data.refundedAt?.toDate(),
                releaseRequestedAt: data.releaseRequestedAt?.toDate(),
            } as EscrowTransaction;
        });

        return { success: true, transactions };
    } catch (error: any) {
        console.error("Get escrow transactions error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update escrow status
 */
export async function updateEscrowStatus(
    transactionId: string,
    status: EscrowStatus
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        const userId = session.user.id;

        // Validate status
        escrowStatusSchema.parse(status);

        // Get transaction
        const txRef = doc(db, COLLECTIONS.ESCROW_TRANSACTIONS, transactionId);
        const txDoc = await getDoc(txRef);

        if (!txDoc.exists()) {
            return { success: false, error: "Transaction not found" };
        }

        const txData = txDoc.data();

        // Verify user is participant (buyer or seller)
        if (txData.buyerId !== userId && txData.sellerId !== userId) {
            return { success: false, error: "Not authorized to update this transaction" };
        }

        // Validate state transitions
        const currentStatus = txData.status;
        const validTransitions: Record<string, string[]> = {
            pending: ["funded", "cancelled"],
            funded: ["in_transit", "disputed", "cancelled"],
            in_transit: ["delivered", "disputed"],
            delivered: ["completed", "disputed"],
            completed: [], // Terminal state
            disputed: ["completed", "cancelled"], // Admin only
            cancelled: [], // Terminal state
        };

        if (!validTransitions[currentStatus]?.includes(status)) {
            return {
                success: false,
                error: `Invalid status transition from ${currentStatus} to ${status}`
            };
        }

        // Update status
        await updateDoc(txRef, {
            status,
            updatedAt: new Date(),
            [`${status}At`]: new Date(), // e.g., deliveredAt, completedAt
        });

        return { success: true };
    } catch (error: any) {
        console.error("Update escrow status error:", error);

        if (error instanceof z.ZodError) {
            return { success: false, error: "Invalid status value" };
        }

        return { success: false, error: error.message };
    }
}

/**
 * Create escrow dispute
 */
export async function createEscrowDispute(
    transactionId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        const userId = session.user.id;

        // Validate reason
        if (!reason.trim() || reason.length < 10 || reason.length > 1000) {
            return { success: false, error: "Dispute reason must be 10-1000 characters" };
        }

        // Get transaction
        const txRef = doc(db, COLLECTIONS.ESCROW_TRANSACTIONS, transactionId);
        const txDoc = await getDoc(txRef);

        if (!txDoc.exists()) {
            return { success: false, error: "Transaction not found" };
        }

        const txData = txDoc.data();

        // Verify user is participant
        if (txData.buyerId !== userId && txData.sellerId !== userId) {
            return { success: false, error: "Not authorized to dispute this transaction" };
        }

        // Check if already disputed
        if (txData.status === "disputed") {
            return { success: false, error: "Transaction already under dispute" };
        }

        // Can only dispute after funding
        if (txData.status === "pending" || txData.status === "cancelled" || txData.status === "completed") {
            return { success: false, error: `Cannot dispute transaction in ${txData.status} status` };
        }

        // Check for existing active dispute
        const existingDisputeQuery = query(
            collection(db, COLLECTIONS.DISPUTES),
            where("orderId", "==", transactionId),
            where("status", "in", ["open", "under_review"])
        );
        const existingDisputes = await getDocs(existingDisputeQuery);

        if (!existingDisputes.empty) {
            return { success: false, error: "An active dispute already exists" };
        }

        // Create dispute
        const disputeData = {
            orderId: transactionId,
            buyerId: txData.buyerId,
            sellerId: txData.sellerId,
            reason,
            description: reason, // Store detailed reason
            raisedBy: userId,
            status: "open",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        const disputeRef = await addDoc(collection(db, COLLECTIONS.DISPUTES), disputeData);

        // Update transaction status
        await updateDoc(txRef, {
            status: "disputed",
            disputeId: disputeRef.id,
            updatedAt: new Date(),
        });

        return { success: true };
    } catch (error: any) {
        console.error("Create escrow dispute error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Release escrow funds (Admin only)
 */
export async function releaseEscrowFunds(
    transactionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const userId = session.user.id;

        // Get transaction
        const txRef = doc(db, COLLECTIONS.ESCROW_TRANSACTIONS, transactionId);
        const txDoc = await getDoc(txRef);

        if (!txDoc.exists()) {
            return { success: false, error: "Transaction not found" };
        }

        const txData = txDoc.data();

        // Validate current status
        if (txData.status !== "delivered" && txData.status !== "disputed") {
            return {
                success: false,
                error: `Cannot release escrow in ${txData.status} status. Must be delivered or disputed.`
            };
        }

        // Prevent double-release
        if (txData.status === "completed") {
            return { success: false, error: "Escrow already released" };
        }

        // Validate amount
        if (!txData.amount || txData.amount <= 0) {
            return { success: false, error: "Invalid transaction amount" };
        }

        // Create payment instruction for admin payout
        const paymentInstructionData = {
            type: "escrow_release",
            escrowId: transactionId,
            recipientId: txData.sellerId,
            recipientEmail: txData.sellerEmail,
            amount: txData.amount,
            status: "pending_admin_action",
            description: `Release escrow funds for ${txData.productName}`,
            createdAt: new Date(),
            createdBy: userId,
            metadata: {
                buyerId: txData.buyerId,
                productName: txData.productName,
                paymentReference: txData.paymentReference,
            },
        };

        await addDoc(collection(db, "paymentInstructions"), paymentInstructionData);

        // Update escrow status
        await updateDoc(txRef, {
            status: "completed",
            releasedAt: new Date(),
            releasedBy: userId,
            updatedAt: new Date(),
        });

        // Create audit log
        const { createAuditLog } = await import("@/lib/audit-log");
        await createAuditLog({
            action: "escrow_released",
            userId,
            userEmail: session.user.email!,
            targetId: transactionId,
            targetType: "escrow",
            metadata: {
                sellerId: txData.sellerId,
                amount: txData.amount,
                productName: txData.productName,
            },
            details: `Released ₦${txData.amount.toLocaleString()} escrow to seller`,
        });

        return { success: true };
    } catch (error: any) {
        console.error("Release escrow funds error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Refund escrow to buyer (Admin only)
 */
export async function refundEscrowToBuyer(
    transactionId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();

        if (!session?.user) {
            return { success: false, error: "Unauthorized" };
        }

        // Check admin role
        if (!session.user.roles?.includes("admin") && !session.user.roles?.includes("super_admin")) {
            return { success: false, error: "Admin access required" };
        }

        const userId = session.user.id;

        // Get transaction
        const txRef = doc(db, COLLECTIONS.ESCROW_TRANSACTIONS, transactionId);
        const txDoc = await getDoc(txRef);

        if (!txDoc.exists()) {
            return { success: false, error: "Transaction not found" };
        }

        const txData = txDoc.data();

        // Validate current status (can only refund if disputed or in certain states)
        if (!["funded", "in_transit", "disputed"].includes(txData.status)) {
            return {
                success: false,
                error: `Cannot refund escrow in ${txData.status} status`
            };
        }

        // Prevent double-refund
        if (txData.refundedAt) {
            return { success: false, error: "Escrow already refunded" };
        }

        // Create payment instruction for admin refund
        const refundInstructionData = {
            type: "escrow_refund",
            escrowId: transactionId,
            recipientId: txData.buyerId,
            recipientEmail: txData.buyerEmail,
            amount: txData.amount,
            status: "pending_admin_action",
            description: `Refund escrow for ${txData.productName}`,
            createdAt: new Date(),
            createdBy: userId,
            metadata: {
                sellerId: txData.sellerId,
                productName: txData.productName,
                paymentReference: txData.paymentReference,
                reason: "Escrow cancelled/disputed",
            },
        };

        await addDoc(collection(db, "paymentInstructions"), refundInstructionData);

        // Update escrow status
        await updateDoc(txRef, {
            status: "cancelled",
            refundedAt: new Date(),
            refundedBy: userId,
            updatedAt: new Date(),
        });

        // Create audit log
        const { createAuditLog } = await import("@/lib/audit-log");
        await createAuditLog({
            action: "escrow_refunded",
            userId,
            userEmail: session.user.email!,
            targetId: transactionId,
            targetType: "escrow",
            metadata: {
                buyerId: txData.buyerId,
                amount: txData.amount,
                productName: txData.productName,
            },
            details: `Refunded ₦${txData.amount.toLocaleString()} escrow to buyer`,
        });

        return { success: true };
    } catch (error: any) {
        console.error("Refund escrow error:", error);
        return { success: false, error: error.message };
    }
}
