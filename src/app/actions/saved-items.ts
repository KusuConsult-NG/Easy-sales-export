"use server";

import { logger } from "@/lib/logger";
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { withSafeAction, ActionResponse } from "@/lib/safe-action";
import { isSavedItemType, isSavedRow, savedItemDocId } from "@/lib/saved-items";
import { readSavedRows } from "@/lib/saved-items-store";
import { publicSellerSummary, type PublicSellerSummary } from "@/lib/public-seller-summary";
import { isLandListingViewable } from "@/lib/land-visibility";

/**
 * Saving a seller, and saving a property — #105.
 *
 * Two controls in the app offered this and neither wrote anything:
 *
 *   the buyer dashboard's "Saved Sellers" tile   read users.savedSellersCount,
 *                                                a key nothing has ever written
 *   the heart on a Farm Nation property          useState, lost on navigation
 *
 * See lib/saved-items.ts for why they are ONE operation here rather than two,
 * why an unsave retires the row instead of destroying it, and why the document
 * id is derived rather than generated.
 *
 * EVERY ACTION IN THIS FILE IS SCOPED TO THE CALLER'S OWN SESSION USER ID.
 * None of them takes a userId parameter. A saved list is not something one
 * account may read of another, and the way that guarantee is kept here is that
 * there is no argument through which another id could arrive — rather than a
 * check that could be forgotten on the second door.
 */

/** A saved seller, with enough of the seller to render a card. */
export interface SavedSellerRecord {
    targetId: string;
    savedAt: string | null;
    /** null when the seller's approved verification can no longer be read. */
    seller: PublicSellerSummary | null;
}

/** A saved property, with enough of the listing to render a card. */
export interface SavedPropertyRecord {
    targetId: string;
    savedAt: string | null;
    /** null when the listing is gone or is no longer publicly viewable. */
    listing: {
        id: string;
        title: string;
        price: number;
        size: number | string;
        status: string;
        image: string | null;
        location: string;
    } | null;
}

/**
 * Save this, or un-save it — whichever it is not right now.
 *
 * Returns the state the row is in AFTERWARDS, so the button renders what the
 * database holds rather than what the browser assumed. A control that flips
 * its own icon and then finds out is #310's shape: the screen discarding the
 * server's answer.
 *
 * ON THE COUNTER: a land listing carries `favoriteCount`, which _fn_listings.ts
 * initialises to 0 and nothing has ever moved. It moves here, through
 * FieldValue.increment — which this adapter applies through the apply_increments
 * RPC, in the database, so two people saving at once do not lose one of the
 * two. It is stepped ONLY when the row's state actually changed, which is why
 * the read above happens first.
 *
 * A FAILED COUNTER UPDATE DOES NOT FAIL THE SAVE. The saved_items row is the
 * source of truth for whether this person saved this listing; favoriteCount is
 * a display total derived from it. Refusing the save because a display total
 * could not be stepped would be the tail wagging the dog, so it is logged and
 * the save stands.
 */
async function _toggleSavedItemAction(
    itemType: string,
    targetId: string,
): Promise<ActionResponse<{ saved: boolean }>> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };

        if (!isSavedItemType(itemType)) {
            return { success: false as const, error: "Unknown item type", data: null };
        }

        const userId = session.user.id;
        const docId = savedItemDocId(userId, itemType, targetId);
        if (!docId) {
            return { success: false as const, error: "That item cannot be saved", data: null };
        }

        const ref = db.collection(COLLECTIONS.SAVED_ITEMS).doc(docId);
        const existing = await ref.get();
        const wasSaved = existing.exists && isSavedRow(existing.data() as Record<string, unknown>);
        const nowSaved = !wasSaved;

        // set with merge, not update: update() on a missing document is a
        // documented silent no-op in this adapter, so the first save of
        // anything would have written nothing at all and reported success.
        await ref.set(
            {
                userId,
                itemType,
                targetId: String(targetId).trim(),
                saved: nowSaved,
                savedAt: nowSaved ? FieldValue.serverTimestamp() : (existing.data()?.savedAt ?? null),
                unsavedAt: nowSaved ? null : FieldValue.serverTimestamp(),
                createdAt: existing.exists
                    ? (existing.data()?.createdAt ?? FieldValue.serverTimestamp())
                    : FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
        );

        if (itemType === "land_listing") {
            try {
                await db.collection(COLLECTIONS.LAND_LISTINGS).doc(String(targetId).trim()).update({
                    favoriteCount: FieldValue.increment(nowSaved ? 1 : -1),
                });
            } catch (error) {
                logger.error(`[saved-items] favoriteCount step failed for listing ${targetId}`, error);
            }
        }

        return { error: null, success: true as const, data: { saved: nowSaved } };
    } catch (error: any) {
        logger.error("[saved-items] toggle failed", error);
        return { success: false as const, error: "Could not update your saved items", data: null };
    }
}

export const toggleSavedItemAction = withSafeAction(
    "toggleSavedItemAction",
    _toggleSavedItemAction,
);

/** Is this one thing saved by the caller right now? */
async function _getSavedItemStateAction(
    itemType: string,
    targetId: string,
): Promise<ActionResponse<{ saved: boolean }>> {
    try {
        const { session } = await requireSession();
        // Not signed in is not an error here — the heart simply renders empty
        // and the click sends them to sign in. Returning a refusal would make
        // every public property page show an error banner.
        if (!session) return { error: null, success: true as const, data: { saved: false } };

        const docId = savedItemDocId(session.user.id, itemType, targetId);
        if (!docId) return { error: null, success: true as const, data: { saved: false } };

        const snap = await db.collection(COLLECTIONS.SAVED_ITEMS).doc(docId).get();
        const saved = snap.exists && isSavedRow(snap.data() as Record<string, unknown>);
        return { error: null, success: true as const, data: { saved } };
    } catch (error: any) {
        logger.error("[saved-items] state read failed", error);
        // A failed read is reported as a failure, NOT as "not saved". #313's
        // lesson: a control that answers "off" when it could not check is
        // indistinguishable from one that checked and found nothing.
        return { success: false as const, error: "Could not check your saved items", data: null };
    }
}

export const getSavedItemStateAction = withSafeAction(
    "getSavedItemStateAction",
    _getSavedItemStateAction,
);

/** How many things of one type the caller has saved. */
async function _getSavedItemCountAction(
    itemType: string,
): Promise<ActionResponse<{ count: number }>> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };
        if (!isSavedItemType(itemType)) {
            return { success: false as const, error: "Unknown item type", data: null };
        }

        const rows = await readSavedRows(session.user.id, itemType);
        return { error: null, success: true as const, data: { count: rows.length } };
    } catch (error: any) {
        logger.error("[saved-items] count failed", error);
        return { success: false as const, error: "Could not count your saved items", data: null };
    }
}

export const getSavedItemCountAction = withSafeAction(
    "getSavedItemCountAction",
    _getSavedItemCountAction,
);

/**
 * The caller's saved sellers, each with the public seller card.
 *
 * A seller whose approved verification can no longer be read comes back with
 * `seller: null` rather than being dropped. The row is the buyer's, and
 * silently shortening their list is #307's shape — a list that failed to load
 * looking exactly like an empty one.
 */
async function _getSavedSellersAction(): Promise<ActionResponse<{ sellers: SavedSellerRecord[] }>> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };

        const rows = await readSavedRows(session.user.id, "marketplace_seller");

        const sellers: SavedSellerRecord[] = await Promise.all(
            rows.map(async (row) => {
                try {
                    const verSnap = await db
                        .collection(COLLECTIONS.SELLER_VERIFICATIONS)
                        .where("userId", "==", row.targetId)
                        .where("status", "==", "approved")
                        .limit(5)
                        .get();

                    if (verSnap.empty) return { ...row, seller: null };

                    const doc = verSnap.docs[0];
                    return {
                        ...row,
                        seller: publicSellerSummary(
                            doc.id,
                            row.targetId,
                            doc.data() as Record<string, unknown>,
                        ),
                    };
                } catch (error) {
                    logger.error(`[saved-items] seller ${row.targetId} could not be read`, error);
                    return { ...row, seller: null };
                }
            }),
        );

        return { error: null, success: true as const, data: { sellers } };
    } catch (error: any) {
        logger.error("[saved-items] saved sellers failed", error);
        return { success: false as const, error: "Could not load your saved sellers", data: null };
    }
}

export const getSavedSellersAction = withSafeAction(
    "getSavedSellersAction",
    _getSavedSellersAction,
);

/**
 * The caller's saved properties.
 *
 * The projection is an ALLOW-LIST of seven display fields, not a spread of the
 * listing document — a land listing carries the owner's id and email address
 * and the admin's verification notes, which lib/land-visibility.ts lists as
 * internal for the reason given there. isLandListingViewable is applied on top,
 * so a listing that has gone back into the review queue is shown as
 * unavailable rather than exposed.
 */
async function _getSavedPropertiesAction(): Promise<
    ActionResponse<{ properties: SavedPropertyRecord[] }>
> {
    try {
        const { session } = await requireSession();
        if (!session) return { success: false as const, error: "Unauthorized", data: null };

        const rows = await readSavedRows(session.user.id, "land_listing");

        const properties: SavedPropertyRecord[] = await Promise.all(
            rows.map(async (row) => {
                try {
                    const snap = await db
                        .collection(COLLECTIONS.LAND_LISTINGS)
                        .doc(row.targetId)
                        .get();

                    if (!snap.exists) return { ...row, listing: null };

                    const data = snap.data() as Record<string, any>;
                    if (!isLandListingViewable(data.status)) return { ...row, listing: null };

                    const location = typeof data.location === "object" && data.location
                        ? [data.location.address, data.location.lga, data.location.state]
                            .filter((part) => typeof part === "string" && part.trim() !== "")
                            .join(", ")
                        : String(data.location ?? "");

                    return {
                        ...row,
                        listing: {
                            id: snap.id,
                            title: String(data.title ?? "Untitled listing"),
                            price: Number(data.price) || 0,
                            size: data.size ?? "",
                            status: String(data.status ?? ""),
                            image: Array.isArray(data.images) && typeof data.images[0] === "string"
                                ? data.images[0]
                                : null,
                            location,
                        },
                    };
                } catch (error) {
                    logger.error(`[saved-items] listing ${row.targetId} could not be read`, error);
                    return { ...row, listing: null };
                }
            }),
        );

        return { error: null, success: true as const, data: { properties } };
    } catch (error: any) {
        logger.error("[saved-items] saved properties failed", error);
        return { success: false as const, error: "Could not load your saved properties", data: null };
    }
}

export const getSavedPropertiesAction = withSafeAction(
    "getSavedPropertiesAction",
    _getSavedPropertiesAction,
);
