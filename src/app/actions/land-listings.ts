"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log-admin";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { unstable_cache } from "next/cache";
import { isAdmin } from "@/lib/admin-permissions";
import { revalidateTag } from "next/cache";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";

/**
 * Farm Nation - Land Listings & Verification
 */

export interface LandListing {
    id?: string;
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    title: string;
    description: string;
    location: {
        state: string;
        lga: string;
        address: string;
    };
    size: number; // in hectares
    price: number;
    category?: string;
    soilType?: string;
    waterSource?: string;
    images: string[];
    documents: string[];
    status: "draft" | "pending_verification" | "verified" | "rejected";
    verificationStatus?: {
        verified: boolean;
        verifiedBy?: string;
        verifiedAt?: FieldValue | Timestamp;
        rejectionReason?: string;
    };
    createdAt: FieldValue | Timestamp;
    updatedAt: FieldValue | Timestamp;
}

/**
 * Create land listing (draft)
 */
export async function createLandListingAction(data: {
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    title: string;
    description: string;
    location: { state: string; lga: string; address: string };
    size: number;
    price: number;
    category?: string;
    soilType?: string;
    waterSource?: string;
}): Promise<{ error: null, success: true | false; error?: string; listingId?: string }> {
    try {
        const listing: Omit<LandListing, "id"> = {
            ...data,
            images: [],
            documents: [],
            status: "draft",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        await createAdminAuditLog({
            action: "user_update",
            userId: data.ownerId,
            targetId: docRef.id,
            targetType: "land_listing_creation",
        });

        return { error: null, success: true as const, listingId: docRef.id };
    } catch (error) {
        logger.error("Land listing creation error:", error);
        return { success: false as const, error: "Failed to create land listing" };
    }
}

/**
 * Submit listing for verification
 */
async function submitForVerificationAction(
    listingId: string,
    ownerId: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false as const, error: "Listing not found" };
        }

        const listingData = listingDoc.data() as LandListing;

        if (listingData.ownerId !== ownerId) {
            return { success: false as const, error: "Unauthorized" };
        }

        await listingRef.update({
            status: "pending_verification",
            updatedAt: FieldValue.serverTimestamp(),
        });

        return { error: null, success: true };
    } catch (error) {
        logger.error("Verification submission error:", error);
        return { success: false as const, error: "Failed to submit for verification" };
    }
}

/**
 * Admin: Verify land listing
 */
export async function verifyLandListingAction(
    listingId: string,
    adminId: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!isAdmin(session?.user?.roles)) {
            return { success: false as const, error: "Unauthorized: Admin access required" };
        }
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false as const, error: "Listing not found" };
        }

        await listingRef.update({
            status: "verified",
            verificationStatus: {
                verified: true,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        await logAdminAction(
            "land_verified",
            adminId,
            listingId,
            "land_listing"
        );

        revalidateTag("land-listings", "page");
        revalidateTag(`property-${listingId}`, "page");
        await invalidateAdminGlobalStats();

        return { error: null, success: true };
    } catch (error) {
        logger.error("Land verification error:", error);
        return { success: false as const, error: "Failed to verify listing" };
    }
}

/**
 * Admin: Reject land listing
 */
export async function rejectLandListingAction(
    listingId: string,
    adminId: string,
    reason: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
    const { session } = sessionResult;
        if (!isAdmin(session?.user?.roles)) {
            return { success: false as const, error: "Unauthorized: Admin access required" };
        }
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false as const, error: "Listing not found" };
        }

        await listingRef.update({
            status: "rejected",
            verificationStatus: {
                verified: false,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: reason,
            },
            updatedAt: FieldValue.serverTimestamp(),
        });

        await logAdminAction(
            "land_rejected",
            adminId,
            listingId,
            "land_listing",
            reason
        );

        revalidateTag("land-listings", "page");
        revalidateTag(`property-${listingId}`, "page");
        await invalidateAdminGlobalStats();

        return { error: null, success: true };
    } catch (error) {
        logger.error("Land rejection error:", error);
        return { success: false as const, error: "Failed to reject listing" };
    }
}

/**
 * Get verified land listings with filters
 */
export async function searchLandListingsAction(filters: {
    state?: string;
    category?: string;
    minSize?: number;
    maxSize?: number;
    minPrice?: number;
    maxPrice?: number;
    soilType?: string;
    waterSource?: string;
    limit?: number;
    lastDocId?: string;
}): Promise<{ listings: LandListing[]; lastDocId: string | null }> {
    // Generate cache key from filters
    const cacheKeyParts = [
        "land-listings",
        filters.state || "all",
        filters.category || "all",
        filters.minSize?.toString() || "0",
        filters.maxSize?.toString() || "max",
        filters.minPrice?.toString() || "0",
        filters.maxPrice?.toString() || "max",
        filters.soilType || "all",
        filters.waterSource || "all",
        filters.limit?.toString() || "12",
        filters.lastDocId || "start"
    ];

    const getCachedListings = unstable_cache(
        async () => {
            try {
                let q = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "==", "verified")
                    .orderBy("createdAt", "desc"); // Ensure stable ordering

                if (filters.state) {
                    q = q.where("location.state", "==", filters.state);
                }
                if (filters.category) {
                    q = q.where("category", "==", filters.category);
                }

                // Pagination
                if (filters.lastDocId) {
                    const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
                    if (lastDoc.exists) {
                        q = q.startAfter(lastDoc);
                    }
                }

                const limit = filters.limit || 12;
                q = q.limit(limit);

                const snapshot = await q.get();
                let results = serializeDocs(snapshot.docs) as unknown as LandListing[];

                // Client-side filtering for numeric ranges
                if (filters.minSize) {
                    results = results.filter((l) => l.size >= filters.minSize!);
                }
                if (filters.maxSize) {
                    results = results.filter((l) => l.size <= filters.maxSize!);
                }
                if (filters.minPrice) {
                    results = results.filter((l) => l.price >= filters.minPrice!);
                }
                if (filters.maxPrice) {
                    results = results.filter((l) => l.price <= filters.maxPrice!);
                }
                if (filters.soilType) {
                    results = results.filter((l) => l.soilType === filters.soilType);
                }
                if (filters.waterSource) {
                    results = results.filter((l) => l.waterSource === filters.waterSource);
                }

                const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

                return { listings: results, lastDocId };
            } catch (error) {
                logger.error("Land search error:", error);
                return { listings: [], lastDocId: null };
            }
        },
        cacheKeyParts,
        { revalidate: 3600, tags: ["land-listings"] }
    );

    return getCachedListings();
}


/**
 * Get pending land listings (admin)
 */
export async function getPendingLandListingsAction(): Promise<LandListing[]> {
    try {
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "pending_verification")
            .get();

        return serializeDocs(snapshot.docs) as unknown as LandListing[];
    } catch (error) {
        logger.error("Failed to fetch pending listings:", error);
        return [];
    }
}

/**
 * Submit land listing with file uploads
 * NOTE: For MVP, files stored as data strings. Production should use Firebase Storage.
 */
export async function submitLandListingAction(data: {
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    title: string;
    description: string;
    location: { state: string; lga: string; address: string };
    size: number;
    price: number;
    category?: string;
    soilType?: string;
    waterSource?: string;
    imageUrls: string[];
    documentUrls: string[];
    // Optional: GPS coordinates if available
    gpsCoordinates?: { latitude: number; longitude: number };
}): Promise<{ error: null, success: true | false; error?: string; listingId?: string }> {
    try {
        const listing: Omit<LandListing, "id"> = {
            ownerId: data.ownerId,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
            title: data.title,
            description: data.description,
            location: data.location,
            size: data.size,
            price: data.price,
            category: data.category,
            soilType: data.soilType,
            waterSource: data.waterSource,
            images: data.imageUrls,
            documents: data.documentUrls,
            status: "pending_verification",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (data.gpsCoordinates) {
            (listing as LandListing & { gpsCoordinates?: { latitude: number; longitude: number } }).gpsCoordinates = data.gpsCoordinates;
        }

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        // Create audit log
        await createAdminAuditLog({
            action: "user_update",
            userId: data.ownerId,
            userEmail: data.ownerEmail,
            targetId: docRef.id,
            targetType: "land_listing",
            metadata: {
                title: data.title,
                location: data.location.state,
                size: data.size,
                price: data.price,
            },
            details: `Land listing submitted: ${data.title}`,
        });

        // Notify user
        await createNotificationAction({
            userId: data.ownerId,
            type: "info",
            title: "Land Listing Submitted",
            message: `Your land listing "${data.title}" has been submitted for verification.`,
            link: "/land",
            linkText: "View Listings",
        });

        return { success: true as const, listingId: docRef.id };
    } catch (error: any) {
        logger.error("Land listing submission error:", error);
        return { success: false as const, error: error.message || "Failed to submit land listing" };
    }
}

/**
 * Get single land listing by ID
 */
const getCachedPropertyById = (id: string) => unstable_cache(
    async () => {
        try {
            const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
            const docSnap = await docRef.get();

            if (docSnap.exists) {
                return { id: docSnap.id, ...docSnap.data() } as LandListing;
            } else {
                return null;
            }
        } catch (error) {
            logger.error("Error fetching property:", error);
            return null;
        }
    },
    [`property-${id}`],
    { revalidate: 3600, tags: [`property-${id}`] }
)();

export async function getPropertyByIdAction(id: string): Promise<LandListing | null> {
    return getCachedPropertyById(id);
}

/**
 * Submit inquiry for a land listing
 */
export async function submitLandInquiryAction(data: {
    listingId: string;
    listingTitle: string;
    listingOwnerId: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    message: string;
}): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        // 1. Save inquiry to database
        const inquiryRef = await db.collection(COLLECTIONS.LAND_INQUIRIES).add({
            ...data,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            read: false
        });

        // 2. Create notification for the listing owner
        await createNotificationAction({
            userId: data.listingOwnerId,
            type: "info",
            title: "New Land Inquiry",
            message: `You have a new inquiry for "${data.listingTitle}" from ${data.buyerName}.`,
            link: `/farm-nation/inquiries/${inquiryRef.id}`,
            linkText: "View Inquiry",
        });

        // 3. Log action
        await createAdminAuditLog({
            action: "land_inquiry",
            userId: "public_user",
            userEmail: data.buyerEmail,
            targetId: inquiryRef.id,
            targetType: "land_inquiry",
            details: `Inquiry for ${data.listingTitle}`,
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Submit inquiry error:", error);
        return { success: false as const, error: error.message || "Failed to send message" };
    }
}

/**
 * Get inquiries for a user (as seller)
 */
export async function getLandInquiriesAction(userId: string): Promise<{ error: null, success: true | false; inquiries?: any[]; error?: string }> {
    try {
        const snapshot = await db.collection(COLLECTIONS.LAND_INQUIRIES)
            .where("listingOwnerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();
        const inquiries = serializeDocs(snapshot.docs);
        return { success: true as const, inquiries };
    } catch (error: any) {
        logger.error("Get inquiries error:", error);
        return { success: false as const, error: error.message };
    }
}

/**
 * Get single inquiry by ID
 */
export async function getLandInquiryByIdAction(inquiryId: string): Promise<{ error: null, success: true | false; inquiry?: any; error?: string }> {
    try {
        const docRef = db.collection(COLLECTIONS.LAND_INQUIRIES).doc(inquiryId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return { error: null, success: true as const, inquiry: { id: docSnap.id, ...docSnap.data() } };
        } else {
            return { success: false as const, error: "Inquiry not found" };
        }
    } catch (error: any) {
        logger.error("Get inquiry error:", error);
        return { success: false as const, error: error.message };
    }
}

/**
 * Admin: Delete land listing
 */
export async function deleteLandListingAction(
    listingId: string,
    adminId: string
): Promise<{ error: null, success: true | false; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!isAdmin(session?.user?.roles)) {
            return { success: false as const, error: "Unauthorized: Admin access required" };
        }
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false as const, error: "Listing not found" };
        }

        await listingRef.delete();

        await logAdminAction(
            "land_deleted",
            adminId,
            listingId,
            "land_listing",
            "Listing was permanently deleted"
        );

        revalidateTag("land-listings", "page");
        revalidateTag(`property-${listingId}`, "page");
        await invalidateAdminGlobalStats();

        return { error: null, success: true };
    } catch (error) {
        logger.error("Land deletion error:", error);
        return { success: false as const, error: "Failed to delete listing" };
    }
}
