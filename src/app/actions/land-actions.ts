"use server";

import { z } from "zod";
import { readLandLocation } from "@/lib/land-location";
import { readSoil, soilKey } from "@/lib/land-soil";
import { safeToISOString, safeToISOStringOptional } from "@/lib/date-utils";
import { notifyMemberDecision } from "@/lib/member-decision-notice";
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
import { ownedProfileIds, filterByOwner, isOwnedBySession } from "@/lib/owned-profile-ids";
import { hasAdminPermission, isPlatformAdmin } from "@/lib/admin-permissions";
import { isAdmin } from "@/lib/admin-permissions";
import { PUBLIC_LAND_STATUSES, stripInternalLandFields } from "@/lib/land-visibility";
import {
    isOwnerMutable,
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
} from "@/lib/land-listing-status";
import { inspectionRefusal } from "@/lib/land-inspection";
import { priceReductionPatch } from "@/lib/price-reduction";
import { serializeValue } from "@/lib/firestore-serialize";
import { requiresReverification } from "@/lib/land-reverification";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";

import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { logger } from "@/lib/logger";
import { groupFreeText } from "@/lib/free-text-grouping";
import { leaseTermRefusal } from "@/lib/lease-term";

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

        //   #898 The same minimum as the other two creators — #895, #897.
        const createRefusal = leaseTermRefusal({
            offersLease: validated.type === "lease",
            durationValue: validated.durationValue,
            durationUnit: validated.durationUnit,
        });
        if (createRefusal) {
            return { success: false, error: createRefusal, data: null };
        }

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
                const shaped = {
                    id: doc.id,
                    ...data,
                    //   #689 One reader for four shapes — see lib/land-location.ts.
                    //   `data.location.geopoint?.latitude` guarded the geopoint
                    //   and not the location, so a row written by
                    //   /api/farm-nation/create-listing (which stores no
                    //   `location` at all) threw here and took the whole page
                    //   with it.
                    location: readLandLocation(data),
                    createdAt: safeToISOString(data.createdAt, new Date().toISOString()),
                    updatedAt: safeToISOString(data.updatedAt, new Date().toISOString()),
                    verifiedAt: safeToISOStringOptional(data.verifiedAt) ?? null 
                };
                /*
                 *   #!! AND A FOURTH TIMESTAMP ARRIVED AFTER THE LIST WAS
                 *       WRITTEN, which is why this is no longer a list.
                 *
                 *       The three lines above convert createdAt, updatedAt and
                 *       verifiedAt BY HAND and spread everything else raw. #867
                 *       then added `priceReducedAt` to this collection, nobody
                 *       added a fourth line, and a stored Timestamp went across
                 *       the server-client boundary:
                 *
                 *         Only plain objects ... can be passed to Client
                 *         Components. {... priceReducedAt: {_seconds: ...,
                 *         _nanoseconds: 850000000, seconds: ..., nanoseconds:
                 *         ...} ...}
                 *
                 *       observed three times in one production session. It
                 *       throws during render, so the listing does not appear —
                 *       and because priceReducedAt is written ONLY when an
                 *       owner cuts the price, the crash lands exactly on the
                 *       listings that have just been edited, and on Hot Deals,
                 *       which is the feature that field exists for.
                 *
                 *       serializeValue converts EVERY timestamp at any depth,
                 *       including the next field somebody adds. It also catches
                 *       the GeoPoint that readLandLocation spreads through from
                 *       `...obj` — another class instance, the same crash, one
                 *       row of test data away.
                 *
                 *       Applied to the finished object rather than to
                 *       doc.data(), so readLandLocation still sees the raw
                 *       shapes it was written to read.
                 */
                return serializeValue(shaped) as unknown as LandListing;
            })
            .filter(listing => (listing as any).status !== 'deleted');

        // Apply client-side filters
        if (filters) { 
            listings = listings.filter(listing => {
                if (filters.minPrice && listing.price < filters.minPrice) return false;
                if (filters.maxPrice && listing.price > filters.maxPrice) return false;
                if (filters.minSize && listing.size < filters.minSize) return false;
                if (filters.maxSize && listing.size > filters.maxSize) return false;
                //   #901 Compared through the shared key, and asked of the row:
                //   `listing.soilQuality` is unset on every stored listing, so
                //   this filter returned nothing for any value it was given.
                if (filters.soilQuality && soilKey(readSoil(listing as any)) !== soilKey(filters.soilQuality)) return false;
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
            //   #904 `!==` REFUSED THE OWNER OF A LISTING FILED UNDER THEIR
            //   SUPERSEDED PROFILE — the one person this gate exists to admit.
            //   isOwnedBySession resolves the row's owner FORWARD, which costs
            //   nothing when it already matches and one keyed read on a miss.
            //
            //   THE FREE CHECKS COME FIRST. This is the public detail page, so
            //   an anonymous viewer and an admin both reach a decision without
            //   the read; only a signed-in non-admin pays for one.
            if (!viewerId || (!viewerIsAdmin && !await isOwnedBySession(data.ownerId, viewerId))) {
                // Indistinguishable from "no such listing", so the endpoint does
                // not confirm that an id exists to someone who may not see it.
                return { success: true, error: null, data: null };
            }
        }

        const listing: LandListing = { 
            id: listingDoc.id,
            ...data,
            //   #689 One reader for four shapes — see lib/land-location.ts.
            location: readLandLocation(data),
            createdAt: safeToISOString(data.createdAt, new Date().toISOString()),
            updatedAt: safeToISOString(data.updatedAt, new Date().toISOString()),
            verifiedAt: safeToISOStringOptional(data.verifiedAt) ?? null 
        } as unknown as LandListing;

        // Internal review fields are stripped for a public viewer. The owner and
        // an admin keep them — the owner needs to read why they were rejected.
        const sessionForFields = await requireSession();
        const viewer = sessionForFields.session?.user;
        //   #904 — the same widening. An owner reading a listing filed under a
        //   superseded profile still needs the review notes saying why it was
        //   rejected, which is the whole reason this branch exists.
        const privileged = Boolean(viewer)
            && (isAdmin(viewer!.roles) || await isOwnedBySession(data.ownerId, viewer!.id));

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
        /*
         *   #904 (SECOND CAUSE) THE LISTING IS FILED UNDER A PROFILE THIS
         *   PERSON NO LONGER SIGNS IN AS.
         *
         *   040 repaired the listings whose owner was written under the wrong
         *   KEY NAME. These have the right key holding a SUPERSEDED VALUE: the
         *   seller listed a parcel on one of their profiles, an admin later
         *   settled the duplicate (#724), and the row still names the id that
         *   lost while the seller signs in as the one that won.
         *
         *   Both faults reach the owner as the same sentence — "My properties
         *   are not listed under my property tab" — and an empty screen is
         *   indistinguishable from owning nothing.
         *
         *   NOT BACKFILLED, and lib/owned-profile-ids.ts records why: settling
         *   a duplicate moves no data, which is the only reason it can be
         *   undone by clearing one field. Rewriting owner keys would take that
         *   away. The pointer is followed on the read instead.
         */
        const ownerIds = await ownedProfileIds(session.user.id);

        const listingsQuery = filterByOwner(
            db.collection(COLLECTIONS.LAND_LISTINGS), 'ownerId', ownerIds,
        ).orderBy('createdAt', 'desc');

        const snapshot = await listingsQuery.get();

        const listings = snapshot.docs
            .map(doc => {
                const data = doc.data();
                const shaped = {
                    id: doc.id,
                    ...data,
                    //   #689 One reader for four shapes — see lib/land-location.ts.
                    //   `data.location.geopoint?.latitude` guarded the geopoint
                    //   and not the location, so a row written by
                    //   /api/farm-nation/create-listing (which stores no
                    //   `location` at all) threw here and took the whole page
                    //   with it.
                    location: readLandLocation(data),
                    /*
                     *   #884 AND THE SAME LESSON, THREE LINES LOWER.
                     *
                     *   From the owner's production log, three times in one
                     *   session:
                     *
                     *       getMyLandListings error:
                     *       TypeError: b.verifiedAt.toDate is not a function
                     *
                     *   These read `(data.x as Timestamp).toDate()`. A stored
                     *   timestamp comes back in four shapes — a Timestamp, an
                     *   ISO string, a Date, a number — and the adapter's
                     *   string-to-Timestamp conversion only matches a FULL ISO
                     *   string, so a row whose `verifiedAt` is anything else
                     *   stays a string. A string has no `.toDate()`.
                     *
                     *   The throw happens INSIDE the .map(), so ONE such row
                     *   emptied the whole list — and both "My Properties" and
                     *   the List Land page read this action. That is why a
                     *   seller could not see, or edit, anything they had
                     *   listed: #878 revealed the screen and this is what the
                     *   screen then did.
                     *
                     *   #439's shape, and the comment directly above cites
                     *   #689's "one reader for four shapes" for the LOCATION
                     *   while the next three lines did dates by hand.
                     *   safeToISOString is that reader for dates, and #605
                     *   already recorded sixty-five display sites not using it.
                     */
                    createdAt: safeToISOString(data.createdAt, new Date().toISOString()),
                    updatedAt: safeToISOString(data.updatedAt, new Date().toISOString()),
                    verifiedAt: safeToISOStringOptional(data.verifiedAt) ?? null 
                };
                /*
                 *   #!! AND THE FOURTH TIMESTAMP, ON THE SCREEN THE OWNER EDITS
                 *       FROM. The note above says these three were "done by
                 *       hand" and names that as the defect; the hand-written
                 *       list then stayed three long while #867 added a fourth
                 *       field to the collection.
                 *
                 *       `priceReducedAt` reached a Client Component as a stored
                 *       Timestamp and threw during render — see the fuller note
                 *       in _getLandListings above. This action feeds My
                 *       Properties and List Land, so the crash landed on the
                 *       seller's own listings the moment one of them had its
                 *       price cut.
                 */
                return serializeValue(shaped) as unknown as LandListing;
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
        //   #904 — My Properties now lists rows filed under a superseded
        //   profile, so this has to admit them too. A screen that shows a
        //   seller their listing and then refuses to edit it is #884's
        //   complaint in a politer form. Same rule, walked forwards.
        if (!await isOwnedBySession(listingData.ownerId, session.user.id) && !isPlatformAdmin(session.user.roles)) {
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

        /*
         *   #898 THE MINIMUM TERM, ON THE EDIT DOOR — #895.
         *
         *   #895 put the rule on the CREATE door the form uses and stopped
         *   there; #897 found the second creator; this is the third door and
         *   the only other LIVE one. Without it a seller could list a
         *   year-long lease and then edit it down to one month.
         *
         *   MERGED WITH THE STORED ROW, not read from the patch alone. This is
         *   a PARTIAL update: an edit that only changes the title sends no term
         *   and no type, and judging it on the patch would ask the rule about
         *   an empty object. The question is what the listing will BE after the
         *   write.
         */
        const merged = { ...listingData, ...validated };
        const editRefusal = leaseTermRefusal({
            offersLease: merged.availableForLease === true || merged.type === "lease",
            durationValue: merged.durationValue,
            durationUnit: merged.durationUnit,
        });
        if (editRefusal) {
            return { success: false, error: editRefusal, data: null };
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
            /*
             *   #867 FARM NATION GETS HOT DEALS TOO — the half the owner asked
             *   to be CREATED rather than wired: "you need to create that for
             *   Farm Nation".
             *
             *   Same rule as the marketplace product edit, same module, and the
             *   comparison is against `listingData.price` — the row as stored,
             *   read above for the ownership and status checks — rather than
             *   anything the request carried.
             *
             *   Spread, so an edit that does not touch the price writes nothing,
             *   and a price that goes back up clears the offer instead of
             *   leaving a badge over a higher number.
             */
            ...(priceReductionPatch(listingData.price, updateData.price) ?? {}),
            updatedAt: FieldValue.serverTimestamp(),
            /*
             *   BACK FOR REVIEW ONLY IF THE PARCEL CHANGED — see
             *   lib/land-reverification for the whole argument.
             *
             *   This was `status: 'pending_verification'`, unconditionally, and
             *   pending_verification is not in PUBLIC_LAND_STATUSES. So every
             *   owner edit took the listing off the properties list, the map,
             *   the detail page and Hot Deals — a corrected typo pulled a
             *   verified parcel off the market until an admin re-approved it,
             *   and nothing on the edit screen said so.
             *
             *   THE LINE ABOVE IS THE PROOF IT WAS WRONG. priceReductionPatch
             *   is #867, raising a Hot Deal when an owner cuts the price; the
             *   next line then hid the listing from Hot Deals. The feature
             *   could not fire once. Two adjacent lines, contradicting.
             *
             *   Spread, so an edit that changes nothing verifiable leaves the
             *   status field untouched rather than writing back the value it
             *   already had — a listing mid-way through some other transition
             *   must not be rewritten by an unrelated description edit.
             */
            ...(requiresReverification(listingData, validated)
                ? { status: 'pending_verification' }
                : {}),
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

        /*
         *   #864 An approval needs a passed inspection. Door 6 of 6, and the one
         *   with the screen — /land/verify imports THIS function, which is the
         *   same reason #397 singled it out.
         *
         *   A read this path did not otherwise do: it went straight to the
         *   claim. The claim is still what decides the race; this only decides
         *   whether an approval is allowed to be attempted, and a stale read
         *   here can only refuse an approval a moment early, never admit one it
         *   should have refused — the report is cleared by a re-dispatch, and a
         *   cleared report reads as "not inspected".
         */
        if (validated.verified) {
            const snap = await db.collection(COLLECTIONS.LAND_LISTINGS)
                .doc(validated.listingId).get();
            const inspectionBlock = snap.exists ? inspectionRefusal(snap.data()) : null;
            if (inspectionBlock) {
                return { success: false, error: inspectionBlock, data: null };
            }
        }

        /**
         *   #397 THE SIXTH BLIND LAND STATUS WRITE — AND THE ONE WITH THE SCREEN.
         *
         *   #27 converted five blind land status writes onto
         *   claimStatusTransitionFromAny; the note on the fifth, in
         *   admin/_land.ts, says "the other four are now converted to" this
         *   shape. This was not among them, and it is the one an admin actually
         *   reaches: /land/verify imports THIS function, while the hardened
         *   admin/_land.ts::verifyLandListing has no screen at all. The wired
         *   door was the unhardened one — the class of #276 and #297.
         *
         *   TWO FAULTS, BOTH OF THEM #27's
         *
         *   1. The write was unconditional. Farm Nation holds a buyer's money
         *      against `pending_escrow`; approving from there put the parcel
         *      back on the public market with the escrow still open, and
         *      rejecting from there took it off the market with the buyer's
         *      money still held and nothing in the flow to release it. That is
         *      #137's fault, fixed on the other doors and left standing here.
         *
         *   2. It wrote `status` ALONE. The decision is carried by three fields
         *      — status, verificationStatus and the `verified` boolean — and
         *      land-listing-status.ts derives verificationStatus from
         *      `obj.verified === true`. A listing approved here was 'verified'
         *      to a status reader and undecided to every reader that goes
         *      through the normaliser. #25 and #28 are the same split.
         *
         *   The starting states come from the shared sets rather than from a
         *   sixth hand-written list (#26). Note that APPROVABLE_FROM_STATUSES
         *   includes "rejected" on purpose, so an admin may reverse a rejection
         *   — which is why rejectionReason is cleared on approval rather than
         *   left to contradict the new decision.
         */
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: validated.listingId,
            fromAny: validated.verified
                ? [...APPROVABLE_FROM_STATUSES]
                : [...REJECTABLE_FROM_STATUSES],
            to: validated.verified ? 'verified' : 'rejected',
            patch: {
                verificationStatus: validated.verified ? 'approved' : 'rejected',
                verified: validated.verified,
                verifiedBy: session.user.id,
                verifiedAt: FieldValue.serverTimestamp(),
                ...(validated.notes ? { verificationNotes: validated.notes } : {}),
                rejectionReason: !validated.verified && validated.rejectionReason
                    ? validated.rejectionReason
                    : null,
                updatedAt: FieldValue.serverTimestamp(),
            },
            recordPreviousAs: validated.verified
                ? 'statusBeforeVerification'
                : 'statusBeforeRejection',
        });

        if (!transition.claimed) {
            logger.warn(
                `[verifyLandListing] Refused: listing ${validated.listingId} is '${transition.status}', ` +
                `which is not a ${validated.verified ? 'approvable' : 'rejectable'} state.`
            );
            return {
                success: false,
                data: null,
                error: transition.status === null
                    ? (transition.exists
                        ? "This land listing has no status recorded, so a decision cannot be made on it."
                        : "Land listing not found")
                    : `This listing is '${transition.status}' and cannot be ` +
                      `${validated.verified ? 'approved' : 'rejected'} from that state. ` +
                      `A listing with a purchase in progress must be resolved first.`,
            };
        }

        /*
         *   #690 AND THE OWNER IS TOLD.
         *
         *   This is the platform's main land decision — eight call sites reach
         *   it — and the file contained no notification of any kind. A member's
         *   listing was approved or refused and they found out by opening the
         *   page. The rejection writes a `rejectionReason` that only an admin
         *   could read, which is the same half #688 found on loan rejections.
         *
         *   The owner is read AFTER the claim, deliberately: only the caller
         *   that won the transition gets here, so the notice is sent once per
         *   decision rather than once per attempt.
         */
        try {
            const ownerSnap = await db.collection(COLLECTIONS.LAND_LISTINGS)
                .doc(validated.listingId).get();
            const owner = ownerSnap.exists ? (ownerSnap.data() ?? {}).ownerId : undefined;
            await notifyMemberDecision({
                userId: owner,
                subject: "Your land listing",
                outcome: validated.verified ? "approved" : "rejected",
                reason: validated.verified ? undefined : (validated.rejectionReason || validated.notes),
                channel: "land",
                link: `/farm-nation/property/${validated.listingId}`,
                linkText: "View listing",
                note: validated.verified
                    ? "It is now visible to buyers on Farm Nation."
                    : undefined,
            });
        } catch (error) {
            //   The decision is already committed; a failed notice must not
            //   report it as a failure the admin then retries.
            logger.error("[verifyLandListing] decision notice failed", { error });
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
        //   #904 — My Properties now lists rows filed under a superseded
        //   profile, so this has to admit them too. A screen that shows a
        //   seller their listing and then refuses to delete it is #884's
        //   complaint in a politer form. Same rule, walked forwards.
        if (!await isOwnedBySession(listingData.ownerId, session.user.id) && !isPlatformAdmin(session.user.roles)) {
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

        const rawStates: string[] = [];
        const rawQualities: string[] = [];
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

            //   #689 THE SEVENTH READER, and the one that did not crash.
            //
            //   `data.location?.state` is guarded against the TypeError and not
            //   against the defect: a listing written by
            //   /api/farm-nation/create-listing carries its state FLAT on the
            //   row, so every one of them was counted under 'Unknown' and the
            //   by-state breakdown on the admin dashboard was wrong by exactly
            //   that many.
            //
            //   Found by the sweep rather than by eye — the six readers before
            //   it were, and this one sits in the same file as three of them.
            //   #842 COLLECTED RAW AND GROUPED ONCE, because both of these are
            //   free text and grouping on the raw string splits a category by
            //   case and spacing alone. On the WAVE report the same shape
            //   reported 334 farmers as 206 — "Farmer", "Farmer " and "FARMER"
            //   counted as three occupations.
            rawStates.push(String(readLandLocation(data).state || 'Unknown'));
            //   #901 AND THE LINE BELOW IT, WHICH IS THE SAME DEFECT.
            //
            //   #689 fixed the state half of this pair and left `data.soilQuality`
            //   — a field NO live writer of this collection sets, so
            //   `bySoilQuality` counted every parcel on the platform as
            //   'Unknown' and the admin breakdown was a single bar. readSoil
            //   reads the `soilType` the form writes as well.
            rawQualities.push(String(readSoil(data) || 'Unknown'));
        });

        //   Mechanical differences only — case, surrounding and repeated
        //   whitespace, a trailing full stop. Typos are NOT guessed at; see
        //   lib/free-text-grouping.
        stats.byState = groupFreeText(rawStates).counts;
        stats.bySoilQuality = groupFreeText(rawQualities).counts;

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
