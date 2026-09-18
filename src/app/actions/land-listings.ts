"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { notifyMemberDecision } from "@/lib/member-decision-notice";
import { notifyListingSubmitted } from "@/lib/farm-nation-notifications";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { recordAdminAction } from "@/lib/audit-log";
import { FieldValue } from "@/lib/firestore-compat";
import { Timestamp } from "@/lib/firestore-compat";
import { createAdminAuditLog, logAdminAction } from "@/lib/audit-log";
import { serializeDocs, serializeValue } from "@/lib/firestore-serialize";
import { createNotificationAction } from "@/app/actions/notifications";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { updateTag } from "next/cache";
import { retirementPatch } from "@/lib/record-retirement";
import { invalidateAdminGlobalStats } from "@/lib/cache-invalidation";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { claimStatusTransitionFromAny } from "@/lib/status-transition";
import {
    PURCHASABLE_STATUSES,
    APPROVABLE_FROM_STATUSES,
    REJECTABLE_FROM_STATUSES,
    isOwnerMutable,
    type LandListingStatus,
    type LandVerificationStatus,
} from "@/lib/land-listing-status";
import { inspectionRefusal } from "@/lib/land-inspection";
import { stripInternalLandFields, isLandListingViewable } from "@/lib/land-visibility";
import { hasAppAccess } from "@/lib/role-app-mapping";
import { checkProductPricing } from "@/lib/product-pricing-guard";

/**
 * Farm Nation - Land Listings & Verification
 */

export interface LandListing { 
    id?: string;
    type?: "sale" | "rent" | "lease";
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
    category?: string | string[];
    soilType?: string;
    waterSource?: string;
    images: string[];
    documents: string[];
    // The shared union, not a local one. This listed six of the fifteen statuses
    // the collection uses — no "available" (what farm-nation creates), no
    // "approved", and none of the escrow states — so the type asserted that
    // values this very file reads and writes could not occur.
    status: LandListingStatus;
    availableForSale?: boolean;
    availableForRent?: boolean;
    availableForLease?: boolean;
    //   #861 Present only on a rent or lease — see the submit action.
    durationValue?: number;
    durationUnit?: "months" | "years";
    //   #869 The rental figure, when the parcel is offered on rental terms as
    //   well as (or instead of) for sale. `price` remains the SALE price.
    rentPrice?: number;
    /**
     *   #871 WHERE THE LAND IS, DECLARED so a reader can see it.
     *
     *   The submit action has written this since long before today and the
     *   interface never named it — so every consumer typed as `LandListing` was
     *   told the field does not exist, and the property page could not render a
     *   map without a cast. A stored field nothing can read is #624's defect,
     *   and here the type system was the thing enforcing it.
     */
    gpsCoordinates?: { latitude: number; longitude: number };
    escrowAvailable?: boolean;
    /**
     * A string, matching types/index.ts and the database query in
     * admin/_land.ts. It was declared here as an object while four other writers
     * put a string on the same field; see land-listing-status.ts for which
     * readers each half broke. The decision detail lives in the four fields
     * below, which admin/_land.ts and _fn_admin.ts already wrote.
     */
    verificationStatus?: LandVerificationStatus;
    verified?: boolean;
    verifiedBy?: string;
    verifiedAt?: FieldValue | Timestamp;
    rejectionReason?: string | null;
    createdAt: FieldValue | Timestamp;
    updatedAt: FieldValue | Timestamp;
}

/**
 * Create land listing (draft)
 */
async function _createLandListingAction(data: { 
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    title: string;
    description: string;
    location: { state: string; lga: string; address: string };
    size: number;
    price: number;
    category?: string;
    soilType?: string;
    waterSource?: string;
}): Promise<ActionResponse<{ listingId: string }>> {
    try {
        // This action had no session guard at all, and took ownerId as a
        // parameter — so a listing could be created in anyone's name, and the
        // audit row below recorded the nominated owner rather than the actor.
        //
        // The owner is taken from the session now. The parameter is still
        // accepted so existing callers compile, and deliberately ignored.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        /**
         *   #486 THIS DOOR ASKED FOR A SESSION AND NOTHING ELSE.
         *
         *        Any signed-in account on the platform could create a land
         *        listing — an academy student, a marketplace buyer, somebody
         *        who has never opened Farm Nation. Not an approval, not the
         *        farmer role, no relationship to the module at all. The API
         *        route the wizard posts to had exactly the same gap, so this is
         *        not a fix that reached one of two doors: it was never written
         *        for either.
         *
         *        THE GATE IS THE MODULE'S OWN ACCESS RULE, NOT APPROVAL, AND
         *        THAT IS DELIBERATE. Requiring an approved registration is the
         *        stricter reading and it would stop every pending applicant
         *        today, with no warning — which is how a repair becomes an
         *        outage. hasAppAccess is what the navigation already assumes and
         *        what the rest of the module enforces, so this breaks nobody
         *        already using Farm Nation and closes the door to everybody who
         *        is not.
         */
        if (!hasAppAccess((session.user.roles ?? []) as any, "farm-nation")) {
            return {
                success: false,
                error: "You need a Farm Nation account to list land. Complete Farm Nation onboarding first.",
                data: null,
            };
        }

        /*
         *   #803 AND THE DRAFT DOOR TOO — every place the rule names.
         *
         *   This is the fourth writer of a land listing's price and it had the
         *   same gap as the submit door below. Guarding one and not this one is
         *   the shape of defect this whole audit keeps finding, and it would be
         *   a poor way to close a finding about exactly that.
         *
         *   A draft is not exempt: drafts are promoted, and a price nobody
         *   checked at draft time is a price nobody checked.
         */
        const draftPricing = checkProductPricing([
            { label: "price", value: data.price },
            { label: "size", value: data.size },
        ]);
        if (!draftPricing.ok) {
            return { success: false, error: draftPricing.message, data: null };
        }

        const ownerId = session.user.id;

        // Fields listed, not spread.
        //
        // `...data` came first and the trusted values after it, so a
        // caller-supplied ownerId could not survive. That handled callers
        // OVERWRITING the fields below; it did nothing about callers ADDING
        // fields these lines never mention. `LandListing` declares
        // `verified`, `verificationStatus`, `verifiedBy`, `verifiedAt` and
        // `escrowAvailable` — all of them records of an admin decision made in
        // verifyLandListingAction — and a create request could simply include
        // them. The listing still could not reach a purchasable status without
        // the admin transition, so this was a false badge rather than a false
        // sale, but a create endpoint has no business writing the verification
        // record at all.
        //
        // The parameter contract is eleven fields. Those eleven are what gets
        // written. `type` and the availableFor* flags are on the interface but
        // not on this signature, so they were never accepted here either — the
        // API route at api/farm-nation/create-listing is the writer that
        // handles them.
        const listing: Omit<LandListing, "id"> = {
            title: data.title,
            description: data.description,
            location: data.location,
            size: data.size,
            price: data.price,
            ...(data.category !== undefined ? { category: data.category } : {}),
            ...(data.soilType !== undefined ? { soilType: data.soilType } : {}),
            ...(data.waterSource !== undefined ? { waterSource: data.waterSource } : {}),
            ownerId,
            ownerName: session.user.name || data.ownerName,
            ownerEmail: session.user.email || data.ownerEmail,
            images: [],
            documents: [],
            status: "draft",
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        await createAdminAuditLog({
            action: "user_update",
            userId: ownerId,
            targetId: docRef.id,
            targetType: "land_listing_creation" 
        });

        return { success: true, error: null, data: { listingId: docRef.id } };
    } catch (error: any) { 
        logger.error("Land listing creation error:", error);
        return { success: false, error: "Failed to create land listing", data: null };
    }
}
export async function createLandListingAction(...args: Parameters<typeof _createLandListingAction>) {
    return withFlexibleSafeAction("createLandListingAction", _createLandListingAction)(...args);
}

/**
 * Submit listing for verification
 */
async function _submitForVerificationAction(
    listingId: string,
    ownerId: string
): Promise<ActionResponse<null>> { 
    try {
        // WHAT WAS WRONG HERE
        // -------------------
        // There was no session guard, and the ownership check was:
        //
        //     if (listingData.ownerId !== ownerId)   // ownerId is a PARAMETER
        //
        // It compared the record's owner against a value the caller supplied.
        // Pass the real owner's id — which is readable from the listing itself,
        // since getPropertyByIdAction is public — and the check passes.
        //
        // That is worse than having no check, because it reads as one. The
        // function directly below this, _verifyLandListingAction, has always
        // called requireSession: the guard was on the sibling and not on this.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        const listingData = listingDoc.data() as LandListing;

        // Compared against the SESSION now. The ownerId parameter is retained
        // for call-site compatibility and is not trusted.
        if (listingData.ownerId !== session.user.id && !isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }

        /**
         *   #403 THE OWNER'S THIRD WRITE PATH, MISSED BY THE FIX THAT HARDENED
         *   THE OTHER TWO.
         *
         *   This was:
         *
         *       await listingRef.update({ status: "pending_verification", ... })
         *
         *   — the current status neither read nor checked. The ownership guard
         *   above tells you who is calling and nothing about what state the
         *   parcel is in, so the owner of a listing at `pending_escrow` (a buyer
         *   at Paystack) or `sold` could drag it back into review. The buyer's
         *   fulfilment and cancel both advance the listing FROM their status via
         *   claimStatusTransition, so after this write neither can ever fire:
         *   the money taken, the parcel back in the review queue, and nothing
         *   left that can move it out.
         *
         *   THE RULE ALREADY EXISTS AND THIS PATH WAS SKIPPED. land-actions.ts
         *   had exactly this fault in updateLandListing and deleteLandListing,
         *   and both were fixed against OWNER_MUTABLE_STATUSES — the shared list
         *   of states the owner may still act from, with `pending` and every
         *   DECISION_LOCKED status refused. There are THREE owner write paths.
         *   The repair reached two. #297's class, and the reason the orphan
         *   queue looks at unreached doors at all.
         *
         *   NOT REACHED IS NOT UNREACHABLE. No screen calls this — but the file
         *   is "use server", so every export is a live HTTP endpoint that any
         *   authenticated owner can post to. The absence of a button is not a
         *   guard.
         *
         *   CHECKED, NOT CLAIMED — and that is deliberate. The admin decision
         *   paths in this same file claim their transitions, and converting this
         *   one to match was the first thing I wrote. It is wrong, for the two
         *   reasons #397 recorded when it asked the same question of the edit and
         *   delete paths:
         *
         *     - OWNER_MUTABLE_STATUSES admits a NULL status on purpose. Legacy
         *       listings predate the vocabulary, and the shared module says
         *       refusing them "would strand their owners entirely".
         *       claimStatusTransitionFromAny returns immediately on a null
         *       status, so a claim here would strand exactly those owners.
         *
         *     - The target, `pending_verification`, is itself an owner-mutable
         *       starting state, and the helper strips the target from the
         *       starting set by design.
         *
         *   So this takes the shape its two siblings take, which is also what
         *   makes the three agree. The race window between the read and the
         *   write is real and is shared by all three — narrower than the hole it
         *   replaces, and not closable without stranding legacy owners.
         */
        if (!isOwnerMutable(listingData.status)) {
            return {
                success: false,
                error: `This listing cannot be submitted for verification right now `
                    + `(status: ${listingData.status}). A purchase is in progress or completed.`,
                data: null,
            };
        }

        await listingRef.update({
            status: "pending_verification",
            updatedAt: FieldValue.serverTimestamp()
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Verification submission error:", error);
        return { success: false, error: "Failed to submit for verification", data: null };
    }
}
export async function submitForVerificationAction(...args: Parameters<typeof _submitForVerificationAction>) {
    return withFlexibleSafeAction("submitForVerificationAction", _submitForVerificationAction)(...args);
}

/**
 * Admin: Verify land listing
 */
async function _verifyLandListingAction(
    listingId: string,
    adminId: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!hasAdminPermission(session?.user?.roles, "land:verify_listings")) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        // #282 THE ACTOR IS THE SESSION, NOT THE ARGUMENT.
        //
        // `adminId` is a caller parameter and it was written as `verifiedBy`
        // and passed to logAdminAction as the acting admin, while the guard
        // above had already established who the caller actually is. So one land
        // admin could record a decision against another's name, and the audit
        // entry would corroborate it.
        //
        // Three of the five land decision paths already did this correctly:
        // api/admin/farm-nation/approve-land, admin/_land.ts, and
        // _deleteLandListingAction further down THIS FILE, which takes the same
        // unused adminId parameter and logs session.user.id.
        //
        // Nothing calls these two today, so this is latent rather than live —
        // but they are exported and the next caller would have inherited it.
        // The parameter is kept so the signature does not change and is
        // deliberately ignored, the same treatment farm-nation-payment.ts gives
        // its `amount` and _submitForVerificationAction gives its `ownerId`.
        const actingAdminId = session.user.id;

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) {
            return { success: false, error: "Listing not found", data: null };
        }

        //   #864 An approval needs a passed inspection. Door 3 of 6 — see
        //   lib/land-inspection for the rule and why it is not written out here.
        const inspectionBlock = inspectionRefusal(listingDoc.data());
        if (inspectionBlock) {
            return { success: false, error: inspectionBlock, data: null };
        }

        // THE THIRD blind verify path in this module, after
        // /api/admin/farm-nation/approve-land and _fn_admin.verifyPropertyAction.
        // Same two problems as both of those:
        //
        //   1. No status guard — an existence check, then an unconditional write.
        //      Applied to a listing in pending_escrow it put land back on the
        //      public market while a buyer's money was held, or discarded the
        //      escrow's state.
        //   2. `verificationStatus` was assigned a FRESH object, so verifying a
        //      previously rejected listing erased the rejection reason and who
        //      gave it — the record of the earlier decision vanishing exactly
        //      when it matters.
        //
        // The set of statuses this may act on is shared with the other four
        // decision paths rather than written out here; see
        // APPROVABLE_FROM_STATUSES for what the five copies disagreed about.
        const transition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: listingId,
            fromAny: [...APPROVABLE_FROM_STATUSES],
            to: "verified",
            patch: {
                // A string, not an object. The object shape was unqueryable —
                // admin/_land.ts's pending queue asks the database for
                // `verificationStatus == "pending"` — and spreading the previous
                // value forward broke outright when it was the string
                // create-listing writes. The decision detail goes to the
                // top-level fields, which every other writer already sets.
                verificationStatus: "approved",
                verified: true,
                verifiedBy: actingAdminId,
                verifiedAt: FieldValue.serverTimestamp(),
                // The prior rejection reason is cleared on the record but kept in
                // the audit log below, which is where a reversed decision belongs.
                rejectionReason: null,
                updatedAt: FieldValue.serverTimestamp()
            },
            recordPreviousAs: "statusBeforeVerification",
        });

        if (!transition.claimed) {
            return {
                success: false,
                error: transition.status === null
                    ? (transition.exists
                        ? "This listing has no status recorded, so it cannot be verified."
                        : "Listing not found")
                    : `This listing is '${transition.status}' and cannot be verified from that state. ` +
                      `A listing with a purchase in progress must be resolved first.`,
                data: null,
            };
        }

        await logAdminAction(
            "land_verified",
            actingAdminId,
            listingId,
            "land_listing"
        );

        /**
         *   #252 revalidateTag(tag, "page") THREW, AT ALL FIFTEEN CALL SITES.
         *
         *        The second argument is a cacheLife PROFILE NAME. This version
         *        of Next ships seven — default, seconds, minutes, hours, days,
         *        weeks, max — and next.config.ts defines no custom ones. "page"
         *        is not among them and is not a Next concept at all.
         *
         *        An unknown name is not ignored. revalidation-utils.js:
         *
         *            cacheLife = workStore?.cacheLifeProfiles[profile];
         *            if (!cacheLife) throw new Error(
         *                `Invalid profile provided "${profile}" ...`);
         *
         *        and that runs in executeRevalidates — the `finally` of the
         *        Server Action wrapper, AFTER this function's work has
         *        completed. So the listing really was verified, and then the
         *        response threw. The admin saw a failure for an operation that
         *        had succeeded, and clicked again.
         *
         *        updateTag is the documented replacement for immediate expiry
         *        inside a Server Action. Immediate rather than
         *        stale-while-revalidate on purpose: this cache exists so a
         *        decision an admin just made is visible, and serving the old
         *        value to the next reader one more time is the thing being
         *        fixed. The three farm-nation ROUTE HANDLERS cannot use it —
         *        updateTag throws outside a Server Action — so they pass an
         *        inline `{ expire: 0 }` profile, which is validated by shape
         *        rather than looked up by name.
         *
         *        revalidate-tag-profile-is-real.test.ts reads the valid names
         *        from Next itself and fails on any new site that invents one.
         */
        updateTag("land-listings");
        updateTag(`property-${listingId}`);
        await invalidateAdminGlobalStats();

        /*
         *   #690 AND THE OWNER IS TOLD.
         *
         *   Latent rather than live — nothing calls this action today, as the
         *   note further up records — and wired anyway, because it is an
         *   exported "use server" endpoint and the next caller would have
         *   inherited the silence. The same argument the unused `adminId`
         *   parameter above is kept under.
         */
        await notifyMemberDecision({
            userId: String((listingDoc.data() ?? {}).ownerId ?? ""),
            subject: "Your land listing",
            outcome: "approved",
            channel: "land",
            link: `/farm-nation/property/${listingId}`,
            linkText: "View listing",
            note: "It is now visible to buyers on Farm Nation.",
        });

        // A verified listing is what a buyer trusts. Who verified it, and when,
        // was recorded nowhere — 'land_verified' has been in the audit
        // vocabulary all along with nothing writing it.
        await recordAdminAction({
            action: "land_verified",
            userId: session.user.id,
            targetId: listingId,
            targetType: "land_listing",
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land verification error:", error);
        return { success: false, error: "Failed to verify listing", data: null };
    }
}
export async function verifyLandListingAction(...args: Parameters<typeof _verifyLandListingAction>) {
    return withFlexibleSafeAction("verifyLandListingAction", _verifyLandListingAction)(...args);
}

/**
 * Admin: Reject land listing
 */
async function _rejectLandListingAction(
    listingId: string,
    adminId: string,
    reason: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!hasAdminPermission(session?.user?.roles, "land:verify_listings")) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        // #282 THE ACTOR IS THE SESSION, NOT THE ARGUMENT.
        //
        // `adminId` is a caller parameter and it was written as `verifiedBy`
        // and passed to logAdminAction as the acting admin, while the guard
        // above had already established who the caller actually is. So one land
        // admin could record a decision against another's name, and the audit
        // entry would corroborate it.
        //
        // Three of the five land decision paths already did this correctly:
        // api/admin/farm-nation/approve-land, admin/_land.ts, and
        // _deleteLandListingAction further down THIS FILE, which takes the same
        // unused adminId parameter and logs session.user.id.
        //
        // Nothing calls these two today, so this is latent rather than live —
        // but they are exported and the next caller would have inherited it.
        // The parameter is kept so the signature does not change and is
        // deliberately ignored, the same treatment farm-nation-payment.ts gives
        // its `amount` and _submitForVerificationAction gives its `ownerId`.
        const actingAdminId = session.user.id;

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) { 
            return { success: false, error: "Listing not found", data: null };
        }

        // Same guard as the verify path above. Rejecting a listing in
        // pending_escrow took it off the market while a buyer's money was held
        // against it.
        const rejectTransition = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: listingId,
            fromAny: [...REJECTABLE_FROM_STATUSES],
            to: "rejected",
            patch: {
                verificationStatus: "rejected",
                verified: false,
                verifiedBy: actingAdminId,
                verifiedAt: FieldValue.serverTimestamp(),
                rejectionReason: reason,
                updatedAt: FieldValue.serverTimestamp()
            },
            recordPreviousAs: "statusBeforeRejection",
        });

        if (!rejectTransition.claimed) {
            return {
                success: false,
                error: rejectTransition.status === null
                    ? (rejectTransition.exists
                        ? "This listing has no status recorded, so it cannot be rejected."
                        : "Listing not found")
                    : `This listing is '${rejectTransition.status}' and cannot be rejected from that ` +
                      `state. A listing with a purchase in progress must be resolved first.`,
                data: null,
            };
        }

        await logAdminAction(
            "land_rejected",
            actingAdminId,
            listingId,
            "land_listing",
            reason
        );

        updateTag("land-listings");
        updateTag(`property-${listingId}`);
        await invalidateAdminGlobalStats();

        //   #690 AND THE OWNER IS TOLD, WITH THE REASON. Latent, and wired for
        //   the same reason as the verify path above.
        await notifyMemberDecision({
            userId: String((listingDoc.data() ?? {}).ownerId ?? ""),
            subject: "Your land listing",
            outcome: "rejected",
            reason,
            channel: "land",
            link: `/farm-nation/property/${listingId}`,
            linkText: "View details",
        });

        await recordAdminAction({
            action: "land_rejected",
            userId: session.user.id,
            targetId: listingId,
            targetType: "land_listing",
            metadata: { reason: reason ?? null },
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land rejection error:", error);
        return { success: false, error: "Failed to reject listing", data: null };
    }
}
export async function rejectLandListingAction(...args: Parameters<typeof _rejectLandListingAction>) {
    return withFlexibleSafeAction("rejectLandListingAction", _rejectLandListingAction)(...args);
}

const CROP_SOIL_MATRIX: Record<string, string[]> = {
    rice: ["clayey", "loamy"],
    maize: ["loamy", "clayey"],
    beans: ["loamy", "sandy"],
    vegetables: ["loamy"],
    soybeans: ["loamy"],
    tomatoes: ["loamy"],
    pepper: ["loamy"],
    cassava: ["loamy", "sandy"],
    wheat: ["clayey", "loamy"],
    sugarcane: ["clayey"],
    groundnut: ["sandy", "loamy"],
    yams: ["sandy", "loamy"],
    coconut: ["sandy"],
    ginger: ["sandy", "loamy"],
    potatoes: ["sandy", "loamy"],
    sesame: ["loamy", "sandy"],
};

/**
 * Get verified land listings with filters
 */
async function _searchLandListingsAction(filters: { 
    state?: string;
    category?: string;
    minSize?: number;
    maxSize?: number;
    minPrice?: number;
    maxPrice?: number;
    soilType?: string;
    waterSource?: string;
    cropType?: string;
    limit?: number;
    lastDocId?: string; 
    type?: "sale" | "rent" | "lease";
}): Promise<ActionResponse<{ listings: LandListing[]; lastDocId: string | null }>> { 
    try {
        let q = db.collection(COLLECTIONS.LAND_LISTINGS)
            // Every for-sale spelling, not just "verified".
            //
            // This filtered on "verified" alone — a FOURTH vocabulary for the same
            // idea — so listings farm-nation created as "available", and any an
            // admin marked "approved", never appeared in search results at all.
            // Invisible inventory, in a different reader from the one already
            // fixed in land-visibility.ts.
            .where("status", "in", [...PURCHASABLE_STATUSES])
            .orderBy("createdAt", "desc");

        if (filters.state) {
            q = q.where("location.state", "==", filters.state);
        }

        if (filters.lastDocId) { 
            const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
            if (lastDoc.exists) {
                q = q.startAfter(lastDoc);
            }
        }

        const limit = filters.limit || 12;
        q = q.limit(limit);

        let snapshot;
        let indexError = false;
        try {
            snapshot = await q.get();
        } catch (e: any) {
            if (e.message && e.message.toLowerCase().includes("index")) {
                logger.warn("Land search failed due to missing index. Falling back.", { error: e.message });
                indexError = true;
                
                // Fallback without orderBy
                let fallbackQuery = db.collection(COLLECTIONS.LAND_LISTINGS).where("status", "in", [...PURCHASABLE_STATUSES]);
                if (filters.state) fallbackQuery = fallbackQuery.where("location.state", "==", filters.state);
                
                if (filters.lastDocId) { 
                    const lastDoc = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(filters.lastDocId).get();
                    if (lastDoc.exists) fallbackQuery = fallbackQuery.startAfter(lastDoc);
                }
                fallbackQuery = fallbackQuery.limit(limit);
                snapshot = await fallbackQuery.get();
            } else {
                throw e;
            }
        }

        let results = serializeDocs(snapshot.docs) as unknown as LandListing[];
        
        if (indexError) {
            results.sort((a: any, b: any) => {
                let aVal = a.createdAt || 0;
                let bVal = b.createdAt || 0;
                if (aVal instanceof Date) aVal = aVal.getTime();
                if (bVal instanceof Date) bVal = bVal.getTime();
                if (typeof aVal === 'string') aVal = new Date(aVal).getTime();
                if (typeof bVal === 'string') bVal = new Date(bVal).getTime();
                return aVal < bVal ? 1 : aVal > bVal ? -1 : 0;
            });
        }

        // Client-side filtering for numeric ranges
        if (filters.minSize) {
            const minSize = filters.minSize;
            results = results.filter((l) => l.size >= minSize);
        }
        if (filters.maxSize) {
            const maxSize = filters.maxSize;
            results = results.filter((l) => l.size <= maxSize);
        }
        if (filters.minPrice) {
            const minPrice = filters.minPrice;
            results = results.filter((l) => l.price >= minPrice);
        }
        if (filters.maxPrice) {
            const maxPrice = filters.maxPrice;
            results = results.filter((l) => l.price <= maxPrice);
        }
        if (filters.soilType) { results = results.filter((l) => l.soilType === filters.soilType); }
        if (filters.waterSource) { results = results.filter((l) => l.waterSource === filters.waterSource); }
        /*
         *   #869 A PARCEL OFFERED TWO WAYS IS FOUND UNDER BOTH.
         *
         *   THE OWNER: "…except if the land can be for either sell or rent etc."
         *
         *   This asked `l.type === filters.type`, and `type` holds ONE string —
         *   so a listing offered for sale AND for rent appeared under whichever
         *   of the two that string happened to be, and was invisible under the
         *   other. #861 identified exactly this and drew the opposite
         *   conclusion, removing the multi-select because the filter could not
         *   express it. The filter can express it now.
         *
         *   The BOOLEANS are what is matched, because they are what the form
         *   writes per offer and what the property page and the checkout read.
         *   `type` is the fallback for rows written before the flags existed —
         *   dropping to it only when the row carries no flags at all, so a row
         *   that HAS them is never judged by the label.
         */
        if (filters.type) {
            const wanted = filters.type;
            results = results.filter((l) => {
                const flags = l as unknown as {
                    availableForSale?: boolean;
                    availableForRent?: boolean;
                    availableForLease?: boolean;
                };
                const hasFlags = flags.availableForSale !== undefined
                    || flags.availableForRent !== undefined
                    || flags.availableForLease !== undefined;

                if (!hasFlags) return l.type === wanted;

                if (wanted === "sale") return flags.availableForSale === true;
                if (wanted === "rent") return flags.availableForRent === true;
                if (wanted === "lease") return flags.availableForLease === true;
                return l.type === wanted;
            });
        }

        // Client-side filtering for category (supports legacy string and new string array)
        if (filters.category) {
            const categoryFilter = filters.category;
            results = results.filter((l) => {
                if (!l.category) return false;
                if (Array.isArray(l.category)) {
                    return l.category.includes(categoryFilter);
                }
                if (typeof l.category === "string") {
                    const cats = l.category.split(",").map(c => c.trim().toLowerCase());
                    return cats.includes(categoryFilter.toLowerCase()) || l.category === categoryFilter;
                }
                return false;
            });
        }

        // Crop-Soil Suitability Matrix filtering
        if (filters.cropType) {
            const cropTypeFilter = filters.cropType;
            const suitableSoils = CROP_SOIL_MATRIX[cropTypeFilter.toLowerCase()] || [];
            if (suitableSoils.length > 0) {
                results = results.filter((l) => {
                    if (!l.soilType) return false;
                    return suitableSoils.includes(l.soilType.toLowerCase());
                });
            } else {
                results = results.filter((l) => {
                    const desc = l.description?.toLowerCase() || "";
                    const title = l.title?.toLowerCase() || "";
                    const cat = (Array.isArray(l.category) 
                        ? l.category.join(", ") 
                        : l.category)?.toLowerCase() || "";
                    const searchTerm = cropTypeFilter.toLowerCase();
                    return desc.includes(searchTerm) || title.includes(searchTerm) || cat.includes(searchTerm);
                });
            }
        }

        const lastDocId = snapshot.docs.length === limit ? snapshot.docs[snapshot.docs.length - 1].id : null;

        /**
         * #340. The review fields, the owner's contact details and the DEEDS do
         * not go to a stranger.
         *
         * This action has no session check — search is public, which is right —
         * and it returned the stored document. lib/land-visibility.ts exists for
         * this exact payload and was written after the same defect was found in
         * /api/farm-nation/listings; its header names the reason. It reached one
         * reader out of four.
         */
        const listings = results.map((l) => stripInternalLandFields(l as any)) as unknown as LandListing[];

        return { success: true, error: null, data: { listings, lastDocId } };
    } catch (error: any) { 
        logger.error("Land search error:", error);
        throw error;
    }
}
export async function searchLandListingsAction(...args: Parameters<typeof _searchLandListingsAction>) {
    return withFlexibleSafeAction("searchLandListingsAction", _searchLandListingsAction)(...args);
}

/**
 * Get pending land listings (admin)
 */
async function _getPendingLandListingsAction(): Promise<ActionResponse<LandListing[]>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!isAdmin(session?.user?.roles)) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const snapshot = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .where("status", "==", "pending_verification")
            .get();

        const listings = serializeDocs(snapshot.docs) as unknown as LandListing[];
        return { success: true, error: null, data: listings };
    } catch (error: any) { 
        logger.error("Failed to fetch pending listings:", error);
        return { success: false, error: "Failed to fetch pending listings", data: null };
    }
}
export async function getPendingLandListingsAction(...args: Parameters<typeof _getPendingLandListingsAction>) {
    return withFlexibleSafeAction("getPendingLandListingsAction", _getPendingLandListingsAction)(...args);
}

/**
 * Submit land listing with file uploads
 */
async function _submitLandListingAction(data: { 
    ownerId: string;
    ownerName: string;
    ownerEmail: string;
    title: string;
    description: string;
    location: { state: string; lga: string; address: string };
    size: number;
    price: number;
    category?: string | string[];
    soilType?: string;
    waterSource?: string;
    imageUrls: string[];
    documentUrls: string[];
    gpsCoordinates?: { latitude: number; longitude: number };
    availableForSale?: boolean;
    availableForRent?: boolean;
    availableForLease?: boolean;
    type?: "sale" | "rent" | "lease";
    /**
     *   #861 HOW LONG A RENT OR LEASE RUNS.
     *
     *   THE OWNER: "There should be duration for leasing or renting." A listing
     *   offered for rent with no term tells a buyer nothing about what she is
     *   being offered — a season, a year, ten years — and she has to message the
     *   seller to learn what the listing should have said.
     *
     *   OPTIONAL AND ONLY WRITTEN WHEN PRESENT. A sale has no term, and a
     *   `durationValue: 0` on a permanent purchase would be a field readers
     *   have to learn to ignore.
     */
    durationValue?: number;
    durationUnit?: "months" | "years";
    /**
     *   #869 WHAT THE LAND COSTS TO RENT, as distinct from what it costs to buy.
     *
     *   THE OWNER, on whether two property types mean two listings: "it means 2
     *   listings except if the land can be for either sell or rent etc."
     *
     *   That exception needs a second figure. A listing has always carried ONE
     *   `price`, and the checkout charged it whichever way the buyer was buying
     *   — fine while a listing was one thing or the other, and wrong the moment
     *   a parcel is offered both ways: a parcel worth ₦5,000,000 to buy might be
     *   ₦200,000 a year to rent.
     *
     *   `price` stays the SALE price, because that is what every existing row
     *   means by it and what the escrow and the ledger already record. Optional,
     *   so every listing written before this is unchanged.
     */
    rentPrice?: number;
    escrowAvailable?: boolean;
    /**
     *   #863 WHERE THE "we have received your listing" NOTICE SENDS HER.
     *
     *   A caller's own screen, because the two land in different modules:
     *   /land/submit has no per-listing page, a Farm Nation seller belongs on
     *   /farm-nation/my-properties, and the public property page is the one
     *   screen that refuses to show an unverified listing. Defaults to "/land",
     *   which is what the notice used before this existed.
     *
     *   Not a free redirect: it is only ever put in a notification this action
     *   itself writes to the submitting user, so the worst a bad value can do
     *   is give her a dead link of her own.
     */
    manageLink?: string;
}): Promise<ActionResponse<{ listingId: string }>> {
    try {
        // The live one — /land/submit and farm-nation/list-land both call it.
        // It had no session guard and took ownerId from the request, so a
        // listing could be published in anyone's name.
        //
        // Both callers already pass `session.user.id` from the client session,
        // so reading it server-side changes nothing they do; it only makes the
        // value trustworthy.
        const sessionResult = await requireSession();
        if (!sessionResult.session) {
            return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        }
        const { session } = sessionResult;

        /**
         *   #486 THE LIVE DOOR, AND THE THIRD ONE WITH NO MODULE GATE.
         *
         *        Its own comment says so: "/land/submit and farm-nation/list-land
         *        both call it". A previous repair made the OWNER trustworthy —
         *        taken from the session rather than the request — and left
         *        WHETHER THE CALLER MAY LIST AT ALL unasked. Any signed-in
         *        account could publish into the queue an admin works.
         *
         *        Three doors write to this table: _createLandListingAction
         *        above, this one, and api/farm-nation/create-listing. None had
         *        the gate. See the note on the first for why it is the module's
         *        access rule and not an approved registration.
         */
        if (!hasAppAccess((session.user.roles ?? []) as any, "farm-nation")) {
            return {
                success: false,
                error: "You need a Farm Nation account to list land. Complete Farm Nation onboarding first.",
                data: null,
            };
        }

        /*
         *   #803 THE LIVE LAND-LISTING DOOR HAD NO RANGE CHECK AT ALL.
         *
         *   THIS IS THE ONE THAT MATTERS. There are three writers of land
         *   listings and only one bounded its numbers:
         *
         *     listPropertyAction   farmNationListingSchema —
         *                          `price: z.number().positive()`,
         *                          `size: z.number().positive()`
         *     the API route        `!pricePerUnit || !totalPrice`, and RETIRED
         *                          (410 unless LEGACY_LAND_LISTING_API=enabled)
         *     THIS ACTION          a session check, an access check, and then
         *                          `price: data.price` written straight through
         *
         *   And this is the LIVE one: /farm-nation/list-land uploads its files
         *   and calls this. A server action is callable directly, so whatever
         *   the form does client-side is not a guard.
         *
         *   WHAT IT REACHES. initiatePropertyPurchaseAction reads
         *   `propData.price` as BOTH the purchase amount and the escrowAmount:
         *
         *       propertyPrice: propData.price,
         *       escrowAmount:  propData.price,
         *
         *   so a plot listed at a negative price becomes a purchase request and
         *   an escrow row carrying that figure. Infinity gets in too —
         *   JSON.stringify writes it as null, so the amount silently becomes
         *   absent rather than wrong.
         *
         *   STATED ACCURATELY: I have not traced a path from here to money
         *   LEAVING the platform, and I am not claiming one. What is certain is
         *   that a listing can be created that nobody can correctly buy, and
         *   that the two sibling doors both consider these values worth
         *   bounding.
         *
         *   THE GUARD IS #794'S, IMPORTED. Its reason for being a module rather
         *   than a rule written out per door is precisely this: it has now been
         *   missing from a door in two separate modules.
         */
        const pricing = checkProductPricing([
            { label: "price", value: data.price },
            { label: "size", value: data.size },
        ]);
        if (!pricing.ok) {
            return { success: false, error: pricing.message, data: null };
        }

        const listing: any = {
            ownerId: session.user.id,
            ownerName: session.user.name || data.ownerName,
            ownerEmail: session.user.email || data.ownerEmail,
            title: data.title,
            description: data.description,
            location: data.location,
            size: data.size,
            price: data.price,
            images: data.imageUrls,
            documents: data.documentUrls,
            status: "pending_verification",
            availableForSale: data.availableForSale ?? true,
            availableForRent: data.availableForRent ?? false,
            availableForLease: data.availableForLease ?? false,
            type: data.type || ((data.availableForRent && !data.availableForSale) ? "lease" : "sale"),
            //   #861 Spread rather than defaulted, so a sale carries no term at
            //   all rather than a zero somebody has to interpret.
            ...(typeof data.durationValue === "number" && data.durationValue > 0
                ? { durationValue: data.durationValue, durationUnit: data.durationUnit ?? "years" }
                : {}),
            /*
             *   #869 The rental figure, spread for the same reason the term is:
             *   a pure sale carries no rentPrice at all rather than a zero every
             *   reader has to learn to disregard.
             *
             *   NOT VALIDATED AGAINST `price`. A rent higher than the sale price
             *   is unusual and not impossible — a short lease of prime land can
             *   exceed a distressed sale — and a form that refuses it would be
             *   guessing at the seller's market.
             */
            ...(typeof data.rentPrice === "number" && data.rentPrice > 0
                ? { rentPrice: data.rentPrice }
                : {}),
            escrowAvailable: data.escrowAvailable ?? true,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp() 
        };

        if (data.category !== undefined) listing.category = data.category;
        if (data.soilType !== undefined) listing.soilType = data.soilType;
        if (data.waterSource !== undefined) listing.waterSource = data.waterSource;

        if (data.gpsCoordinates) { 
            listing.gpsCoordinates = data.gpsCoordinates;
        }

        const docRef = await db.collection(COLLECTIONS.LAND_LISTINGS).add(listing);

        // Create audit log
        //
        // session.user.id, not data.ownerId. The listing above was fixed to
        // take its owner from the session, and this was left reading the
        // request — so the audit row still recorded the nominated user as the
        // actor, and the notification below still went to them.
        //
        // One copy of a path fixed and its siblings missed, inside a single
        // function. Exactly the shape this codebase keeps producing.
        await createAdminAuditLog({ 
            action: "user_update",
            userId: session.user.id,
            userEmail: session.user.email || data.ownerEmail,
            targetId: docRef.id,
            targetType: "land_listing",
            metadata: {
                title: data.title,
                location: data.location.state,
                size: data.size,
                price: data.price 
            },
            details: `Land listing submitted: ${data.title}` 
        });

        /*
         *   #863 AND SEND HER AN EMAIL, which this never did.
         *
         *   THE OWNER: "After listing notification email to be sent."
         *
         *   This rang the bell and stopped. A seller who submits a form and
         *   closes the tab — which is what submitting a form usually means —
         *   had no record that the listing arrived anywhere.
         *
         *   The notice also now says the part she needs and the old one left
         *   out: the listing is NOT visible to buyers yet. #856 is why that
         *   matters — until it, an unverified listing wore a "Verified Land"
         *   badge, so she had every reason to believe she was live.
         *
         *   `manageLink` because the two callers land in different modules:
         *   /land/submit has no per-listing page, and a Farm Nation seller
         *   belongs on /farm-nation/my-properties. The PUBLIC property page is
         *   the one screen that would refuse to show her the listing she has
         *   just made.
         */
        await notifyListingSubmitted({
            ownerId: session.user.id,
            ownerEmail: session.user.email || data.ownerEmail,
            ownerName: session.user.name || data.ownerName,
            listingTitle: data.title,
            manageLink: data.manageLink || "/land",
        });

        return { success: true, error: null, data: { listingId: docRef.id } };
    } catch (error: any) { 
        logger.error("Land listing submission error:", error);
        return { success: false, error: error.message || "Failed to submit land listing", data: null };
    }
}
export async function submitLandListingAction(...args: Parameters<typeof _submitLandListingAction>) {
    return withFlexibleSafeAction("submitLandListingAction", _submitLandListingAction)(...args);
}

/**
 * Get single land listing by ID
 */
async function _getPropertyByIdAction(id: string): Promise<ActionResponse<LandListing | null>> {
    try {
        const docRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(id);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            // ✅ FIX: serializeValue converts Firestore Timestamps to ISO strings
            // so the result is safe to pass across the server→client boundary.
            const data = { id: docSnap.id, ...serializeValue(docSnap.data()) } as LandListing;

            /**
             *   #340 THE PUBLIC DETAIL PAGE RETURNED THE WHOLE DOCUMENT, AT ANY
             *        STATUS.
             *
             *        /farm-nation/property/[id] has no auth guard — it is not
             *        under the (member) group and farm-nation/layout.tsx only
             *        sets metadata — and this is the action all three of its
             *        callers import. It had no session check, no status filter
             *        and no strip, so ANY id returned:
             *
             *          documents          the C of O, survey plan, tax clearance
             *          ownerEmail,        the owner's contact details
             *          ownerPhone
             *          verificationNotes, the admin's review of them
             *          rejectionReason,
             *          verifiedBy
             *
             *        for listings in ANY state — pending_verification, rejected
             *        and deleted included. A rejected application was readable,
             *        with the reason it was rejected, by anyone who could guess
             *        or scrape an id.
             *
             *        Two rules, both from lib/land-visibility.ts so the four
             *        readers of this collection finally share one definition:
             *        a listing still in (or thrown out of) the review queue is
             *        not viewable at all, and what is viewable is stripped.
             *
             *        The OWNER and an admin who may verify listings are exempt
             *        — the owner's own edit screen and the admin queue both go
             *        through here, and both need the whole record.
             */
            const sessionResult = await requireSession();
            const viewer = sessionResult.session?.user;
            const privileged = Boolean(
                viewer && (
                    viewer.id === (data as any).ownerId
                    || hasAdminPermission(viewer.roles, "land:verify_listings")
                )
            );

            if (privileged) {
                return { success: true, error: null, data };
            }

            if (!isLandListingViewable((data as any).status)) {
                // Indistinguishable from "no such listing", on purpose: telling a
                // stranger that an id exists but is rejected is most of what the
                // rejection record says.
                return { success: true, error: null, data: null };
            }

            return { success: true, error: null, data: stripInternalLandFields(data as any) };
        } else {
            return { success: true, error: null, data: null };
        }
    } catch (error: any) {
        logger.error("getPropertyByIdAction error:", error);
        return { success: false, error: "Failed to fetch property", data: null };
    }
}
export async function getPropertyByIdAction(...args: Parameters<typeof _getPropertyByIdAction>) {
    return withFlexibleSafeAction("getPropertyByIdAction", _getPropertyByIdAction)(...args);
}

/**
 * Submit inquiry for a land listing
 */
async function _submitLandInquiryAction(data: { 
    listingId: string;
    listingTitle: string;
    listingOwnerId: string;
    buyerName: string;
    buyerEmail: string;
    buyerPhone: string;
    message: string; 
}): Promise<ActionResponse<null>> {
    try {
        // Left PUBLIC on purpose — someone enquiring about land should not need
        // an account first, and that is a product decision rather than an
        // oversight.
        //
        // What was wrong is narrower: `listingOwnerId` and `listingTitle` came
        // from the caller and were passed straight into createNotificationAction.
        // So this was an open endpoint for sending a notification to ANY user,
        // with an attacker-chosen title and body — a phishing primitive wearing
        // the platform's own branding.
        //
        // Both are read from the listing now. The listing must also exist, which
        // it never had to before.
        const listingSnap = await db.collection(COLLECTIONS.LAND_LISTINGS).doc(data.listingId).get();
        if (!listingSnap.exists) {
            return { success: false, error: "Listing not found", data: null };
        }
        const listing = listingSnap.data() as LandListing;

        const listingOwnerId = listing.ownerId;
        const listingTitle = listing.title;

        if (!listingOwnerId) {
            return { success: false, error: "This listing has no owner to contact", data: null };
        }

        const inquiryRef = await db.collection(COLLECTIONS.LAND_INQUIRIES).add({
            ...data,
            // After the spread: the caller's values are recorded nowhere.
            listingOwnerId,
            listingTitle,
            status: "pending",
            createdAt: FieldValue.serverTimestamp(),
            read: false
        });

        await createNotificationAction({
            // The listing's owner, not the caller's nominee.
            userId: listingOwnerId,
            type: "info",
            title: "New Land Inquiry",
            message: `You have a new inquiry for "${listingTitle}" from ${data.buyerName}.`,
            link: `/farm-nation/inquiries/${inquiryRef.id}`,
            linkText: "View Inquiry" 
        });

        await createAdminAuditLog({
            action: "land_inquiry",
            userId: "public_user",
            userEmail: data.buyerEmail,
            targetId: inquiryRef.id,
            targetType: "land_inquiry",
            details: `Inquiry for ${listingTitle}` 
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Submit inquiry error:", error);
        return { success: false, error: error.message || "Failed to send message", data: null };
    }
}
export async function submitLandInquiryAction(...args: Parameters<typeof _submitLandInquiryAction>) {
    return withFlexibleSafeAction("submitLandInquiryAction", _submitLandInquiryAction)(...args);
}

/**
 * Get inquiries for a user (as seller)
 */
async function _getLandInquiriesAction(userId: string): Promise<ActionResponse<any[]>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        // The session was established and then never consulted: the query ran on
        // `listingOwnerId == userId` where userId is the caller's own argument.
        // Any authenticated user could name any landowner and read their inbox.
        //
        // These rows are unusually sensitive. _submitLandInquiryAction is public
        // BY DESIGN — someone enquiring about land should not need an account —
        // and each row it writes carries `buyerName`, `buyerEmail`, `buyerPhone`
        // and the message body. So this endpoint turned a deliberately open
        // intake form into a bulk export of the contact details it collected,
        // for any owner, to anyone with an account.
        const { session } = sessionResult;
        if (session.user.id !== userId && !isAdmin(session.user.roles)) {
            return { success: false, error: "Unauthorized", data: null };
        }
        
        const snapshot = await db.collection(COLLECTIONS.LAND_INQUIRIES)
            .where("listingOwnerId", "==", userId)
            .orderBy("createdAt", "desc")
            .get();
        const inquiries = serializeDocs(snapshot.docs);
        return { success: true, error: null, data: inquiries };
    } catch (error: any) { 
        logger.error("Get inquiries error:", error);
        return { success: false, error: error.message || "Failed to fetch inquiries", data: null };
    }
}
export async function getLandInquiriesAction(...args: Parameters<typeof _getLandInquiriesAction>) {
    return withFlexibleSafeAction("getLandInquiriesAction", _getLandInquiriesAction)(...args);
}

/**
 * Get single inquiry by ID
 */
async function _getLandInquiryByIdAction(inquiryId: string): Promise<ActionResponse<any>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };

        const docRef = db.collection(COLLECTIONS.LAND_INQUIRIES).doc(inquiryId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            // Found by reading rather than by the scanner, and worth saying why:
            // this one takes an inquiryId, not a userId, and runs no `.where` at
            // all, so neither the ownership scan's read rule nor its write rule
            // has anything to catch. A single doc fetched by id with no
            // ownership check afterwards is a third shape, and the tool still
            // cannot see it.
            //
            // It returned the same buyerName/buyerEmail/buyerPhone/message as
            // the list above, one row at a time, to any authenticated caller.
            // The notification sent on submission links to
            // /farm-nation/inquiries/<id>, so ids travel.
            // Owner or admin, and deliberately no "or the buyer" clause: the
            // intake is public, so an inquiry carries buyerName/buyerEmail/
            // buyerPhone but never a buyerId — there may be no account behind it
            // at all. A buyerId comparison here would be dead code that reads as
            // though it grants the enquirer access.
            const inquiry = docSnap.data() ?? {};
            const { session } = sessionResult;
            const isParty = inquiry.listingOwnerId === session.user.id;
            if (!isParty && !isAdmin(session.user.roles)) {
                // The same "not found" an absent row gets, so the endpoint does
                // not confirm which inquiry ids exist.
                return { success: false, error: "Inquiry not found", data: null };
            }

            // ✅ FIX: serializeValue converts Timestamp fields to ISO strings for safe client transfer.
            return { success: true, error: null, data: { id: docSnap.id, ...serializeValue(docSnap.data()) } };
        } else { 
            return { success: false, error: "Inquiry not found", data: null };
        }
    } catch (error: any) { 
        logger.error("Get inquiry error:", error);
        return { success: false, error: error.message || "Failed to fetch inquiry", data: null };
    }
}
export async function getLandInquiryByIdAction(...args: Parameters<typeof _getLandInquiryByIdAction>) {
    return withFlexibleSafeAction("getLandInquiryByIdAction", _getLandInquiryByIdAction)(...args);
}

/**
 * Admin: Delete land listing
 */
async function _deleteLandListingAction(
    listingId: string,
    adminId: string
): Promise<ActionResponse<null>> { 
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false, error: sessionResult.error?.error ?? "Authentication required", data: null };
        const { session } = sessionResult;
        
        if (!hasAdminPermission(session?.user?.roles, "land:verify_listings")) { 
            return { success: false, error: "Unauthorized: Admin access required", data: null };
        }

        const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(listingId);
        const listingDoc = await listingRef.get();

        if (!listingDoc.exists) { 
            return { success: false, error: "Listing not found", data: null };
        }

        /**
         *   #301 THE STATUS FOR THIS ALREADY EXISTED AND THE CODE IGNORED IT.
         *
         *        land-listing-status.ts declares "deleted" in LandListingStatus
         *        and its own header describes the behaviour as "delete sets
         *        `deleted`". No reader admits that status — it is in neither
         *        PURCHASABLE_STATUSES nor BROWSABLE_STATUSES — so setting it is
         *        sufficient to remove a listing from every buyer-facing screen.
         *
         *        The code called .delete() instead, destroying a row that land
         *        purchases and farm-nation transactions reference by id
         *        (_fna_finance.ts reads LAND_LISTINGS.doc(preTxData.propertyId)
         *        while settling a transaction).
         *
         *        So the vocabulary described a soft delete the code had stopped
         *        performing. It performs it again.
         */
        await listingRef.update({
            status: "deleted",
            ...retirementPatch(session.user.id, listingDoc.data()?.status),
            updatedAt: new Date().toISOString(),
        });

        await logAdminAction(
            "land_deleted",
            session.user.id,
            listingId,
            "land_listing",
            "Listing was retired (status: deleted) — the row is retained so purchases and transactions that reference it stay readable"
        );

        updateTag("land-listings");
        updateTag(`property-${listingId}`);
        await invalidateAdminGlobalStats();

        // Irreversible, and nothing else records that the listing ever existed.
        await recordAdminAction({
            action: "land_deleted",
            userId: session.user.id,
            targetId: listingId,
            targetType: "land_listing",
        });

        return { success: true, error: null, data: null };
    } catch (error: any) { 
        logger.error("Land deletion error:", error);
        return { success: false, error: "Failed to delete listing", data: null };
    }
}
export async function deleteLandListingAction(...args: Parameters<typeof _deleteLandListingAction>) {
    return withFlexibleSafeAction("deleteLandListingAction", _deleteLandListingAction)(...args);
}
