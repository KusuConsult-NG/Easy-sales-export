"use server";

import { requireSession } from "@/lib/session-guard";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isBrowsable, AWAITING_VERIFICATION_STATUS } from "@/lib/land-listing-status";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
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

        /**
         * The COMMERCIAL terms are frozen once money is committed.
         *
         * THE DEFECT
         * ----------
         * `price` was writable at any time, by the owner, with no reference to the
         * listing's status — and verifyPropertyPaymentAction compares what the
         * buyer paid against the LIVE listing price:
         *
         *     if (amountInNaira + 1 < listedPrice) throw new Error("Payment ... does not cover ...")
         *
         * So this sequence took a buyer's money and refused them:
         *
         *   1. owner lists at ₦5,000,000; an admin verifies it
         *   2. buyer initialises — charged the listed ₦5,000,000, and the listing
         *      moves to pending_escrow
         *   3. buyer pays on Paystack
         *   4. owner updates price to ₦50,000,000
         *   5. the buyer returns, verification reads the NEW price, and throws
         *
         * The payment is claimed by then, so the buyer has paid and received
         * nothing. It works as deliberate griefing, but it does not need malice:
         * an owner legitimately repricing between a buyer's initialisation and
         * their return from Paystack breaks that purchase the same way.
         *
         * Descriptive fields — name, description, location, features — stay
         * editable, because correcting a typo mid-sale harms nobody. It is the
         * terms the buyer was quoted on that must not move under them.
         */
        const TERMS_LOCKED_IN = [
            "pending_escrow",
            "pending_payment",
            "payment_confirmed",
            "pending_transfer",
            "sold",
            "completed",
        ];

        const changesTerms =
            updates.price !== undefined ||
            updates.size !== undefined ||
            updates.type !== undefined ||
            updates.category !== undefined ||
            updates.leaseDuration !== undefined;

        if (changesTerms && TERMS_LOCKED_IN.includes(String(property?.status))) {
            return {
                success: false as const,
                error:
                    `This property has a purchase in progress (${property?.status}), so its price, ` +
                    `size, type and lease terms cannot be changed. Descriptive details can still be ` +
                    `edited, or resolve the purchase first.`,
                data: null,
                meta: null,
            };
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
        });

        /**
         * Re-entering the review queue, which the comment here claimed to do and
         * the code did not.
         *
         * It wrote `verificationStatus: "pending_review"` and called that
         * "Reset verification status if new docs added". Two things were wrong
         * with it:
         *
         *   1. "pending_review" is a value nothing reads. The review queues
         *      match "pending" (admin/_land.ts, before it moved to `status`) or
         *      derive their state from `status` (_fna_verifications.ts). So the
         *      reset resolved to nothing anywhere.
         *
         *   2. It never touched `status`, which is what the queues actually
         *      select on. This action exists for an owner whose listing was
         *      REJECTED for missing documents — the whole reason to upload them —
         *      and after uploading, the listing stayed `rejected`. It never came
         *      back to an admin, and the owner had no way to make it. That is a
         *      listing permanently stuck one action away from approval.
         *
         * Only `rejected` and `draft` are resubmitted. A listing that is already
         * live must not be pulled off the market because its owner attached
         * another document, and one with money against it is not this action's to
         * move.
         */
        const RESUBMITTABLE_FROM = ["rejected", "draft"];

        if (RESUBMITTABLE_FROM.includes(String(property?.status))) {
            const resubmitted = await claimStatusTransitionFromAny({
                collection: COLLECTIONS.LAND_LISTINGS,
                id: propertyId,
                fromAny: RESUBMITTABLE_FROM,
                to: "pending_verification",
                patch: {
                    verificationStatus: AWAITING_VERIFICATION_STATUS,
                    verified: false,
                    // The reason is cleared because it has been addressed. The
                    // admin audit log holds the history.
                    rejectionReason: null,
                    resubmittedAt: FieldValue.serverTimestamp(),
                    updatedAt: FieldValue.serverTimestamp(),
                },
                recordPreviousAs: "statusBeforeResubmission",
            });

            // A refusal here is not an error for the caller: the documents were
            // saved, which is what they asked for. It means the listing moved on
            // between the read and the write.
            if (!resubmitted.claimed) {
                logger.warn(
                    `[uploadPropertyDocuments] Documents saved for ${propertyId} but ` +
                    `resubmission skipped: status is '${resubmitted.status}'.`
                );
            }
        }

        return { error: null, success: true as const, data: null };
    } catch (error: any) { 
        logger.error("Upload documents error:", error);
        return { success: false as const, error: error.message, data: null };
    }
}


export const uploadPropertyDocumentsAction = withFlexibleSafeAction("uploadPropertyDocumentsAction", _uploadPropertyDocumentsAction);
