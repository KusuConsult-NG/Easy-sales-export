/**
 * What counts as a price reduction, and how long it stays an offer.
 *
 *   #867 A PRICE CUT WENT NOWHERE.
 *
 *   THE OWNER: "Promotion to slash sales for all listed product — products that
 *   get price reduction should automatically go to flash sales / hot deals, and
 *   you need to create that for Farm Nation, and ensure the section on
 *   marketplace is properly wired."
 *
 *   MEASURED. The marketplace has a Flash Sales tab, and everything in it comes
 *   from ONE source: `getActiveFlashSaleProductsAction`, which reads
 *   FLASH_SALE_PRODUCTS — rows created by a Village Market EVENT. An ordinary
 *   seller who dropped the price of an ordinary product produced nothing at
 *   all: no record that the price had moved, and no way for any screen to know
 *   it had. Farm Nation had no such section in any form.
 *
 *   THE FIELDS EXISTED AND WERE REFUSED, which is the sharp part.
 *   api/marketplace/update-product names `isFlashSale`, `originalPrice` and
 *   `flashPrice` in its blocked list, with the reason written down: a client
 *   could otherwise "present an invented discount against an invented original
 *   price". That refusal is correct and stays. It is also why this module
 *   derives the reduction from the STORED price on the server, where the
 *   previous value is a fact rather than a claim.
 *
 * ── WHAT MAKES SOMETHING A HOT DEAL, AND WHY EACH RULE IS THERE ─────────────
 *
 *   "Any product whose price ever fell" is not a promotion, it is a permanent
 *   badge on everything that was ever repriced. Three rules keep it meaningful,
 *   and all three are here rather than at the call sites, because the
 *   marketplace and Farm Nation must agree about what an offer is:
 *
 *     IT MUST BE A REAL CUT.  MIN_DISCOUNT_PERCENT — a naira off a million is
 *                             not a deal, and rounding noise from a currency
 *                             field should not light up a banner.
 *
 *     IT MUST STILL BE TRUE.  The comparison is against the price stored NOW.
 *                             A seller who cuts and then restores the price
 *                             leaves no offer behind, because `previousPrice`
 *                             is cleared on any increase.
 *
 *     IT MUST BE RECENT.      OFFER_WINDOW_DAYS. A cut made in March is not a
 *                             flash sale in September; without a window the
 *                             section fills up permanently and stops meaning
 *                             anything, which is the failure mode of every
 *                             "deals" page.
 *
 *   NOT A STORED BOOLEAN. `isFlashSale: true` written at reduction time would
 *   be a flag nothing ever clears — the window would pass and the badge would
 *   remain, and this codebase has repaired that exact shape repeatedly (#624's
 *   "a declared rule that nothing consulted"). The facts are stored; the
 *   VERDICT is computed on read, so it expires by itself with no sweep, no
 *   cron and nothing to forget to run.
 */

/** Below this, a change is repricing rather than a promotion. */
export const MIN_DISCOUNT_PERCENT = 5;

/** How long a reduction stays a hot deal. */
export const OFFER_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The fields a reduction records. Written by the server, never by a client. */
export interface PriceReductionFields {
    /** What it cost before the cut. Null once the price rises again. */
    previousPrice: number | null;
    /** When the cut was made, ISO. Null with previousPrice. */
    priceReducedAt: string | null;
}

const isPositive = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * The retail price out of a marketplace product's `pricingTiers`.
 *
 *   The two collections this module serves keep their price in different
 *   shapes: a land listing has a plain `price` on the row, and a marketplace
 *   product has an ARRAY of tiers — retail, bulk, export. The comparison has to
 *   be like for like, and retail is the one a buyer sees on the card and the
 *   one the Flash Sales section is about.
 *
 *   Reading the tier by NAME rather than by position, because the array is
 *   built conditionally — bulk and export are pushed only when the seller
 *   offers them — so `[0]` is retail today by construction and by nothing that
 *   would survive a reorder.
 */
export function retailPriceOf(tiers: unknown): number | null {
    if (!Array.isArray(tiers)) return null;

    const retail = tiers.find(
        (t) => (t as { type?: unknown })?.type === "retail",
    ) as { price?: unknown } | undefined;

    return isPositive(retail?.price) ? retail.price : null;
}

/**
 * The patch to write when a price changes.
 *
 * `previous` is the price ALREADY STORED and `next` is what is being written, so
 * a caller cannot describe a discount that did not happen. Returns `null` when
 * there is nothing to record, so a caller can spread conditionally and an
 * unchanged price writes no fields at all.
 *
 * A RISE CLEARS THE OFFER rather than leaving it. A seller who cuts a price and
 * puts it back has no promotion, and a stale `previousPrice` under a higher
 * current price would render as a negative discount.
 */
export function priceReductionPatch(
    previous: unknown,
    next: unknown,
    now: Date = new Date(),
): PriceReductionFields | null {
    if (!isPositive(next)) return null;

    //   No previous price to compare against — a first listing is not a cut.
    if (!isPositive(previous)) return null;

    /*
     *   REDUNDANT, AND KEPT ON PURPOSE — the same call kyc-validators makes
     *   about its all-same-digit line, and for the same reason.
     *
     *   Mutation testing showed this branch changes no answer: replacing it with
     *   `if (false)` failed nothing, because a rise gives the percentage below a
     *   NEGATIVE value and an unchanged price gives zero, and both are under
     *   MIN_DISCOUNT_PERCENT, so both already return the cleared record.
     *
     *   It stays because "a price that went up is not an offer" is the rule a
     *   reader looks for first, and finding it only as a consequence of
     *   arithmetic on the next line is how somebody later "simplifies" the
     *   percentage check and takes this with it. The test file records the
     *   redundancy so nobody deletes the percentage check believing this covers
     *   it.
     */
    if (next >= previous) {
        //   Cleared, not left. Includes "unchanged": re-saving a form must not
        //   extend an offer's window, or every edit renews the badge.
        return { previousPrice: null, priceReducedAt: null };
    }

    const percent = ((previous - next) / previous) * 100;
    if (percent < MIN_DISCOUNT_PERCENT) {
        //   A trivial cut is not a promotion, and it must not silently keep an
        //   older, larger one alive either.
        return { previousPrice: null, priceReducedAt: null };
    }

    return { previousPrice: previous, priceReducedAt: now.toISOString() };
}

/** How much off, as a whole percentage. 0 when the record is not an offer. */
export function discountPercent(record: unknown, currentPrice: unknown): number {
    const previous = (record as { previousPrice?: unknown } | null)?.previousPrice;
    if (!isPositive(previous) || !isPositive(currentPrice)) return 0;
    if (currentPrice >= previous) return 0;

    return Math.round(((previous - currentPrice) / previous) * 100);
}

/**
 * Is this record a live hot deal?
 *
 * Takes the record and its current price separately because the two live in
 * different places on the two collections this serves: a land listing keeps
 * `price` on the row, and a marketplace product keeps it inside `pricingTiers`.
 * Asking the caller for the number it already knows is cheaper than teaching
 * this module both shapes.
 */
export function isOnOffer(
    record: unknown,
    currentPrice: unknown,
    now: Date = new Date(),
): boolean {
    if (discountPercent(record, currentPrice) < MIN_DISCOUNT_PERCENT) return false;

    const at = (record as { priceReducedAt?: unknown } | null)?.priceReducedAt;
    if (typeof at !== "string" || !at.trim()) return false;

    const reducedAt = new Date(at).getTime();
    //   An unparseable date is not an offer. Failing closed here means a bad
    //   row drops out of the section rather than sitting in it forever.
    if (!Number.isFinite(reducedAt)) return false;

    const age = now.getTime() - reducedAt;
    //   A future timestamp is refused too — it would otherwise outlast every
    //   window.
    return age >= 0 && age <= OFFER_WINDOW_DAYS * MS_PER_DAY;
}
