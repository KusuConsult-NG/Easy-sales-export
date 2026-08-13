/**
 * What a stranger may see of a land listing.
 *
 * WHY THIS IS A SHARED MODULE
 * ---------------------------
 * It already existed, as two local constants and a helper inside
 * src/app/actions/land-actions.ts, with a comment saying exactly why they were
 * needed:
 *
 *     A land listing is public once it has been verified — browsing farmland
 *     for sale is the point of the module. Everything else is a review queue:
 *     pending_verification, rejected, deleted. Those documents carry the
 *     admin's verificationNotes and rejectionReason, the owner's id and email,
 *     and they belong to people who have not agreed to be listed anywhere yet.
 *
 * /api/farm-nation/listings — which has no authentication, and feeds /land and
 * /farm-nation/map — did:
 *
 *     const data = doc.data();
 *     return { id: doc.id, ...data, ... };
 *
 * So the reasoning was written down, implemented once, and the public endpoint
 * spread the whole document anyway. The same shape as the export catalogue, the
 * quiz answer key, and the approval audit entries: the correct implementation
 * exists and one path does not reach it.
 *
 * THE TWO DEFINITIONS ALSO DISAGREED
 * ----------------------------------
 * The action treats "verified" and "approved" as publicly visible; the route
 * queried "verified" alone. A listing an admin marked approved was public to
 * one half of the platform and invisible to the other.
 */

/**
 * Statuses a stranger may see.
 *
 * Everything else is a review queue.
 */
export const PUBLIC_LAND_STATUSES: readonly string[] = ["verified", "approved"];

/**
 * Fields that exist for the review process and are nobody else's business.
 *
 * `verifiedBy` is an admin's user id. `rejectionReason` and `verificationNotes`
 * are internal review text — and since a listing that was rejected and later
 * approved now carries its earlier decision forward, a verified listing can
 * hold both.
 */
export const INTERNAL_LAND_FIELDS: readonly string[] = [
    "verificationNotes",
    "rejectionReason",
    "verifiedBy",
    "ownerEmail",
    "previousOwnerId",
];

/**
 * Returns a copy without the internal fields.
 *
 * A copy, not a mutation: the document read from the database is also what the
 * admin views are built from, and those need the fields this removes.
 */
export function stripInternalLandFields<T extends Record<string, any>>(listing: T): T {
    const copy: Record<string, any> = { ...listing };
    for (const field of INTERNAL_LAND_FIELDS) delete copy[field];

    // The nested object too. approve-land and reject-land write the decision
    // under verificationStatus, so removing only the top-level keys leaves the
    // same information one level down.
    if (copy.verificationStatus && typeof copy.verificationStatus === "object") {
        const nested: Record<string, any> = { ...copy.verificationStatus };
        for (const field of INTERNAL_LAND_FIELDS) delete nested[field];
        copy.verificationStatus = nested;
    }

    return copy as T;
}
