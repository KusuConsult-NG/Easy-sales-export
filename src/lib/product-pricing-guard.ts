/**
 * Whether a product's numbers are ones it can actually be sold at.
 *
 *   #794 ONE OF THE TWO PRODUCT-CREATION DOORS CHECKED THIS. THE OTHER DID NOT.
 *
 *   /marketplace/products/add posts to /api/marketplace/create-product, which
 *   has carried this check for some time. /marketplace/sell/create calls
 *   createProductAction, which validates with ProductSchema — where
 *   PricingTierSchema is `price: z.number().default(0)` and availableQuantity is
 *   `z.number().default(0)`, neither bounded below.
 *
 *   MEASURED, by running the schema rather than reading it:
 *
 *       ACCEPTED  negative retail price  -> price -5000
 *       ACCEPTED  negative stock         -> qty -99
 *       rejected  Infinity price                (z.number() refuses non-finite)
 *
 * ── WHAT IT COSTS, STATED ACCURATELY ────────────────────────────────────────
 *
 *   NOT theft, and the first draft of this finding said it was. Three guards
 *   downstream already close that: validateCartItems refuses a non-positive
 *   stored price and a non-positive quantity, and checkOrderAmountBounds fails
 *   closed on a negative total (#112). village-market.ts guards its own writer
 *   and its comment names this exact residue — "the one place a non-positive
 *   price gets written: PricingTierSchema is z.number().default(0)".
 *
 *   What it costs is a LISTING NOBODY CAN BUY. The product is created, appears
 *   in the catalogue, and every checkout that includes it throws "Invalid price
 *   for <product>". The buyer sees an error naming a product they did not do
 *   anything wrong with, and nothing tells the seller their listing is broken.
 *
 * ── WHY THE FIX IS NOT "TIGHTEN THE SCHEMA" ─────────────────────────────────
 *
 *   That was the obvious move and it would have been a serious regression.
 *   ProductSchema is ALSO the read path: firestore-serialize derives
 *   LenientProductSchema from it with lenientObject, which wraps each field in
 *   `.catch(default)`. So a tier the schema rejects does not fail one tier — it
 *   drops the WHOLE `pricingTiers` array back to its default,
 *   `[{ type: "retail", price: 0, minQuantity: 1 }]`.
 *
 *   Measured, with a real shape — retail 5,000 and a bulk tier the seller left
 *   blank at 0:
 *
 *       today (loose)  [{"retail",5000},{"bulk",0}]
 *       if tightened   [{"retail",0}]            ← the ₦5,000 is gone
 *
 *   Tightening the shared schema would have shown live products as FREE across
 *   the catalogue. The healing is deliberate and stays; the bound belongs at the
 *   doors that WRITE, which is where the API route already had it.
 *
 *   So it is extracted rather than copied. Two doors that each carry their own
 *   copy of one rule is how this module's creators already drifted twice —
 *   ProductSchema's own comments record certifications being dropped by one
 *   door and the initial status diverging between them.
 */

/** A number this platform will let somebody trade on. */
export interface PricingCheck {
    /** Label as a person would say it: "retail price", "stock quantity". */
    label: string;
    value: number;
    /**
     * True when 0 means "not offered" rather than "free".
     *
     * Bulk and export tiers default to 0 when a seller does not offer them, and
     * the creators only push a tier when the corresponding flag is set — so 0
     * there is an absence, not a price. A RETAIL price of 0 is not: every
     * product has one, and checkout refuses a non-positive stored price, so a
     * zero retail price is a listing that cannot be bought.
     */
    zeroMeansAbsent?: boolean;
}

export interface PricingVerdict {
    ok: boolean;
    /** Ready to show a seller; empty when ok. */
    message: string;
}

/**
 * Check every number a product is listed on.
 *
 * Returns the FIRST failure, because a seller fixes one field at a time and a
 * list of five complaints about one typo is worse than the one that matters.
 */
export function checkProductPricing(fields: readonly PricingCheck[]): PricingVerdict {
    for (const { label, value, zeroMeansAbsent } of fields) {
        /*
         *   Truthiness is not a range check, which is what the API route's own
         *   note says: `!value` rejects exactly 0 and NaN, and accepts -100.
         *   Infinity passes it too — parseCurrencyStringToFloat is parseFloat
         *   underneath, so "1e400" yields Infinity, every total computed from it
         *   is Infinity, and JSON.stringify writes that as null.
         */
        if (!Number.isFinite(value)) {
            return { ok: false, message: `The ${label} must be a number.` };
        }
        if (value < 0) {
            return { ok: false, message: `The ${label} cannot be negative.` };
        }
        if (value === 0 && !zeroMeansAbsent) {
            return { ok: false, message: `The ${label} must be greater than zero.` };
        }
    }
    return { ok: true, message: "" };
}
