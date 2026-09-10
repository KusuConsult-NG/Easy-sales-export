/**
 * Turning a stored value into words, without dying on a row that has none.
 *
 *   #596 A STATUS FIELD NOBODY WROTE TOOK THE PAGE DOWN — TEN TIMES, IN TEN
 *        SPELLINGS.
 *
 *   The codebase says this everywhere:
 *
 *       {shipment.status.replace("_", " ")}
 *       {t.type.replace('_', ' ')}
 *       {order.paymentStatus.replace("_", " ")}
 *       {loan.purpose.replace('_', ' ')}
 *       {review.status.charAt(0).toUpperCase() + review.status.slice(1)}
 *
 *   Every one of those is a `.replace` on a field read straight off a stored
 *   document, inside a `.map` over a list, with no guard. A row missing that one
 *   field throws DURING RENDER — and a throw in render is not a missing badge,
 *   it is the whole screen. #581 and #589 are the same shape on `grades[0]` and
 *   on `occupation`, and this is that class again on the field almost every list
 *   row displays.
 *
 * ── HOW LIKELY, HONESTLY ────────────────────────────────────────────────────
 *
 *   LATENT, NOT FIRING TODAY, and saying otherwise would be the louder, falser
 *   finding. Every writer of COOPERATIVE_TRANSACTIONS sets `type`; every writer
 *   of PRODUCT_REVIEWS sets `status`. I checked each collection rather than
 *   assuming.
 *
 *   It is fixed anyway for the reason #589's escrow-id note gives: the
 *   consequence is total and silent — a blank page, not a blank field — and the
 *   fix costs nothing. These are also exactly the collections that acquire rows
 *   from migrations, from admin back-fills and from partial writes, which is
 *   how #563, #573 and #589 each arrived.
 *
 * ── AND ONE READING, NOT TEN ────────────────────────────────────────────────
 *
 *   #439's lesson, which this codebase keeps paying for: a rule stated by hand
 *   at every call site is a rule applied at most of them. Ten sites, and they
 *   already disagreed — some `replace("_", " ")` (the FIRST underscore only,
 *   so `pending_manual_review` came out as "pending manual_review"), some
 *   `replace(/_/g, " ")`, some upper-cased, some capitalised, some neither.
 */

/**
 * A stored status, code or category as a person reads it.
 *
 * Never throws and never returns "undefined": an absent, empty or non-string
 * value becomes `fallback`, which is an em dash by default because a blank cell
 * in a table reads as a rendering bug.
 *
 * Every underscore is replaced, not merely the first — `replace("_", " ")`
 * leaves the rest, and `pending_manual_review` came out as
 * "pending manual_review" at more than one call site.
 */
export function humanise(value: unknown, fallback = "—"): string {
    if (typeof value !== "string") return fallback;
    const words = value.trim().replace(/_/g, " ");
    return words === "" ? fallback : words;
}

/** The same, capitalised — "in transit", not "In Transit": one initial only. */
export function humaniseCapitalised(value: unknown, fallback = "—"): string {
    const words = humanise(value, fallback);
    if (words === fallback) return fallback;
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The same, upper-cased, for the badges that shout. */
export function humaniseUpper(value: unknown, fallback = "—"): string {
    const words = humanise(value, fallback);
    return words === fallback ? fallback : words.toUpperCase();
}

/**
 * A short, safe reference for an id shown to a person.
 *
 * `review.productId.slice(0, 16)` threw on a review row without one. An id is
 * exactly the kind of field a partial write leaves out, and it is exactly the
 * kind that gets shown "so support can quote it".
 */
export function shortId(value: unknown, length = 16, fallback = "—"): string {
    if (typeof value !== "string" || value.trim() === "") return fallback;
    return value.trim().slice(0, length);
}
