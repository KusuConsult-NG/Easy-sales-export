/**
 * What a stranger may see of a marketplace seller.
 *
 * WHY THIS IS A SHARED MODULE
 * ---------------------------
 * This projection existed once, inline in /api/marketplace/sellers/[sellerId],
 * and #105 needed a second reader: the buyer's saved-sellers list shows the
 * same business name, badge, location and logo for each seller kept.
 *
 * Copying the object literal would have produced the shape this codebase keeps
 * having to unpick — two statements of one rule that drift, and the drift is
 * always a field appearing on the door nobody was looking at. The seller
 * verification document this reads from carries the seller's own bank details,
 * their identity-document URLs and the admin's review notes, so a projection
 * that grows a field by accident is a PII leak, not a cosmetic difference.
 *
 * It is an ALLOW-LIST, never a spread. `{ id, ...verData }` would publish the
 * whole verification record, which is #338 and #341 exactly.
 *
 * This module is pure and imports nothing.
 */

export interface PublicSellerSummary {
    /** The verification document's id. */
    id: string;
    /** The seller's user id — what a link and a saved row point at. */
    userId: string;
    businessName: string;
    businessDescription: string;
    businessType: string;
    state: string;
    isVerifiedBadge: boolean;
    logoUrl: string | null;
    approvedAt: string | null;
}

function text(...candidates: unknown[]): string {
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
    }
    return "";
}

/**
 * When a value can be a Firestore Timestamp, an ISO string or a Date.
 *
 * The route wrote `verData.approvedAt?.toDate?.()?.toISOString() ?? null`,
 * which is null for every row whose writer stored an ISO string — and this
 * codebase has writers of both shapes for the same field, which is the split
 * exportWindowEndDate and reservationStartedAt each handle in their own module.
 */
function isoOrNull(value: unknown): string | null {
    if (value === null || value === undefined || value === "") return null;

    const raw = typeof (value as { toDate?: () => Date }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : (value as string | number | Date);

    const d = new Date(raw as string);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Project one approved seller verification document for public display.
 *
 * @param verificationDocId the verification document's own id
 * @param sellerUserId      the seller's user id
 * @param verData           the raw verification document
 */
export function publicSellerSummary(
    verificationDocId: string,
    sellerUserId: string,
    verData: Record<string, unknown> | null | undefined,
): PublicSellerSummary {
    const data = verData ?? {};
    return {
        id: verificationDocId,
        userId: sellerUserId,
        businessName: text(data.businessName),
        businessDescription: text(data.businessDescription, data.bio),
        businessType: text(data.businessType),
        state: text(data.state, data.location),
        // `=== true` alone would drop the badge from any row that stored it as
        // the string "true" — the raw_data JSONB round-trip this adapter does
        // makes that shape reachable, and the route's `?? false` accepted it.
        isVerifiedBadge: data.isVerifiedBadge === true || data.isVerifiedBadge === "true",
        logoUrl: text(data.logoUrl, data.businessLogo) || null,
        approvedAt: isoOrNull(data.approvedAt),
    };
}
