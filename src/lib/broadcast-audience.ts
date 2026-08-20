/**
 * Who counts as a marketplace buyer, for a broadcast.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three channels send to the "buyers" audience, and they did not agree.
 *
 * The email path (broadcast-logic.ts) streams users and asks:
 *
 *     data.marketplaceAccountType === "buyer"
 *       || data.marketplaceAccountType === "both"
 *       || (data.roles && data.roles.includes("buyer"))
 *
 * The SMS path (sms-broadcast.ts) and the in-app path (in-app-broadcast.ts)
 * asked the database instead:
 *
 *     .where("marketplaceAccountType", "in", ["buyer", "both"])
 *
 * `marketplaceAccountType` is a top-level field that NOTHING IN THIS CODEBASE
 * WRITES. Every reference to it is a read: two queries, three `select()` lists,
 * and three defensive `||` fallbacks. So the query matched no rows, the loop
 * over the empty result did nothing, and the SMS and in-app "buyers" broadcasts
 * reached nobody — with no error and a recipient count of zero that looked like
 * an audience nobody belonged to.
 *
 * The email path survived only because of its `|| roles.includes("buyer")`
 * clause, which is doing all the work. That clause is the real definition, and
 * it now lives here where all three read it.
 *
 * WHAT THIS DOES NOT SETTLE
 * -------------------------
 * Where a buyer's account type is actually recorded. approve-seller and admin.ts
 * write `serviceRegistrations.marketplace = { status, accountType, ... }`, so
 * the value lives at `serviceRegistrations.marketplace.accountType` — and none
 * of the three channels has ever read it. admin/_users.ts already reaches for it
 * as a fallback:
 *
 *     data.marketplaceAccountType || data.serviceRegistrations?.marketplace?.accountType || data.accountType
 *
 * Adding it here would change who receives a broadcast, which is a product
 * decision about whether someone who registered as a buyer but holds no buyer
 * role should be messaged. Recorded rather than taken.
 */

/** The shape each channel already has to hand when it asks. */
export interface BroadcastAudienceUser {
    marketplaceAccountType?: string | null;
    roles?: string[] | null;
}

/**
 * The predicate the email path has always used, and the one the other two
 * channels now use too.
 *
 * `marketplaceAccountType` is kept in the test deliberately: it is the field the
 * audience was named for, and if anything ever starts writing it this keeps
 * working without a second change.
 */
export function isMarketplaceBuyer(user: BroadcastAudienceUser | null | undefined): boolean {
    if (!user) return false;

    const accountType = user.marketplaceAccountType;
    if (accountType === "buyer" || accountType === "both") return true;

    return Array.isArray(user.roles) && user.roles.includes("buyer");
}

/**
 * What "approved" means to an admin choosing a module audience.
 *
 * WHY IT IS A SET AND WHY IT LIVES HERE
 * -------------------------------------
 * The module audiences filter on `moduleStatus`, and its two interesting values
 * are opposites: "approved" and "not_approved". They were written out separately,
 * eight times over — four module audiences in sms-broadcast.ts, four more in
 * in-app-broadcast.ts — and the two arms did not agree:
 *
 *     approved      accepted approved, active, paid, completed
 *     not_approved  excluded approved and active ONLY
 *
 * So an applicant whose status is "paid" or "completed" matched BOTH. The
 * not_approved audience is the chase-up list — the one that says a payment or an
 * application is outstanding — so somebody who had paid received a message asking
 * them to pay, and appeared in the count of people who had not.
 *
 * Deriving both arms from ONE set is what stops the two drifting again, and
 * putting the set here rather than in either channel is what stops the SMS and
 * in-app answers diverging. `isMarketplaceBuyer` above exists for the same
 * reason, after the same kind of divergence reached nobody at all.
 *
 * Not applied to marketplace_onboarded, whose own filter is symmetric already
 * (approved/active on both arms) and whose statuses come from a different
 * vocabulary.
 */
export const APPROVED_MODULE_STATUSES: ReadonlySet<string> =
    new Set(["approved", "active", "paid", "completed"]);

/** True when this status means the applicant has been let in. */
export function isApprovedModuleStatus(status: string | null | undefined): boolean {
    return APPROVED_MODULE_STATUSES.has(String(status ?? ""));
}
