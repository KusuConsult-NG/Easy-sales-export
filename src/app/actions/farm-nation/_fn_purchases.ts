"use server";

import { requireSession } from "@/lib/session-guard";
import { releasedReservationFields } from "@/lib/land-reservation-expiry";
import { logger } from '@/lib/logger';
import { supabaseDb as db } from "@/lib/supabase-db";
import { FieldValue } from "@/lib/firestore-compat";
import { COLLECTIONS } from "@/lib/types/firestore";
import { claimStatusTransition, claimStatusTransitionFromAny } from "@/lib/status-transition";
import { PURCHASABLE_STATUSES, isPurchasable, statusAfterCancellation } from "@/lib/land-listing-status";
import { serializeDocs } from "@/lib/firestore-serialize";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import type { Property } from "@/lib/types/farm-nation-actions";

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
        // "verified" and "available" both mean approved and for sale — see
        // src/lib/land-listing-status.ts. Requiring only "available" made every
        // admin-verified land listing unbuyable.
        if (!isPurchasable(property.status)) { 
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

        // ── CLAIM THE PROPERTY, THEN RECORD THE PURCHASE ──────
        //
        // The availability check used to live inside runTransaction, which
        // takes no lock. Two buyers requesting the same property at once both
        // read "available", both created a purchase request, and both marked it
        // pending — the same property sold twice, with two buyers each expecting
        // to pay for it.
        //
        // Claiming available → pending is the reservation: exactly one buyer
        // wins, and the loser is told it has gone rather than being taken to
        // payment for something they cannot have.
        const propSnapPre = await propertyRef.get();
        if (!propSnapPre.exists) {
            return { success: false as const, error: "Property not found", data: null, meta: null };
        }
        const propData = propSnapPre.data() as Property;

        const claim = await claimStatusTransitionFromAny({
            collection: COLLECTIONS.LAND_LISTINGS,
            id: propertyId,
            fromAny: [...PURCHASABLE_STATUSES],
            to: "pending",
            patch: { pendingBuyerId: session.user.id, pendingSince: new Date().toISOString() },
            // Records which status the listing was reserved FROM, so cancelling
            // can put it back rather than guessing. A listing reserved from
            // "verified" must return to "verified" or it drops out of the
            // public land view.
            recordPreviousAs: "previousStatus",
        });

        if (!claim.claimed) {
            return {
                success: false as const,
                error: "Property is no longer available",
                data: null,
                meta: null,
            };
        }

        /**
         * A reservation with no purchase request behind it is a stranded
         * listing.
         *
         * The claim above takes the property off the market. If the write below
         * fails, the buyer has nothing to cancel — cancelPurchaseRequestAction
         * needs a request — and no other buyer can claim it, so the property is
         * gone for good. Same hole as the checkout path, which now releases on
         * failure too.
         */
        try {
        await db.runTransaction(async (transaction) => {
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

            // (The property was already moved to "pending" by the claim above.
            //  Setting it here as well is what put the reservation AFTER the
            //  purchase request, so two buyers could both get that far.)
        });
        } catch (writeError) {
            try {
                await propertyRef.update({
                    status: statusAfterCancellation(propData.status),
                    // #140 — one definition, so `pendingSince` cannot outlive
                    // the hold it dates and mislead the sweep that reads it.
                    ...releasedReservationFields(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } catch (releaseError) {
                logger.error(
                    `[initiatePropertyPurchase] property ${propertyId} is reserved and could not be released ` +
                    `after the purchase request failed to write; it needs to be freed by hand.`,
                    releaseError,
                );
            }
            throw writeError;
        }

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
            if (e.message?.includes("FAILED_PRECONDITION") || e.code === 9 || e.message?.includes("index") || e.message?.includes("INDEX")) {
                logger.warn("Missing index for getMyPurchaseRequestsAction, falling back to memory sort");
                snapshot = await db.collection(COLLECTIONS.FARM_NATION_TRANSACTIONS)
                    .where("buyerId", "==", session.user.id)
                    .get();
                const requests = serializeDocs<any>(snapshot.docs);
                requests.sort((a, b) => {
                    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                    return bTime - aTime;
                });
                return { error: null, success: true as const, data: { requests }, meta: null };
            }
            throw e;
        }

        const requests = serializeDocs<any>(snapshot.docs);

        return { error: null, success: true as const, data: { requests } };
    } catch (error: any) { 
        logger.error("Get purchase requests error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}


export async function getMyPurchaseRequestsAction(...args: Parameters<typeof _getMyPurchaseRequestsAction>) {
    return withFlexibleSafeAction("getMyPurchaseRequestsAction", _getMyPurchaseRequestsAction)(...args);
}


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

        // ── CLAIM THE CANCELLATION, THEN RELEASE THE PROPERTY ──────
        //
        // Claiming means two simultaneous cancellations cannot both release the
        // property — which, now that the reservation happens up front, would
        // otherwise free a listing another buyer had already claimed.
        const cancelClaim = await claimStatusTransition({
            collection: COLLECTIONS.FARM_NATION_TRANSACTIONS,
            id: requestId,
            from: "pending_payment",
            to: "cancelled",
            patch: { escrowStatus: "refunded", cancelledAt: new Date().toISOString() },
        });

        if (!cancelClaim.claimed) {
            return {
                success: false as const,
                error: "Can only cancel pending payment requests",
                data: null,
                meta: null,
            };
        }

        // Return the property to the pool.
        //
        // This used to set "verified", which left the listing unbuyable:
        // purchasing requires "available", so no buyer could claim it again.
        //
        // "verified" is NOT an invalid status — it is the land module's
        // admin-approved state, and getVerifiedLandListings queries exactly
        // that. The problem is that LAND_LISTINGS is shared by two modules with
        // incompatible vocabularies:
        //
        //   land-actions   pending_verification → verified / rejected → deleted
        //                  public view queries status = 'verified'
        //   farm-nation    creates as "available"; purchase requires "available"
        //
        // So a listing is visible in one module or purchasable in the other,
        // never both. Restoring "available" here is right for a listing that
        // came through farm-nation — which is the only kind that can reach this
        // path, since a "verified" listing cannot be purchased in the first
        // place. The underlying split is recorded in
        // docs/audit/atomic-money-migration.md and needs a decision, not a
        // patch.
        if (requestData?.propertyId) {
            const listingRef = db.collection(COLLECTIONS.LAND_LISTINGS).doc(requestData.propertyId);
            const listingSnap = await listingRef.get();
            const listing = listingSnap.data() ?? {};

            /**
             * Release only the reservation THIS request is holding.
             *
             * This wrote the release unconditionally, from the propertyId on the
             * cancelled request. `pendingBuyerId` is written by both reservation
             * paths and was read by nothing, so nothing checked that the listing
             * was still held by the person cancelling.
             *
             * That matters as soon as a reservation can change hands. An admin
             * approval used to claim a listing straight out of "pending" (see
             * IN_REVIEW_STATUSES), after which another buyer could reserve and
             * pay for it — and then the FIRST buyer cancelling their stale
             * request would blow away the second buyer's reservation while their
             * money was in escrow. Approvals no longer do that, and this no
             * longer depends on them not doing it.
             *
             * A listing that has moved on is left exactly as it is; the request
             * is still cancelled, because that part is the buyer's to decide.
             */
            const heldByThisBuyer = String(listing.pendingBuyerId ?? "") === session.user.id;

            if (heldByThisBuyer) {
                await listingRef.update({
                    status: statusAfterCancellation(listing.previousStatus),
                    // #140 — see releasedReservationFields: `pendingSince` was
                    // left behind here, so a released listing kept the
                    // timestamp of a hold it no longer had.
                    ...releasedReservationFields(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            } else if (listing.pendingBuyerId) {
                logger.warn(
                    `[cancelPurchaseRequest] request ${requestId} cancelled, but listing ` +
                    `${requestData.propertyId} is reserved by ${listing.pendingBuyerId}; left untouched.`
                );
            }
        }

        return { error: null, success: true as const, meta: null, data: null };
    } catch (error: any) { 
        logger.error("Cancel purchase request error:", error);
        return { success: false as const, error: error.message, data: null, meta: null };
    }
}


export async function cancelPurchaseRequestAction(...args: Parameters<typeof _cancelPurchaseRequestAction>) {
    return withFlexibleSafeAction("cancelPurchaseRequestAction", _cancelPurchaseRequestAction)(...args);
}
