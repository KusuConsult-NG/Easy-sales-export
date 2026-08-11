"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { isAdmin } from "@/lib/admin-permissions";
import { revalidateTag } from "next/cache";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";

/**
 * Farm Nation - Land Listings & Verification
 */

export interface LandListing { 
    id?: string;
    type?: "sale" | "rent" | "lease";
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
    category?: string | string[];
    soilType?: string;
    waterSource?: string;
    images: string[];
    documents: string[];
    status: "draft" | "pending_verification" | "verified" | "rejected" | "sold" | "leased";
    availableForSale?: boolean;
    availableForRent?: boolean;
    availableForLease?: boolean;
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
        // This action had no session guard at all, and took ownerId as a
        // parameter — so a listing could be created in anyone's name, and the
        // audit row below recorded the nominated owner rather than the actor.
        //
        // The owner is taken from the session now. The parameter is still
        // accepted so existing callers compile, and deliberately ignored.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;
        const ownerId = session.user.id;

        const listing: Omit<LandListing, "id"> = {
            ...data,
            // After the spread, so a caller-supplied ownerId cannot survive.
            ownerId,
            ownerName: session.user.name || data.ownerName,
            ownerEmail: session.user.email || data.ownerEmail,
            images: [],
            documents: [],
            status: "draft",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        await createAdminAuditLog({
            action: "user_update",
            userId: ownerId,
            targetId: docRef.id,
            targetType: "land_listing_creation" 
        });

        return { success: true, error: null, data: { listingId: docRef.id } };
    } catch (error: any) { 
        logger.error("Land listing creation error:", error);
        return { success: false, error: "Failed to create land listing", data: null };
    }
}
export async function createLandListingAction(...args: Parameters<typeof _createLandListingAction>) {
    return withFlexibleSafeAction("createLandListingAction", _createLandListingAction)(...args);
}

/**
 * Submit listing for verification
 */
async function _submitForVerificationAction(
    listingId: string,
    ownerId: string
): Promise<ActionResponse<null>> { 
    try {
        // WHAT WAS WRONG HERE
        // -------------------
        // There was no session guard, and the ownership check was:
        //
        //     if (listingData.ownerId !== ownerId)   // ownerId is a PARAMETER
        //
        // It compared the record's owner against a value the caller supplied.
        // Pass the real owner's id — which is readable from the listing itself,
        // since getPropertyByIdAction is public — and the check passes.
        //
        // That is worse than having no check, because it reads as one. The
        // function directly below this, _verifyLandListingAction, has always
        // called requireSession: the guard was on the sibling and not on this.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        const listingData = listingDoc.data() as LandListing;

        // Compared against the SESSION now. The ownerId parameter is retained
        // for call-site compatibility and is not trusted.
        if (listingData.ownerId !== session.user.id && !isAdmin(session.user.roles)) {
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
export async function submitForVerificationAction(...args: Parameters<typeof _submitForVerificationAction>) {
    return withFlexibleSafeAction("submitForVerificationAction", _submitForVerificationAction)(...args);
}

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
export async function verifyLandListingAction(...args: Parameters<typeof _verifyLandListingAction>) {
    return withFlexibleSafeAction("verifyLandListingAction", _verifyLandListingAction)(...args);
}

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
export async function rejectLandListingAction(...args: Parameters<typeof _rejectLandListingAction>) {
    return withFlexibleSafeAction("rejectLandListingAction", _rejectLandListingAction)(...args);
}

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
    type?: "sale" | "rent" | "lease";
}): Promise<ActionResponse<{ listings: LandListing[]; lastDocId: string | null }>> { 
    try {
        let q = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "verified")
            .orderBy("createdAt", "desc");

        if (filters.state) {
            q = q.where("location.state", "==", filters.state);
        }

        if (filters.lastDocId) { 
            const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const limit = filters.limit || 12;
        q = q.limit(limit);

        let snapshot;
        let indexError = false;
        try {
            snapshot = await q.get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Land search failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                
                // Fallback without orderBy
                let fallbackQuery = db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "==", "verified");
                if (filters.state) fallbackQuery = fallbackQuery.where("location.state", "==", filters.state);
                
                if (filters.lastDocId) { 
                    const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
                    if (lastDoc.exists) fallbackQuery = fallbackQuery.startAfter(lastDoc);
                }
                fallbackQuery = fallbackQuery.limit(limit);
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }

        let results = serializeDocs(snapshot.docs) as unknown as LandListing[];
        
        if (indexError) {
            results.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                if (typeof aVal === 'string') aVal = new Date(aVal).getTime();
                if (typeof bVal === 'string') bVal = new Date(bVal).getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        // Client-side filtering for numeric ranges
        if (filters.minSize) {
            const minSize = filters.minSize;
            results = results.filter((l) => l.size >= minSize);
        }
        if (filters.maxSize) {
            const maxSize = filters.maxSize;
            results = results.filter((l) => l.size <= maxSize);
        }
        if (filters.minPrice) {
            const minPrice = filters.minPrice;
            results = results.filter((l) => l.price >= minPrice);
        }
        if (filters.maxPrice) {
            const maxPrice = filters.maxPrice;
            results = results.filter((l) => l.price <= maxPrice);
        }
        if (filters.soilType) { results = results.filter((l) => l.soilType === filters.soilType); }
        if (filters.waterSource) { results = results.filter((l) => l.waterSource === filters.waterSource); }
        if (filters.type) { results = results.filter((l) => l.type === filters.type); }

        // Client-side filtering for category (supports legacy string and new string array)
        if (filters.category) {
            const categoryFilter = filters.category;
            results = results.filter((l) => {
                if (!l.category) return false;
                if (Array.isArray(l.category)) {
                    return l.category.includes(categoryFilter);
                }
                if (typeof l.category === "string") {
                    const cats = l.category.split(",").map(c => c.trim().toLowerCase());
                    return cats.includes(categoryFilter.toLowerCase()) || l.category === categoryFilter;
                }
                return false;
            });
        }

        // Crop-Soil Suitability Matrix filtering
        if (filters.cropType) {
            const cropTypeFilter = filters.cropType;
            const suitableSoils = CROP_SOIL_MATRIX[cropTypeFilter.toLowerCase()] || [];
            if (suitableSoils.length > 0) {
                results = results.filter((l) => {
                    if (!l.soilType) return false;
                    return suitableSoils.includes(l.soilType.toLowerCase());
                });
            } else {
                results = results.filter((l) => {
                    const desc = l.description?.toLowerCase() || "";
                    const title = l.title?.toLowerCase() || "";
                    const cat = (Array.isArray(l.category) 
                        ? l.category.join(", ") 
                        : l.category)?.toLowerCase() || "";
                    const searchTerm = cropTypeFilter.toLowerCase();
                    return desc.includes(searchTerm) || title.includes(searchTerm) || cat.includes(searchTerm);
                });
            }
        }

        const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        return { success: true, error: null, data: { listings: results, lastDocId } };
    } catch (error: any) { 
        logger.error("Land search error:", error);
        throw error;
    }
}
export async function searchLandListingsAction(...args: Parameters<typeof _searchLandListingsAction>) {
    return withFlexibleSafeAction("searchLandListingsAction", _searchLandListingsAction)(...args);
}

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
export async function getPendingLandListingsAction(...args: Parameters<typeof _getPendingLandListingsAction>) {
    return withFlexibleSafeAction("getPendingLandListingsAction", _getPendingLandListingsAction)(...args);
}

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
    category?: string | string[];
    soilType?: string;
    waterSource?: string;
    imageUrls: string[];
    documentUrls: string[];
    gpsCoordinates?: { latitude: number; longitude: number };
    availableForSale?: boolean;
    availableForRent?: boolean;
    availableForLease?: boolean;
    type?: "sale" | "rent" | "lease";
    escrowAvailable?: boolean;
}): Promise<ActionResponse<{ listingId: string }>> {
    try {
        // The live one — /land/submit and farm-nation/list-land both call it.
        // It had no session guard and took ownerId from the request, so a
        // listing could be published in anyone's name.
        //
        // Both callers already pass `session.user.id` from the client session,
        // so reading it server-side changes nothing they do; it only makes the
        // value trustworthy.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        const listing: any = {
            ownerId: session.user.id,
            ownerName: session.user.name || data.ownerName,
            ownerEmail: session.user.email || data.ownerEmail,
            title: data.title,
            description: data.description,
            location: data.location,
            size: data.size,
            price: data.price,
            images: data.imageUrls,
            documents: data.documentUrls,
            status: "pending_verification",
            availableForSale: data.availableForSale ?? true,
            availableForRent: data.availableForRent ?? false,
            availableForLease: data.availableForLease ?? false,
            type: data.type || ((data.availableForRent && !data.availableForSale) ? "lease" : "sale"),
            escrowAvailable: data.escrowAvailable ?? true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        };

        if (data.category !== undefined) listing.category = data.category;
        if (data.soilType !== undefined) listing.soilType = data.soilType;
        if (data.waterSource !== undefined) listing.waterSource = data.waterSource;

        if (data.gpsCoordinates) { 
            listing.gpsCoordinates = data.gpsCoordinates;
        }

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        // Create audit log
        //
        // session.user.id, not data.ownerId. The listing above was fixed to
        // take its owner from the session, and this was left reading the
        // request — so the audit row still recorded the nominated user as the
        // actor, and the notification below still went to them.
        //
        // One copy of a path fixed and its siblings missed, inside a single
        // function. Exactly the shape this codebase keeps producing.
        await createAdminAuditLog({ 
            action: "user_update",
            userId: session.user.id,
            userEmail: session.user.email || data.ownerEmail,
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

        // Notify user — the one who actually submitted it.
        await createNotificationAction({
            userId: session.user.id,
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
export async function submitLandListingAction(...args: Parameters<typeof _submitLandListingAction>) {
    return withFlexibleSafeAction("submitLandListingAction", _submitLandListingAction)(...args);
}

/**
 * Get single land listing by ID
 */
async function _getPropertyByIdAction(id: string): Promise<ActionResponse<LandListing | null>> { 
    try {
        const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            // ✅ FIX: serializeValue converts Firestore Timestamps to ISO strings
            // so the result is safe to pass across the server→client boundary.
            const data = { id: docSnap.id, ...serializeValue(docSnap.data()) } as LandListing;
            return { success: true, error: null, data };
        } else { 
            return { success: true, error: null, data: null };
        }
    } catch (error: any) {
        logger.error("getPropertyByIdAction error:", error);
        return { success: false, error: "Failed to fetch property", data: null };
    }
}
export async function getPropertyByIdAction(...args: Parameters<typeof _getPropertyByIdAction>) {
    return withFlexibleSafeAction("getPropertyByIdAction", _getPropertyByIdAction)(...args);
}

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
        // Left PUBLIC on purpose — someone enquiring about land should not need
        // an account first, and that is a product decision rather than an
        // oversight.
        //
        // What was wrong is narrower: `listingOwnerId` and `listingTitle` came
        // from the caller and were passed straight into createNotificationAction.
        // So this was an open endpoint for sending a notification to ANY user,
        // with an attacker-chosen title and body — a phishing primitive wearing
        // the platform's own branding.
        //
        // Both are read from the listing now. The listing must also exist, which
        // it never had to before.
        const listingSnap = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(data.listingId).get();
        if (!listingSnap.exists) {
            return { success: false, error: "Listing not found", data: null };
        }
        const listing = listingSnap.data() as LandListing;

        const listingOwnerId = listing.ownerId;
        const listingTitle = listing.title;

        if (!listingOwnerId) {
            return { success: false, error: "This listing has no owner to contact", data: null };
        }

        const inquiryRef = await db.collection(COLLECTIONS.LAND_INQUIRIES).add({
            ...data,
            // After the spread: the caller's values are recorded nowhere.
            listingOwnerId,
            listingTitle,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            read: false
        });

        await createNotificationAction({
            // The listing's owner, not the caller's nominee.
            userId: listingOwnerId,
            type: "info",
            title: "New Land Inquiry",
            message: `You have a new inquiry for "${listingTitle}" from ${data.buyerName}.`,
            link: `/farm-nation/inquiries/${inquiryRef.id}`,
            linkText: "View Inquiry" 
        });

        await createAdminAuditLog({
            action: "land_inquiry",
            userId: "public_user",
            userEmail: data.buyerEmail,
            targetId: inquiryRef.id,
            targetType: "land_inquiry",
            details: `Inquiry for ${listingTitle}` 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Submit inquiry error:", error);
        return { success: false, error: error.message || "Failed to send message", data: null };
    }
}
export async function submitLandInquiryAction(...args: Parameters<typeof _submitLandInquiryAction>) {
    return withFlexibleSafeAction("submitLandInquiryAction", _submitLandInquiryAction)(...args);
}

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
export async function getLandInquiriesAction(...args: Parameters<typeof _getLandInquiriesAction>) {
    return withFlexibleSafeAction("getLandInquiriesAction", _getLandInquiriesAction)(...args);
}

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
            // ✅ FIX: serializeValue converts Timestamp fields to ISO strings for safe client transfer.
            return { success: true, error: null, data: { id: docSnap.id, ...serializeValue(docSnap.data()) } };
        } else { 
            return { success: false, error: "Inquiry not found", data: null };
        }
    } catch (error: any) { 
        logger.error("Get inquiry error:", error);
        return { success: false, error: error.message || "Failed to fetch inquiry", data: null };
    }
}
export async function getLandInquiryByIdAction(...args: Parameters<typeof _getLandInquiryByIdAction>) {
    return withFlexibleSafeAction("getLandInquiryByIdAction", _getLandInquiryByIdAction)(...args);
}

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
            session.user.id,
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
export async function deleteLandListingAction(...args: Parameters<typeof _deleteLandListingAction>) {
    return withFlexibleSafeAction("deleteLandListingAction", _deleteLandListingAction)(...args);
}
