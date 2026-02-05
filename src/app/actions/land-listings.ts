"use server";

import { doc, setDoc, getDoc, collection, addDoc, query, where, getDocs, updateDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createAuditLog, logAdminAction } from "@/lib/audit-log";
import { createNotificationAction } from "@/app/actions/notifications";

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
    soilType?: string;
    waterSource?: string;
    images: string[];
    documents: string[];
    status: "draft" | "pending_verification" | "verified" | "rejected";
    verificationStatus?: {
        verified: boolean;
        verifiedBy?: string;
        verifiedAt?: Timestamp;
        rejectionReason?: string;
    };
    createdAt: Timestamp;
    updatedAt: Timestamp;
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
    soilType?: string;
    waterSource?: string;
}): Promise<{ success: boolean; error?: string; listingId?: string }> {
    try {
        const listing: Omit<LandListing, "id"> = {
            ...data,
            images: [],
            documents: [],
            status: "draft",
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "land_listings"), listing);

        await createAuditLog({
            action: "user_update",
            userId: data.ownerId,
            targetId: docRef.id,
            targetType: "land_listing_creation",
        });

        return { success: true, listingId: docRef.id };
    } catch (error) {
        console.error("Land listing creation error:", error);
        return { success: false, error: "Failed to create land listing" };
    }
}

/**
 * Submit listing for verification
 */
async function submitForVerificationAction(
    listingId: string,
    ownerId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const listingRef = doc(db, "land_listings", listingId);
        const listingDoc = await getDoc(listingRef);

        if (!listingDoc.exists()) {
            return { success: false, error: "Listing not found" };
        }

        const listingData = listingDoc.data() as LandListing;

        if (listingData.ownerId !== ownerId) {
            return { success: false, error: "Unauthorized" };
        }

        await updateDoc(listingRef, {
            status: "pending_verification",
            updatedAt: Timestamp.now(),
        });

        return { success: true };
    } catch (error) {
        console.error("Verification submission error:", error);
        return { success: false, error: "Failed to submit for verification" };
    }
}

/**
 * Admin: Verify land listing
 */
export async function verifyLandListingAction(
    listingId: string,
    adminId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const listingRef = doc(db, "land_listings", listingId);
        const listingDoc = await getDoc(listingRef);

        if (!listingDoc.exists()) {
            return { success: false, error: "Listing not found" };
        }

        await updateDoc(listingRef, {
            status: "verified",
            verificationStatus: {
                verified: true,
                verifiedBy: adminId,
                verifiedAt: Timestamp.now(),
            },
            updatedAt: Timestamp.now(),
        });

        await logAdminAction(
            "land_verified",
            adminId,
            listingId,
            "land_listing"
        );

        return { success: true };
    } catch (error) {
        console.error("Land verification error:", error);
        return { success: false, error: "Failed to verify listing" };
    }
}

/**
 * Admin: Reject land listing
 */
export async function rejectLandListingAction(
    listingId: string,
    adminId: string,
    reason: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const listingRef = doc(db, "land_listings", listingId);
        const listingDoc = await getDoc(listingRef);

        if (!listingDoc.exists()) {
            return { success: false, error: "Listing not found" };
        }

        await updateDoc(listingRef, {
            status: "rejected",
            verificationStatus: {
                verified: false,
                verifiedBy: adminId,
                verifiedAt: Timestamp.now(),
                rejectionReason: reason,
            },
            updatedAt: Timestamp.now(),
        });

        await logAdminAction(
            "land_rejected",
            adminId,
            listingId,
            "land_listing",
            reason
        );

        return { success: true };
    } catch (error) {
        console.error("Land rejection error:", error);
        return { success: false, error: "Failed to reject listing" };
    }
}

/**
 * Get verified land listings with filters
 */
export async function searchLandListingsAction(filters: {
    state?: string;
    minSize?: number;
    maxSize?: number;
    minPrice?: number;
    maxPrice?: number;
    soilType?: string;
    waterSource?: string;
}): Promise<LandListing[]> {
    try {
        let q = query(
            collection(db, "land_listings"),
            where("status", "==", "verified")
        );

        if (filters.state) {
            q = query(q, where("location.state", "==", filters.state));
        }

        const snapshot = await getDocs(q);
        let results = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LandListing[];

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

        return results;
    } catch (error) {
        console.error("Land search error:", error);
        return [];
    }
}


/**
 * Get pending land listings (admin)
 */
export async function getPendingLandListingsAction(): Promise<LandListing[]> {
    try {
        const q = query(
            collection(db, "land_listings"),
            where("status", "==", "pending_verification")
        );

        const snapshot = await getDocs(q);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as LandListing[];
    } catch (error) {
        console.error("Failed to fetch pending listings:", error);
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
    soilType?: string;
    waterSource?: string;
    imageFiles: File[];
    documentFiles: File[];
}): Promise<{ success: boolean; error?: string; listingId?: string }> {
    try {
        // For now, just store file names as placeholders
        // In production, upload to Firebase Storage and store URLs
        const imageNames = data.imageFiles.map(f => f.name);
        const documentNames = data.documentFiles.map(f => f.name);

        const listing: Omit<LandListing, "id"> = {
            ownerId: data.ownerId,
            ownerName: data.ownerName,
            ownerEmail: data.ownerEmail,
            title: data.title,
            description: data.description,
            location: data.location,
            size: data.size,
            price: data.price,
            soilType: data.soilType,
            waterSource: data.waterSource,
            images: imageNames, // Store filenames for MVP
            documents: documentNames,
            status: "pending_verification",
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, "land_listings"), listing);

        // Create audit log
        await createAuditLog({
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

        return { success: true, listingId: docRef.id };
    } catch (error: any) {
        console.error("Land listing submission error:", error);
        return { success: false, error: error.message || "Failed to submit land listing" };
    }
}
