"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isValidState, isValidLGA, normalizeLocation } from "@/lib/locations";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";

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
    createdAt: any;
    updatedAt: any;
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

        let properties = serializeDocs<Property>(snapshot.docs);

        // Apply filters (Client-side for now as Firestore is limited)
        if (filters) {
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                properties = properties.filter(p =>
                    p.name?.toLowerCase()?.includes(searchLower) ||
                    p.location?.toLowerCase()?.includes(searchLower) ||
                    p.state?.toLowerCase()?.includes(searchLower)
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
            data: { properties },
            meta: { cursor: lastDoc?.id || null, hasMore: snapshot.docs.length === pageSize }
        };
    } catch (error: any) {
        logger.error("Get properties error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

export async function approveFarmNationSellerAction(userId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, data: null, error: "Unauthorized", meta: null };

        // Update user
        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "approved",
            "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.approvedBy": session.user.id,
            roles: FieldValue.arrayUnion("farmer")
        });

        return { success: true, data: { message: "Seller approved successfully" }, meta: null };
    } catch (error: any) {
        logger.error("Approve seller error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

export async function rejectFarmNationSellerAction(userId: string, reason: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, data: null, error: "Unauthorized", meta: null };

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            "serviceRegistrations.farmNation.status": "rejected",
            "serviceRegistrations.farmNation.rejectionReason": reason,
            "serviceRegistrations.farmNation.rejectedAt": FieldValue.serverTimestamp(),
            "serviceRegistrations.farmNation.rejectedBy": session.user.id,
            roles: FieldValue.arrayRemove("farmer"),
        });

        return { success: true, data: { message: "Seller application rejected" }, meta: null };
    } catch (error: any) {
        logger.error("Reject Farm Nation seller error:", error);
        return { success: false, data: null, error: error.message, meta: null };
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
            return { success: false, data: null, error: "Property not found", meta: null };
        }

        const data = propertyDoc.data()!;

        // Increment view count
        await propertyRef.update({
            viewCount: (data.viewCount || 0) + 1,
        });

        const property = serializeDoc<Property>(propertyDoc.id, data);

        return { success: true, data: { property }, meta: null };
    } catch (error: any) {
        logger.error("Get property error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}



/**
 * List a new property
 */
export async function listPropertyAction(input: PropertyListingInput) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        // Check user tier (Premium required)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, data: null, error: "User not found", meta: null };
        }

        const userData = userDoc.data()!;
        if (!userData.serviceRegistrations?.cooperative?.status || userData.serviceRegistrations.cooperative.status !== "approved") {
            return {
                success: false,
                data: null,
                error: "Cooperative membership required to list properties. Please complete your cooperative registration.",
                meta: null
            };
        }

        // Validate with Zod
        const { farmNationListingSchema } = await import("@/lib/validations/land");
        const validation = farmNationListingSchema.safeParse(input);

        if (!validation.success) {
            return {
                success: false,
                data: null,
                error: validation.error.issues[0]?.message || "Validation failed",
                meta: null
            };
        }

        const validatedData = validation.data;

        // Check State/LGA Validity after basic schema check
        if (!isValidState(validatedData.state)) {
            return { success: false, data: null, error: `Invalid State: "${validatedData.state}"`, meta: null };
        }
        if (!isValidLGA(validatedData.state, validatedData.lga)) {
            return { success: false, data: null, error: `Invalid LGA: "${validatedData.lga}" in ${validatedData.state}`, meta: null };
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
            data: { message: "Property listed successfully. Awaiting admin verification.", propertyId: docRef.id },
            meta: null
        };
    } catch (error: any) {
        logger.error("List property error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Get user's listed properties
 */
export async function getMyPropertiesAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        let snapshot;
        try {
            snapshot = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
                .where("ownerId", "==", session.user.id)
                .orderBy("createdAt", "desc")
                .get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION")) {
                logger.warn("Missing index for getMyPropertiesAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
                    .where("ownerId", "==", session.user.id)
                    .get();
                
                const properties = serializeDocs<Property>(snapshot.docs);
                return { 
                    success: true, 
                    data: { 
                        properties: properties.sort((a, b) => {
                            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
                            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
                            return dateB.getTime() - dateA.getTime();
                        }) 
                    }, 
                    meta: null 
                };
            }
            throw e;
        }

        const properties = serializeDocs<Property>(snapshot.docs);


        return { success: true, data: { properties }, meta: null };
    } catch (error: any) {
        logger.error("Get my properties error:", error);
        return { success: false, data: null, error: error.message, meta: null };
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        // Verify property exists and is available
        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, data: null, error: "Property not found", meta: null };
        }

        const property = propertyDoc.data() as Property;
        if (property.status !== "available") {
            return { success: false, data: null, error: "Property is no longer available", meta: null };
        }

        // Check user tier
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            return { success: false, data: null, error: "User not found", meta: null };
        }

        const userData = userDoc.data()!;
        if (!userData.serviceRegistrations?.cooperative?.status || userData.serviceRegistrations.cooperative.status !== "approved") {
            return {
                success: false,
                data: null,
                error: "Cooperative membership required. Please complete your cooperative registration.",
                meta: null
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
            data: { message: "Purchase request created. Proceed to payment.", requestId: requestRef.id, amount: property.price },
            meta: null
        };
    } catch (error: any) {
        logger.error("Initiate purchase error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Get user's purchase/lease requests
 */
export async function getMyPurchaseRequestsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        let snapshot;
        try {
            snapshot = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                .where("buyerId", "==", session.user.id)
                .orderBy("createdAt", "desc")
                .get();
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION")) {
                logger.warn("Missing index for getMyPurchaseRequestsAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                    .where("buyerId", "==", session.user.id)
                    .get();
                
                const requests = serializeDocs(snapshot.docs);
                return { 
                    success: true, 
                    data: { 
                        requests: requests.sort((a: any, b: any) => {
                            const dateA = a.createdAt?.toDate?.() || new Date(a.createdAt);
                            const dateB = b.createdAt?.toDate?.() || new Date(b.createdAt);
                            return dateB.getTime() - dateA.getTime();
                        }) 
                    }, 
                    meta: null 
                };
            }
            throw e;
        }

        const requests = serializeDocs(snapshot.docs);


        return { success: true, data: { requests }, meta: null };
    } catch (error: any) {
        logger.error("Get purchase requests error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Cancel a purchase/lease request
 */
export async function cancelPurchaseRequestAction(requestId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        const requestRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) {
            return { success: false, data: null, error: "Purchase request not found", meta: null };
        }

        const requestData = requestDoc.data();

        // Verify user owns this request
        if (requestData?.buyerId !== session.user.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        // Can only cancel pending requests
        if (requestData?.status !== "pending_payment") {
            return { success: false, data: null, error: "Can only cancel pending payment requests", meta: null };
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
            data: { message: "Purchase request cancelled successfully" },
            meta: null
        };
    } catch (error: any) {
        logger.error("Cancel purchase request error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Delete a property listing
 */
export async function deletePropertyAction(propertyId: string) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, data: null, error: "Property not found", meta: null };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        // Check for active purchase requests
        const activeRequests = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
            .where("propertyId", "==", propertyId)
            .where("status", "in", ["pending_payment", "payment_confirmed"])
            .get();

        if (!activeRequests.empty) {
            return {
                success: false,
                data: null,
                error: "Cannot delete property with active purchase requests",
                meta: null
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
            data: { message: "Property deleted successfully" },
            meta: null
        };
    } catch (error: any) {
        logger.error("Delete property error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Update a property listing
 */
export async function updatePropertyAction(propertyId: string, updates: Partial<PropertyListingInput>) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false, data: null, error: "Property not found", meta: null };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
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
                return { success: false, data: null, error: `Invalid State: ${updates.state}`, meta: null };
            }
            // If both present or one changing, re-validate pair
            if (!isValidLGA(newState, newLGA)) {
                return { success: false, data: null, error: `Invalid LGA: ${newLGA} in ${newState}`, meta: null };
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
            data: { message: "Property updated successfully" },
            meta: null
        };
    } catch (error: any) {
        logger.error("Update property error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

/**
 * Submit Farm Nation Onboarding
 */
export interface FarmNationOnboardingData {
    role: "buyer" | "seller" | "both";
    profile: {
        firstName: string;
        lastName: string;
        otherName?: string;
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;

        if (!session?.user?.id) {
            return {
                success: false,
                data: null,
                error: "Not authenticated. Please login first.",
                meta: null
            };
        }

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') {
            return {
                success: false,
                data: null,
                error: "Your previous application is still being processed.",
                meta: null
            };
        }
        if (existingStatus === 'approved') {
            return {
                success: false,
                data: null,
                error: "You are already registered for Farm Nation.",
                meta: null
            };
        }

        // Validate required fields
        if (!data.role || !data.profile || !data.terms) {
            return {
                success: false,
                data: null,
                error: "Missing required onboarding data",
                meta: null
            };
        }

        // Validate terms acceptance
        if (!data.terms.termsAccepted || !data.terms.privacyAccepted || !data.terms.feeDisclosureAccepted) {
            return {
                success: false,
                data: null,
                error: "You must accept all terms to continue",
                meta: null
            };
        }

        // Prepare user roles
        const roles: string[] = [];
        if (data.role === "buyer" || data.role === "both") {
            roles.push("investor");
        }
        if (data.role === "seller" || data.role === "both") {
            roles.push("farmer");
        }

        // Update user document in Firestore - separate top-level and nested updates
        await db.collection(COLLECTIONS.USERS).doc(userId).set(
            {
                farmNation: {
                    role: data.role,
                    profile: {
                        ...data.profile,
                        fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                            .filter(Boolean).join(" ").trim(),
                    },
                    interests: data.interests,
                    onboardingCompletedAt: new Date().toISOString(),
                    termsAcceptedAt: new Date().toISOString(),
                },
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
            // Sync KYC name fields for Admin Communication Hub & admin portal
            firstName: data.profile.firstName,
            lastName: data.profile.lastName,
            otherName: data.profile.otherName || null,
            fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                .filter(Boolean).join(" ").trim(),
            // Sync other PII for Communication Hub
            phone: data.profile.phone,
            stateOfOrigin: data.profile.state,
            lga: data.profile.lga,
            residentialAddress: data.profile.address,
        });

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Farm Nation onboarding:", err);
        }

        return {
            success: true,
            data: {
                role: data.role,
                userId,
            },
            meta: null
        };
    } catch (error: any) {
        logger.error("Error submitting Farm Nation onboarding:", error);
        return {
            success: false,
            data: null,
            error: "An error occurred while processing your onboarding. Please try again.",
            meta: null
        };
    }
}

// ============================================
// Check Farm Nation Application Status Action
// ============================================

export async function checkFarmNationStatusAction(): Promise<string | null> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return null;
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        let status = userData?.serviceRegistrations?.farmNation?.status;

        // ── AUTHORITATIVE CHECK: Check real application record ──────
        // If status is not approved, check the source of truth for Farm Nation applications.
        if (status !== "approved") {
            const appSnap = await db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", session.user.id)
                .orderBy("submittedAt", "desc")
                .limit(1)
                .get();

            if (!appSnap.empty) {
                const appData = appSnap.docs[0].data();
                if (appData.status === "approved" || appData.status === "approved_admin") {
                    status = "approved";
                    // Proactively backfill for performance in future logins
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).set({
                        serviceRegistrations: { farmNation: { status: "approved", syncedAt: new Date().toISOString() } }
                    }, { merge: true });
                } else if (appData.status) {
                    status = appData.status;
                }
            }
        }

        if (status) {
            return status;
        }

        // ── FALLBACK: Farm Nation data was stored directly in userData.farmNation ──
        // This was the V1 data structure before serviceRegistrations was introduced.
        const legacyFarmNation = userData?.farmNation;
        if (legacyFarmNation?.role || legacyFarmNation?.onboardingCompletedAt) {
            const legacyStatus = 'pending'; // V1 data = completed onboarding = pending review

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).set(
                {
                    serviceRegistrations: {
                        farmNation: {
                            status: legacyStatus,
                            role: legacyFarmNation.role,
                            syncedFromLegacy: true,
                            syncedAt: new Date().toISOString()
                        }
                    }
                },
                { merge: true }
            );

            logger.info(`[checkFarmNationStatus] Backfilled legacy farmNation status '${legacyStatus}' for user ${session.user.id}`);
            return legacyStatus;
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
): Promise<{ success: boolean; data?: any; error?: string; meta?: any }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, data: null, error: "Unauthorized", meta: null };

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false, data: null, error: "Property not found", meta: null };

        const property = propertyDoc.data();
        if (property?.ownerId !== session.user.id) return { success: false, data: null, error: "Unauthorized", meta: null };

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
export async function verifyPropertyAction(propertyId: string, verified: boolean) {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        // Check admin role
        const { isAdmin } = await import("@/lib/admin-permissions");
        if (!isAdmin(session?.user?.roles)) {
            return { success: false, data: null, error: "Unauthorized", meta: null };
        }

        const propertyRef = db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false, data: null, error: "Property not found", meta: null };

        const property = propertyDoc.data() as Property;

        // 🔒 SECURITY FIX: Require Documents for Verification
        if (verified) {
            // Must have at least C of O OR Survey Plan
            if (!property.documents?.cOfO && !property.documents?.surveyPlan) {
                return {
                    success: false,
                    data: null,
                    error: "Cannot verify property without documents (C of O or Survey Plan required).",
                    meta: null
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

        return { success: true, data: null, meta: null };
    } catch (error: any) {
        logger.error("Verify property error:", error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}

// ============================================================================
// USER REVISION FLOW — Farm Nation Onboarding
// ============================================================================

/**
 * Fetch the current user's Farm Nation onboarding data for prefilling the edit form.
 */
export async function getFarmNationApplicationAction(): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user) return { success: false, data: null, error: 'Unauthorized', meta: null };

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const farmNation = userData?.farmNation;
        const registration = userData?.serviceRegistrations?.farmNation;

        if (!farmNation && !registration) {
            return { success: false, data: null, error: 'No application found', meta: null };
        }

        return {
            success: true,
            data: { application: { ...farmNation, ...registration }, rejectionReason: registration?.rejectionReason },
            meta: null
        };
    } catch (error) {
        logger.error('getFarmNationApplicationAction error:', error);
        return { success: false, data: null, error: 'Failed to fetch application', meta: null };
    }
}

/**
 * Resubmit a rejected Farm Nation onboarding application with corrected data.
 */
export async function resubmitFarmNationApplicationAction(
    data: FarmNationOnboardingData
): Promise<{ success: boolean; data?: any; meta?: any; error?: string }> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error.error };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, data: null, error: 'Unauthorized', meta: null };

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;
        const allowedStatuses = ['pending', 'rejected', 'revision_required'];

        if (!allowedStatuses.includes(existingStatus || '')) {
            return { success: false, data: null, error: 'Your application cannot be resubmitted at this time.', meta: null };
        }

        if (!data.terms.termsAccepted || !data.terms.privacyAccepted || !data.terms.feeDisclosureAccepted) {
            return { success: false, data: null, error: 'You must accept all terms to continue', meta: null };
        }

        await db.collection(COLLECTIONS.USERS).doc(userId).set(
            {
                farmNation: {
                    role: data.role,
                    profile: {
                        ...data.profile,
                        fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                            .filter(Boolean).join(" ").trim(),
                    },
                    interests: data.interests,
                    resubmittedAt: new Date().toISOString(),
                    termsAcceptedAt: new Date().toISOString(),
                },
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true }
        );

        await db.collection(COLLECTIONS.USERS).doc(userId).update({
            'serviceRegistrations.farmNation.status': 'pending',
            'serviceRegistrations.farmNation.role': data.role,
            'serviceRegistrations.farmNation.rejectionReason': null,
            'serviceRegistrations.farmNation.resubmittedAt': FieldValue.serverTimestamp(),
            // Sync KYC name fields to central user document
            firstName: data.profile.firstName,
            lastName: data.profile.lastName,
            otherName: data.profile.otherName || null,
            fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                .filter(Boolean).join(" ").trim(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        try {
            await invalidateUserCache(userId);
        } catch (err) {
            logger.error("Failed to invalidate cache after Farm Nation resubmission:", err);
        }

        return { success: true, data: null, meta: null };
    } catch (error: any) {
        logger.error('resubmitFarmNationApplicationAction error:', error);
        return { success: false, data: null, error: 'Failed to resubmit application', meta: null };
    }
}

// ============================================================================
// DASHBOARD STATS — Farm Nation Member Dashboard
// ============================================================================

export interface FarmNationDashboardStats {
    /** Total size (hectares) of all properties the user has listed */
    totalHectares: number;
    /** Count of properties with status "available" */
    activeListings: number;
    /** Count of properties with status "sold" or "leased" */
    completedDeals: number;
    /** Total value of all listed properties */
    portfolioValue: number;
    /** Count of pending purchase/lease transactions (as buyer) */
    pendingTransactions: number;
    /** Count of properties acquired (status completed/confirmed) */
    propertiesAcquired: number;
    /** Total value of investments made */
    totalInvestmentValue: number;
    /** Recent transactions (last 5 as buyer) */
    recentTransactions: Array<{
        id: string;
        propertyName: string;
        propertyType: string;
        amount: number;
        status: string;
        createdAt: Date;
    }>;
    /** Recent listings (last 4 by this user) */
    recentListings: Array<{
        id: string;
        name: string;
        location: string;
        state: string;
        size: number;
        price: number;
        status: string;
        verified: boolean;
        type: string;
        createdAt: Date;
    }>;
    /** User's registered role in Farm Nation (buyer | seller | both) */
    role: string;
}

export async function getFarmNationDashboardStatsAction() {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, data: null, error: 'Unauthorized', meta: null };
        const { session } = sessionResult;
        if (!session?.user?.id) return { success: false, data: null, error: 'Unauthorized', meta: null };

        const userId = session.user.id;

        // Fetch in parallel: user's listings + purchase transactions as buyer
        let listingsSnap, transactionsSnap, userDoc;
        try {
            [listingsSnap, transactionsSnap, userDoc] = await Promise.all([
                db.collection(COLLECTIONS.FARM_NATION_PROPERTIES)
                    .where('ownerId', '==', userId)
                    .orderBy('createdAt', 'desc')
                    .get(),
                db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                    .where('buyerId', '==', userId)
                    .orderBy('createdAt', 'desc')
                    .limit(10)
                    .get(),
                db.collection(COLLECTIONS.USERS).doc(userId).get(),
            ]);
        } catch (e: any) {
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9) {
                logger.warn("Missing index for Dashboard Stats, falling back to sequential memory sort");
                // Fetch sequentially without sort
                const [lSnap, tSnap, uDoc] = await Promise.all([
                    db.collection(COLLECTIONS.FARM_NATION_PROPERTIES).where('ownerId', '==', userId).get(),
                    db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).where('buyerId', '==', userId).limit(10).get(),
                    db.collection(COLLECTIONS.USERS).doc(userId).get(),
                ]);
                listingsSnap = lSnap;
                transactionsSnap = tSnap;
                userDoc = uDoc;
                
                // We will sort listingsSnap.docs and transactionsSnap.docs below
            } else {
                throw e;
            }
        }


        const properties = serializeDocs<any>(listingsSnap.docs).map(d => ({
            id: d.id,
            size: Number(d.size) || 0,
            price: Number(d.price) || 0,
            status: d.status || 'available',
            verified: d.verified || false,
            name: d.name || 'Unnamed Property',
            location: d.location || '',
            state: d.state || '',
            type: d.type || 'sale',
            createdAt: d.createdAt,
        }));

        const transactions = serializeDocs<any>(transactionsSnap.docs).map(d => ({
            id: d.id,
            propertyName: d.propertyName || 'Unknown Property',
            propertyType: d.propertyType || 'sale',
            amount: Number(d.propertyPrice || d.escrowAmount || 0),
            status: d.status || 'pending',
            createdAt: d.createdAt,
        }));

        // Derive stats from listings (Seller)
        const activeListings = properties.filter(p => p.status === 'available').length;
        const completedDeals = properties.filter(p => p.status === 'sold' || p.status === 'leased').length;
        const totalHectares = properties.reduce((sum, p) => sum + p.size, 0);
        const portfolioValue = properties.reduce((sum, p) => sum + p.price, 0);

        // Derive stats from transactions (Buyer/Investor)
        const completedPurchases = transactions.filter(t => t.status === 'completed' || t.status === 'payment_confirmed');
        const propertiesAcquired = completedPurchases.length;
        const totalInvestmentValue = completedPurchases.reduce((sum, t) => sum + t.amount, 0);
        
        const pendingTransactions = transactions.filter(
            t => t.status === 'pending_payment' || t.status === 'payment_confirmed'
        ).length;

        // User role
        const role = userDoc.data()?.serviceRegistrations?.farmNation?.role
            || userDoc.data()?.farmNation?.role
            || 'buyer';

        return {
            success: true,
            data: {
                stats: {
                    totalHectares,
                    activeListings,
                    completedDeals,
                    portfolioValue,
                    pendingTransactions,
                    propertiesAcquired,
                    totalInvestmentValue,
                    recentTransactions: transactions.slice(0, 5),
                    recentListings: properties.slice(0, 4),
                    role,
                }
            },
            meta: null
        };
    } catch (error: any) {
        logger.error('getFarmNationDashboardStatsAction error:', error);
        return { success: false, data: null, error: error.message, meta: null };
    }
}
