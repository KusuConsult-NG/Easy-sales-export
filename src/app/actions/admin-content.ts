"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export type ContentType = "products" | "land" | "loans" | "wave" | "certificates" | "resources" | "courses";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingContentItem {
    id: string;
    type: ContentType;
    title: string;
    submittedBy: string; // Email or Name
    submittedAt: Date;
    status: ApprovalStatus;
    description?: string;
    metadata?: any; // Original document data
}

/**
 * Fetches all pending content from various collections.
 * Aggregates:
 * - Marketplace Products (status: pending)
 * - Land Listings (verificationStatus: pending)
 * - Loans (status: pending)
 * - WAVE Applications (status: pending)
 */
export async function getPendingContentAction(): Promise<{
    success: boolean;
    data?: PendingContentItem[];
    error?: string;
}> {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection("users").doc(session.user.id).get();
        const userData = userDoc.data();
        if (!userDoc.exists || !userData || userData.role !== "admin") {
            return { success: false, error: "Unauthorized" };
        }

        const pendingItems: PendingContentItem[] = [];

        // 1. Marketplace Products
        const productsQuery = db.collection("marketplace_products").where("status", "==", "pending");
        const productsSnap = await productsQuery.get();
        productsSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "products",
                title: data.name || "Untitled Product",
                submittedBy: data.sellerId || "Unknown Seller", // ideally fetch seller name
                submittedAt: data.createdAt?.toDate() || new Date(),
                status: "pending",
                description: `Price: ${data.price} - Category: ${data.category}`,
                metadata: data,
            });
        });

        // 2. Land Listings
        const landQuery = db.collection("land_listings").where("verificationStatus", "==", "pending");
        const landSnap = await landQuery.get();
        landSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "land",
                title: data.title || "Untitled Land",
                submittedBy: data.ownerName || "Unknown Owner",
                submittedAt: data.createdAt?.toDate() || new Date(),
                status: "pending",
                description: `${data.size} ${data.unit} at ${data.state}, ${data.lga}`,
                metadata: data,
            });
        });

        // 3. Loans
        const loansQuery = db.collection("loans").where("status", "==", "pending");
        const loansSnap = await loansQuery.get();
        loansSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "loans",
                title: `Loan Request: ₦${data.amount?.toLocaleString()}`,
                submittedBy: data.userName || data.userId,
                submittedAt: data.createdAt?.toDate() || new Date(),
                status: "pending",
                description: `Purpose: ${data.purpose}`,
                metadata: data,
            });
        });

        // 4. WAVE Applications
        const waveQuery = db.collection("wave_applications").where("status", "==", "pending");
        const waveSnap = await waveQuery.get();
        waveSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "wave",
                title: `WAVE Application: ${data.businessName || "Unknown Business"}`,
                submittedBy: data.applicantName || data.email || "Unknown Applicant",
                submittedAt: data.createdAt?.toDate() || new Date(),
                status: "pending",
                description: `Business Type: ${data.businessType}`,
                metadata: data,
            });
        });

        // Sort by submittedAt desc
        pendingItems.sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());

        return { success: true, data: pendingItems };

    } catch (error: any) {
        logger.error("Get pending content error:", error);
        return { success: false, error: error.message };
    }
}

export async function approveContentAction(
    id: string,
    type: ContentType
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        switch (type) {
            case "products":
                await db.collection("marketplace_products").doc(id).update({
                    status: "approved",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            case "land":
                await db.collection("land_listings").doc(id).update({
                    verificationStatus: "verified",
                    verifiedAt: timestamp,
                    verifiedBy: adminId,
                });
                break;
            case "loans":
                await db.collection("loans").doc(id).update({
                    status: "approved", // or 'processing' depending on flow, but 'approved' for now
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            case "wave":
                await db.collection("wave_applications").doc(id).update({
                    status: "approved",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            default:
                return { success: false, error: "Invalid content type" };
        }

        return { success: true };

    } catch (error: any) {
        logger.error("Approve content error:", error);
        return { success: false, error: error.message };
    }
}

export async function rejectContentAction(
    id: string,
    type: ContentType,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id || !session.user.roles?.includes("admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        // Validate reason
        if (!reason || reason.trim().length < 5) {
            return { success: false, error: "Rejection reason must be at least 5 characters" };
        }
        if (reason.length > 500) {
            return { success: false, error: "Rejection reason is too long (max 500 characters)" };
        }

        switch (type) {
            case "products":
                await db.collection("marketplace_products").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            case "land":
                await db.collection("land_listings").doc(id).update({
                    verificationStatus: "rejected",
                    verificationNotes: reason, // land uses 'verificationNotes' usually
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            case "loans":
                await db.collection("loans").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            case "wave":
                await db.collection("wave_applications").doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            default:
                return { success: false, error: "Invalid content type" };
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Reject content error:", error);
        return { success: false, error: error.message };
    }
}
