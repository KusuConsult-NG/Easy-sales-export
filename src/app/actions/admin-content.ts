"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "firebase-admin/firestore";

export type ContentType = "products" | "land" | "certificates" | "resources" | "courses";
export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface PendingContentItem {
    id: string;
    type: ContentType;
    title: string;
    submittedBy: string; // Email or Name
    submittedAt: string; // ISO string (Date objects can't cross server action boundary)
    status: ApprovalStatus;
    description?: string;
    metadata?: Record<string, unknown>; // Sanitized document data
}

/** Convert Firestore Timestamps / Date objects to ISO strings so the
 *  value can be serialized across the Server Action boundary. */
function sanitizeForSerialization(obj: unknown): unknown {
    if (obj === null || obj === undefined) return obj;
    // Firestore Timestamp
    if (typeof obj === "object" && typeof (obj as any).toDate === "function") {
        return (obj as any).toDate().toISOString();
    }
    if (obj instanceof Date) return obj.toISOString();
    if (Array.isArray(obj)) return obj.map(sanitizeForSerialization);
    if (typeof obj === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            out[k] = sanitizeForSerialization(v);
        }
        return out;
    }
    return obj;
}

/**
 * Fetches all pending content from various collections.
 * Aggregates:
 * - Marketplace Products (status: pending)
 * - Land Listings (verificationStatus: pending)
 * - Marketplace Products (status: pending)
 * - Land Listings (verificationStatus: pending)
 */
export async function getPendingContentAction(): Promise<{
    error: null, success: true | false;
    data?: PendingContentItem[];
    error?: string;
}> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const roles = userData?.roles || [];
        if (!userDoc.exists || !userData || !isAdmin(roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const pendingItems: PendingContentItem[] = [];

        // 1. Marketplace Products
        const productsQuery = db.collection(COLLECTIONS.MARKETPLACE_PRODUCTS)
            .where("status", "==", "pending")
            .limit(500);
        const productsSnap = await productsQuery.get();
        productsSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "products",
                title: data.name || "Untitled Product",
                submittedBy: data.sellerId || "Unknown Seller",
                submittedAt: (data.createdAt?.toDate() || new Date()).toISOString(),
                status: "pending",
                description: `Price: ${data.price} - Category: ${data.category}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        });

        // 2. Land Listings
        const landQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("verificationStatus", "==", "pending")
            .limit(500);
        const landSnap = await landQuery.get();
        landSnap.forEach((doc) => {
            const data = doc.data();
            pendingItems.push({
                id: doc.id,
                type: "land",
                title: data.title || "Untitled Land",
                submittedBy: data.ownerName || "Unknown Owner",
                submittedAt: (data.createdAt?.toDate() || new Date()).toISOString(),
                status: "pending",
                description: `${data.size} ${data.unit} at ${data.state}, ${data.lga}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        });

        // Removed Loans and WAVE logic from Content Approval Center since they have dedicated administrative dashboards.

        // Sort by submittedAt desc (ISO strings sort lexicographically)
        pendingItems.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

        return { error: null, success: true as const, data: pendingItems };

    } catch (error: any) {
        logger.error("Get pending content error:", error);
        return { success: false as const, error: error.message };
    }
}

export async function approveContentAction(
    id: string,
    type: ContentType
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        switch (type) {
            case "products":
                await db.collection(COLLECTIONS.MARKETPLACE_PRODUCTS).doc(id).update({
                    status: "approved",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            case "land":
                await db.collection(COLLECTIONS.LAND_LISTINGS).doc(id).update({
                    verificationStatus: "verified",
                    verifiedAt: timestamp,
                    verifiedBy: adminId,
                });
                break;
            default:
                return { success: false as const, error: "Invalid content type" };
        }

        return { error: null, success: true };

    } catch (error: any) {
        logger.error("Approve content error:", error);
        return { success: false as const, error: error.message };
    }
}

export async function rejectContentAction(
    id: string,
    type: ContentType,
    reason: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        // Validate reason
        if (!reason || reason.trim().length < 5) {
            return { success: false as const, error: "Rejection reason must be at least 5 characters" };
        }
        if (reason.length > 500) {
            return { success: false as const, error: "Rejection reason is too long (max 500 characters)" };
        }

        switch (type) {
            case "products":
                await db.collection(COLLECTIONS.MARKETPLACE_PRODUCTS).doc(id).update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            case "land":
                await db.collection(COLLECTIONS.LAND_LISTINGS).doc(id).update({
                    verificationStatus: "rejected",
                    verificationNotes: reason, // land uses 'verificationNotes' usually
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            default:
                return { success: false as const, error: "Invalid content type" };
        }

        return { success: true };
    } catch (error: any) {
        logger.error("Reject content error:", error);
        return { success: false as const, error: error.message };
    }
}
