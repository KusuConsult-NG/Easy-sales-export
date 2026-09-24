/**
 * One listing per submission, decided by the document id.
 *
 *   THE OWNER: "Listing a product was create twice but was only listed once."
 *
 * ── WHAT WAS THERE ──────────────────────────────────────────────────────────
 *
 *   Both product creators built their own id the same way:
 *
 *       const productId = `product_${userId}_${Date.now()}`;
 *
 *   A clock reading is not an identity. It says WHEN a request reached the
 *   server, which is the one thing that differs between a submission and its
 *   accidental twin — so two deliveries of the SAME listing got two ids and
 *   became two rows, and `.set()` had nothing to object to.
 *
 *   Both forms do disable their button while submitting. That is worth having
 *   and it is not a guarantee: a form post that is retried by the browser, a
 *   connection that drops after the write and before the response, an Enter
 *   keypress landing before React re-renders, or any caller at all — these are
 *   "use server" exports and an HTTP route, so the client is not the only way
 *   in. A guard that lives only in the browser cannot bind a request that never
 *   came through the browser; lib/marketplace-application records the same
 *   argument about a Continue button.
 *
 *   THE "ONLY LISTED ONCE" HALF follows from the duplicate rather than
 *   contradicting it: a new listing is held at PRODUCT_INITIAL_STATUS for
 *   review, an admin approves the one in front of them, and its twin stays in
 *   the queue. So the seller has two records and one listing, which is exactly
 *   what was reported.
 *
 * ── WHAT THIS DOES INSTEAD ──────────────────────────────────────────────────
 *
 *   The FORM decides the id, once, when it is opened. Every delivery of that
 *   one submission therefore addresses one document, and the collection's
 *   primary key does the deduplication — no second table, no migration, and no
 *   window between a check and a write for two requests to slip through: if
 *   both race, they race for the same row.
 *
 *   AND A SECOND DELIVERY IS A REPLAY, NOT AN OVERWRITE. The creators read the
 *   id first and, finding it taken, report success on the listing that already
 *   exists rather than writing over it. That matters beyond tidiness: a seller
 *   who kept a submission id could otherwise post it again months later and
 *   reset a suspended or archived listing back to a fresh pending one, which is
 *   the moderation escape hatch #906 closed from the other side.
 *
 *   A FAILED SUBMISSION BURNS NOTHING. Nothing is written until the listing
 *   passes validation, so a member who is refused for a bad price and corrects
 *   it submits the same id and succeeds. The export window modal learned this
 *   the hard way: it claimed its idempotency key before the compliance checks,
 *   so failing KYC left the member holding a key that said "duplicate
 *   transaction, please wait" forever.
 *
 *   NO SUBMISSION ID, NO CHANGE. The old clock-based id is still the fallback,
 *   so any caller that does not send one behaves exactly as it did.
 */

/** The form field carrying the id. One spelling, for four files. */
export const SUBMISSION_ID_FIELD = "submissionId";

/**
 * The characters a submission id may contribute to a document id.
 *
 * These ids end up as a primary key and inside storage paths
 * (`products/${userId}/${productId}/...`), so a client-supplied value is
 * filtered rather than trusted: anything outside this set is dropped, and a
 * value with nothing left is treated as absent.
 */
const SAFE = /[^A-Za-z0-9-]/g;

/** How much of a submitted id is kept. A UUID is 36 characters. */
const MAX_LENGTH = 40;

/** The usable part of a client-supplied submission id, or "" if there is none. */
export function cleanSubmissionId(value: unknown): string {
    if (typeof value !== "string") return "";
    return value.replace(SAFE, "").slice(0, MAX_LENGTH);
}

/**
 * The document id for this listing.
 *
 * Namespaced by the seller, so one member's submission id can never address
 * another member's product however it was chosen.
 */
export function productDocumentId(userId: string, submissionId: unknown): string {
    const clean = cleanSubmissionId(submissionId);
    //   The original id, kept as the fallback so a caller that sends nothing is
    //   affected in no way at all.
    return `product_${userId}_${clean || Date.now()}`;
}

/**
 * True when a submission id was supplied and is usable.
 *
 * The creators check this before deciding whether a taken id means "this is a
 * replay" — without one the id is a clock reading, and a collision there is a
 * coincidence rather than a repeat of the same submission.
 */
export function hasSubmissionId(value: unknown): boolean {
    return cleanSubmissionId(value).length > 0;
}
