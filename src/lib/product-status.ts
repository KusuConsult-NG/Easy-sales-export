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
 * THE CHOICE MADE HERE
 * --------------------
 * Whether a marketplace moderates listings before they go live is the owner's
 * call, not a detail to infer. Both creators read PRODUCT_INITIAL_STATUS, so
 * the decision is one constant in one file.
 *
 * It was "active" for exactly one reason, and that reason has expired: at the
 * time nothing could release a pending product, so holding listings would have
 * stranded them. #906 records the owner making the call the other way now that
 * the queue exists. The full reasoning is on the constant itself.
 *
 * Moderation from the other direction is unchanged: reviewProductAction still
 * suspends or rejects a live listing.
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
 *   #906 THE OWNER HAS MADE THE CALL THE HEADER ABOVE WAS WAITING FOR.
 *
 *   THE OWNER: "When a user applies to any of the modules that they list
 *   products, when they get approved as users, their content is also supposed
 *   to be approved through the content approval tab on the admin dashboard …
 *   All the content that are currently being displayed on marketplace and farm
 *   nation were displayed after the user got approved and not his content being
 *   approved."
 *
 *   That is an accurate description of what this constant did. There are TWO
 *   gates in the design and marketplace only ever ran the first:
 *
 *       gate 1  IS THIS PERSON ALLOWED TO SELL?    lib/seller-approval.ts,
 *               asked by both creators. Live, and working.
 *       gate 2  MAY THIS PARTICULAR ITEM BE SHOWN?  the content-approval
 *               console. Live for land and for export, and bypassed here.
 *
 *   The other two modules already do both. A Farm Nation listing is created
 *   `pending_verification` and an export catalogue row `pending`; each waits
 *   for a decision that writes a reviewer's id onto it. A marketplace product
 *   was published the moment its seller was approved, so the only thing
 *   standing between a fresh account and the shop floor was gate 1 — which is
 *   about the PERSON, and says nothing about what they listed.
 *
 *   THE HEADER ABOVE ARGUED FOR "active" AND THAT ARGUMENT WAS RIGHT AT THE
 *   TIME. Its reason was that no admin screen could release a pending product,
 *   so holding listings would have stranded them. That reason is gone:
 *   _getAdminProductsAction and _reviewProductAction exist, the content-approval
 *   console lists and decides products, and #853 derived its tab set from
 *   PRODUCT_MODERATION_STATUSES. The queue an approval needs is built.
 *
 *   WHAT THIS DOES NOT DO, AND MUST NOT. It does not touch a single stored row.
 *   Everything already `active` stays visible and buyable — pulling live
 *   inventory off a running marketplace is not a code change to make on
 *   somebody's behalf. What it changes is only what happens NEXT: a new listing
 *   waits for gate 2, like land and export always have.
 *
 *   The backlog that accumulated under the old rule is a separate question and
 *   it is now ASKABLE rather than invisible: every decision path stamps
 *   `approvedBy` (products, export) or `verifiedBy` (land), so live content
 *   carrying neither is live content nobody reviewed. getContentApprovalItemsAction
 *   reports that per item as `reviewed`, and the console shows it.
 */
export const PRODUCT_INITIAL_STATUS: ProductStatus = "pending";

/**
 * What a seller is told when a listing is created.
 *
 *   #906 DERIVED FROM THE CONSTANT ABOVE, not typed out beside it.
 *
 *   Three screens said "Product listed successfully" / "Product created
 *   successfully", which was true while new listings went straight to the shop
 *   floor and is a lie the moment they do not. Copy that states a behaviour has
 *   to move when the behaviour moves, or the seller is told their product is
 *   live, goes looking for it, and cannot find it — the exact complaint the
 *   header above records from the first time these two creators disagreed.
 *
 *   So the sentence is computed from the value rather than kept in step by
 *   hand, and flipping PRODUCT_INITIAL_STATUS back would carry the wording back
 *   with it.
 */
//   Widened deliberately: TypeScript narrows a `const` to its initialiser even
//   through the union annotation, so comparing the constant directly is a
//   compile error today ("no overlap") and would become one again on the other
//   value. The whole point is that this line survives the constant changing.
const INITIAL_STATUS: string = PRODUCT_INITIAL_STATUS;

export const PRODUCT_CREATED_MESSAGE: string =
    INITIAL_STATUS === "active"
        ? "Product listed successfully"
        : "Product submitted for review. It goes live once an admin approves it.";

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
 * Statuses a product can be RETIRED in — gone, not awaiting anybody.
 *
 * Named so the moderation list below can be derived by subtraction rather than
 * by another hand-written enumeration. Both are terminal: #301 and #647 record
 * that neither delete destroys the row, and #647 added `archived` to the union
 * precisely because a status the code wrote was not a status the code knew.
 */
export const PRODUCT_RETIRED_STATUSES: readonly ProductStatus[] = ["deleted", "archived"];

/**
 * Statuses the admin moderation queue accounts for.
 *
 *   #853 THE MODERATION SCREEN KEPT THE SAME FIVE-STATUS LIST TWICE, AND THE
 *   CANONICAL LIST HAS EIGHT.
 *
 *   Written out by hand in two places that must agree:
 *
 *       admin/marketplace/products/page.tsx   const TABS = [...]
 *       actions/admin/_marketplace.ts         const countable = [...]
 *
 *   — the same five strings, in the same order, in a client component and a
 *   server action. The client renders one tab per entry and reads
 *   `stats[tab]`; the server counts one status per entry. They agree today
 *   because somebody typed them identically, and nothing would fail if a later
 *   edit reached one of them: a tab whose status the server does not count
 *   simply shows no badge, and a status the server counts with no tab is a
 *   number nobody sees.
 *
 *   AND BOTH ARE A SUBSET OF PRODUCT_STATUSES, exhaustive by coincidence. That
 *   is #846's finding — two lists whose union happens to cover what the code
 *   writes — and this module has already paid for it once: #647's header
 *   records `archived` being "written by two doors and declared by neither
 *   list", which made a deleted listing read as "Active" on the seller's own
 *   page.
 *
 *   Derived by subtraction, so a status added to PRODUCT_STATUSES appears in
 *   the moderation queue BY DEFAULT — visible — instead of making every product
 *   carrying it invisible to the people whose job is to act on it. Same choice,
 *   for the same reason, as lib/module-registration-status's IN_REVIEW split
 *   and lib/module-applicant-count's `other` bucket.
 *
 *   `out_of_stock` IS INCLUDED AND THAT IS NOT AN OVERSIGHT. It is a real state
 *   a listing can be in, #647 made it visible and unsellable, and an
 *   administrator looking at the catalogue should be able to see how many are
 *   in it. Nothing writes it today, so the tab reads zero — which is a true
 *   statement about the catalogue, not noise.
 *
 *   THE RETIRED PAIR STAYS OUT, and that IS a judgement rather than a
 *   subtraction for tidiness: a deleted or archived listing is not waiting for
 *   an administrator, and PRODUCT_DECISION_LOCKED already refuses to act on
 *   `deleted`. A queue that lists rows nobody can action is the "warning nobody
 *   can act on" shape from #658.
 */
export const PRODUCT_MODERATION_STATUSES: readonly ProductStatus[] =
    PRODUCT_STATUSES.filter((s) => !PRODUCT_RETIRED_STATUSES.includes(s));

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
