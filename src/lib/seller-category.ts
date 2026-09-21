/**
 * What a marketplace seller sells: wholesale, retail, or both.
 *
 *   THE OWNER: "select both wholesale and retail should be enabled during
 *   onboarding on marketplace."
 *
 *   The onboarding step offered the two as mutually exclusive buttons and the
 *   stored value was `"wholesale" | "retail"`, so a seller who does both had to
 *   pick the one they did less of. The account type beside it has offered
 *   buyer / seller / BOTH all along; this is the same question one field down,
 *   and it had no third answer.
 *
 * ── WHY THIS IS A SHARED MODULE AND NOT A THIRD STRING ──────────────────────
 *
 *   `sellerCategory` is not a label. It is stamped onto EVERY ONE of the
 *   seller's products (_mp_products.ts reads it back), and it is QUERIED BY
 *   EQUALITY in two places:
 *
 *       sms-broadcast.ts      q.where("sellerCategory", "==", "wholesale")
 *       in-app-broadcast.ts   q.where("sellerCategory", "==", "retail")
 *
 *   So simply allowing a third value would have made a "both" seller match
 *   NEITHER audience — dropping them out of every wholesale broadcast and
 *   every retail one at the same time. _mp_seller_verification's own comment
 *   warns about exactly this shape: "an unrecognised string removes the
 *   seller's whole catalogue from both the wholesale and the retail view at
 *   once — and nothing here would have refused it."
 *
 *   The vocabulary and the "who counts as wholesale" question therefore live
 *   together, here, so a caller cannot have one without the other.
 */

/** Every value `sellerCategory` may hold. */
export const SELLER_CATEGORIES = ["wholesale", "retail", "both"] as const;

export type SellerCategory = (typeof SELLER_CATEGORIES)[number];

/** Is this one of the values we store? */
export function isSellerCategory(value: unknown): value is SellerCategory {
    return typeof value === "string" && (SELLER_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The stored values that count as selling `kind`.
 *
 *   For a query. `"both"` belongs to each of them, which is the whole point —
 *   an equality test cannot express that and this is what replaces it:
 *
 *       q.where("sellerCategory", "in", [...sellerCategoryMatches("wholesale")])
 *
 *   Returned as an array rather than a predicate because the callers are
 *   database queries, and a predicate would have to be applied after the read.
 */
export function sellerCategoryMatches(kind: "wholesale" | "retail"): readonly SellerCategory[] {
    return [kind, "both"];
}

/**
 * How to name a category on screen.
 *
 *   The admin seller list rendered `category === "wholesale" ? "Wholesale" :
 *   "Retail"`, which is a two-answer question asked of a three-answer field —
 *   so a "both" seller would have been labelled Retail. One function, so the
 *   next screen to show this cannot reinvent that.
 */
export function sellerCategoryLabel(value: unknown): string {
    if (value === "wholesale") return "Wholesale";
    if (value === "retail") return "Retail";
    if (value === "both") return "Wholesale & Retail";
    return "";
}

/**
 * The stored value for a set of chosen kinds.
 *
 *   The onboarding step now lets a seller tick either or both, and this is
 *   where two ticks become one stored word. Null when nothing is chosen, which
 *   is what the step's own "you must choose" guard tests.
 */
export function sellerCategoryFor(
    kinds: readonly ("wholesale" | "retail")[],
): SellerCategory | null {
    const wholesale = kinds.includes("wholesale");
    const retail = kinds.includes("retail");

    if (wholesale && retail) return "both";
    if (wholesale) return "wholesale";
    if (retail) return "retail";
    return null;
}

/** The kinds a stored value represents — the inverse of `sellerCategoryFor`. */
export function kindsOf(value: unknown): readonly ("wholesale" | "retail")[] {
    if (value === "both") return ["wholesale", "retail"];
    if (value === "wholesale") return ["wholesale"];
    if (value === "retail") return ["retail"];
    return [];
}
