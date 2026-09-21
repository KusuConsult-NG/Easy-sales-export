/**
 * Does this edit need an admin to look at the parcel again?
 *
 *   #!! EVERY OWNER EDIT TOOK THE LISTING OFF THE MARKET.
 *
 *   The edit door wrote, unconditionally:
 *
 *       await ...doc(listingId).update({
 *           ...updateData,
 *           ...(priceReductionPatch(listingData.price, updateData.price) ?? {}),
 *           updatedAt: FieldValue.serverTimestamp(),
 *           status: 'pending_verification',
 *       });
 *
 *   `pending_verification` is not in PUBLIC_LAND_STATUSES — which is
 *   PURCHASABLE_STATUSES, ["approved", "available", "verified"] — so the
 *   listing left the properties list, the map, the detail page and Hot Deals
 *   the moment its owner touched it. Correcting a typo in the description
 *   pulled a verified parcel off the market until an admin re-approved it, and
 *   nothing on the edit screen said so.
 *
 * ── THE TWO ADJACENT LINES CONTRADICTED EACH OTHER ──────────────────────────
 *
 *   Look at what `priceReductionPatch` is for. #867 wired it into this exact
 *   write so that a price cut on a Farm Nation parcel raises a Hot Deal — "you
 *   need to create that for Farm Nation", in the owner's own words. The very
 *   next line then set the status that removes the listing from Hot Deals.
 *
 *   So the feature could never fire: every price reduction created a hot-deal
 *   badge on a listing it had simultaneously hidden. That is the clearest proof
 *   the reset was never meant to apply to everything — the code already had a
 *   case it broke.
 *
 * ── WHAT VERIFICATION ACTUALLY ATTESTS TO ───────────────────────────────────
 *
 *   An admin verifying land checks the PARCEL and its EVIDENCE: where it is,
 *   how big it is, what it is, and the photographs standing as proof of all
 *   three. Those are the claims a seller could bait-and-switch after approval,
 *   and changing any of them genuinely does need looking at again.
 *
 *   What an admin does not verify is the prose or the commercial terms. A
 *   title, a description, a feature list, a price, a rent, a lease term,
 *   whether escrow is offered — none of that is a claim about the land, and
 *   price in particular MUST stay live or Hot Deals cannot work.
 *
 *   The commercial terms are not unguarded, either: they have their own rule in
 *   the same action. `isOwnerMutable` refuses the whole edit once a purchase is
 *   in progress, so a price cannot move under a buyer regardless of what this
 *   file says.
 *
 * ── COMPARED BY VALUE, NEVER BY PRESENCE ────────────────────────────────────
 *
 *   This is the part that decides whether the fix works at all. The edit screen
 *   is a FORM: it posts every field it holds on every save, changed or not. A
 *   rule written as "did the patch mention `size`?" would answer yes on every
 *   submission and re-verify exactly as often as the unconditional line it
 *   replaced — a fix that changes nothing, which is worse than no fix, because
 *   it looks like one.
 *
 *   So each field is compared against what is STORED, and a field the patch
 *   omits is not a change.
 */

/** The fields an admin's verification is an opinion about. */
export const VERIFIABLE_FIELDS = [
    "location",
    "size",
    "images",
    "soilQuality",
    "waterSource",
    "category",
] as const;

/**
 * Compare two stored values for equality, tolerantly.
 *
 *   `location` is an object and `images`/`category` can be arrays, so this is
 *   not `===`. Key order must not matter either: the form rebuilds the object
 *   each render and a re-ordered but identical location is not a move.
 */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;

    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return false;
        if (a.length !== b.length) return false;
        //   Order-sensitive on purpose: images[0] is the one shown as the
        //   listing's photograph, so re-ordering them changes what a buyer sees
        //   first and is a change worth re-checking.
        return a.every((item, i) => sameValue(item, b[i]));
    }

    if (typeof a === "object" && typeof b === "object") {
        const ka = Object.keys(a as object).sort();
        const kb = Object.keys(b as object).sort();
        if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
        return ka.every((k) => sameValue((a as any)[k], (b as any)[k]));
    }

    //   Numbers arriving as strings from a form field are the same size.
    if (typeof a === "number" || typeof b === "number") {
        return Number(a) === Number(b) && String(a).trim() !== "" && String(b).trim() !== "";
    }

    return false;
}

/**
 * Which verifiable fields this patch actually changes, compared to the row.
 *
 * Returns the field names, so a caller can say WHICH claim needs re-checking
 * rather than only that one does.
 */
export function reverificationTriggers(
    stored: Record<string, any> | null | undefined,
    patch: Record<string, any> | null | undefined,
): string[] {
    if (!patch) return [];
    const row = stored ?? {};

    return VERIFIABLE_FIELDS.filter((field) => {
        //   A field the edit did not send is not a change. `undefined` is the
        //   only absence: a form clearing an optional field sends null, and
        //   null against a stored value IS a change.
        if (!(field in patch) || patch[field] === undefined) return false;
        return !sameValue(row[field], patch[field]);
    });
}

/**
 * Does this edit send the listing back for verification?
 *
 *   A listing that was never verified is unaffected either way — it is already
 *   pending, and the caller leaves its status alone.
 */
export function requiresReverification(
    stored: Record<string, any> | null | undefined,
    patch: Record<string, any> | null | undefined,
): boolean {
    return reverificationTriggers(stored, patch).length > 0;
}
