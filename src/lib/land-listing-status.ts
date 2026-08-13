/**
 * The status vocabulary for LAND_LISTINGS — one definition, shared.
 *
 * WHY THIS EXISTS
 * ---------------
 * `LAND_LISTINGS` is written and read by two modules that did not agree on what
 * a status means, so a listing was visible in one or purchasable in the other,
 * never both:
 *
 *   land-actions   creates `pending_verification`; an admin moves it to
 *                  `verified` or `rejected`; delete sets `deleted`.
 *                  The public view queries status = 'verified'.
 *
 *   farm-nation    creates `available`; purchase required exactly `available`,
 *                  reserved as `pending`, and sold as `sold`.
 *
 * So a land listing an admin had verified could not be bought through
 * farm-nation at all, and a farm-nation property never appeared in the verified
 * land view. Half the inventory was unreachable from each side.
 *
 * Worse, farm-nation's browse applied NO status filter, so buyers were shown
 * listings that were awaiting verification, explicitly rejected, or deleted —
 * and could start a purchase on them.
 *
 * WHAT THIS DOES
 * --------------
 * Treats the two "approved and for sale" statuses as synonyms rather than
 * renaming either. `verified` and `available` mean the same thing and both are
 * honoured, which avoids a data migration over live listings — and a migration
 * here would be the risky kind, because the two modules would disagree during
 * it.
 *
 * If the vocabularies are ever unified for real, this file is the single place
 * that has to change.
 */

/** Every status a land listing is known to hold, from either module. */
export type LandListingStatus =
    | "pending_verification"
    | "verified"          // land-actions: admin approved
    | "available"         // farm-nation: created and for sale
    | "pending"           // farm-nation: reserved by a buyer mid-purchase
    | "sold"
    | "leased"
    | "rejected"
    | "deleted";

/**
 * Statuses meaning "approved and for sale".
 *
 * Two spellings of one idea. `verified` comes from the land module's admin
 * approval, `available` from farm-nation's own creation path.
 */
export const PURCHASABLE_STATUSES: readonly LandListingStatus[] = ["verified", "available"];

/**
 * Statuses a buyer may see when browsing.
 *
 * Deliberately the same set as purchasable: showing a listing that cannot be
 * bought sends buyers down a flow that fails at the end. `pending` is excluded
 * because another buyer is mid-purchase.
 */
export const BROWSABLE_STATUSES: readonly LandListingStatus[] = PURCHASABLE_STATUSES;

/**
 * Statuses meaning "waiting for an admin to look at it".
 *
 * Named here because two dashboards counted `status == "pending"` for this and
 * got a different, live meaning: farm-nation sets `pending` when a BUYER
 * reserves a listing mid-purchase. So those panels counted reserved properties
 * as outstanding approvals and showed zero for the listings actually awaiting
 * review — while farm-nation-admin.ts and admin-content.ts, which query
 * `pending_verification`, showed the real queue. Three screens, two answers.
 *
 * Anything counting an approval backlog should use this rather than a literal.
 */
export const AWAITING_REVIEW_STATUSES: readonly LandListingStatus[] = ["pending_verification"];

/** True when a listing can be bought right now. */
export function isPurchasable(status: unknown): boolean {
    return typeof status === "string" &&
        (PURCHASABLE_STATUSES as readonly string[]).includes(status);
}

/** True when a listing should appear in a buyer-facing list. */
export function isBrowsable(status: unknown): boolean {
    return typeof status === "string" &&
        (BROWSABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * The status to restore when a purchase is cancelled or expires.
 *
 * A listing reserved from `verified` must go back to `verified`, or it drops
 * out of the public land view. Returning it to `available` instead — which an
 * earlier fix did — quietly removes an admin-approved listing from the
 * marketplace it was approved for.
 *
 * `previousStatus` is recorded on the listing when it is reserved. The fallback
 * is only for listings reserved before that was recorded.
 */
export function statusAfterCancellation(previousStatus: unknown): LandListingStatus {
    return isPurchasable(previousStatus)
        ? (previousStatus as LandListingStatus)
        : "available";
}
