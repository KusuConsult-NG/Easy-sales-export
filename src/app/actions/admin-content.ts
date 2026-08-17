"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { FieldValue } from "@/lib/firestore-compat";
import { serializeValue } from "@/lib/firestore-serialize";
import {
    AWAITING_REVIEW_STATUSES,
    PURCHASABLE_STATUSES,
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
} from "@/lib/land-listing-status";

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

// sanitizeForSerialization() has been replaced by the shared serializeValue() from @/lib/firestore-serialize.
// serializeValue is a superset: it also handles plain-object Timestamps (_seconds/_nanoseconds).

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
        //
        // Sets, not single values. "pending" meant `pending_verification` alone,
        // omitting `inspection_scheduled` — a listing with an inspector
        // dispatched and no decision yet — and "approved" meant `verified`
        // alone, omitting the `available` that farm-nation's own creation path
        // writes and the `approved` that land-visibility.ts honours. So this
        // console's approved tab and its counts showed a subset of the approved
        // inventory, and its pending tab a subset of the queue.
        const landStatuses: readonly string[] =
            status === "pending" ? [...AWAITING_REVIEW_STATUSES]
            : status === "approved" ? [...PURCHASABLE_STATUSES]
            : ["rejected"];
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
                metadata: serializeValue(data) as Record<string, unknown>,
            });
        });

        // 2. Land Listings
        const landQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "in", [...landStatuses])
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
                metadata: serializeValue(data) as Record<string, unknown>,
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
                metadata: serializeValue(data) as Record<string, unknown>,
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
            // The same sets as the list above, so the tab and its badge agree.
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...AWAITING_REVIEW_STATUSES]).count().get(),
            db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...PURCHASABLE_STATUSES]).count().get(),
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
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        // Live role re-validation — bypasses the stale JWT.
        //
        // getContentApprovalItemsAction, twenty lines above in this same file,
        // reads the caller's roles from the database before listing anything.
        // These two endpoints — which mark land VERIFIED, put products live and
        // publish export listings — trusted session.user.roles alone, so the
        // read beside them was better protected than the writes.
        //
        // In practice the gap is small: role changes invalidate the user's cache
        // and the JWT callback resynchronises from it. This is consistency
        // rather than a live hole, and it costs one document read on an action
        // an admin performs by hand. Recorded that way rather than overstated.
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];
        if (!callerDoc.exists || !isAdmin(callerRoles)) {
            return { success: false as const, error: "Unauthorized" , data: null };
        }

        const timestamp = FieldValue.serverTimestamp();
        const adminId = session.user.id;

        const result = await db.runTransaction(async (transaction) => {
            switch (type) {
                case "products": {
                    const docRef = db.collection(COLLECTIONS.PRODUCTS).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Product listing not found" };
                    }
                    transaction.update(docRef, {
                        status: "active",
                        approvedAt: timestamp,
                        approvedBy: adminId,
                    });
                    break;
                }
                case "land": {
                    const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Land listing not found" };
                    }

                    // The state check the other land decision paths do, done here
                    // too. This is a transaction, so the read above and the write
                    // below cannot be raced — what was missing is any check on
                    // WHICH state it read. Approving a listing in pending_escrow
                    // put the parcel back on the public market with a buyer's
                    // money held against it; approving one already `sold`
                    // reopened it outright.
                    const landStatusNow = String(docSnap.data()?.status ?? "");
                    if (!APPROVABLE_FROM_STATUSES.includes(landStatusNow)) {
                        return {
                            success: false as const,
                            error: `This land listing is '${landStatusNow}' and cannot be approved ` +
                                `from that state. A listing with a purchase in progress must be ` +
                                `resolved first.`,
                        };
                    }

                    transaction.update(docRef, {
                        status: "verified",
                        verificationStatus: "approved",
                        verified: true,
                        verifiedAt: timestamp,
                        verifiedBy: adminId,
                        rejectionReason: null,
                        statusBeforeVerification: landStatusNow,
                    });
                    break;
                }
                case "export": {
                    const docRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Export listing not found" };
                    }
                    transaction.update(docRef, {
                        status: "live",
                        isActive: true,
                        approvedAt: timestamp,
                        approvedBy: adminId,
                    });
                    break;
                }
                default:
                    return { success: false as const, error: "Invalid content type" };
            }
            return { success: true as const, error: null, ownerId: type === "land" ? (await db.collection(COLLECTIONS.LAND_LISTINGS).doc(id).get()).data()?.ownerId : null };
        });

        if (!result.success) {
            return { success: false as const, error: result.error || "Approval failed", data: null };
        }

        if (result.success && type === "land" && (result as any).ownerId) {
            try {
                const { invalidateServiceCache } = await import('@/lib/cache-invalidation');
                await invalidateServiceCache((result as any).ownerId, 'farmNation');
                logger.info(`[Content Approval] Cache cleared for user: ${(result as any).ownerId}`);
            } catch (cacheError) {
                logger.error('[Content Approval] Cache clear error:', cacheError);
            }
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
        if (!session?.user?.id) {
            return { success: false as const, error: "Not authenticated" , data: null };
        }

        // Live role re-validation — bypasses the stale JWT.
        //
        // getContentApprovalItemsAction, twenty lines above in this same file,
        // reads the caller's roles from the database before listing anything.
        // These two endpoints — which mark land VERIFIED, put products live and
        // publish export listings — trusted session.user.roles alone, so the
        // read beside them was better protected than the writes.
        //
        // In practice the gap is small: role changes invalidate the user's cache
        // and the JWT callback resynchronises from it. This is consistency
        // rather than a live hole, and it costs one document read on an action
        // an admin performs by hand. Recorded that way rather than overstated.
        const callerDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const callerRoles: string[] = callerDoc.data()?.roles ?? [];
        if (!callerDoc.exists || !isAdmin(callerRoles)) {
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

        const result = await db.runTransaction(async (transaction) => {
            switch (type) {
                case "products": {
                    const docRef = db.collection(COLLECTIONS.PRODUCTS).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Product listing not found" };
                    }
                    transaction.update(docRef, {
                        status: "rejected",
                        rejectionReason: reason,
                        rejectedAt: timestamp,
                        rejectedBy: adminId,
                    });
                    break;
                }
                case "land": {
                    const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Land listing not found" };
                    }

                    // See the approval case above. Rejecting from pending_escrow
                    // took the parcel off the market while the buyer's money
                    // stayed held, with nothing in the flow to release it.
                    const landStatusNow = String(docSnap.data()?.status ?? "");
                    if (!REJECTABLE_FROM_STATUSES.includes(landStatusNow)) {
                        return {
                            success: false as const,
                            error: `This land listing is '${landStatusNow}' and cannot be rejected ` +
                                `from that state. A listing with a purchase in progress must be ` +
                                `resolved first.`,
                        };
                    }

                    transaction.update(docRef, {
                        status: "rejected",
                        verificationStatus: "rejected",
                        verificationNotes: reason,
                        rejectionReason: reason,
                        rejectedAt: timestamp,
                        rejectedBy: adminId,
                        verified: false,
                        statusBeforeRejection: landStatusNow,
                    });
                    break;
                }
                case "export": {
                    const docRef = db.collection(COLLECTIONS.EXPORT_CATALOG).doc(id);
                    const docSnap = await transaction.get(docRef);
                    if (!docSnap.exists) {
                        return { success: false as const, error: "Export listing not found" };
                    }
                    transaction.update(docRef, {
                        status: "rejected",
                        isActive: false,
                        rejectionReason: reason,
                        rejectedAt: timestamp,
                        rejectedBy: adminId,
                    });
                    break;
                }
                default:
                    return { success: false as const, error: "Invalid content type" };
            }
            return { success: true as const, error: null };
        });

        if (!result.success) {
            return { success: false as const, error: result.error || "Rejection failed", data: null };
        }

        return { error: null,  success: true as const , data: null };
    } catch (error: any) {
        logger.error("Reject content error:", error);
        return { success: false as const, error: error.message , data: null };
    }
}
