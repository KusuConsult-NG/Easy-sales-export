"use server";

import { z } from "zod";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue, Timestamp, GeoPoint } from "firebase-admin/firestore";
import { 
    landListingSchema,
    landListingUpdateSchema,
    landVerificationSchema,
    landSearchSchema 
} from "@/lib/validations/land";
import { type LandListing } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log-admin";
import { requireSession } from "@/lib/session-guard";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { logger } from "@/lib/logger";

/**
 * Create a new land listing
 */
async function _createLandListing(
    data: z.infer<typeof landListingSchema>
): Promise<ActionResponse<null>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { 
        const validated = landListingSchema.parse(data);

        // Create GeoPoint for Firestore geolocation
        const geoPoint = new GeoPoint(validated.location.lat, validated.location.lng);

        // Create land listing in Firestore
        const listingRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add({
            ...validated,
            location: {
                ...validated.location,
                geopoint: geoPoint, // For geospatial queries
            },
            ownerId: session.user.id,
            status: 'pending_verification',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            verifiedAt: null,
            verifiedBy: null,
            rejectionReason: null 
        });

        // Audit log
        await createAdminAuditLog({
            userId: session.user.id,
            action: 'land_created',
            targetId: listingRef.id,
            targetType: 'land_listing',
            metadata: {
                title: validated.title,
                size: validated.size,
                price: validated.price,
                location: `${validated.location.city}, ${validated.location.state}` 
            } 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        if (error instanceof z.ZodError) {
            const firstIssue = error.issues[0];
            return { success: false, error: `${firstIssue.path.join('.')}: ${firstIssue.message}`, data: null };
        }
        logger.error("createLandListing error:", error);
        return { success: false, error: "Failed to create land listing", data: null };
    }
}
export const createLandListing = withFlexibleSafeAction("createLandListing", _createLandListing);

/**
 * Get all land listings with optional filters
 */
async function _getLandListings(filters?: z.infer<typeof landSearchSchema>): Promise<ActionResponse<LandListing[]>> { 
    try {
        let listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .orderBy('createdAt', 'desc');

        // Apply status filter if provided
        if (filters?.status) {
            listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
                .where('status', '==', filters.status)
                .orderBy('createdAt', 'desc');
        }

        if (filters?.limit) { 
            listingsQuery = listingsQuery.limit(filters.limit);
        } else { 
            listingsQuery = listingsQuery.limit(50);
        }

        const snapshot = await listingsQuery.get();

        let listings = snapshot.docs.map(doc => { 
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                location: {
                    ...data.location,
                    lat: data.location.geopoint?.latitude || data.location.lat,
                    lng: data.location.geopoint?.longitude || data.location.lng 
                },
                createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
                verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate().toISOString() : null 
            } as unknown as LandListing;
        });

        // Apply client-side filters
        if (filters) { 
            listings = listings.filter(listing => {
                if (filters.minPrice && listing.price < filters.minPrice) return false;
                if (filters.maxPrice && listing.price > filters.maxPrice) return false;
                if (filters.minSize && listing.size < filters.minSize) return false;
                if (filters.maxSize && listing.size > filters.maxSize) return false;
                if (filters.soilQuality && listing.soilQuality !== filters.soilQuality) return false;
                if (filters.state && listing.location.state !== filters.state) return false;
                if (filters.city && listing.location.city !== filters.city) return false;
                if (filters.waterAccess !== undefined && listing.waterAccess !== filters.waterAccess) return false;
                if (filters.electricityAccess !== undefined && listing.electricityAccess !== filters.electricityAccess) return false;
                if (filters.roadAccess !== undefined && listing.roadAccess !== filters.roadAccess) return false;
                return true;
            });
        }

        return { success: true, error: null, data: listings };
    } catch (error: any) { 
        logger.error("getLandListings error:", error);
        return { success: false, error: "Failed to fetch land listings", data: null };
    }
}
export const getLandListings = withFlexibleSafeAction("getLandListings", _getLandListings);

/**
 * Get verified land listings only (public view)
 */
async function _getVerifiedLandListings(filters?: z.infer<typeof landSearchSchema>): Promise<ActionResponse<LandListing[]>> { 
    return _getLandListings({ ...filters, status: 'verified' });
}
export const getVerifiedLandListings = withFlexibleSafeAction("getVerifiedLandListings", _getVerifiedLandListings);

/**
 * Get a specific land listing by ID
 */
async function _getLandListing(listingId: string): Promise<ActionResponse<LandListing | null>> { 
    try {
        const listingDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId).get();

        if (!listingDoc.exists) {
            return { success: true, error: null, data: null };
        }

        const data = listingDoc.data()!;

        const listing: LandListing = { 
            id: listingDoc.id,
            ...data,
            location: {
                ...data.location,
                lat: data.location.geopoint?.latitude || data.location.lat,
                lng: data.location.geopoint?.longitude || data.location.lng 
            },
            createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
            updatedAt: (data.updatedAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
            verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate().toISOString() : null 
        } as unknown as LandListing;

        return { success: true, error: null, data: listing };
    } catch (error: any) { 
        logger.error("getLandListing error:", error);
        return { success: false, error: "Failed to fetch listing", data: null };
    }
}
export const getLandListing = withFlexibleSafeAction("getLandListing", _getLandListing);

/**
 * Get user's own land listings
 */
async function _getMyLandListings(): Promise<ActionResponse<LandListing[]>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { 
        const listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where('ownerId', '==', session.user.id)
            .orderBy('createdAt', 'desc');

        const snapshot = await listingsQuery.get();

        const listings = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                ...data,
                location: {
                    ...data.location,
                    lat: data.location.geopoint?.latitude || data.location.lat,
                    lng: data.location.geopoint?.longitude || data.location.lng 
                },
                createdAt: (data.createdAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
                updatedAt: (data.updatedAt as Timestamp)?.toDate().toISOString() || new Date().toISOString(),
                verifiedAt: data.verifiedAt ? (data.verifiedAt as Timestamp).toDate().toISOString() : null 
            } as unknown as LandListing;
        });

        return { success: true, error: null, data: listings };
    } catch (error: any) { 
        logger.error("getMyLandListings error:", error);
        return { success: false, error: "Failed to fetch your listings", data: null };
    }
}
export const getMyLandListings = withFlexibleSafeAction("getMyLandListings", _getMyLandListings);

/**
 * Update a land listing (owner only)
 */
async function _updateLandListing(
    data: z.infer<typeof landListingUpdateSchema>
): Promise<ActionResponse<null>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { 
        const validated = landListingUpdateSchema.parse(data);

        // Check ownership
        const listingDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(validated.listingId).get();
        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        const listingData = listingDoc.data()!;
        if (listingData.ownerId !== session.user.id && !session.user.roles?.includes('admin')) { 
            return { success: false, error: "Unauthorized to edit this listing", data: null };
        }

        const { listingId, ...updateData } = validated;

        // If location is updated, create new GeoPoint
        if (updateData.location) { 
            const geoPoint = new GeoPoint(updateData.location.lat, updateData.location.lng);
            (updateData as any).location = {
                ...updateData.location,
                geopoint: geoPoint 
            };
        }

        await db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId).update({ 
            ...updateData,
            updatedAt: FieldValue.serverTimestamp(),
            status: 'pending_verification' 
        });

        // Audit log
        await createAdminAuditLog({ 
            userId: session.user.id,
            action: 'land_updated',
            targetId: listingId,
            targetType: 'land_listing',
            metadata: { action: 'update' } 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        if (error instanceof z.ZodError) {
            const firstIssue = error.issues[0];
            return { success: false, error: `${firstIssue.path.join('.')}: ${firstIssue.message}`, data: null };
        }
        logger.error("updateLandListing error:", error);
        return { success: false, error: "Failed to update listing", data: null };
    }
}
export const updateLandListing = withFlexibleSafeAction("updateLandListing", _updateLandListing);

/**
 * Verify or reject a land listing (Admin only)
 */
async function _verifyLandListing(
    data: z.infer<typeof landVerificationSchema>
): Promise<ActionResponse<null>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    if (!session || !session.user.roles?.includes('admin')) { 
        return { success: false, error: "Unauthorized - Admin only", data: null };
    }

    try { 
        const validated = landVerificationSchema.parse(data);

        const updateData: Record<string, unknown> = {
            status: validated.verified ? 'verified' : 'rejected',
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        };

        if (validated.notes) { updateData.verificationNotes = validated.notes; }
        if (!validated.verified && validated.rejectionReason) { updateData.rejectionReason = validated.rejectionReason; }

        await db.collection(COLLECTIONS.LAND_LISTINGS).doc(validated.listingId).update(updateData);

        // Audit log
        await createAdminAuditLog({ 
            userId: session.user.id,
            action: 'land_verified',
            targetId: validated.listingId,
            targetType: 'land_listing',
            metadata: {
                verified: validated.verified,
                notes: validated.notes,
                rejectionReason: validated.rejectionReason 
            } 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        if (error instanceof z.ZodError) {
            const firstIssue = error.issues[0];
            return { success: false, error: `${firstIssue.path.join('.')}: ${firstIssue.message}`, data: null };
        }
        logger.error("verifyLandListing error:", error);
        return { success: false, error: "Failed to verify listing", data: null };
    }
}
export const verifyLandListing = withFlexibleSafeAction("verifyLandListing", _verifyLandListing);

/**
 * Delete a land listing (owner or admin only)
 */
async function _deleteLandListing(listingId: string): Promise<ActionResponse<null>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;

    try { 
        const listingDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId).get();
        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        const listingData = listingDoc.data()!;
        if (listingData.ownerId !== session.user.id && !session.user.roles?.includes('admin')) { 
            return { success: false, error: "Unauthorized to delete this listing", data: null };
        }

        // Soft delete by updating status
        await db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId).update({ 
            status: 'deleted',
            deletedAt: FieldValue.serverTimestamp(),
            deletedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp() 
        });

        // Audit log
        await createAdminAuditLog({ 
            userId: session.user.id,
            action: 'land_deleted',
            targetId: listingId,
            targetType: 'land_listing',
            metadata: { action: 'delete' } 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("deleteLandListing error:", error);
        return { success: false, error: "Failed to delete listing", data: null };
    }
}
export const deleteLandListing = withFlexibleSafeAction("deleteLandListing", _deleteLandListing);

/**
 * Get land listing statistics (Admin only)
 */
async function _getLandStatistics(): Promise<ActionResponse<any>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    if (!session || !session.user.roles?.includes('admin')) { 
        return { success: false, error: "Unauthorized - Admin only", data: null };
    }

    try {
        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS).limit(5000).get();

        const stats = {
            total: 0,
            pending: 0,
            verified: 0,
            rejected: 0,
            totalSize: 0,
            totalValue: 0,
            averagePrice: 0,
            byState: {} as Record<string, number>,
            bySoilQuality: {} as Record<string, number> 
        };

        snapshot.docs.forEach(doc => { 
            const data = doc.data();

            // Skip deleted
            if (data.status === 'deleted') return;

            stats.total++;
            stats.totalSize += data.size || 0;
            stats.totalValue += data.price || 0;

            if (data.status === 'pending_verification') stats.pending++;
            else if (data.status === 'verified') stats.verified++;
            else if (data.status === 'rejected') stats.rejected++;

            // By state
            const state = data.location?.state || 'Unknown';
            stats.byState[state] = (stats.byState[state] || 0) + 1;

            // By soil quality
            const quality = data.soilQuality || 'Unknown';
            stats.bySoilQuality[quality] = (stats.bySoilQuality[quality] || 0) + 1;
        });

        if (stats.total > 0) { 
            stats.averagePrice = Math.round(stats.totalValue / stats.total);
        }

        return { success: true, error: null, data: stats };
    } catch (error: any) { 
        logger.error("getLandStatistics error:", error);
        return { success: false, error: "Failed to fetch statistics", data: null };
    }
}
export const getLandStatistics = withFlexibleSafeAction("getLandStatistics", _getLandStatistics);
