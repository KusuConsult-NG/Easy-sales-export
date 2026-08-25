"use server";

import { z } from "zod";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { GeoPoint, FieldValue, Timestamp } from "@/lib/firestore-compat";
import { 
    landListingSchema,
    landListingUpdateSchema,
    landVerificationSchema,
    landSearchSchema 
} from "@/lib/validations/land";
import { type LandListing } from "@/types/strict";
import { createAdminAuditLog } from "@/lib/audit-log";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { isAdmin } from "@/lib/admin-permissions";
import { PUBLIC_LAND_STATUSES, stripInternalLandFields } from "@/lib/land-visibility";
import { isOwnerMutable } from "@/lib/land-listing-status";

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
export async function createLandListing(...args: Parameters<typeof _createLandListing>) {
    return withFlexibleSafeAction("createLandListing", _createLandListing)(...args);
}

/**
 * Get all land listings with optional filters
 */
async function _getLandListings(filters?: z.infer<typeof landSearchSchema>): Promise<ActionResponse<LandListing[]>> { 
    try {
        // The review queue is not a public feed.
        //
        // This endpoint had no caller check at all and honoured a `status`
        // filter, so anyone could ask for `{ status: 'pending_verification' }`
        // and receive every unverified land listing — full documents, including
        // the admin's verificationNotes and rejectionReason, the owner's id and
        // their email. /land/verify, an admin page, is the only caller that ever
        // passes a non-public status.
        //
        // Browsing VERIFIED land stays open, because that is what the module is
        // for. Anything else now needs an admin.
        const requestedStatus = filters?.status;
        const wantsNonPublic = requestedStatus !== undefined && !PUBLIC_LAND_STATUSES.includes(requestedStatus);

        let callerIsAdmin = false;
        if (wantsNonPublic) {
            const sessionResult = await requireSession();
            const roles = sessionResult.session?.user?.roles;
            callerIsAdmin = Boolean(sessionResult.session) && isAdmin(roles);
            if (!callerIsAdmin) {
                return { success: false, error: "Unauthorized", data: null };
            }
        }

        let listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .orderBy('createdAt', 'desc');

        // Apply status filter if provided
        if (filters?.status) {
            const targetStatuses = filters.status === 'verified' ? ['verified', 'approved'] : [filters.status];
            listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
                .where('status', 'in', targetStatuses)
                .orderBy('createdAt', 'desc');
        }

        if (filters?.limit) { 
            listingsQuery = listingsQuery.limit(filters.limit);
        } else { 
            listingsQuery = listingsQuery.limit(50);
        }

        const snapshot = await listingsQuery.get();

        let listings = snapshot.docs
            .map(doc => { 
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
            })
            .filter(listing => (listing as any).status !== 'deleted');

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
export async function getLandListings(...args: Parameters<typeof _getLandListings>) {
    return withFlexibleSafeAction("getLandListings", _getLandListings)(...args);
}

/**
 * Get verified land listings only (public view)
 */
async function _getVerifiedLandListings(filters?: z.infer<typeof landSearchSchema>): Promise<ActionResponse<LandListing[]>> { 
    return _getLandListings({ ...filters, status: 'verified' });
}
export async function getVerifiedLandListings(...args: Parameters<typeof _getVerifiedLandListings>) {
    return withFlexibleSafeAction("getVerifiedLandListings", _getVerifiedLandListings)(...args);
}

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

        // A listing under review is visible to its owner and to admins, and to
        // nobody else.
        //
        // This returned the whole document for any id, in any status, with no
        // session at all — so a stranger walking ids could read pending and
        // rejected listings along with the admin notes explaining why. It has no
        // UI caller, which is not a defence: every export of a "use server"
        // module is a reachable endpoint.
        const isPublicStatus = PUBLIC_LAND_STATUSES.includes(String(data.status));
        if (!isPublicStatus) {
            const sessionResult = await requireSession();
            const viewerId = sessionResult.session?.user?.id;
            const viewerIsAdmin = isAdmin(sessionResult.session?.user?.roles);
            if (!viewerId || (viewerId !== data.ownerId && !viewerIsAdmin)) {
                // Indistinguishable from "no such listing", so the endpoint does
                // not confirm that an id exists to someone who may not see it.
                return { success: true, error: null, data: null };
            }
        }

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

        // Internal review fields are stripped for a public viewer. The owner and
        // an admin keep them — the owner needs to read why they were rejected.
        const sessionForFields = await requireSession();
        const viewer = sessionForFields.session?.user;
        const privileged = Boolean(viewer) && (viewer!.id === data.ownerId || isAdmin(viewer!.roles));

        return {
            success: true,
            error: null,
            data: privileged ? listing : stripInternalLandFields(listing),
        };
    } catch (error: any) { 
        logger.error("getLandListing error:", error);
        return { success: false, error: "Failed to fetch listing", data: null };
    }
}
export async function getLandListing(...args: Parameters<typeof _getLandListing>) {
    return withFlexibleSafeAction("getLandListing", _getLandListing)(...args);
}

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

        const listings = snapshot.docs
            .map(doc => {
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
            })
            .filter(listing => (listing as any).status !== 'deleted');

        return { success: true, error: null, data: listings };
    } catch (error: any) { 
        logger.error("getMyLandListings error:", error);
        return { success: false, error: "Failed to fetch your listings", data: null };
    }
}
export async function getMyLandListings(...args: Parameters<typeof _getMyLandListings>) {
    return withFlexibleSafeAction("getMyLandListings", _getMyLandListings)(...args);
}

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
        if (listingData.ownerId !== session.user.id && !(session.user.roles?.includes('admin') || session.user.roles?.includes('super_admin'))) {
            return { success: false, error: "Unauthorized to edit this listing", data: null };
        }

        // AN OWNER EDIT ERASED A BUYER'S RESERVATION.
        //
        // The write below sets `status: "pending_verification"` unconditionally.
        // A buyer reserving this parcel claims it to "pending"
        // (_fn_purchases.ts) and then pays at Paystack; the fulfilment and the
        // cancel path both advance it FROM "pending" via claimStatusTransition.
        // An owner edit landing in that window rewrote the status, so the claim
        // could never fire: the buyer's money was taken for a listing that had
        // been re-priced and pulled back into review under them. Same fault the
        // admin decision paths were taught about (DECISION_LOCKED_STATUSES);
        // this is the owner's copy of it, and `sold` was editable too.
        if (!isOwnerMutable(listingData.status)) {
            return {
                success: false,
                error: `This listing cannot be edited right now (status: ${listingData.status}). `
                    + `A purchase is in progress or completed.`,
                data: null,
            };
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
export async function updateLandListing(...args: Parameters<typeof _updateLandListing>) {
    return withFlexibleSafeAction("updateLandListing", _updateLandListing)(...args);
}

/**
 * Verify or reject a land listing (Admin only)
 */
async function _verifyLandListing(
    data: z.infer<typeof landVerificationSchema>
): Promise<ActionResponse<null>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    //   #265 AND "VERIFYING LAND IS NOT THEIR JOB" WAS WRONG ABOUT ONE ROLE.
    //
    //        The note above rejects isAdmin() because it "would WIDEN this to
    //        moderator, support and every module admin" — true, and that is not
    //        the choice. land:verify_listings is held by super_admin, admin and
    //        farm_nation_admin, and by no other module admin. The matrix says
    //        verifying land IS the farm-nation admin's job; this guard said it
    //        was not, and the matrix is the definition.
    //
    //        Naming the permission also keeps the fix the note was written for:
    //        a super_admin without the literal 'admin' role still passes.
    const canVerifyLand = hasAdminPermission(session?.user?.roles, "land:verify_listings");
    if (!session || !canVerifyLand) {
        return { success: false, error: "Unauthorized: land:verify_listings required", data: null };
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
export async function verifyLandListing(...args: Parameters<typeof _verifyLandListing>) {
    return withFlexibleSafeAction("verifyLandListing", _verifyLandListing)(...args);
}

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
        if (listingData.ownerId !== session.user.id && !(session.user.roles?.includes('admin') || session.user.roles?.includes('super_admin'))) {
            return { success: false, error: "Unauthorized to delete this listing", data: null };
        }

        // Deleting mid-purchase is the edit fault with a tombstone: the buyer's
        // "pending" reservation (or a completed sale) was overwritten with
        // "deleted", and the claim that fulfils or cancels the purchase can
        // never move a deleted row. Same rule as the edit above.
        if (!isOwnerMutable(listingData.status)) {
            return {
                success: false,
                error: `This listing cannot be deleted right now (status: ${listingData.status}). `
                    + `A purchase is in progress or completed.`,
                data: null,
            };
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
export async function deleteLandListing(...args: Parameters<typeof _deleteLandListing>) {
    return withFlexibleSafeAction("deleteLandListing", _deleteLandListing)(...args);
}

/**
 * Get land listing statistics (Admin only)
 */
async function _getLandStatistics(): Promise<ActionResponse<any>> { 
    const sessionResult = await requireSession();
    if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
    const { session } = sessionResult;
    
    // #265 Same permission as the verification queue above: an admin running
    // that queue needs the numbers that describe it.
    if (!session || !hasAdminPermission(session.user.roles, "land:verify_listings")) {
        return { success: false, error: "Unauthorized: land:verify_listings required", data: null };
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
export async function getLandStatistics(...args: Parameters<typeof _getLandStatistics>) {
    return withFlexibleSafeAction("getLandStatistics", _getLandStatistics)(...args);
}
