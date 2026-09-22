/**
 * What approving a marketplace seller grants — asked once, by both approvers.
 *
 *   #908 #844's FIX LANDED ON THE DOOR NOBODY USES.
 *
 *   THE OWNER: "Did you verify that a user who signs up as a seller only sees
 *   seller's dashboard and same applies to buyer and also if they apply as both
 *   then they see the 2 dashboards?"
 *
 *   #844 found that a `both` applicant came out able to sell and not buy, and
 *   fixed it — in `_approveMarketplaceUserAction`, the server action. There are
 *   TWO approvers:
 *
 *       actions/admin/_marketplace.ts          arrayUnion("seller",
 *         _approveMarketplaceUserAction        "marketplace_buyer") when the
 *                                              application says "both". FIXED.
 *
 *       api/admin/marketplace/approve-seller   roles: ["seller"] on create,
 *                                              arrayUnion("seller") on update.
 *                                              Never reads accountType at all.
 *
 *   AND THE ROUTE IS THE LIVE ONE. _marketplace.ts says so itself, eight lines
 *   from the fix, in a note about a different field: "the admin sellers page
 *   calls the API route, so approvals made through the UI have always written
 *   the value readers accept." So every approval an administrator has actually
 *   clicked went through the half that was never repaired.
 *
 *   WHAT THAT COSTS A `both` APPLICANT. They can sell — that is the role they
 *   were granted. Buying mostly works too, because the marketplace module gate
 *   accepts any of its four roles and the buyer nav is ungated. What they do
 *   not get is the ROLE, and the role is what the platform reads when it is
 *   describing them: the admin sellers list classifies by capability (#854, on
 *   purpose), so somebody who applied as both is filed under "Sellers Only" —
 *   a true statement about their roles and a false one about their account.
 *
 *   ONE RULE, TWO DOORS. Stated here rather than repaired twice, because
 *   repairing it twice is what produced this. #458: "two statements of one rule
 *   is the defect, not the cure."
 */

/**
 * The marketplace roles an approval grants, given what the applicant asked for.
 *
 * Returns the roles to ADD. Both callers union rather than assign, so an
 * existing role is never removed and a re-approval is idempotent — #684's
 * re-import lesson, which applies to any decision an admin can click twice.
 */
export function rolesGrantedOnSellerApproval(accountType: unknown): string[] {
    const asked = typeof accountType === "string" ? accountType.trim().toLowerCase() : "";

    /*
     *   THE OWNER: "on marketplace buyers are still having add product button
     *   and that is not supposed to be so."
     *
     *   THIS FUNCTION WAS WHY. It read: `asked === "both" ? [seller, buyer] :
     *   ["seller"]` — so "buyer" fell into the else and was granted SELLER. The
     *   comment that stood here defended it: "this door exists to approve a
     *   SELLER, and a buyer-only application does not arrive at it."
     *
     *   It does. SELLER_VERIFICATIONS holds EVERY marketplace application
     *   whatever the applicant asked to be — _mp_onboarding:211 reads
     *   `vData?.accountType` off that very row precisely because it varies — and
     *   checkModuleAccess heals from the same collection. A buyer's approved
     *   application reaches all three readers, and this rule made every one of
     *   them a seller.
     *
     *   Three cases and a default, stated rather than inferred from an else:
     *
     *     both     sell and buy
     *     buyer    buy only            <- the case that was falling through
     *     seller   sell only
     *     absent   sell only, because rows predate the field and demoting a
     *              live seller is a worse failure than the one being fixed
     */
    if (asked === "both") return ["seller", "marketplace_buyer"];
    if (asked === "buyer") return ["marketplace_buyer"];
    return ["seller"];
}

/** The three values the onboarding form can produce. */
const KNOWN_ACCOUNT_TYPES = ["buyer", "seller", "both"] as const;

/**
 * The accountType to record on the user's marketplace registration.
 *
 * The route wrote no accountType at all, so `/marketplace/dashboard` — which
 * reads exactly this field to choose which dashboard to open — had nothing to
 * read for anybody approved through the UI, and fell through to its role check.
 *
 * ── IT DOES NOT DISCARD A VALUE IT DOES NOT RECOGNISE ───────────────────────
 *
 * The first draft of this folded anything unknown to "seller", and the
 * behaviour suite caught it: an existing test approves a record carrying
 * `accountType: "wholesale"` and asserts the registration still says
 * "wholesale".
 *
 * That test is right and the draft was wrong. `serviceRegistrations` is a
 * record of what somebody applied for, and rewriting a value because this
 * function has not heard of it is exactly the kind of quiet loss this audit
 * keeps finding — the owner asks for "the true representation of the data".
 * The read side already degrades safely: /marketplace/dashboard branches on
 * the three known values and falls through to the ROLES for anything else,
 * which is a better answer than a guess written into the database.
 *
 * So: the three known values are normalised (" Both " and "both" are one
 * application), anything else is preserved as stored, and the default applies
 * only when there is nothing there at all.
 */
export function accountTypeOnSellerApproval(accountType: unknown): string {
    if (typeof accountType !== "string" || !accountType.trim()) return "seller";

    const trimmed = accountType.trim();
    const lowered = trimmed.toLowerCase();

    return (KNOWN_ACCOUNT_TYPES as readonly string[]).includes(lowered) ? lowered : trimmed;
}
