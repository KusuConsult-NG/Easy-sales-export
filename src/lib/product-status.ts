/**
 * Marketplace product status — one vocabulary, and one answer for a new listing.
 *
 * THE DEFECT THIS EXISTS FOR
 * -------------------------
 * There were TWO product creators and they disagreed about whether a new listing
 * is visible:
 *
 *   createProductAction              status: "pending"
 *     used by /marketplace/sell/create — the "Add your first product"
 *     destination linked from the seller products page (three times), the seller
 *     dashboard, seller analytics and the products page. Six entry points.
 *
 *   POST /api/marketplace/create-product   status: "active"
 *     used by /marketplace/products/add
 *
 * And ProductSchema defaults to a third value, "draft", which no writer sets.
 *
 * Every buyer-facing reader filters on exactly `status == "active"` —
 * _mp_catalog.ts in three places, _buyer.ts in three more. So a product created
 * through the primary seller path was invisible to every buyer.
 *
 * NOTHING RELEASED IT
 * -------------------
 * There is no admin screen or action anywhere that approves a product.
 * admin-content.ts COUNTS pending/active/rejected products, so the admin
 * dashboard displayed a growing pending figure with no way to act on it. The
 * only route out of "pending" was POST /api/marketplace/update-product, which
 * accepted any field a seller sent — so the state was simultaneously a dead end
 * for honest sellers and no obstacle at all to anyone who found that endpoint.
 * (That route is now whitelisted; `status` is not on the list.)
 *
 * So: six links pointed sellers at a form that produced a listing no buyer could
 * see and no admin could release.
 *
 * THE CHOICE MADE HERE, AND HOW TO REVERSE IT
 * -------------------------------------------
 * Whether a marketplace moderates listings before they go live is the owner's
 * call, not a detail to infer. Both creators now read PRODUCT_INITIAL_STATUS, so
 * the decision is one constant in one file.
 *
 * It is set to "active" because that is the NON-BREAKING direction. The path
 * that works today (/marketplace/products/add) publishes immediately; setting
 * this to "pending" would stop those products appearing until an admin acted,
 * which would break something that currently works in order to enforce a policy
 * that was never implemented. Setting it to "active" changes nothing that works
 * and fixes what does not.
 *
 * Moderation is still available and is now actually possible: reviewProductAction
 * suspends or rejects a live listing, and releases the pending backlog. If the
 * owner wants approval BEFORE publication, change the constant below — the
 * admin queue, the transitions and the tests are already in place for it.
 *
 * TWO DECLARED STATUSES NOBODY WRITES
 * -----------------------------------
 * "draft" is the ProductSchema default and no writer sets it. "out_of_stock" is
 * declared and no writer of the products collection sets it either — the buyer
 * page computes it client-side for flash-sale rows only. Both are left in the
 * union because a stored document could carry them, and PRODUCT_VISIBLE_STATUSES
 * decides what buyers see rather than each reader hand-writing "active".
 *
 * Worth naming: because every reader tests "active" alone, a product marked
 * out_of_stock would vanish from the marketplace entirely rather than showing as
 * out of stock. Nothing writes that status today, so this is a latent problem
 * rather than a live one, and it is not fixed here — doing so means deciding how
 * an out-of-stock listing should present, which is a product question.
 */

export const PRODUCT_STATUSES = [
    "draft",
    "pending",
    "active",
    "rejected",
    "suspended",
    "out_of_stock",
    "deleted",
    /**
     *   #647 WRITTEN BY TWO DOORS AND DECLARED BY NEITHER LIST.
     *
     *   Both product deletes retire the row rather than destroying it — #301
     *   fixed that pair together — and both write `status: "archived"`, which
     *   was in neither this union nor ProductSchema.
     *
     *   So a status the code writes was not a status the code knew. The seller's
     *   own products page reads it through `configs[status] || configs.active`
     *   and labelled a deleted listing "Active"; the schema's enum rejected it,
     *   and the healing parse handed the screens the DEFAULT — "draft" — for a
     *   row that says archived.
     *
     *   Declared here, not sellable, not visible. Nothing about what is stored
     *   changes; what changes is that the rest of the code can now say what it
     *   is looking at.
     */
    "archived",
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * The status a newly created product gets, from EITHER creator.
 *
 * Change this one value to require approval before publication. See the note
 * above for why it is "active" today.
 */
export const PRODUCT_INITIAL_STATUS: ProductStatus = "active";

/**
 * Statuses a buyer can see a product in.
 *
 *   #624 THIS WAS A DECLARED RULE THAT NOTHING CONSULTED.
 *
 *        `isVisibleProductStatus` had ZERO callers, and every buyer-facing read
 *        hand-wrote `where("status", "==", "active")` instead — fifteen copies
 *        across four files. So the one place that states what a buyer may see
 *        decided nothing, and changing it changed nothing: exactly the shape of
 *        #618's silo rule, which only drew sidebar links, and #623's
 *        `finance:refund`, which gated no door.
 *
 *        All fifteen ask this list now. The VALUE is unchanged, so no buyer
 *        sees anything today that they did not see yesterday — what changes is
 *        that the next edit to this line reaches the marketplace.
 *
 *   AND `out_of_stock` STAYS OUT, DELIBERATELY, WITH ITS REASON.
 *
 *        The note above records that a product marked out_of_stock vanishes
 *        from the marketplace rather than showing as unavailable. Adding it
 *        here would now genuinely change what buyers see — and that would be
 *        WORSE, not better, until the product card and the checkout say "out of
 *        stock" and refuse the purchase. A listing a buyer can add to a basket
 *        and pay for, which cannot be fulfilled, is a bigger defect than one
 *        that is hidden.
 *
 *        Nothing writes out_of_stock today, so the trap is latent. Making this
 *        list real is what turns finishing it into a one-line change here plus
 *        the presentation, instead of a fifteen-site sweep.
 *
 *   #647 AND THAT IS DONE, SO out_of_stock IS IN THE LIST NOW.
 *
 *        The condition #624 set was a checkout that refuses. There is one:
 *        validateCartItems consults PRODUCT_SELLABLE_STATUSES below, before the
 *        buyer is sent to Paystack, and out_of_stock is not in it. So the pair
 *        lands together, which is what that note asked for.
 *
 *        The PRESENTATION was already written and could never fire. All three
 *        product cards and the detail page test `status === "out_of_stock"` —
 *        and every query that could have produced such a row filtered it out
 *        first. A rule nothing consults was #624; a treatment nothing can reach
 *        is the same defect seen from the other end.
 *
 *        Nothing writes the status even now, so no buyer sees anything today
 *        that they did not see yesterday. What changes is that the day somebody
 *        does write it, the listing shows as unavailable instead of vanishing.
 */
export const PRODUCT_VISIBLE_STATUSES: readonly ProductStatus[] = ["active", "out_of_stock"];

/**
 * Statuses a buyer can BUY a product in.
 *
 *   #647 NOTHING ASKED THIS QUESTION AT ALL.
 *
 *        #624 made the VISIBLE rule real across fifteen catalogue queries. Not
 *        one purchase door consulted anything: `validateCartItems` — the
 *        function every marketplace order passes through — read the product
 *        document to take the price from it and never looked at its status.
 *
 *        So an admin suspending a counterfeit listing removed it from the browse
 *        results and left it for sale. The cart lives in localStorage and is
 *        never re-read against the database, and the product page serves any id
 *        whatever its status, so a shared link kept selling it.
 *
 *        VISIBLE AND SELLABLE ARE GENUINELY DIFFERENT QUESTIONS, which is why
 *        this is a second list rather than a reuse of the first: out_of_stock is
 *        visible and unbuyable, and that combination is the whole point of it.
 *        The reverse — sellable but invisible — has no meaning, and the test
 *        pins that direction shut.
 */
export const PRODUCT_SELLABLE_STATUSES: readonly ProductStatus[] = ["active"];

/**
 * Flash-sale rows are a DIFFERENT COLLECTION with a different vocabulary.
 *
 * village-market writes `status: "active"` on create and `status: "removed"`
 * when a seller pulls an item — "removed" is not a ProductStatus and never was.
 * The two sets agree today at one value; they are stated separately because
 * they are maintained by different code, and assuming they agree is how a
 * removed flash-sale item stayed purchasable.
 */
export const FLASH_SALE_SELLABLE_STATUSES: readonly string[] = ["active"];

/** May a buyer put this product in an order? */
export function isSellableProductStatus(status: unknown): boolean {
    return PRODUCT_SELLABLE_STATUSES.includes(String(status) as ProductStatus);
}

/** May a buyer put this flash-sale row in an order? */
export function isSellableFlashSaleStatus(status: unknown): boolean {
    return FLASH_SALE_SELLABLE_STATUSES.includes(String(status));
}

/** A live listing can be pulled; a pending or rejected one can be released. */
export const PRODUCT_APPROVABLE_FROM: readonly ProductStatus[] = [
    "draft",
    "pending",
    "rejected",
    "suspended",
];

/** What an admin can reject or suspend from. */
export const PRODUCT_REJECTABLE_FROM: readonly ProductStatus[] = [
    "draft",
    "pending",
    "active",
];

/** Statuses an admin review can no longer act on. */
export const PRODUCT_DECISION_LOCKED: readonly ProductStatus[] = ["deleted"];

export function isVisibleProductStatus(status: unknown): boolean {
    return PRODUCT_VISIBLE_STATUSES.includes(String(status) as ProductStatus);
}

/**
 * Normalises a stored value onto the union.
 *
 * "live" is what the EXPORT catalog calls the same idea (see
 * reviewExportProductAction), and the two vocabularies have been mixed up
 * before — #26 found five disagreeing status sets in the land module for the
 * same reason. Mapping it is cheaper than the bug.
 */
export function normaliseProductStatus(status: unknown): ProductStatus | null {
    const raw = String(status ?? "").trim().toLowerCase();
    if (!raw) return null;
    if (raw === "live" || raw === "published") return "active";
    if (raw === "inactive" || raw === "unpublished") return "suspended";
    return (PRODUCT_STATUSES as readonly string[]).includes(raw) ? (raw as ProductStatus) : null;
}
