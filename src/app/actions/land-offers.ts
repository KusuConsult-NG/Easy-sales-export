/**
 * Offers on a parcel of land, and the owner's answer to them.
 *
 *   #874 THE SAME GAP AS #873, IN THE MODULE WHERE THE SUMS ARE LARGER.
 *
 *   THE OWNER: "there is a senerio where a buyer wants to ask for discount on
 *   certain product/property" — product AND property. #873 wired the
 *   marketplace; this is the property half.
 *
 *   MEASURED FIRST, and the two modules were not in the same state. The
 *   marketplace already had a record for "a buyer is asking about a price"
 *   (`marketplace_quotes`) with no reply. Farm Nation had NOTHING: the only
 *   buyer-to-seller channel on a listing is a land inquiry, and an inquiry is a
 *   PUBLIC intake with a name, an email and a phone number and no buyerId at
 *   all — getLandInquiryByIdAction's own guard says so, and #872's reply had to
 *   go out by email because of it.
 *
 *   An offer moves money into escrow. It needs an account on both sides, so it
 *   cannot be an inquiry, and a new record is the honest answer rather than
 *   bending one that means something else.
 *
 * ── ONE SET OF RULES, NOT A SECOND COPY ─────────────────────────────────────
 *
 *   The law is lib/quote-negotiation.ts, unchanged and shared. Everything that
 *   decides whether an agreed figure may be spent is identical in both modules
 *   — it is the buyer's, it is for this thing, it is accepted, unspent,
 *   unexpired, and it never raises the price — and the one thing that differs is
 *   quantity: a parcel is one parcel, so both sides pass 1 and the check is
 *   satisfied rather than skipped.
 *
 *   Two copies of this reasoning would be two places to fix it, and this
 *   codebase's own history is mostly about a rule applied to some of the places
 *   it names.
 *
 * ── AND THE PRICE IS STILL THE SELLER'S ─────────────────────────────────────
 *
 *   farm-nation-payment.ts already ignores the caller's `amount` because
 *   trusting it meant "anyone could buy any verified property for ₦10,000". An
 *   accepted offer does not reopen that door: the checkout is handed an OFFER
 *   ID, reads the row, and takes the figure the OWNER agreed to.
 */

"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { requireSession } from "@/lib/session-guard";
import { logger } from "@/lib/logger";
import { FieldValue } from "@/lib/firestore-compat";
import { revalidatePath } from "next/cache";
import { withSafeAction } from "@/lib/safe-action";
import { createNotification } from "@/infrastructure/notifications/service";
import { serializeDocs } from "@/lib/firestore-serialize";
import type { ActionResponse } from "@/lib/safe-action";
import {
    offerRefusal,
    positiveNumber,
    responseRefusal,
    type QuoteRecord,
} from "@/lib/quote-negotiation";

export interface LandOfferData {
    listingId: string;
    /** What the buyer is willing to pay. Required — an offer with no figure is not an offer. */
    offeredPrice: number;
    /** Which of the listing's offers this is about. Resolved against the listing, never believed. */
    mode?: "buy" | "rent";
    message?: string;
}

/**
 * Tell the other side.
 *
 *   THROUGH THE SERVICE. #687's ledger names the five modules that write
 *   notifications directly; this is not becoming a sixth. What the direct write
 *   skips is #738 — a notice addressed to a SUPERSEDED profile is redirected to
 *   the row the person signs in as — and lib/farm-nation-notifications.ts
 *   already records that exact mistake being made and corrected on this module.
 */
async function ringBell(userId: string, title: string, message: string, link: string) {
    if (!userId) return;
    await createNotification({ userId, type: "farm_nation", title, message, link });
}

/**
 * What this listing asks for the offer the buyer is taking.
 *
 *   #869's rule, and it has to be the same rule: `price` is the sale figure and
 *   `rentPrice` is what the term costs, so an offer against a rental has to be
 *   measured against the rental price or every rental offer looks like a huge
 *   discount off a sale price nobody was discussing.
 *
 *   The mode is RESOLVED against the listing's own flags rather than believed,
 *   exactly as farm-nation-payment.ts resolves it, so naming `rent` on a
 *   sale-only parcel cannot pick the cheaper of two figures.
 */
function listedFigureFor(
    listing: Record<string, any>,
    wanted: "buy" | "rent" | undefined,
): { mode: "buy" | "rent"; listedPrice: number } {
    const offersRental = listing.availableForRent === true || listing.availableForLease === true;
    const offersSale = listing.availableForSale === true;
    const mode: "buy" | "rent" =
        wanted === "rent" && offersRental ? "rent"
            : (offersRental && !offersSale ? "rent" : "buy");

    const rentPrice = Number(listing.rentPrice || 0);
    const listedPrice = mode === "rent" && rentPrice > 0
        ? rentPrice
        : Number(listing.price || 0);

    return { mode, listedPrice };
}

// ---------------------------------------------------------------------------
// THE BUYER MAKES AN OFFER
// ---------------------------------------------------------------------------

async function _makeLandOfferAction(data: LandOfferData): Promise<ActionResponse<{ id: string }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const { session } = sessionResult;
        const userId = session.user.id;

        const listingSnap = await db.collection(COLLECTIONS.LAND_LISTINGS)
            .doc(String(data.listingId)).get();
        if (!listingSnap.exists) {
            return { success: false as const, error: "Property not found", data: null };
        }
        const listing = listingSnap.data() ?? {};

        /*
         *   THE OWNER AND THE TITLE COME FROM THE LISTING.
         *
         *   The third time this file's neighbours have had to say it:
         *   _submitLandInquiryAction took listingOwnerId and listingTitle from
         *   the request and now reads them from the listing; so does
         *   createReviewAction; so does _submitQuoteRequestAction. A recipient
         *   id taken from a request is an open endpoint for sending a branded
         *   platform notification to anybody.
         */
        const ownerId = String(listing.ownerId || "");
        const title = String(listing.title || "this property");
        if (!ownerId) {
            return { success: false as const, error: "This property has no owner on record", data: null };
        }
        if (ownerId === userId) {
            return { success: false as const, error: "You cannot make an offer on your own property", data: null };
        }

        const { mode, listedPrice } = listedFigureFor(listing, data.mode);

        const offeredPrice = positiveNumber(data.offeredPrice);
        const problem = offerRefusal(offeredPrice, listedPrice, data.offeredPrice);
        if (problem) return { success: false as const, error: problem, data: null };
        if (offeredPrice === null) {
            //   Unlike a marketplace RFQ, a land offer with no figure is not a
            //   thing: the owner has nothing to accept and the buyer has asked
            //   nothing. The inquiry form is where "tell me about it" lives.
            return { success: false as const, error: "Enter the amount you are offering.", data: null };
        }

        /*
         *   ONE OPEN OFFER PER BUYER PER PARCEL, for the reason _quotes.ts
         *   gives about its own duplicate check: every call writes a row and a
         *   notification, and nothing else bounds the repetition. A second offer
         *   while the first is unanswered is not something a buyer means to do.
         *
         *   A check, not a lock. Two racing calls can both pass; that bounds a
         *   flood to a handful rather than to nothing, and the rows are inert.
         */
        const open = await db.collection(COLLECTIONS.LAND_OFFERS)
            .where("buyerId", "==", userId)
            .where("listingId", "==", String(data.listingId))
            .where("status", "==", "pending")
            .limit(1)
            .get();
        if (!open.empty) {
            return {
                success: false as const,
                error: "You already have an offer waiting on this property.",
                data: null,
            };
        }

        const ref = await db.collection(COLLECTIONS.LAND_OFFERS).add({
            listingId: String(data.listingId),
            listingTitle: title,
            sellerId: ownerId,
            buyerId: userId,
            buyerName: session.user.name || "A buyer",
            buyerEmail: session.user.email || "",
            //   A parcel is one parcel. Carried so the shared rules in
            //   quote-negotiation.ts have the quantity they check.
            quantity: 1,
            offerMode: mode,
            listedPrice,
            offeredPrice,
            message: typeof data.message === "string" ? data.message.trim().slice(0, 2000) : "",
            status: "pending",
            _version: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });

        await ringBell(
            ownerId,
            "You have an offer on your property",
            `${session.user.name || "A buyer"} offered ₦${offeredPrice.toLocaleString()} for "${title}" (listed at ₦${listedPrice.toLocaleString()}).`,
            "/farm-nation/offers",
        );

        revalidatePath("/farm-nation/offers");
        revalidatePath(`/farm-nation/property/${data.listingId}`);

        return { error: null, success: true as const, data: { id: ref.id } };
    } catch (error) {
        logger.error("Make land offer error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to send your offer. Please try again.", data: null };
    }
}
export const makeLandOfferAction = withSafeAction("makeLandOfferAction", _makeLandOfferAction);

// ---------------------------------------------------------------------------
// THE OWNER ANSWERS
// ---------------------------------------------------------------------------

async function _respondToLandOfferAction(
    offerId: string,
    response: { decision: "accept" | "counter" | "decline"; price?: number; message?: string },
): Promise<ActionResponse<{ status: string }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const userId = sessionResult.session.user.id;

        const snap = await db.collection(COLLECTIONS.LAND_OFFERS).doc(String(offerId)).get();
        if (!snap.exists) return { success: false as const, error: "Offer not found", data: null };
        const offer = (snap.data() ?? {}) as QuoteRecord & Record<string, any>;

        /*
         *   THE OWNER NAMED ON THE OFFER, AND NOBODY ELSE — not an admin.
         *   #873's reasoning, unchanged: agreeing a price on a seller's behalf
         *   is not moderation, it is trading as them, and here the escrow is for
         *   a piece of land.
         */
        if (!offer.sellerId || offer.sellerId !== userId) {
            return { success: false as const, error: "This offer is not on your property", data: null };
        }

        if (offer.status !== "pending") {
            return {
                success: false as const,
                error: offer.status === "accepted"
                    ? "This offer has already been agreed."
                    : "This offer has already been answered.",
                data: null,
            };
        }

        const listedPrice = Number(offer.listedPrice ?? 0);
        const counter = positiveNumber(response?.price);
        const refusal = responseRefusal(String(response?.decision), counter, listedPrice, response?.price);
        if (refusal) return { success: false as const, error: refusal, data: null };

        const decision = response.decision;
        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = {
            sellerMessage: typeof response?.message === "string"
                ? response.message.trim().slice(0, 2000) : "",
            respondedAt: nowIso,
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (decision === "accept") {
            const asked = positiveNumber(offer.offeredPrice);
            if (asked === null) {
                return { success: false as const, error: "This offer has no usable figure.", data: null };
            }
            patch.status = "accepted";
            patch.agreedPrice = asked;
            patch.acceptedAt = nowIso;
        } else if (decision === "counter") {
            patch.status = "countered";
            patch.counterPrice = counter;
        } else {
            patch.status = "declined";
        }

        await db.collection(COLLECTIONS.LAND_OFFERS).doc(String(offerId)).update(patch);

        const title = String(offer.listingTitle || "the property");
        await ringBell(
            String(offer.buyerId || ""),
            decision === "accept" ? "Your offer was accepted"
                : decision === "counter" ? "The owner sent you a price" : "Your offer was declined",
            decision === "accept"
                ? `The owner accepted your offer on "${title}". You can proceed at the agreed price.`
                : decision === "counter"
                    ? `The owner asked ₦${Number(counter).toLocaleString()} for "${title}".`
                    : `The owner declined your offer on "${title}".`,
            "/farm-nation/offers",
        );

        revalidatePath("/farm-nation/offers");
        return { error: null, success: true as const, data: { status: String(patch.status) } };
    } catch (error) {
        logger.error("Respond to land offer error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to send your response. Please try again.", data: null };
    }
}
export const respondToLandOfferAction = withSafeAction("respondToLandOfferAction", _respondToLandOfferAction);

// ---------------------------------------------------------------------------
// THE BUYER ANSWERS A COUNTER
// ---------------------------------------------------------------------------

async function _settleLandOfferCounterAction(
    offerId: string,
    decision: "accept" | "decline",
): Promise<ActionResponse<{ status: string }>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const userId = sessionResult.session.user.id;

        const snap = await db.collection(COLLECTIONS.LAND_OFFERS).doc(String(offerId)).get();
        if (!snap.exists) return { success: false as const, error: "Offer not found", data: null };
        const offer = (snap.data() ?? {}) as QuoteRecord & Record<string, any>;

        if (!offer.buyerId || offer.buyerId !== userId) {
            return { success: false as const, error: "This offer is not yours", data: null };
        }
        if (offer.status !== "countered") {
            return { success: false as const, error: "There is no counter offer to answer.", data: null };
        }
        if (decision !== "accept" && decision !== "decline") {
            return { success: false as const, error: "Choose whether to accept or decline.", data: null };
        }

        const nowIso = new Date().toISOString();
        const patch: Record<string, any> = { settledAt: nowIso, updatedAt: FieldValue.serverTimestamp() };

        if (decision === "accept") {
            //   The OWNER's figure, off the row. This action takes no price.
            const countered = positiveNumber(offer.counterPrice);
            if (countered === null) {
                return { success: false as const, error: "This counter offer has no usable price.", data: null };
            }
            patch.status = "accepted";
            patch.agreedPrice = countered;
            patch.acceptedAt = nowIso;
        } else {
            patch.status = "declined";
        }

        await db.collection(COLLECTIONS.LAND_OFFERS).doc(String(offerId)).update(patch);

        await ringBell(
            String(offer.sellerId || ""),
            decision === "accept" ? "Your price was accepted" : "Your price was declined",
            decision === "accept"
                ? `The buyer accepted your price for "${offer.listingTitle || "your property"}".`
                : `The buyer declined your price for "${offer.listingTitle || "your property"}".`,
            "/farm-nation/offers",
        );

        revalidatePath("/farm-nation/offers");
        return { error: null, success: true as const, data: { status: String(patch.status) } };
    } catch (error) {
        logger.error("Settle land offer error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to record your answer. Please try again.", data: null };
    }
}
export const settleLandOfferCounterAction = withSafeAction("settleLandOfferCounterAction", _settleLandOfferCounterAction);

// ---------------------------------------------------------------------------
// READING THEM
// ---------------------------------------------------------------------------

/**
 * Every offer this account is a party to, on either side.
 *
 *   ONE SCREEN FOR BOTH ROLES, because on Farm Nation one account is routinely
 *   both: a member who lists a parcel also browses them. Two pages would mean a
 *   member seeing half their offers and concluding the other half was lost.
 *
 *   The filter is the SESSION's id on both queries. There is no `role` or
 *   `userId` parameter to name somebody else with — the shape _getMyQuotesAction
 *   originally had on the land side let "any authenticated user name any
 *   landowner and read their inbox".
 */
async function _getMyLandOffersAction(): Promise<ActionResponse<{
    asBuyer: any[]; asSeller: any[];
}>> {
    let sessionResult;
    try {
        sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: "Unauthorized", data: null };
        const userId = sessionResult.session.user.id;

        const [mine, onMine] = await Promise.all([
            db.collection(COLLECTIONS.LAND_OFFERS)
                .where("buyerId", "==", userId).orderBy("createdAt", "desc").get(),
            db.collection(COLLECTIONS.LAND_OFFERS)
                .where("sellerId", "==", userId).orderBy("createdAt", "desc").get(),
        ]);

        return {
            error: null,
            success: true as const,
            data: { asBuyer: serializeDocs(mine.docs), asSeller: serializeDocs(onMine.docs) },
        };
    } catch (error) {
        logger.error("Get my land offers error:", {
            userId: sessionResult?.session?.user?.id,
            error: error instanceof Error ? error.message : String(error),
        });
        return { success: false as const, error: "Failed to load your offers", data: null };
    }
}
export const getMyLandOffersAction = withSafeAction("getMyLandOffersAction", _getMyLandOffersAction);
