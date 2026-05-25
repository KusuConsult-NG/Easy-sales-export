"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "firebase-admin/firestore";

export type ContentType = "products" | "land" | "certificates" | "resources" | "courses" | "export";
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
 * Fetches all content from various collections matching the given status.
 * Aggregates:
 * - Marketplace Products
 * - Land Listings
 * - Export Catalog
 */
export async function getContentApprovalItemsAction(
    status: ApprovalStatus = "pending"
): Promise<
    | { success: true; error: null; data: PendingContentItem[]; stats: { pending: number; approved: number; rejected: number }; [key: string]: any }
    | { success: false; error: string; data: null; stats?: null; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        // Check admin role
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();
        const roles = userData?.roles || [];
        if (!userDoc.exists || !userData || !isAdmin(roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const items: PendingContentItem[] = [];

        // Determine Firestore query filters per status
        // products
        const productStatus = status === "pending" ? "pending" : status === "approved" ? "active" : "rejected";
        // land listings
        const landStatus = status === "pending" ? "pending_verification" : status === "approved" ? "verified" : "rejected";
        // export catalog
        const exportStatus = status === "pending" ? "pending" : status === "approved" ? "live" : "rejected";

        // 1. Marketplace Products
        const productsQuery = db.collection(COLLECTIONS.PRODUCTS)
            .where("status", "==", productStatus)
            .limit(500);
        const productsSnap = await productsQuery.get();
        productsSnap.forEach((doc) => {
            const data = doc.data();
            const retailPrice = data.pricingTiers?.find((t: any) => t.type === "retail")?.price || data.pricingTiers?.[0]?.price || data.price || 0;
            items.push({
                id: doc.id,
                type: "products",
                title: data.title || data.name || "Untitled Product",
                submittedBy: data.sellerName || data.sellerId || "Unknown Seller",
                submittedAt: (typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate() : new Date(data.createdAt || Date.now())).toISOString(),
                status: status,
                description: `Price: ₦${retailPrice.toLocaleString()} - Category: ${data.category}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        });

        // 2. Land Listings
        const landQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", landStatus)
            .limit(500);
        const landSnap = await landQuery.get();
        landSnap.forEach((doc) => {
            const data = doc.data();
            items.push({
                id: doc.id,
                type: "land",
                title: data.title || "Untitled Land",
                submittedBy: data.ownerName || data.ownerEmail || data.ownerId || "Unknown Owner",
                submittedAt: (typeof data.createdAt?.toDate === 'function' ? data.createdAt.toDate() : new Date(data.createdAt || Date.now())).toISOString(),
                status: status,
                description: `${data.size} ${data.unit || 'acres'} at ${data.location?.state || data.state || 'Unknown State'}, ${data.location?.lga || data.lga || 'Unknown LGA'}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        });

        // 3. Export Catalog
        const exportQuery = db.collection(COLLECTIONS.EXPORT_CATALOG)
            .where("status", "==", exportStatus)
            .limit(500);
        const exportSnap = await exportQuery.get();
        exportSnap.forEach((doc) => {
            const data = doc.data();
            items.push({
                id: doc.id,
                type: "export",
                title: data.productName || data.title || "Untitled Export",
                submittedBy: data.userId || "Unknown User",
                submittedAt: (data.createdAt?.toDate ? data.createdAt.toDate() : new Date(data.createdAt || Date.now())).toISOString(),
                status: status,
                description: `${data.category || "General"} - ${data.availableQuantity || 0} ${data.unit || "units"}`,
                metadata: sanitizeForSerialization(data) as Record<string, unknown>,
            });
        });

        // Sort by submittedAt desc (ISO strings sort lexicographically)
        items.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

        // Fast count aggregations across the three collections for global totals
        const [
            pendingProductsCount,
            approvedProductsCount,
            rejectedProductsCount,
            pendingLandCount,
            approvedLandCount,
            rejectedLandCount,
            pendingExportCount,
            approvedExportCount,
            rejectedExportCount,
        ] = await Promise.all([
            db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "active").count().get(),
            db.collection(COLLECTIONS.PRODUCTS).where("status", "==", "rejected").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "pending_verification").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified").count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "rejected").count().get(),
            db.collection(COLLECTIONS.EXPORT_CATALOG).where("status", "==", "pending").count().get(),
            db.collection(COLLECTIONS.EXPORT_CATALOG).where("status", "==", "live").count().get(),
            db.collection(COLLECTIONS.EXPORT_CATALOG).where("status", "==", "rejected").count().get(),
        ]);

        const stats = {
            pending: pendingProductsCount.data().count + pendingLandCount.data().count + pendingExportCount.data().count,
            approved: approvedProductsCount.data().count + approvedLandCount.data().count + approvedExportCount.data().count,
            rejected: rejectedProductsCount.data().count + rejectedLandCount.data().count + rejectedExportCount.data().count,
            typeStats: {
                products: {
                    pending: pendingProductsCount.data().count,
                    approved: approvedProductsCount.data().count,
                    rejected: rejectedProductsCount.data().count,
                },
                land: {
                    pending: pendingLandCount.data().count,
                    approved: approvedLandCount.data().count,
                    rejected: rejectedLandCount.data().count,
                },
                export: {
                    pending: pendingExportCount.data().count,
                    approved: approvedExportCount.data().count,
                    rejected: rejectedExportCount.data().count,
                }
            }
        };

        return { error: null, success: true as const, data: items, stats };

    } catch (error: any) {
        logger.error("Get content approval items error:", error);
        return { success: false as const, error: error.message , data: null };
    }
}

export async function getPendingContentAction(): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    const res = await getContentApprovalItemsAction("pending");
    if (!res.success) {
        return { success: false, error: res.error, data: null };
    }
    return { success: true, error: null, data: res.data };
}

export async function approveContentAction(
    id: string,
    type: ContentType
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        switch (type) {
            case "products": {
                const docRef = db.collection(COLLECTIONS.PRODUCTS).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Product listing not found" , data: null };
                }
                await docRef.update({
                    status: "active",
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            }
            case "land": {
                const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Land listing not found" , data: null };
                }
                await docRef.update({
                    status: "verified",
                    verificationStatus: "verified",
                    verifiedAt: timestamp,
                    verifiedBy: adminId,
                });
                break;
            }
            case "export": {
                const docRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Export listing not found" , data: null };
                }
                await docRef.update({
                    status: "live",
                    isActive: true,
                    approvedAt: timestamp,
                    approvedBy: adminId,
                });
                break;
            }
            default:
                return { success: false as const, error: "Invalid content type" , data: null };
        }

        return { error: null, success: true as const , data: null };

    } catch (error: any) {
        logger.error("Approve content error:", error);
        return { success: false as const, error: error.message , data: null };
    }
}

export async function rejectContentAction(
    id: string,
    type: ContentType,
    reason: string
): Promise<
    | { success: true; error: null; data?: any; meta?: any; [key: string]: any }
    | { success: false; error: string; data?: null; meta?: any; [key: string]: any }
> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
        if (!session?.user?.id || !isAdmin(session.user.roles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        // Validate reason
        if (!reason || reason.trim().length < 5) {
            return { success: false as const, error: "Rejection reason must be at least 5 characters" , data: null };
        }
        if (reason.length > 500) {
            return { success: false as const, error: "Rejection reason is too long (max 500 characters)" , data: null };
        }

        switch (type) {
            case "products": {
                const docRef = db.collection(COLLECTIONS.PRODUCTS).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Product listing not found" , data: null };
                }
                await docRef.update({
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            }
            case "land": {
                const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Land listing not found" , data: null };
                }
                await docRef.update({
                    status: "rejected",
                    verificationStatus: "rejected",
                    verificationNotes: reason,
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            }
            case "export": {
                const docRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(id);
                const docSnap = await docRef.get();
                if (!docSnap.exists) {
                    return { success: false as const, error: "Export listing not found" , data: null };
                }
                await docRef.update({
                    status: "rejected",
                    isActive: false,
                    rejectionReason: reason,
                    rejectedAt: timestamp,
                    rejectedBy: adminId,
                });
                break;
            }
            default:
                return { success: false as const, error: "Invalid content type" , data: null };
        }

        return { error: null,  success: true as const , data: null };
    } catch (error: any) {
        logger.error("Reject content error:", error);
        return { success: false as const, error: error.message , data: null };
    }
}
