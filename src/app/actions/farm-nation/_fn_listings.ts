"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isBrowsable } from "@/lib/land-listing-status";
import { isValidState, isValidLGA, normalizeLocation } from "@/lib/locations";
import { serializeDoc, serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Property, PropertyListingInput } from "@/lib/types/farm-nation-actions";

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
        let query: import("@/lib/supabase-db").SupabaseQuery = db.collection(COLLECTIONS.LAND_LISTINGS);

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
        // Only show listings that can actually be bought.
        //
        // There was no status filter here at all, so buyers were shown listings
        // awaiting verification, ones an admin had explicitly rejected, and
        // soft-deleted ones — and could start a purchase that then failed.
        properties = properties.filter((p) => isBrowsable(p.status));

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
                const catFilter = filters.category;
                properties = properties.filter((p) => {
                    if (!p.category) return false;
                    if (Array.isArray(p.category)) {
                        return p.category.includes(catFilter);
                    }
                    if (typeof p.category === "string") {
                        const cats = p.category.split(",").map(c => c.trim().toLowerCase());
                        return cats.includes(catFilter.toLowerCase()) || p.category === catFilter;
                    }
                    return false;
                });
            }
            if (filters.type && filters.type !== "all") { 
                properties = properties.filter((p) => p.type === filters.type);
            }
            if (filters.minPrice) { 
                const minPrice = filters.minPrice;
                properties = properties.filter((p) => p.price >= minPrice);
            }
            if (filters.maxPrice) { 
                const maxPrice = filters.maxPrice;
                properties = properties.filter((p) => p.price <= maxPrice);
            }
            if (filters.minSize) { 
                const minSize = filters.minSize;
                properties = properties.filter((p) => p.size >= minSize);
            }
            if (filters.maxSize) { 
                const maxSize = filters.maxSize;
                properties = properties.filter((p) => p.size <= maxSize);
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

        // Increment view count.
        //
        // This read the value and wrote back `(data.viewCount || 0) + 1`, so two
        // views landing together both read the same number and one of them was
        // lost. The endpoint is public, so concurrency here is the normal case
        // rather than the exception.
        //
        // The rest of the codebase already uses the atomic primitive —
        // `downloads: FieldValue.increment(1)` in wave/_actions.ts — and the
        // sweep for this shape found no other persisted counter doing it by
        // hand, so this was the last one.
        await propertyRef.update({ viewCount: FieldValue.increment(1) });

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
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.includes("index") || e.message?.includes("INDEX")) {
                logger.warn("Missing index for getMyPropertiesAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
                    .where("ownerId", "==", session.user.id)
                    .get();
                const properties = serializeDocs<Property>(snapshot.docs);
                properties.sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime;
                });
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
