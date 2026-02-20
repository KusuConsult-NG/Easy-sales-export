"use server";

import { auth } from "@/lib/auth";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isValidState, isValidLGA, normalizeLocation } from "@/lib/locations";

/**
 * Farm Nation Property Management Actions
 */

export interface Property {
    id: string;
    name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number; // hectares
    type: "sale" | "lease";
    category: "farming-arable" | "farming-irrigated" | "farming-commercial" | "farming-mixed" | "leasing" | "poultry" | "fishery" | "greenhouse" | "mixed-use";
    images: string[];
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    ownerPhone: string;
    status: "available" | "pending" | "sold" | "leased";
    verified: boolean;
    features: string[];
    coordinates?: {
        latitude: number;
        longitude: number;
    };
    documents: {
        cOfO?: string; //  Certificate of Occupancy
        surveyPlan?: string;
        taxClearance?: string;
    };
    createdAt: Date;
    updatedAt: Date;
    leaseDuration?: number; // months, if type is lease
    viewCount: number;
    favoriteCount: number;
}

export interface PropertyListingInput {
    name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number;
    type: "sale" | "lease";
    category: string;
    features: string[];
    leaseDuration?: number;
}

/**
 * Get all properties with optional filters
 */
export async function getPropertiesAction(filters?: {
    state?: string;
    category?: string;
    type?: string;
    minPrice?: number;
    maxPrice?: number;
    minSize?: number;
    maxSize?: number;
    search?: string;
    limit?: number;
    lastDocId?: string;
}) {
    try {
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES);

        // Sorting
        query = query.orderBy("createdAt", "desc");

        // Pagination Cursor
        if (filters?.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(filters.lastDocId).get();
            if (lastDoc.exists) {
                query = query.startAfter(lastDoc);
            }
        }

        const pageSize = filters?.limit || 20;
        query = query.limit(pageSize);

        const snapshot = await query.get();

        let properties = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as Property[];

        // Apply filters (Client-side for now as Firestore is limited)
        if (filters) {
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                properties = properties.filter(p =>
                    p.name.toLowerCase().includes(searchLower) ||
                    p.location.toLowerCase().includes(searchLower) ||
                    p.state.toLowerCase().includes(searchLower)
                );
            }
            if (filters.state && filters.state !== "all") {
                properties = properties.filter((p) => p.state === filters.state);
            }
            if (filters.category && filters.category !== "all") {
                properties = properties.filter((p) => p.category === filters.category);
            }
            if (filters.type && filters.type !== "all") {
                properties = properties.filter((p) => p.type === filters.type);
            }
            if (filters.minPrice) {
                properties = properties.filter((p) => p.price >= filters.minPrice!);
            }
            if (filters.maxPrice) {
                properties = properties.filter((p) => p.price <= filters.maxPrice!);
            }
            if (filters.minSize) {
                properties = properties.filter((p) => p.size >= filters.minSize!);
            }
            if (filters.maxSize) {
                properties = properties.filter((p) => p.size <= filters.maxSize!);
            }
        }

        const lastDoc = snapshot.docs[snapshot.docs.length - 1];

        return {
            success: true,
            properties,
            lastDocId: lastDoc?.id,
            hasMore: snapshot.docs.length === pageSize
        };
    } catch (error: any) {
        logger.error("Get properties error:", error);
        return { success: false, error: error.message };
    }
}

export async function approveFarmNationSellerAction(userId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        // Update user
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "approved",
            "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.approvedBy": session.user.id,
            roles: FieldValue.arrayUnion("farm-nation-seller")
        });

        return { success: true, message: "Seller approved successfully" };
    } catch (error: any) {
        logger.error("Approve seller error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get property by ID
 */
export async function getPropertyByIdAction(propertyId: string) {
    try {
        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, error: "Property not found" };
        }

        const data = propertyDoc.data()!;

        // Increment view count
        await propertyRef.update({
            viewCount: (data.viewCount || 0) + 1,
        });

        const property = {
            id: propertyDoc.id,
            ...data,
            createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
        } as Property;

        return { success: true, property };
    } catch (error: any) {
        logger.error("Get property error:", error);
        return { success: false, error: error.message };
    }
}



/**
 * List a new property
 */
export async function listPropertyAction(input: PropertyListingInput) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Check user tier (Premium required)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data()!;
        if (!userData.cooperativeTier || userData.cooperativeTier === "Basic") {
            return {
                success: false,
                error: "Premium tier required to list properties. Contribute at least ₦20,000.",
            };
        }

        // Validate with Zod
        const { farmNationListingSchema } = await import("@/lib/validations/land");
        const validation = farmNationListingSchema.safeParse(input);

        if (!validation.success) {
            return {
                success: false,
                error: validation.error.issues[0]?.message || "Validation failed",
            };
        }

        const validatedData = validation.data;

        // Check State/LGA Validity after basic schema check
        if (!isValidState(validatedData.state)) {
            return { success: false, error: `Invalid State: "${validatedData.state}"` };
        }
        if (!isValidLGA(validatedData.state, validatedData.lga)) {
            return { success: false, error: `Invalid LGA: "${validatedData.lga}" in ${validatedData.state}` };
        }

        // Create property
        const property = {
            name: validatedData.name,
            description: validatedData.description,
            location: validatedData.location,
            state: normalizeLocation(validatedData.state),
            lga: normalizeLocation(validatedData.lga),
            price: validatedData.price,
            size: validatedData.size,
            type: validatedData.type,
            category: validatedData.category,
            features: validatedData.features,
            leaseDuration: validatedData.leaseDuration || null,
            images: [], // Will be uploaded separately
            ownerId: session.user.id,
            ownerName: userData.name || "Unknown",
            ownerEmail: userData.email || "",
            ownerPhone: userData.phone || "",
            status: "available",
            verified: false, // Requires admin verification
            documents: {},
            viewCount: 0,
            favoriteCount: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).add(property);

        return {
            success: true,
            message: "Property listed successfully. Awaiting admin verification.",
            propertyId: docRef.id,
        };
    } catch (error: any) {
        logger.error("List property error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user's listed properties
 */
export async function getMyPropertiesAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const snapshot = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
            .where("ownerId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        const properties = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        }) as Property[];

        return { success: true, properties };
    } catch (error: any) {
        logger.error("Get my properties error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Initiate property purchase/lease
 */
export async function initiatePropertyPurchaseAction(
    propertyId: string,
    buyerInfo: {
        fullName: string;
        email: string;
        phone: string;
        purpose: string;
    }
) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Verify property exists and is available
        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, error: "Property not found" };
        }

        const property = propertyDoc.data() as Property;
        if (property.status !== "available") {
            return { success: false, error: "Property is no longer available" };
        }

        // Check user tier
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, error: "User not found" };
        }

        const userData = userDoc.data()!;
        if (!userData.cooperativeTier || userData.cooperativeTier === "Basic") {
            return {
                success: false,
                error: "Premium tier required. Contribute at least ₦20,000.",
            };
        }

        // Create purchase request
        const purchaseRequest = {
            propertyId,
            propertyName: property.name,
            propertyPrice: property.price,
            propertyType: property.type,
            buyerId: session.user.id,
            buyerName: buyerInfo.fullName,
            buyerEmail: buyerInfo.email,
            buyerPhone: buyerInfo.phone,
            purpose: buyerInfo.purpose,
            sellerId: property.ownerId,
            sellerName: property.ownerName,
            status: "pending_payment",
            escrowAmount: property.price,
            escrowStatus: "pending",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const requestRef = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).add(purchaseRequest);

        // Mark property as pending
        await propertyRef.update({
            status: "pending",
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            message: "Purchase request created. Proceed to payment.",
            requestId: requestRef.id,
            amount: property.price,
        };
    } catch (error: any) {
        logger.error("Initiate purchase error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Get user's purchase/lease requests
 */
export async function getMyPurchaseRequestsAction() {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const snapshot = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
            .where("buyerId", "==", session.user.id)
            .orderBy("createdAt", "desc")
            .get();

        const requests = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                createdAt: (data.createdAt as Timestamp)?.toDate() || new Date(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate() || new Date(),
            };
        });

        return { success: true, requests };
    } catch (error: any) {
        logger.error("Get purchase requests error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Cancel a purchase/lease request
 */
export async function cancelPurchaseRequestAction(requestId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const requestRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) {
            return { success: false, error: "Purchase request not found" };
        }

        const requestData = requestDoc.data();

        // Verify user owns this request
        if (requestData?.buyerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Can only cancel pending requests
        if (requestData?.status !== "pending_payment") {
            return { success: false, error: "Can only cancel pending payment requests" };
        }

        // Update request status
        await requestRef.update({
            status: "cancelled",
            escrowStatus: "refunded",
            cancelledAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        // Mark property as available again
        if (requestData?.propertyId) {
            await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(requestData.propertyId).update({
                status: "available",
                updatedAt: FieldValue.serverTimestamp(),
            });
        }

        return {
            success: true,
            message: "Purchase request cancelled successfully",
        };
    } catch (error: any) {
        logger.error("Cancel purchase request error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Delete a property listing
 */
export async function deletePropertyAction(propertyId: string) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, error: "Property not found" };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Check for active purchase requests
        const activeRequests = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
            .where("propertyId", "==", propertyId)
            .where("status", "in", ["pending_payment", "payment_confirmed"])
            .get();

        if (!activeRequests.empty) {
            return {
                success: false,
                error: "Cannot delete property with active purchase requests",
            };
        }

        // Soft delete - mark as deleted
        await propertyRef.update({
            status: "deleted",
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            message: "Property deleted successfully",
        };
    } catch (error: any) {
        logger.error("Delete property error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Update a property listing
 */
export async function updatePropertyAction(propertyId: string, updates: Partial<PropertyListingInput>) {
    try {
        const session = await auth();
        if (!session?.user?.id) {
            return { success: false, error: "Unauthorized" };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, error: "Property not found" };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) {
            return { success: false, error: "Unauthorized" };
        }

        // Build update object
        const updateData: any = {
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (updates.name) updateData.name = updates.name;
        if (updates.description) updateData.description = updates.description;
        if (updates.location) updateData.location = updates.location;

        // Validate State/LGA updates
        if (updates.state || updates.lga) {
            const newState = updates.state ? normalizeLocation(updates.state) : property?.state;
            const newLGA = updates.lga ? normalizeLocation(updates.lga) : property?.lga;

            if (updates.state && !isValidState(newState)) {
                return { success: false, error: `Invalid State: ${updates.state}` };
            }
            // If both present or one changing, re-validate pair
            if (!isValidLGA(newState, newLGA)) {
                return { success: false, error: `Invalid LGA: ${newLGA} in ${newState}` };
            }

            if (updates.state) updateData.state = newState;
            if (updates.lga) updateData.lga = newLGA;
        }

        if (updates.price !== undefined) updateData.price = updates.price;
        if (updates.size !== undefined) updateData.size = updates.size;
        if (updates.type) updateData.type = updates.type;
        if (updates.category) updateData.category = updates.category;
        if (updates.features) updateData.features = updates.features;
        if (updates.leaseDuration) updateData.leaseDuration = updates.leaseDuration;

        await propertyRef.update(updateData);

        return {
            success: true,
            message: "Property updated successfully",
        };
    } catch (error: any) {
        logger.error("Update property error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Submit Farm Nation Onboarding
 */
export interface FarmNationOnboardingData {
    role: "buyer" | "seller" | "both";
    profile: {
        fullName: string;
        phone: string;
        businessName?: string;
        state: string;
        lga: string;
        address: string;
    };
    interests: {
        // Buyer fields
        propertyTypes?: string[];
        budgetRange?: string;
        preferredSize?: string;
        // Seller fields
        listingTypes?: string[];
        totalAcreage?: string;
        readyToList?: boolean;
    };
    terms: {
        termsAccepted: boolean;
        privacyAccepted: boolean;
        feeDisclosureAccepted: boolean;
    };
}

export async function submitFarmNationOnboardingAction(data: FarmNationOnboardingData) {
    try {
        // Get authenticated session
        const session = await auth();

        if (!session?.user?.id) {
            return {
                success: false,
                error: "Not authenticated. Please login first.",
            };
        }

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return {
                success: false,
                error: "Your previous application is still being processed."
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                error: "You are already registered for Farm Nation."
            };
        }

        // Validate required fields
        if (!data.role || !data.profile || !data.terms) {
            return {
                success: false,
                error: "Missing required onboarding data",
            };
        }

        // Validate terms acceptance
        if (!data.terms.termsAccepted || !data.terms.privacyAccepted || !data.terms.feeDisclosureAccepted) {
            return {
                success: false,
                error: "You must accept all terms to continue",
            };
        }

        // Prepare user roles
        const roles: string[] = [];
        if (data.role === "buyer" || data.role === "both") {
            roles.push("farm-nation-buyer");
        }
        if (data.role === "seller" || data.role === "both") {
            roles.push("farm-nation-seller");
        }

        // Update user document in Firestore - separate top-level and nested updates
        await db.collection(COLLECTIONS.USERS).doc(userId).set(
            {
                farmNation: {
                    role: data.role,
                    profile: data.profile,
                    interests: data.interests,
                    onboardingCompletedAt: new Date().toISOString(),
                    termsAcceptedAt: new Date().toISOString(),
                },
                // isVerified: true, // REMOVED: User must be verified by Admin
                roles: FieldValue.arrayUnion(...roles),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );
        // Dot notation update for serviceRegistrations to prevent wiping other modules
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "pending",
            "serviceRegistrations.farmNation.role": data.role,
            "serviceRegistrations.farmNation.completedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.submittedAt": FieldValue.serverTimestamp(),
        });

        return {
            success: true,
            data: {
                role: data.role,
                userId,
            },
        };
    } catch (error: any) {
        logger.error("Error submitting Farm Nation onboarding:", error);
        return {
            success: false,
            error: "An error occurred while processing your onboarding. Please try again.",
        };
    }
}

// ============================================
// Check Farm Nation Application Status Action
// ============================================

export async function checkFarmNationStatusAction(): Promise<string | null> {
    try {
        const session = await auth();
        if (!session?.user) return null;

        // Check user document for service registration
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const registration = userData?.serviceRegistrations?.farmNation;

        if (registration?.status) {
            return registration.status;
        }

        return null;
    } catch (error) {
        logger.error("Error checking Farm Nation status:", error);
        return null;
    }
}

/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
/**
 * Upload Property Documents (Seller)
 */
export async function uploadPropertyDocumentsAction(
    propertyId: string,
    documents: {
        cOfO?: string;
        surveyPlan?: string;
        taxClearance?: string;
    }
): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        if (!session?.user?.id) return { success: false, error: "Unauthorized" };

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false, error: "Property not found" };

        const property = propertyDoc.data();
        if (property?.ownerId !== session.user.id) return { success: false, error: "Unauthorized" };

        // Merge documents
        const currentDocs = property?.documents || {};
        const newDocs = { ...currentDocs, ...documents };

        await propertyRef.update({
            documents: newDocs,
            updatedAt: FieldValue.serverTimestamp(),
            verificationStatus: "pending_review" // Reset verification status if new docs added
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Upload documents error:", error);
        return { success: false, error: error.message };
    }
}

/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
export async function verifyPropertyAction(propertyId: string, verified: boolean): Promise<{ success: boolean; error?: string }> {
    try {
        const session = await auth();
        // Check admin role
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false, error: "Unauthorized" };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false, error: "Property not found" };

        const property = propertyDoc.data() as Property;

        // 🔒 SECURITY FIX: Require Documents for Verification
        if (verified) {
            // Must have at least C of O OR Survey Plan
            if (!property.documents?.cOfO && !property.documents?.surveyPlan) {
                return {
                    success: false,
                    error: "Cannot verify property without documents (C of O or Survey Plan required)."
                };
            }
        }

        await propertyRef.update({
            verified: verified,
            verifiedAt: verified ? FieldValue.serverTimestamp() : null,
            verifiedBy: verified ? session.user.id : null,
            updatedAt: FieldValue.serverTimestamp(),
            // Ensure status reflects verification
            status: verified ? "available" : property.status // Keep existing if un-verifying, or reset? Let's leave status alone unless it was explicitly pending.
        });

        // 📜 Audit Log
        const { logAuditAction } = await import("@/lib/audit");
        await logAuditAction({
            userId: session.user.id,
            action: verified ? "VERIFY_PROPERTY" : "UNVERIFY_PROPERTY",
            details: `${verified ? "Verified" : "Unverified"} property ${propertyId}`,
            metadata: { propertyId, verified }
        });

        return { success: true };
    } catch (error: any) {
        logger.error("Verify property error:", error);
        return { success: false, error: error.message };
    }
}
