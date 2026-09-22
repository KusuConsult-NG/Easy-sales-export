/**
 * Did anybody actually decide this listing?
 *
 *   #906 THIS LIVES IN A LIB BECAUSE actions/admin-content.ts CARRIES
 *   "use server", AND THAT IS A REAL CONSTRAINT RATHER THAN TIDINESS.
 *
 *   Every export from a "use server" module is a SERVER ACTION — an
 *   independently addressable endpoint, which is the property that made
 *   autoEnrollPaidUser a paid-content bypass. A synchronous predicate exported
 *   from there is not an action at all, and the repo's own ratchet said so:
 *
 *       🚨 1 server action(s) reach no authorisation guard:
 *            app/actions/admin-content.ts::wasReviewed
 *
 *   Baselining it would have been wrong twice: it is not a public action, and
 *   the file it sat in is what turned it into a door. Here it is a function.
 *
 * ── WHAT IT ANSWERS ─────────────────────────────────────────────────────────
 *
 *   THE OWNER: "All the content that are currently being displayed on
 *   marketplace and farm nation were displayed after the user got approved and
 *   not his content being approved."
 *
 *   Accurate, and until now unanswerable from the console. The approved tab
 *   listed everything purchasable and said nothing about how it got there — a
 *   listing an admin released and a listing that was never held in the first
 *   place rendered identically, under a panel reading "This content has been
 *   fully verified and approved".
 *
 *   Every decision path stamps its reviewer, so the ABSENCE of all of them is
 *   the fact the owner is describing — recorded at the time by the code that
 *   made the decision, rather than inferred afterwards.
 *
 *   FALSE IS NOT AN ACCUSATION. Under the old rule (PRODUCT_INITIAL_STATUS
 *   "active", see lib/product-status) a listing went live correctly, and with
 *   nobody reviewing it. This says which ones, so an administrator can work
 *   through them — not that anything was done wrong.
 */

/**
 * The fields a decision writes, across all three collections.
 *
 * ONE LIST rather than a test per type, because these three types are decided
 * by four different code paths — approveContentAction, rejectContentAction,
 * _reviewProductAction and the farm-nation admin routes — and they do not share
 * a field name. Reading only `approvedBy` would report every land listing an
 * admin verified as never reviewed, which is a worse lie than the one being
 * fixed.
 */
export const REVIEWER_FIELDS = ["approvedBy", "verifiedBy", "reviewedBy", "rejectedBy"] as const;

/** Did anybody decide this document? */
export function wasReviewed(data: Record<string, any> | null | undefined): boolean {
    if (!data) return false;
    return REVIEWER_FIELDS.some((f) => {
        const v = data[f];
        //   An empty string is what a blank admin id leaves behind, and it is
        //   not a decision.
        return typeof v === "string" ? v.trim().length > 0 : v != null;
    });
}
