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

/**
 * Every status a land listing is known to hold, from either module.
 *
 * This listed nine and the collection uses fifteen. The five money states were
 * the omission that mattered: `pending_escrow`, `pending_payment`,
 * `payment_confirmed` and `pending_transfer` are exactly the states an admin
 * decision must not overwrite, and a type meant to enumerate the vocabulary did
 * not mention them — so nothing reading this file could see that they existed.
 */
export type LandListingStatus =
    | "draft"             // saved but not submitted for review
    | "pending_verification"
    | "inspection_scheduled" // an inspector has been dispatched
    | "verified"          // land-actions: admin approved
    | "available"         // farm-nation: created and for sale
    | "approved"          // land-visibility.ts's spelling of the same thing
    | "pending"           // farm-nation: reserved by a buyer mid-purchase
    | "pending_payment"
    | "pending_escrow"    // a buyer's money is held against this parcel
    | "payment_confirmed"
    | "pending_transfer"
    | "sold"
    | "leased"
    | "rejected"
    | "deleted";

/**
 * Statuses meaning "approved and for sale".
 *
 * THREE spellings of one idea, not two. `verified` comes from the land module's
 * admin approval, `available` from farm-nation's own creation path, and
 * `approved` from land-visibility.ts — which maintained its OWN list,
 * PUBLIC_LAND_STATUSES = ["verified", "approved"], while this file said
 * ["verified", "available"].
 *
 * Two files each claiming to be the single definition, disagreeing on two of the
 * three values, and the mismatch was live in both directions:
 *
 *   "available"  purchasable here, NOT public there — so every listing
 *                farm-nation created was buyable but absent from
 *                /api/farm-nation/listings and /land. Invisible inventory,
 *                reachable only with a direct URL.
 *
 *   "approved"   public there, NOT purchasable here — so a listing an admin
 *                marked approved was shown to buyers and then refused at
 *                isPurchasable(), failing at the end of the flow.
 *
 * All three are honoured now, and land-visibility.ts derives PUBLIC_LAND_STATUSES
 * from this constant rather than keeping a second copy. That is what makes this
 * file's closing promise — "the single place that has to change" — true.
 */
export const PURCHASABLE_STATUSES: readonly LandListingStatus[] = [
    "verified",
    "available",
    "approved",
];

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
 * `inspection_scheduled` IS in this set, and it was not.
 *
 * That was the remaining half of the same disagreement. A listing with an
 * inspector dispatched has not been decided — _fna_verifications.ts counts it as
 * pending and shows it under the pending tab of the queue an admin actually
 * works from — but this set held `pending_verification` alone, so the global
 * dashboard and analytics reported a smaller backlog than the queue contained.
 * The two numbers were produced from the same collection, seconds apart, and
 * disagreed by however many inspections were outstanding.
 *
 * Anything counting an approval backlog should use this rather than a literal,
 * and must query it with `in` — the two call sites wrote
 * `AWAITING_REVIEW_STATUSES[0]`, which was correct for a one-element set and
 * silently ignored everything added to it.
 */
export const AWAITING_REVIEW_STATUSES: readonly LandListingStatus[] = [
    "pending_verification",
    "inspection_scheduled",
];

/**
 * The `verificationStatus` value meaning "no decision yet".
 *
 * A constant because it is what admin/_land.ts's pending queue used to ask the
 * database for as a literal, and because _fn_listings.ts wrote a different
 * spelling of it — "pending_review" — which that query could never match. Every
 * listing whose owner added documents after a rejection dropped out of the
 * review queue entirely.
 */
export const AWAITING_VERIFICATION_STATUS: LandVerificationStatus = "pending";

/**
 * Statuses an admin approval or rejection may act on.
 *
 * FIVE COPIES OF THIS LIST EXISTED, AND THEY DISAGREED
 * ---------------------------------------------------
 * Each admin decision path hand-wrote its own:
 *
 *   approve-land            pending, pending_verification, inspection_scheduled,
 *                           rejected
 *   land-listings verify    + draft
 *   _fn_admin verifyProperty + available, approved, verified
 *   reject-land             pending, pending_verification, inspection_scheduled,
 *                           verified
 *   land-listings reject    + draft, available, approved
 *
 * So the same listing could be approved through one admin screen and refused
 * through another. The sharpest case: approve-land omitted `available` — the
 * status farm-nation's own creation path writes — so the admin land queue could
 * not approve a farm-nation listing at all, while _fn_admin could.
 *
 * WHAT THE GUARD IS ACTUALLY FOR
 * ------------------------------
 * Not to police which review step comes next; it is to stop an admin decision
 * overwriting a status that money depends on. `pending_escrow`,
 * `pending_payment`, `pending_transfer`, `sold` and `leased` all mean a buyer
 * has committed, and `deleted` means the owner withdrew it. Reopening any of
 * those puts a parcel back on the market with an escrow held against it.
 *
 * Enumerated rather than expressed as "everything except", so a status added
 * later cannot become admin-writable by omission.
 */
/**
 * "pending" is NOT in this list, and that is the point.
 *
 * On LAND_LISTINGS, `pending` has exactly one writer: the farm-nation buyer
 * RESERVATION in _fn_purchases.ts, which claims a listing to "pending" while
 * that buyer is at checkout. Nothing writes it to mean "waiting for an admin" —
 * review is `pending_verification`. The collision is documented a few lines
 * below for PENDING_REVIEW_STATUSES, where two dashboards counted reserved
 * properties as outstanding approvals; those readers were corrected and this
 * list was not.
 *
 * Leaving it here let an admin approval or rejection CLAIM A LISTING A BUYER
 * WAS PAYING FOR — the approval succeeded, wrote "verified", and put the parcel
 * back on the public market with someone mid-purchase. That is the same fault
 * the approve-land route's own comment describes for `pending_escrow` ("two
 * buyers, two escrows, one parcel"); `pending` is that fault one step earlier,
 * before the money is taken.
 *
 * An admin is now refused on a reserved listing, and told which state it is in.
 * A reservation that is abandoned rather than cancelled therefore holds the
 * listing until its buyer cancels — `pendingSince` is written for exactly this
 * and is read by nothing, so there is no expiry. Building that sweep is a
 * product decision, not a bug fix, and is recorded rather than invented here.
 */
const IN_REVIEW_STATUSES: readonly string[] = [
    "draft",
    "pending_verification",
    "inspection_scheduled",
];

/**
 * Statuses an approval may start from.
 *
 * The for-sale statuses are included so all three spellings converge on the
 * canonical `verified` — that is the point of having one vocabulary. `rejected`
 * is included because reversing a rejection is a real admin action, and every
 * call site preserves the prior reason when it happens.
 */
export const APPROVABLE_FROM_STATUSES: readonly string[] = [
    ...IN_REVIEW_STATUSES,
    ...PURCHASABLE_STATUSES,
    "rejected",
];

/**
 * Statuses a rejection may start from.
 *
 * Includes `rejected` so an admin can correct the reason on a listing they have
 * already rejected, which the blind writes these replaced allowed.
 */
export const REJECTABLE_FROM_STATUSES: readonly string[] = [
    ...IN_REVIEW_STATUSES,
    ...PURCHASABLE_STATUSES,
    "rejected",
];

/**
 * Statuses no admin decision may overwrite — money or the owner's withdrawal
 * depends on them.
 *
 * Not used as the guard (the guard enumerates what IS allowed). Exported so the
 * refusal message and the tests can name the reason, and so the two lists can be
 * asserted disjoint.
 */
export const DECISION_LOCKED_STATUSES: readonly string[] = [
    "pending_payment",
    "pending_escrow",
    "payment_confirmed",
    "pending_transfer",
    "sold",
    "leased",
    "deleted",
];

/**
 * The `verificationStatus` field: one shape, one set of values.
 *
 * THE FIELD HELD TWO DIFFERENT TYPES
 * ----------------------------------
 * Four writers put a STRING on it:
 *
 *   create-listing/route.ts   "pending"        — every listing made via the API
 *   admin-content.ts          "approved" / "rejected"
 *   admin/_land.ts            the decision, "approved" / "rejected"
 *   _fn_listings.ts           "pending_review" — a fourth value, matching none
 *                                                of the others
 *
 * and three put an OBJECT — `{ verified, verifiedBy, verifiedAt,
 * rejectionReason }` — on the same field: land-listings.ts's verify and reject,
 * and the approve-land / reject-land routes.
 *
 * The readers split the same way, so each half worked only on rows the other
 * half had not touched:
 *
 *   admin/_land.ts:34         .where("verificationStatus", "==", "pending")
 *                             — a DATABASE QUERY. An object never matches, so a
 *                             listing decided through either API route was gone
 *                             from that pending queue for good.
 *   map/page.tsx, types/      compare it to a string
 *   _fna_verifications.ts     reads verificationStatus?.verifiedAt
 *   land-visibility.ts        strips internal keys from it as an object
 *
 * And it broke the fix that carried a prior decision forward:
 * `...(previous.verificationStatus ?? {})` spreads a STRING into indexed
 * characters, so approving a freshly created listing — whose value is the string
 * "pending" from create-listing — wrote
 * `{0:"p",1:"e",2:"n",...,verified:true}`.
 *
 * THE STRING WINS
 * ---------------
 * It is what the database query needs, what the shared type declares, and what
 * three of the four string writers already emit. The decision detail moves to
 * the top-level `verified` / `verifiedBy` / `verifiedAt` / `rejectionReason`
 * fields, which already exist, are already written by admin/_land.ts and
 * _fn_admin.ts, and are already removed from public output by
 * stripInternalLandFields — better than the nested copy, which needed its own
 * stripping pass.
 */
export type LandVerificationStatus = "pending" | "approved" | "rejected";

/**
 * Normalises whatever a row happens to carry into the canonical string.
 *
 * Live rows hold all of it: the four strings, the object, and nothing at all.
 * Readers must not have to know which.
 */
export function normaliseVerificationStatus(raw: unknown): LandVerificationStatus {
    if (typeof raw === "string") {
        // "pending_review" is _fn_listings' spelling of the same waiting state.
        if (raw === "approved" || raw === "verified") return "approved";
        if (raw === "rejected") return "rejected";
        return "pending";
    }

    // The legacy object shape. `verified` is the only field that carried the
    // decision; a rejection set it false and added rejectionReason.
    if (raw && typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        if (obj.verified === true) return "approved";
        if (obj.verified === false && obj.rejectionReason) return "rejected";
        return "pending";
    }

    return "pending";
}

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
