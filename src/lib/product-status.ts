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
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/**
 * The status a newly created product gets, from EITHER creator.
 *
 * Change this one value to require approval before publication. See the note
 * above for why it is "active" today.
 */
export const PRODUCT_INITIAL_STATUS: ProductStatus = "active";

/** Statuses a buyer can see a product in. */
export const PRODUCT_VISIBLE_STATUSES: readonly ProductStatus[] = ["active"];

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
