/**
 * The bookkeeping a "delete" writes when it retires a record instead of
 * destroying it.
 *
 *   #301 THREE DELETE DOORS DESTROYED THE ROW WHILE THEIR OWN MODULE'S OTHER
 *        DOOR RETIRED IT.
 *
 *        Owner decision: nothing is deleted. The code gets fixed and the data
 *        stays recoverable. #300 applied that to the erasure path; this applies
 *        it to the catalogues.
 *
 *        The three were not a matter of taste, because in each case THE SAME
 *        MODULE already had a retirement convention and the destructive door
 *        ignored it:
 *
 *          EXPORT_CATALOG  deleteExportCatalogAction (the admin door) writes
 *                          { isActive: false, deletedAt, deletedBy } and the
 *                          public catalogue and the stats both filter
 *                          isActive == true. deleteExportProductAction — the
 *                          SELLER's door, on the same collection — called
 *                          .delete().
 *
 *          LAND_LISTINGS   land-listing-status.ts declares "deleted" in the
 *                          status vocabulary and its own header says "delete
 *                          sets `deleted`". No reader admits that status.
 *                          _deleteLandListingAction called .delete().
 *
 *          PRODUCTS        every buyer-facing query filters status == "active",
 *                          so a status change is all that hiding a listing has
 *                          ever needed. Both doors — the server action and
 *                          api/marketplace/delete-product — called .delete().
 *
 *        So this is the codebase's recurring shape again: more than one door
 *        onto one operation, and the door people actually use is not the
 *        hardened one.
 *
 * WHY IT MATTERS BEYOND THE PRINCIPLE
 * -----------------------------------
 * These rows are pointed AT. An order stores productIds; a land purchase
 * stores the listing id; an export order stores the catalogue id. Destroying
 * the row leaves every one of those references dangling, and this adapter does
 * not raise on a dangling reference — `update()` on a missing document is a
 * documented SILENT NO-OP (see lib/supabase-db.ts).
 *
 * The sharp end is order-management.ts, which returns stock to
 * PRODUCTS.doc(item.productId) when an order is cancelled or refunded. If the
 * seller deleted the product first, that update writes nothing, returns
 * nothing, and the cancellation reports success. The buyer is refunded, the
 * stock is not restored, and no error is raised anywhere.
 *
 * WHY THIS IS BOOKKEEPING ONLY, AND NOT A FOURTH STATUS VOCABULARY
 * ---------------------------------------------------------------
 * Because inventing one more spelling of "hidden" is how this codebase got
 * five approvable-status sets and three land vocabularies. Each call site keeps
 * ITS collection's existing hiding key — isActive for the export catalogue,
 * status "deleted" for land, status "archived" for products — and adds these
 * shared fields on top, so who retired what and when is recorded the same way
 * everywhere and there is still exactly one query that hides each collection.
 */

/**
 * Fields common to every retirement.
 *
 * `statusBeforeRetirement` is the part that makes this reversible: restoring a
 * record means putting that value back, and without it a mistaken retirement
 * could only be undone by guessing what the row used to say.
 */
export function retirementPatch(
    actorId: string,
    previousStatus?: unknown,
): Record<string, unknown> {
    return {
        retired: true,
        retiredAt: new Date().toISOString(),
        retiredBy: actorId,
        statusBeforeRetirement: previousStatus ?? null,
    };
}

/**
 * Whether a row has been retired, for the readers that do not filter on a
 * status — a seller's own product list, a seller's own export catalogue.
 *
 * Those lists query by owner and nothing else, so retiring a row would leave it
 * on the owner's screen with no way to remove it. They filter with this instead
 * of each growing its own idea of what retired means.
 */
export function isRetired(row: Record<string, any> | undefined | null): boolean {
    return row?.retired === true;
}
