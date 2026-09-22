/**
 * What a Farm Nation registration grants — asked once, by every door.
 *
 *   THE OWNER: "when users sign up as sellers they can't have buyers features
 *   on their dashboards ... and this also applies to Farm Nation."
 *
 *   THE QUESTION WAS ALREADY BEING ASKED, AND THEN THROWN AWAY.
 *
 *   The onboarding has a dedicated step for it — `role: z.enum(["buyer",
 *   "seller", "both"])` — and derived the right roles from it:
 *
 *       if (role === "buyer"  || role === "both") roles.push("investor");
 *       if (role === "seller" || role === "both") roles.push("farmer");
 *
 *   Then `_fn_admin`'s approval wrote `roles: ["farmer"]` on create and
 *   `arrayUnion("farmer")` on update — UNCONDITIONALLY, reading nothing. So an
 *   applicant who said "buyer", and was correctly given `investor` at
 *   onboarding, was handed `farmer` — a SELLER role — the moment an
 *   administrator approved them. The module's own answer, overwritten by the
 *   screen that was supposed to confirm it.
 *
 *   This is the marketplace defect exactly: checkModuleAccess Layer 2.11 also
 *   granted `seller` without reading `accountType`. Two modules, one shape —
 *   a door that grants capability without asking what was applied for.
 *
 *   ONE RULE, EVERY DOOR. Stated here rather than repaired at each site,
 *   because repairing it at each site is what produced it. #458: "two
 *   statements of one rule is the defect, not the cure."
 */

/** Buys land and invests — the Farm Nation buyer. */
export const FARM_NATION_BUYER_ROLE = "investor";

/** Lists and operates land — the Farm Nation seller. */
export const FARM_NATION_SELLER_ROLE = "farmer";

/**
 * The roles to ADD, given what the applicant asked to be.
 *
 * Callers union rather than assign, so an existing role is never removed and a
 * re-approval is idempotent.
 *
 * AN ABSENT ROLE KEEPS TODAY'S SELLER DEFAULT. Every row approved before this
 * rule existed was granted `farmer` outright, so defaulting to it leaves those
 * accounts exactly as they are. Demoting a live land-owner to fix a
 * classification bug would be a worse failure than the one being fixed — the
 * same judgement, for the same reason, as the marketplace rule's.
 */
export function rolesForFarmNationRole(role: unknown): string[] {
    const asked = typeof role === "string" ? role.trim().toLowerCase() : "";

    if (asked === "both") return [FARM_NATION_SELLER_ROLE, FARM_NATION_BUYER_ROLE];
    if (asked === "buyer") return [FARM_NATION_BUYER_ROLE];
    return [FARM_NATION_SELLER_ROLE];
}
