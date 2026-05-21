"use server";

import { auth } from "@/lib/auth";
import { requireSession } from "@/lib/session-guard";
import { checkModuleAccess } from "@/lib/module-access-check";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isValidState, isValidLGA, normalizeLocation } from "@/lib/locations";
import { invalidateUserCache } from "@/lib/cache-invalidation";
import { serializeDoc, serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { z } from "zod";

/**
 * Farm Nation Property Management Actions
 */

export interface Property { id: string;
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
    documents: { cOfO?: string; //  Certificate of Occupancy
        surveyPlan?: string;
        taxClearance?: string;
    };
    createdAt: any;
    updatedAt: any;
    leaseDuration?: number; // months, if type is lease
    viewCount: number;
    favoriteCount: number;
}

export interface PropertyListingInput { name: string;
    description: string;
    location: string;
    state: string;
    lga: string;
    price: number;
    size: number;
    type: "sale" | "lease";
    category: string;
    features: string[];
    leaseDuration?: number; }

/**
 * Get all properties with optional filters
 */
async function _getPropertiesAction(filters?: { 
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
}): Promise<ActionResponse<{ properties: Property[] }>> { 
    try {
        let query: FirebaseFirestore.Query = db.collection(COLLECTIONS.LAND_LISTINGS);

        // Sorting
        query = query.orderBy("createdAt", "desc");

        // Pagination Cursor
        if (filters?.lastDocId) {
            const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
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
            error: null, 
            success: true as const, 
            data: { properties },
            meta: { cursor: lastDoc?.id || null, hasMore: snapshot.docs.length === pageSize }
        };
    } catch (error: any) { 
        logger.error("Get properties error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const getPropertiesAction = withFlexibleSafeAction("getPropertiesAction", _getPropertiesAction);

async function _approveFarmNationSellerAction(userId: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // ── SYNC AUTHORITATIVE RECORD & USER IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const appQuery = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1);
            
            const [userDoc, appSnap] = await Promise.all([
                transaction.get(userRef),
                appQuery.get()
            ]);

            if (!userDoc.exists) throw new Error("User not found");

            // Update user
            transaction.update(userRef, { 
                "serviceRegistrations.farmNation.status": "approved",
                "serviceRegistrations.farmNation.paymentStatus": "completed",
                "serviceRegistrations.farmNation.approvedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.approvedBy": session.user.id,
                roles: FieldValue.arrayUnion("farmer")
            });

            // Update application
            if (!appSnap.empty) { 
                transaction.update(appSnap.docs[0].ref, {
                    status: "approved",
                    approvedAt: FieldValue.serverTimestamp(),
                    approvedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error("Approve seller error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const approveFarmNationSellerAction = withFlexibleSafeAction("approveFarmNationSellerAction", _approveFarmNationSellerAction);

async function _rejectFarmNationSellerAction(userId: string, reason: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // ── SYNC AUTHORITATIVE RECORD & USER IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const appQuery = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS)
                .where("userId", "==", userId)
                .orderBy("submittedAt", "desc")
                .limit(1);
            
            const [userDoc, appSnap] = await Promise.all([
                transaction.get(userRef),
                appQuery.get()
            ]);

            if (!userDoc.exists) throw new Error("User not found");

            transaction.update(userRef, { 
                "serviceRegistrations.farmNation.status": "rejected",
                "serviceRegistrations.farmNation.rejectionReason": reason,
                "serviceRegistrations.farmNation.rejectedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.rejectedBy": session.user.id,
                roles: FieldValue.arrayRemove("farmer") 
            });

            if (!appSnap.empty) { 
                transaction.update(appSnap.docs[0].ref, {
                    status: "rejected",
                    rejectionReason: reason,
                    rejectedAt: FieldValue.serverTimestamp(),
                    rejectedBy: session.user.id,
                    updatedAt: FieldValue.serverTimestamp()
                });
            }
        });

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error("Reject Farm Nation seller error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const rejectFarmNationSellerAction = withFlexibleSafeAction("rejectFarmNationSellerAction", _rejectFarmNationSellerAction);

/**
 * Get property by ID
 */
/**
 * Get property by ID
 */
async function _getPropertyByIdAction(propertyId: string): Promise<ActionResponse<{ property: Property }>> { 
    try {
        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) {
            return { success: false as const, data: null, error: "Property not found", meta: null };
        }

        const data = propertyDoc.data()!;

        // Increment view count
        await propertyRef.update({ viewCount: (data.viewCount || 0) + 1 });

        const property = serializeDoc<Property>(propertyDoc.id, data);

        return { success: true as const, data: { property }, error: null };
    } catch (error: any) { 
        logger.error("Get property error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const getPropertyByIdAction = withFlexibleSafeAction("getPropertyByIdAction", _getPropertyByIdAction);



/**
 * List a new property
 */
/**
 * List a new property
 */
async function _listPropertyAction(input: PropertyListingInput): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Check user tier (Premium required)
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { 
            return { success: false as const, data: null, error: "User not found", meta: null };
        }

        const userData = userDoc.data()!;
        const coopStatus = userData.serviceRegistrations?.cooperatives?.status || userData.serviceRegistrations?.cooperative?.status;
        if (!coopStatus || (coopStatus !== "approved" && coopStatus !== "active")) { 
            return { success: false as const, error: "Cooperative membership required to list properties. Please complete your cooperative registration.", data: null, meta: null };
        }

        // Validate with Zod
        const { farmNationListingSchema } = await import("@/lib/validations/land");
        const validation = farmNationListingSchema.safeParse(input);

        if (!validation.success) { 
            return { success: false as const, error: validation.error.issues[0]?.message || "Validation failed", data: null, meta: null };
        }

        const validatedData = validation.data;

        // Check State/LGA Validity after basic schema check
        if (!isValidState(validatedData.state)) { 
            return { success: false as const, data: null, error: `Invalid State: "${validatedData.state }"`, meta: null };
        }
        if (!isValidLGA(validatedData.state, validatedData.lga)) { 
            return { success: false as const, error: `Invalid LGA: "${validatedData.lga }" in ${validatedData.state}`, data: null, meta: null };
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
            updatedAt: FieldValue.serverTimestamp() 
        };

        await db.collection(COLLECTIONS.LAND_LISTINGS).add(property);

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("List property error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const listPropertyAction = withFlexibleSafeAction("listPropertyAction", _listPropertyAction);

/**
 * Get user's listed properties
 */
/**
 * Get user's listed properties
 */
async function _getMyPropertiesAction(): Promise<ActionResponse<{ properties: Property[] }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        let snapshot;
        try { 
            snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
                .where("ownerId", "==", session.user.id)
                .orderBy("createdAt", "desc")
                .get();
        } catch (e: any) { 
            if (e.message?.includes("FAILED_PRECONDITION")) {
                logger.warn("Missing index for getMyPropertiesAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("ownerId", "==", session.user.id)
                    .get();
                const properties = serializeDocs<Property>(snapshot.docs);
                return { error: null, success: true as const, data: { properties }, meta: null };
            }
            throw e;
        }

        const properties = serializeDocs<Property>(snapshot.docs);

        return { error: null, success: true as const, data: { properties } };
    } catch (error: any) { 
        logger.error("Get my properties error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const getMyPropertiesAction = withFlexibleSafeAction("getMyPropertiesAction", _getMyPropertiesAction);

/**
 * Initiate property purchase/lease
 */
/**
 * Initiate property purchase/lease
 */
async function _initiatePropertyPurchaseAction(
    propertyId: string,
    buyerInfo: { 
        fullName: string;
        email: string;
        phone: string;
        purpose: string;
        zoningComplianceDeclarationAccepted?: boolean;
    }
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        // Strict validation of zoning compliance declaration
        if (!buyerInfo.zoningComplianceDeclarationAccepted) {
            return { success: false as const, error: "Zoning compliance declaration must be accepted to proceed with property purchase", data: null, meta: null };
        }

        // Verify property exists and is available
        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) { 
            return { success: false as const, error: "Property not found", data: null, meta: null };
        }

        const property = propertyDoc.data() as Property;
        if (property.status !== "available") { 
            return { success: false as const, error: "Property is no longer available", data: null, meta: null };
        }

        // Check user tier
        const userRef = db.collection(COLLECTIONS.USERS).doc(session.user.id);
        const userDoc = await userRef.get();

        if (!userDoc.exists) { 
            return { success: false as const, error: "User not found", data: null, meta: null };
        }

        const userData = userDoc.data()!;
        const coopStatus = userData.serviceRegistrations?.cooperatives?.status || userData.serviceRegistrations?.cooperative?.status;
        if (!coopStatus || (coopStatus !== "approved" && coopStatus !== "active")) { 
            return { success: false as const, error: "Cooperative membership required. Please complete your cooperative registration.", data: null, meta: null };
        }

        // ── EXECUTE PURCHASE IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const propSnap = await transaction.get(propertyRef);
            if (!propSnap.exists) throw new Error("Property not found");
            
            const propData = propSnap.data() as Property;
            if (propData.status !== "available") throw new Error("Property is no longer available");

            // Create purchase request record
            const purchaseRequestRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc();
            transaction.set(purchaseRequestRef, { 
                propertyId,
                propertyName: propData.name,
                propertyPrice: propData.price,
                propertyType: propData.type,
                buyerId: session.user.id,
                buyerName: buyerInfo.fullName,
                buyerEmail: buyerInfo.email,
                buyerPhone: buyerInfo.phone,
                purpose: buyerInfo.purpose,
                sellerId: propData.ownerId,
                sellerName: propData.ownerName,
                status: "pending_payment",
                escrowAmount: propData.price,
                escrowStatus: "pending",
                zoningComplianceDeclarationAccepted: true,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            });

            // Mark property as pending
            transaction.update(propertyRef, { 
                status: "pending",
                updatedAt: FieldValue.serverTimestamp() 
            });
        });

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Initiate purchase error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const initiatePropertyPurchaseAction = withFlexibleSafeAction("initiatePropertyPurchaseAction", _initiatePropertyPurchaseAction);

/**
 * Get user's purchase/lease requests
 */
/**
 * Get user's purchase/lease requests
 */
async function _getMyPurchaseRequestsAction(): Promise<ActionResponse<{ requests: any[] }>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

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
                return { error: null, success: true as const, data: { requests }, meta: null };
            }
            throw e;
        }

        const requests = serializeDocs(snapshot.docs);

        return { error: null, success: true as const, data: { requests } };
    } catch (error: any) { 
        logger.error("Get purchase requests error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const getMyPurchaseRequestsAction = withFlexibleSafeAction("getMyPurchaseRequestsAction", _getMyPurchaseRequestsAction);

/**
 * Cancel a purchase/lease request
 */
/**
 * Cancel a purchase/lease request
 */
async function _cancelPurchaseRequestAction(requestId: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const requestRef = db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).doc(requestId);
        const requestDoc = await requestRef.get();

        if (!requestDoc.exists) { 
            return { success: false as const, error: "Purchase request not found", data: null, meta: null };
        }

        const requestData = requestDoc.data();

        // Verify user owns this request
        if (requestData?.buyerId !== session.user.id) { 
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        // Can only cancel pending requests
        if (requestData?.status !== "pending_payment") { 
            return { success: false as const, error: "Can only cancel pending payment requests", data: null, meta: null };
        }

        // ── EXECUTE CANCELLATION IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const reqSnap = await transaction.get(requestRef);
            if (!reqSnap.exists) throw new Error("Purchase request not found");
            
            const reqData = reqSnap.data();
            if (reqData?.buyerId !== session.user.id) throw new Error("Unauthorized");
            if (reqData?.status !== "pending_payment") throw new Error("Can only cancel pending payment requests");

            // Update request status
            transaction.update(requestRef, { 
                status: "cancelled",
                escrowStatus: "refunded",
                cancelledAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            });

            // Mark property as available again
            if (reqData?.propertyId) { 
                const pRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(reqData.propertyId);
                transaction.update(pRef, {
                    status: "verified",
                    updatedAt: FieldValue.serverTimestamp() 
                });
            }
        });

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Cancel purchase request error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const cancelPurchaseRequestAction = withFlexibleSafeAction("cancelPurchaseRequestAction", _cancelPurchaseRequestAction);

/**
 * Delete a property listing
 */
/**
 * Delete a property listing
 */
async function _deletePropertyAction(propertyId: string): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) { 
            return { success: false as const, error: "Property not found", data: null, meta: null };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) { 
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        // Check for active purchase requests
        const activeRequests = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
            .where("propertyId", "==", propertyId)
            .where("status", "in", ["pending_payment", "payment_confirmed"])
            .get();

        if (!activeRequests.empty) { 
            return { success: false as const, error: "Cannot delete property with active purchase requests", data: null, meta: null };
        }

        // Soft delete - mark as deleted
        await propertyRef.update({ 
            status: "deleted",
            deletedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        });

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Delete property error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const deletePropertyAction = withFlexibleSafeAction("deletePropertyAction", _deletePropertyAction);

/**
 * Update a property listing
 */
/**
 * Update a property listing
 */
async function _updatePropertyAction(propertyId: string, updates: Partial<PropertyListingInput>): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) { 
            return { success: false as const, error: "Property not found", data: null, meta: null };
        }

        const property = propertyDoc.data();

        // Verify user owns this property
        if (property?.ownerId !== session.user.id) { 
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        // Build update object
        const updateData: any = { updatedAt: FieldValue.serverTimestamp() };

        if (updates.name) updateData.name = updates.name;
        if (updates.description) updateData.description = updates.description;
        if (updates.location) updateData.location = updates.location;

        // Validate State/LGA updates
        if (updates.state || updates.lga) { 
            const newState = updates.state ? normalizeLocation(updates.state) : property?.state;
            const newLGA = updates.lga ? normalizeLocation(updates.lga) : property?.lga;

            if (updates.state && !isValidState(newState)) {
                return { success: false as const, error: `Invalid State: ${updates.state }`, data: null, meta: null };
            }
            // If both present or one changing, re-validate pair
            if (!isValidLGA(newState, newLGA)) { 
                return { success: false as const, error: `Invalid LGA: ${newLGA } in ${newState}`, data: null, meta: null };
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

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Update property error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}
export const updatePropertyAction = withFlexibleSafeAction("updatePropertyAction", _updatePropertyAction);

/**
 * Submit Farm Nation Onboarding
 */
export interface FarmNationOnboardingData { role: "buyer" | "seller" | "both";
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
    interests: { // Buyer fields
        propertyTypes?: string[];
        budgetRange?: string;
        preferredSize?: string;
        // Seller fields
        listingTypes?: string[];
        totalAcreage?: string;
        readyToList?: boolean;
    };
    terms: { termsAccepted: boolean;
        privacyAccepted: boolean;
        feeDisclosureAccepted: boolean;
    };
}

async function _submitFarmNationOnboardingAction(data: FarmNationOnboardingData): Promise<ActionResponse<null>> { 
    try {
        // Get authenticated session
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Check for existing application
        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;

        if (existingStatus === 'pending' || existingStatus === 'under_review') { 
            return { success: false as const, error: "Your previous application is still being processed.", data: null, meta: null };
        }
        if (existingStatus === 'approved') { 
            return { success: false as const, error: "You are already registered for Farm Nation.", data: null, meta: null };
        }

        // Validate required fields
        if (!data.role || !data.profile || !data.terms) { 
            return { success: false as const, error: "Missing required onboarding data", data: null, meta: null };
        }

        // Validate terms acceptance
        if (!data.terms.termsAccepted || !data.terms.privacyAccepted || !data.terms.feeDisclosureAccepted) { 
            return { success: false as const, error: "You must accept all terms to continue", data: null, meta: null };
        }

        // Prepare user roles
        const roles: string[] = [];
        if (data.role === "buyer" || data.role === "both") { 
            roles.push("investor");
        }
        if (data.role === "seller" || data.role === "both") { 
            roles.push("farmer");
        }

        // ── EXECUTE ONBOARDING IN A TRANSACTION ──────
        await db.runTransaction(async (transaction) => {
            const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
            const appRef = db.collection(COLLECTIONS.FARM_NATION_APPLICATIONS).doc();

            // Prepare names
            const fullName = [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                .filter(Boolean).join(" ").trim();

            // Update user document
            transaction.update(userRef, { 
                "farmNation.role": data.role,
                "farmNation.profile": {
                    ...data.profile,
                    fullName
                },
                "farmNation.interests": data.interests,
                "farmNation.onboardingCompletedAt": new Date().toISOString(),
                "farmNation.termsAcceptedAt": new Date().toISOString(),
                roles: FieldValue.arrayUnion(...roles),
                // Safe dot-notation for serviceRegistrations
                "serviceRegistrations.farmNation.status": "pending",
                "serviceRegistrations.farmNation.paymentStatus": "completed",
                "serviceRegistrations.farmNation.role": data.role,
                "serviceRegistrations.farmNation.completedAt": FieldValue.serverTimestamp(),
                "serviceRegistrations.farmNation.submittedAt": FieldValue.serverTimestamp(),
                
                firstName: data.profile.firstName,
                lastName: data.profile.lastName,
                otherName: data.profile.otherName || null,
                fullName,
                phone: data.profile.phone,
                stateOfOrigin: data.profile.state,
                lga: data.profile.lga,
                residentialAddress: data.profile.address,
                updatedAt: FieldValue.serverTimestamp() 
            });

            // Create authoritative record
            transaction.set(appRef, { 
                userId,
                userEmail: session.user.email,
                role: data.role,
                profile: data.profile,
                interests: data.interests,
                status: "pending",
                submittedAt: FieldValue.serverTimestamp(),
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp() 
            });
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Farm Nation onboarding:", err);
        }

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Error submitting Farm Nation onboarding:", error);
        return { success: false as const, error: "An error occurred while processing your onboarding. Please try again.", data: null, meta: null };
    }
}
export const submitFarmNationOnboardingAction = withFlexibleSafeAction("submitFarmNationOnboardingAction", _submitFarmNationOnboardingAction);

// ============================================
// Check Farm Nation Application Status Action
// ============================================

async function _checkFarmNationStatusAction(): Promise<ActionResponse<string | null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
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
                    await db.collection(COLLECTIONS.USERS).doc(session.user.id).update({
                        "serviceRegistrations.farmNation.status": "approved",
                        "serviceRegistrations.farmNation.paymentStatus": "completed",
                        "serviceRegistrations.farmNation.syncedAt": FieldValue.serverTimestamp()
                    });
                } else if (appData.status) { 
                    status = appData.status;
                }
            }
        }

        if (status) { 
            return { success: true as const, data: status, error: null };
        }

        // ── FALLBACK: Farm Nation data was stored directly in userData.farmNation ──
        // This was the V1 data structure before serviceRegistrations was introduced.
        const legacyFarmNation = userData?.farmNation;
        if (legacyFarmNation?.role || legacyFarmNation?.onboardingCompletedAt) { 
            const legacyStatus = 'pending'; // V1 data = completed onboarding = pending review

            await db.collection(COLLECTIONS.USERS).doc(session.user.id).update(
                {
                    "serviceRegistrations.farmNation.status": legacyStatus,
                    "serviceRegistrations.farmNation.role": legacyFarmNation.role,
                    "serviceRegistrations.farmNation.syncedFromLegacy": true,
                    "serviceRegistrations.farmNation.syncedAt": new Date().toISOString()
                }
            );

            logger.info(`[checkFarmNationStatus] Backfilled legacy farmNation status '${legacyStatus}' for user ${session.user.id}`);
            return { success: true as const, data: legacyStatus, error: null };
        }

        return { success: true as const, data: null, error: null };
    } catch (error) { 
        logger.error("Error checking Farm Nation status:", error);
        return { success: false as const, error: "Failed to check status", data: null };
    }
}
export const checkFarmNationStatusAction = withFlexibleSafeAction("checkFarmNationStatusAction", _checkFarmNationStatusAction);

/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
/**
 * Upload Property Documents (Seller)
 */
/**
 * Upload Property Documents (Seller)
 */
async function _uploadPropertyDocumentsAction(
    propertyId: string,
    documents: { 
        cOfO?: string;
        surveyPlan?: string;
        taxClearance?: string;
    }
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false as const, error: "Property not found", data: null, meta: null };

        const property = propertyDoc.data();
        if (property?.ownerId !== session.user.id) return { success: false as const, error: "Unauthorized", data: null, meta: null };

        // Merge documents
        const currentDocs = property?.documents || {};
        const newDocs = { ...currentDocs, ...documents };

        await propertyRef.update({ 
            documents: newDocs,
            updatedAt: FieldValue.serverTimestamp(),
            verificationStatus: "pending_review" // Reset verification status if new docs added
        });

        return { error: null, success: true as const, data: null };
    } catch (error: any) { 
        logger.error("Upload documents error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}
export const uploadPropertyDocumentsAction = withFlexibleSafeAction("uploadPropertyDocumentsAction", _uploadPropertyDocumentsAction);

/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
/**
 * Verify Property (Admin Only)
 * Toggles the verified status of a property
 */
async function _verifyPropertyAction(propertyId: string, verified: boolean): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        // Check admin role
        const { isAdmin } = await import("@/lib/admin-permissions");
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false as const, error: "Unauthorized", data: null, meta: null };
        }

        const propertyRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(propertyId);
        const propertyDoc = await propertyRef.get();

        if (!propertyDoc.exists) return { success: false as const, error: "Property not found", data: null, meta: null };

        const property = propertyDoc.data() as Property;

        // 🔒 SECURITY FIX: Require Documents for Verification
        if (verified) { 
            // Must have at least C of O OR Survey Plan
            if (!property.documents?.cOfO && !property.documents?.surveyPlan) {
                return { success: false as const, error: "Cannot verify property without documents (C of O or Survey Plan required).", data: null, meta: null };
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
        const { logAuditAction } = await import("@/lib/audit-log");
        await logAuditAction({
            userId: session.user.id,
            action: verified ? "VERIFY_PROPERTY" : "UNVERIFY_PROPERTY",
            details: `${verified ? "Verified" : "Unverified"} property ${propertyId}`,
            metadata: { propertyId, verified }
        });

        return { success: true as const, data: null, meta: null, error: null };
    } catch (error: any) { 
        logger.error("Verify property error:", error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const verifyPropertyAction = withFlexibleSafeAction("verifyPropertyAction", _verifyPropertyAction);

// ============================================================================
// USER REVISION FLOW — Farm Nation Onboarding
// ============================================================================

/**
 * Fetch the current user's Farm Nation onboarding data for prefilling the edit form.
 */
/**
 * Fetch the current user's Farm Nation onboarding data for prefilling the edit form.
 */
async function _getFarmNationApplicationAction(): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(session.user.id).get();
        const userData = userDoc.data();

        const farmNation = serializeValue(userData?.farmNation);
        const registration = serializeValue(userData?.serviceRegistrations?.farmNation);

        if (!farmNation && !registration) { 
            return { success: false as const, data: null, error: 'No application found', meta: null };
        }

        return { error: null, success: true as const, data: { farmNation, registration, rejectionReason: registration?.rejectionReason } };
    } catch (error) { 
        logger.error('getFarmNationApplicationAction error:', error);
        return { success: false as const, data: null, error: 'Failed to fetch application', meta: null };
    }
}
export const getFarmNationApplicationAction = withFlexibleSafeAction("getFarmNationApplicationAction", _getFarmNationApplicationAction);

/**
 * Resubmit a rejected Farm Nation onboarding application with corrected data.
 */
/**
 * Resubmit a rejected Farm Nation onboarding application with corrected data.
 */
async function _resubmitFarmNationApplicationAction(
    data: FarmNationOnboardingData
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
        const existingStatus = userDoc.data()?.serviceRegistrations?.farmNation?.status;
        const allowedStatuses = ['pending', 'rejected', 'revision_required'];

        if (!allowedStatuses.includes(existingStatus || '')) { 
            return { success: false as const, data: null, error: 'Your application cannot be resubmitted at this time.', meta: null };
        }

        if (!data.terms.termsAccepted || !data.terms.privacyAccepted || !data.terms.feeDisclosureAccepted) { 
            return { success: false as const, data: null, error: 'You must accept all terms to continue', meta: null };
        }

        await db.collection(COLLECTIONS.USERS).doc(userId).update(
            { 
                "farmNation.role": data.role,
                "farmNation.profile": {
                    ...data.profile,
                    fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                        .filter(Boolean).join(" ").trim() 
                },
                "farmNation.interests": data.interests,
                "farmNation.resubmittedAt": new Date().toISOString(),
                "farmNation.termsAcceptedAt": new Date().toISOString(),
                updatedAt: FieldValue.serverTimestamp() 
            }
        );

        await db.collection(COLLECTIONS.USERS).doc(userId).update({ 
            'serviceRegistrations.farmNation.status': 'pending',
            'serviceRegistrations.farmNation.paymentStatus': 'completed',
            'serviceRegistrations.farmNation.role': data.role,
            'serviceRegistrations.farmNation.rejectionReason': null,
            'serviceRegistrations.farmNation.resubmittedAt': FieldValue.serverTimestamp(),
            // Sync KYC name fields to central user document
            firstName: data.profile.firstName,
            lastName: data.profile.lastName,
            otherName: data.profile.otherName || null,
            fullName: [data.profile.firstName, data.profile.otherName, data.profile.lastName]
                .filter(Boolean).join(" ").trim(),
            updatedAt: FieldValue.serverTimestamp() 
        });

        try { 
            await invalidateUserCache(userId);
        } catch (err) { 
            logger.error("Failed to invalidate cache after Farm Nation resubmission:", err);
        }

        return { error: null, success: true as const, data: null, meta: null };
    } catch (error: any) { 
        logger.error('resubmitFarmNationApplicationAction error:', error);
        return { success: false as const, data: null, error: 'Failed to resubmit application', meta: null };
    }
}
export const resubmitFarmNationApplicationAction = withFlexibleSafeAction("resubmitFarmNationApplicationAction", _resubmitFarmNationApplicationAction);

// ============================================================================
// DASHBOARD STATS — Farm Nation Member Dashboard
// ============================================================================

export interface FarmNationDashboardStats { /** Total size (hectares) of all properties the user has listed */
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
    recentListings: Array<{ id: string;
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

async function _getFarmNationDashboardStatsAction(): Promise<ActionResponse<FarmNationDashboardStats>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, data: null, error: 'Unauthorized', meta: null };
        const { session } = sessionResult;

        const userId = session.user.id;

        // Fetch in parallel: user's listings + purchase transactions as buyer
        let listingsSnap, transactionsSnap, userDoc;
        try { 
            [listingsSnap, transactionsSnap, userDoc] = await Promise.all([
                db.collection(COLLECTIONS.LAND_LISTINGS)
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
                    db.collection(COLLECTIONS.LAND_LISTINGS).where('ownerId', '==', userId).get(),
                    db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS).where('buyerId', '==', userId).limit(10).get(),
                    db.collection(COLLECTIONS.USERS).doc(userId).get(),
                ]);
                listingsSnap = lSnap;
                transactionsSnap = tSnap;
                userDoc = uDoc;
            } else { 
                throw e;
            }
        }

        const properties = serializeDocs<any>(listingsSnap.docs).map(d => ({ 
            id: d.id,
            size: Number(d.size) || 0,
            price: Number(d.price) || 0,
            status: d.status || 'draft',
            verified: d.status === 'verified',
            name: d.title || 'Unnamed Property',
            location: d.location?.address || d.location?.lga || '',
            state: d.location?.state || '',
            type: d.category || 'sale',
            createdAt: d.createdAt 
        }));

        const transactions = serializeDocs<any>(transactionsSnap.docs).map(d => ({ 
            id: d.id,
            propertyName: d.propertyName || 'Unknown Property',
            propertyType: d.propertyType || 'sale',
            amount: Number(d.propertyPrice || d.escrowAmount || 0),
            status: d.status || 'pending',
            createdAt: d.createdAt 
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

        const stats: FarmNationDashboardStats = {
            totalHectares,
            activeListings,
            completedDeals,
            portfolioValue,
            pendingTransactions,
            propertiesAcquired,
            totalInvestmentValue,
            recentTransactions: transactions.slice(0, 5),
            recentListings: properties.slice(0, 4),
            role
        };

        return { error: null, success: true as const, data: stats };
    } catch (error: any) { 
        logger.error('getFarmNationDashboardStatsAction error:', error);
        return { success: false as const, data: null, error: error.message, meta: null };
    }
}
export const getFarmNationDashboardStatsAction = withFlexibleSafeAction("getFarmNationDashboardStatsAction", _getFarmNationDashboardStatsAction);

async function _checkFarmNationAccessAction(): Promise<ActionResponse<boolean>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false as const, error: "Session expired", data: null };
        }
        const hasAccess = await checkModuleAccess(
            sessionResult.session.user.id,
            sessionResult.session.user.roles || [],
            "farm-nation"
        );
        return { success: true as const, error: null, data: hasAccess };
    } catch (error: any) {
        logger.error("checkFarmNationAccessAction error:", error);
        return { success: false as const, error: error.message ?? "Failed to verify access", data: null };
    }
}
export const checkFarmNationAccessAction = withFlexibleSafeAction("checkFarmNationAccessAction", _checkFarmNationAccessAction);
