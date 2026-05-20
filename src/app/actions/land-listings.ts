"use server";

import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log-admin";
import { serializeDocs } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { unstable_cache } from "next/cache";
import { isAdmin } from "@/lib/admin-permissions";
import { revalidateTag } from "next/cache";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

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
    availableForSale?: boolean;
    availableForRent?: boolean;
    escrowAvailable?: boolean;
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
async function _createLandListingAction(data: { 
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
}): Promise<ActionResponse<{ listingId: string }>> { 
    try {
        const listing: Omit<LandListing, "id"> = {
            ...data,
            images: [],
            documents: [],
            status: "draft",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        };

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        await createAdminAuditLog({ 
            action: "user_update",
            userId: data.ownerId,
            targetId: docRef.id,
            targetType: "land_listing_creation" 
        });

        return { success: true, error: null, data: { listingId: docRef.id } };
    } catch (error: any) { 
        logger.error("Land listing creation error:", error);
        return { success: false, error: "Failed to create land listing", data: null };
    }
}
export const createLandListingAction = withFlexibleSafeAction("createLandListingAction", _createLandListingAction);

/**
 * Submit listing for verification
 */
async function _submitForVerificationAction(
    listingId: string,
    ownerId: string
): Promise<ActionResponse<null>> { 
    try {
        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        const listingData = listingDoc.data() as LandListing;

        if (listingData.ownerId !== ownerId) { 
            return { success: false, error: "Unauthorized", data: null };
        }

        await listingRef.update({ 
            status: "pending_verification",
            updatedAt: FieldValue.serverTimestamp() 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Verification submission error:", error);
        return { success: false, error: "Failed to submit for verification", data: null };
    }
}
export const submitForVerificationAction = withFlexibleSafeAction("submitForVerificationAction", _submitForVerificationAction);

/**
 * Admin: Verify land listing
 */
async function _verifyLandListingAction(
    listingId: string,
    adminId: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) { 
            return { success: false, error: "Listing not found", data: null };
        }

        await listingRef.update({ 
            status: "verified",
            verificationStatus: {
                verified: true,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp() 
            },
            updatedAt: FieldValue.serverTimestamp() 
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

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land verification error:", error);
        return { success: false, error: "Failed to verify listing", data: null };
    }
}
export const verifyLandListingAction = withFlexibleSafeAction("verifyLandListingAction", _verifyLandListingAction);

/**
 * Admin: Reject land listing
 */
async function _rejectLandListingAction(
    listingId: string,
    adminId: string,
    reason: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) { 
            return { success: false, error: "Listing not found", data: null };
        }

        await listingRef.update({ 
            status: "rejected",
            verificationStatus: {
                verified: false,
                verifiedBy: adminId,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: reason 
            },
            updatedAt: FieldValue.serverTimestamp() 
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

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land rejection error:", error);
        return { success: false, error: "Failed to reject listing", data: null };
    }
}
export const rejectLandListingAction = withFlexibleSafeAction("rejectLandListingAction", _rejectLandListingAction);

const CROP_SOIL_MATRIX: Record<string, string[]> = {
    rice: ["clayey", "loamy"],
    maize: ["loamy", "clayey"],
    beans: ["loamy", "sandy"],
    vegetables: ["loamy"],
    soybeans: ["loamy"],
    tomatoes: ["loamy"],
    pepper: ["loamy"],
    cassava: ["loamy", "sandy"],
    wheat: ["clayey", "loamy"],
    sugarcane: ["clayey"],
    groundnut: ["sandy", "loamy"],
    yams: ["sandy", "loamy"],
    coconut: ["sandy"],
    ginger: ["sandy", "loamy"],
    potatoes: ["sandy", "loamy"],
    sesame: ["loamy", "sandy"],
};

/**
 * Get verified land listings with filters
 */
async function _searchLandListingsAction(filters: { 
    state?: string;
    category?: string;
    minSize?: number;
    maxSize?: number;
    minPrice?: number;
    maxPrice?: number;
    soilType?: string;
    waterSource?: string;
    cropType?: string;
    limit?: number;
    lastDocId?: string; 
}): Promise<ActionResponse<{ listings: LandListing[]; lastDocId: string | null }>> { 
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
        filters.cropType || "all",
        filters.limit?.toString() || "12",
        filters.lastDocId || "start"
    ];

    const getCachedListings = unstable_cache(
        async () => {
            try {
                let q = db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("status", "==", "verified")
                    .orderBy("createdAt", "desc");

                if (filters.state) {
                    q = q.where("location.state", "==", filters.state);
                }
                if (filters.category) { 
                    q = q.where("category", "==", filters.category);
                }

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
                if (filters.minSize) { results = results.filter((l) => l.size >= filters.minSize!); }
                if (filters.maxSize) { results = results.filter((l) => l.size <= filters.maxSize!); }
                if (filters.minPrice) { results = results.filter((l) => l.price >= filters.minPrice!); }
                if (filters.maxPrice) { results = results.filter((l) => l.price <= filters.maxPrice!); }
                if (filters.soilType) { results = results.filter((l) => l.soilType === filters.soilType); }
                if (filters.waterSource) { results = results.filter((l) => l.waterSource === filters.waterSource); }

                // Crop-Soil Suitability Matrix filtering
                if (filters.cropType) {
                    const suitableSoils = CROP_SOIL_MATRIX[filters.cropType.toLowerCase()] || [];
                    if (suitableSoils.length > 0) {
                        results = results.filter((l) => {
                            if (!l.soilType) return false;
                            return suitableSoils.includes(l.soilType.toLowerCase());
                        });
                    } else {
                        results = results.filter((l) => {
                            const desc = l.description?.toLowerCase() || "";
                            const title = l.title?.toLowerCase() || "";
                            const cat = l.category?.toLowerCase() || "";
                            const searchTerm = filters.cropType!.toLowerCase();
                            return desc.includes(searchTerm) || title.includes(searchTerm) || cat.includes(searchTerm);
                        });
                    }
                }

                const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

                return { listings: results, lastDocId };
            } catch (error: any) { 
                logger.error("Land search error:", error);
                return { listings: [], lastDocId: null };
            }
        },
        cacheKeyParts,
        { revalidate: 3600, tags: ["land-listings"] }
    );

    const result = await getCachedListings();
    return { success: true, error: null, data: result };
}
export const searchLandListingsAction = withFlexibleSafeAction("searchLandListingsAction", _searchLandListingsAction);

/**
 * Get pending land listings (admin)
 */
async function _getPendingLandListingsAction(): Promise<ActionResponse<LandListing[]>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "pending_verification")
            .get();

        const listings = serializeDocs(snapshot.docs) as unknown as LandListing[];
        return { success: true, error: null, data: listings };
    } catch (error: any) { 
        logger.error("Failed to fetch pending listings:", error);
        return { success: false, error: "Failed to fetch pending listings", data: null };
    }
}
export const getPendingLandListingsAction = withFlexibleSafeAction("getPendingLandListingsAction", _getPendingLandListingsAction);

/**
 * Submit land listing with file uploads
 */
async function _submitLandListingAction(data: { 
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
    gpsCoordinates?: { latitude: number; longitude: number };
    availableForSale?: boolean;
    availableForRent?: boolean;
    escrowAvailable?: boolean;
}): Promise<ActionResponse<{ listingId: string }>> { 
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
            availableForSale: data.availableForSale ?? true,
            availableForRent: data.availableForRent ?? false,
            escrowAvailable: data.escrowAvailable ?? true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
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
                price: data.price 
            },
            details: `Land listing submitted: ${data.title}` 
        });

        // Notify user
        await createNotificationAction({
            userId: data.ownerId,
            type: "info",
            title: "Land Listing Submitted",
            message: `Your land listing "${data.title}" has been submitted for verification.`,
            link: "/land",
            linkText: "View Listings" 
        });

        return { success: true, error: null, data: { listingId: docRef.id } };
    } catch (error: any) { 
        logger.error("Land listing submission error:", error);
        return { success: false, error: error.message || "Failed to submit land listing", data: null };
    }
}
export const submitLandListingAction = withFlexibleSafeAction("submitLandListingAction", _submitLandListingAction);

/**
 * Get single land listing by ID
 */
async function _getPropertyByIdAction(id: string): Promise<ActionResponse<LandListing | null>> { 
    try {
        const result = await unstable_cache(
            async () => { 
                try {
                    const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
                    const docSnap = await docRef.get();

                    if (docSnap.exists) {
                        return { id: docSnap.id, ...docSnap.data() } as LandListing;
                    } else { 
                        return null;
                    }
                } catch (error: any) { 
                    logger.error("Error fetching property:", error);
                    return null;
                }
            },
            [`property-${id}`],
            { revalidate: 3600, tags: [`property-${id}`] }
        )();
        
        return { success: true, error: null, data: result };
    } catch (error: any) {
        logger.error("getPropertyByIdAction error:", error);
        return { success: false, error: "Failed to fetch property", data: null };
    }
}
export const getPropertyByIdAction = withFlexibleSafeAction("getPropertyByIdAction", _getPropertyByIdAction);

/**
 * Submit inquiry for a land listing
 */
async function _submitLandInquiryAction(data: { 
    listingId: string;
    listingTitle: string;
    listingOwnerId: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    message: string; 
}): Promise<ActionResponse<null>> { 
    try {
        const inquiryRef = await db.collection(COLLECTIONS.LAND_INQUIRIES).add({
            ...data,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            read: false
        });

        await createNotificationAction({
            userId: data.listingOwnerId,
            type: "info",
            title: "New Land Inquiry",
            message: `You have a new inquiry for "${data.listingTitle}" from ${data.buyerName}.`,
            link: `/farm-nation/inquiries/${inquiryRef.id}`,
            linkText: "View Inquiry" 
        });

        await createAdminAuditLog({
            action: "land_inquiry",
            userId: "public_user",
            userEmail: data.buyerEmail,
            targetId: inquiryRef.id,
            targetType: "land_inquiry",
            details: `Inquiry for ${data.listingTitle}` 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Submit inquiry error:", error);
        return { success: false, error: error.message || "Failed to send message", data: null };
    }
}
export const submitLandInquiryAction = withFlexibleSafeAction("submitLandInquiryAction", _submitLandInquiryAction);

/**
 * Get inquiries for a user (as seller)
 */
async function _getLandInquiriesAction(userId: string): Promise<ActionResponse<any[]>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        
        const snapshot = await db.collection(COLLECTIONS.LAND_INQUIRIES)
            .where("listingOwnerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();
        const inquiries = serializeDocs(snapshot.docs);
        return { success: true, error: null, data: inquiries };
    } catch (error: any) { 
        logger.error("Get inquiries error:", error);
        return { success: false, error: error.message || "Failed to fetch inquiries", data: null };
    }
}
export const getLandInquiriesAction = withFlexibleSafeAction("getLandInquiriesAction", _getLandInquiriesAction);

/**
 * Get single inquiry by ID
 */
async function _getLandInquiryByIdAction(inquiryId: string): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const docRef = db.collection(COLLECTIONS.LAND_INQUIRIES).doc(inquiryId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            return { success: true, error: null, data: { id: docSnap.id, ...docSnap.data() } };
        } else { 
            return { success: false, error: "Inquiry not found", data: null };
        }
    } catch (error: any) { 
        logger.error("Get inquiry error:", error);
        return { success: false, error: error.message || "Failed to fetch inquiry", data: null };
    }
}
export const getLandInquiryByIdAction = withFlexibleSafeAction("getLandInquiryByIdAction", _getLandInquiryByIdAction);

/**
 * Admin: Delete land listing
 */
async function _deleteLandListingAction(
    listingId: string,
    adminId: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) { 
            return { success: false, error: "Listing not found", data: null };
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

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land deletion error:", error);
        return { success: false, error: "Failed to delete listing", data: null };
    }
}
export const deleteLandListingAction = withFlexibleSafeAction("deleteLandListingAction", _deleteLandListingAction);
