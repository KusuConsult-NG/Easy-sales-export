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
