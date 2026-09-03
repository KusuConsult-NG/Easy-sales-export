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
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { PUBLIC_LAND_STATUSES, stripInternalLandFields } from "@/lib/land-visibility";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import { APPROVABLE_FROM_STATUSES, REJECTABLE_FROM_STATUSES } from "@/lib/land-listing-status";

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

        /**
         * THE REVIEW QUEUE WAS THE DEFAULT PAGE.
         *
         * The gate above fires only when the caller ASKS for a non-public
         * status. Omitting the filter left `wantsNonPublic` false, so no session
         * was required — and the query then applied no status predicate at all,
         * because that too was inside `if (filters?.status)`. So
         * `getLandListings()`, with no arguments and no session, returned every
         * listing on the platform: pending_verification, rejected, all of it.
         *
         * The gate refused the front door and left the wall open, and the wall
         * is the one lib/land-visibility.ts was extracted from this file to
         * build. Its header names the endpoint that spread whole documents;
         * this is the action the rule came from.
         *
         * The status set is decided ONCE now, and defaults to public. Anything
         * else has to be asked for, and asking is what the gate above checks.
         *
         * `verified` expands to the whole public set rather than to the
         * hardcoded `['verified', 'approved']` it used to. That pair was the
         * drift land-visibility.ts documents: `available` is purchasable and was
         * missing here, so every listing Farm Nation created was buyable and
         * absent from this feed — invisible inventory, reachable only by direct
         * URL.
         */
        const targetStatuses = wantsNonPublic
            ? [requestedStatus as string]
            : [...PUBLIC_LAND_STATUSES];

        let listingsQuery = db.collection(COLLECTIONS.LAND_LISTINGS)
            .where('status', 'in', targetStatuses);

        /**
         * AND THE SEARCH FILTERS RAN OVER AN ARBITRARY PAGE.
         *
         * `.limit()` was applied by the database and every filter below was
         * applied in memory AFTERWARDS, so a search matched only within the
         * newest N listings. With an older, cheaper parcel in the catalogue,
         * "under ₦2,000,000" returned nothing — indistinguishable from a
         * catalogue that has none, which is the same shape as the export window
         * date filter and the admin marketplace search.
         *
         * The predicates the database can express are asked of the database, so
         * the limit applies to MATCHING rows, which is what a caller means by
         * `limit`. A range predicate beside an equality and an order is ordinary
         * on Postgres through PostgREST — the same argument the export window
         * filter was moved on.
         */
        if (filters?.minPrice !== undefined) listingsQuery = listingsQuery.where('price', '>=', filters.minPrice);
        if (filters?.maxPrice !== undefined) listingsQuery = listingsQuery.where('price', '<=', filters.maxPrice);
        if (filters?.minSize !== undefined) listingsQuery = listingsQuery.where('size', '>=', filters.minSize);
        if (filters?.maxSize !== undefined) listingsQuery = listingsQuery.where('size', '<=', filters.maxSize);
        if (filters?.soilQuality) listingsQuery = listingsQuery.where('soilQuality', '==', filters.soilQuality);
        if (filters?.state) listingsQuery = listingsQuery.where('location.state', '==', filters.state);
        if (filters?.city) listingsQuery = listingsQuery.where('location.city', '==', filters.city);

        listingsQuery = listingsQuery.orderBy('createdAt', 'desc');
        listingsQuery = listingsQuery.limit(filters?.limit ?? 50);

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
            // Backstop. `deleted` is not in PUBLIC_LAND_STATUSES and is not a
            // value landSearchSchema accepts, so the query above cannot select
            // one — this stays for a row whose status the query matched by some
            // other route.
            .filter(listing => (listing as any).status !== 'deleted');

        // The three the database cannot answer, because nothing writes them.
        //
        // waterAccess, electricityAccess and roadAccess are read by LandMap and
        // by /land/verify and are written by no creator in this codebase, so
        // they are absent from every stored listing. Filtering on one therefore
        // matches nothing — which is the honest outcome for a field that does
        // not exist, and is left in memory rather than pushed into a query where
        // it would look like a supported search.
        if (filters) {
            listings = listings.filter(listing => {
                if (filters.waterAccess !== undefined && listing.waterAccess !== filters.waterAccess) return false;
                if (filters.electricityAccess !== undefined && listing.electricityAccess !== filters.electricityAccess) return false;
                if (filters.roadAccess !== undefined && listing.roadAccess !== filters.roadAccess) return false;
                return true;
            });
        }

        /**
         * The browse feed is stripped; the review queue is not.
         *
         * This feed never called stripInternalLandFields at all, while the
         * single-listing read below it and /api/farm-nation/listings both do —
         * so a verified listing that had been rejected once handed a stranger
         * the admin's notes, the admin's user id and the owner's email.
         *
         * Decided by which status set was asked for rather than by re-resolving
         * the session: a non-public status is admin-only by the gate above, and
         * a public browse never needs the review fields. That keeps the public
         * path free of a session lookup it does not otherwise need.
         */
        const visible = wantsNonPublic ? listings : listings.map(stripInternalLandFields);

        return { success: true, error: null, data: visible };
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
            status: 'pending_verification',
            // The previous approval does not survive the edit that voided it.
            //
            // The status went back to pending_verification and `verifiedAt` /
            // `verifiedBy` stayed exactly as they were, so a listing waiting for
            // review still carried "verified by admin-9 on that date" — and the
            // admin re-reviewing it was looking at their own earlier approval of
            // different content.
            //
            // verificationNotes and rejectionReason are deliberately left: the
            // owner is editing in order to address them, and needs to keep
            // reading what they said.
            verifiedAt: null,
            verifiedBy: null,
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
    
    /**
     * THE ROLE THAT OWNS THIS QUEUE WAS THE ONE IT LOCKED OUT.
     *
     * The guard was `roles.includes('admin') || roles.includes('super_admin')`
     * under a comment explaining that isAdmin() would wrongly widen this to
     * "moderator, support and every module admin; verifying land is not their
     * job". Right about isAdmin(), wrong about the conclusion — the choice is
     * not between a hardcoded pair and a helper that admits everyone. There is
     * a permission for this, `land:verify_listings`, and admin-permissions.ts
     * grants it to exactly three roles:
     *
     *     farm_nation_admin: [..., "land:verify_listings"]
     *
     * super_admin, admin AND farm_nation_admin. Farm Nation is the module land
     * verification belongs to. Every other door to this operation already asks
     * for the permission by name — admin/_land.ts (twice),
     * farm-nation/_fn_admin.ts, farm-nation-admin/_fna_verifications.ts
     * (twice), land-listings.ts (three times), and the approve-land and
     * reject-land route handlers. Eleven call sites agree; this was the
     * twelfth, and it disagreed with all of them.
     *
     * So a farm_nation_admin could approve a listing through
     * /api/admin/farm-nation/approve-land and was refused by this action: two
     * doors to the same operation, one open and one shut, and which one you
     * got depended on which screen you were standing on.
     *
     * Naming the permission is neither the old pair nor isAdmin(). It admits
     * the three roles the matrix lists and still refuses moderator, support,
     * wave_admin and academy_admin — which is what the old comment was
     * protecting, and is asserted in land-listing-visibility.test.ts.
     */
    if (!hasAdminPermission(session?.user.roles, "land:verify_listings")) {
        return { success: false, error: "Unauthorized - land:verify_listings required", data: null };
    }

    try { 
        const validated = landVerificationSchema.parse(data);

        const patch: Record<string, unknown> = {
            verifiedBy: session.user.id,
            verifiedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        };

        if (validated.notes) { patch.verificationNotes = validated.notes; }
        if (!validated.verified && validated.rejectionReason) { patch.rejectionReason = validated.rejectionReason; }

        /**
         * THE SIXTH BLIND LAND STATUS WRITE.
         *
         * admin/_land.ts carries a comment headed "The FIFTH blind land status
         * write, and the most exposed of the five", and lists what the five had
         * in common: they wrote the status unconditionally, without reading the
         * listing first. All five were converted to claimStatusTransitionFromAny.
         *
         * This one was not among them — and /land/verify, the admin verification
         * page, calls THIS one. It was
         *
         *     await db.collection(LAND_LISTINGS).doc(validated.listingId).update(updateData)
         *
         * with no read at all. Two consequences, and the second is the one that
         * touches money:
         *
         *   A listing id that does not exist. update() on a missing document is
         *   a no-op on this adapter — it warns and affects no rows — so the
         *   action reported success and wrote an audit row recording a
         *   verification that never happened.
         *
         *   A listing whose state should not be overwritten. Farm Nation holds a
         *   buyer's money against `pending_escrow`. Approving from there put the
         *   parcel back on the public market with the escrow still open;
         *   rejecting from there took it off the market with the buyer's money
         *   still held and nothing in the flow to release it. That is the fifth
         *   write's own wording, and it applies here unchanged.
         *
         * Everything this wrote is preserved; the check and the write are one
         * operation now, against the same APPROVABLE_FROM / REJECTABLE_FROM sets
         * the other five use.
         */
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: validated.listingId,
            fromAny: validated.verified
                ? [...APPROVABLE_FROM_STATUSES]
                : [...REJECTABLE_FROM_STATUSES],
            to: validated.verified ? 'verified' : 'rejected',
            patch,
            recordPreviousAs: validated.verified
                ? 'statusBeforeVerification'
                : 'statusBeforeRejection',
        });

        if (!transition.claimed) {
            return {
                success: false,
                error: transition.status === null
                    ? (transition.exists
                        ? "This land listing has no status recorded, so a decision cannot be made on it."
                        : "Listing not found")
                    : `This listing is '${transition.status}' and cannot be `
                      + `${validated.verified ? 'verified' : 'rejected'} from that state. `
                      + `A listing with a purchase in progress must be resolved first.`,
                data: null,
            };
        }

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
    
    if (!session || !(session.user.roles?.includes('admin') || session.user.roles?.includes('super_admin'))) { 
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
export async function getLandStatistics(...args: Parameters<typeof _getLandStatistics>) {
    return withFlexibleSafeAction("getLandStatistics", _getLandStatistics)(...args);
}
