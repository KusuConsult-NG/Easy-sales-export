import { FARM_NATION_BUYER_ROLE, FARM_NATION_SELLER_ROLE } from "@/lib/farm-nation-roles";

/**
 * Changing what a Farm Nation member is registered as — #947.
 *
 *   THERE WAS NO DOOR AT ALL, WHICH IS WORSE THAN THE LEDGER RECORDED.
 *
 *   A member chooses buyer, seller or both at onboarding, and that choice
 *   decides what their dashboard offers — the owner's requirement, recorded in
 *   farm-nation-roles: "when users sign up as sellers they can't have buyers
 *   features on their dashboards ... and this also applies to Farm Nation."
 *
 *   The audit recorded the only edit path as
 *   `resubmitFarmNationApplicationAction`, "which writes status: pending" —
 *   implying an approved member could use it and be un-approved for their
 *   trouble. Measured, it is stricter than that: it admits only
 *   `['pending', 'rejected', 'revision_required']`, so an APPROVED member is
 *   refused outright. A farmer who joined to buy land and now wants to sell some
 *   had no path of any kind, self-service or otherwise.
 *
 * ── WHY SELF-SERVICE IS SAFE HERE, WHICH IS NOT OBVIOUS ─────────────────────
 *
 *   Gaining the seller role does not publish anything. _fn_listings writes every
 *   new listing at `status: "pending_verification"`, and the admin surface behind
 *   it is not a rubber stamp — approve-land, reject-land, land-verifications,
 *   dispatch-inspector and record-inspection, including a physical inspection.
 *
 *   So the seller role buys the ability to SUBMIT a listing for inspection. It
 *   bypasses no verification, which is what would otherwise make a member-facing
 *   role change a privilege escalation dressed as a convenience.
 *
 * ── IT ADDS AND NEVER REMOVES, AND THAT IS A DECISION ───────────────────────
 *
 *   farm-nation-roles already states the half-rule: "Callers union rather than
 *   assign, so an existing role is never removed and a re-approval is
 *   idempotent." This follows it, and the reason is stronger than consistency.
 *
 *   A member holding approved land listings who dropped the seller role would
 *   keep the listings and lose the screens that manage them: live rows, with
 *   inquiries and offers against them, belonging to somebody who can no longer
 *   answer. That is stranding, and it is the shape this audit keeps finding.
 *   Deciding what should happen to those listings is a product question about
 *   somebody's property, so narrowing is refused with a sentence rather than
 *   performed quietly.
 *
 *   A member who genuinely wants to stop selling can ask an administrator, who
 *   can see the listings. The refusal says so rather than leaving them guessing.
 */

/** What a member may be registered as. The onboarding's own three. */
export const FARM_NATION_ROLES = ["buyer", "seller", "both"] as const;
export type FarmNationRole = (typeof FARM_NATION_ROLES)[number];

/** Registration statuses that may change their own role. */
export const FARM_NATION_SETTLED_STATUSES = ["approved", "active"] as const;

export type FarmNationRoleChange =
    /** Grant these roles and store `nextRole`. */
    | { kind: "grant"; nextRole: FarmNationRole; rolesToAdd: string[] }
    /** Already holds it. Not an error — saying so is the whole answer. */
    | { kind: "no-change"; reason: string }
    /** Refused, with the sentence the member should read. */
    | { kind: "refused"; reason: string };

function isRole(value: unknown): value is FarmNationRole {
    return typeof value === "string"
        && (FARM_NATION_ROLES as readonly string[]).includes(value);
}

/**
 * The union of what they are and what they asked to be.
 *
 * buyer + seller is both; anything + both is both; a request for what they
 * already hold changes nothing.
 */
function widen(current: FarmNationRole, requested: FarmNationRole): FarmNationRole {
    if (current === requested) return current;
    return "both";
}

/**
 * What to do about this member's request to change what they are registered as.
 *
 * Pure, and takes the stored role and status rather than reading them, so a test
 * can ask it questions with known answers.
 */
export function farmNationRoleChange(account: {
    /** `serviceRegistrations.farmNation.role` as stored. */
    currentRole?: unknown;
    /** `serviceRegistrations.farmNation.status` as stored. */
    status?: unknown;
    requested: unknown;
}): FarmNationRoleChange {
    if (!isRole(account.requested)) {
        return { kind: "refused", reason: "Choose whether you want to buy, sell, or both." };
    }

    const status = typeof account.status === "string" ? account.status : "";
    if (!(FARM_NATION_SETTLED_STATUSES as readonly string[]).includes(status)) {
        /*
         *   An application still in review changes what it asked for by being
         *   resubmitted, which is what that path is for. Sending them here would
         *   grant a role the approval has not yet agreed to.
         */
        return {
            kind: "refused",
            reason: "Your Farm Nation registration is still being reviewed. "
                + "You can change what you applied for by updating your application.",
        };
    }

    /*
     *   AN ABSENT ROLE READS AS SELLER, matching farm-nation-roles exactly: "Every
     *   row approved before this rule existed was granted `farmer` outright, so
     *   defaulting to it leaves those accounts exactly as they are." Reading it as
     *   buyer here would tell a live land-owner they are not a seller.
     */
    const current: FarmNationRole = isRole(account.currentRole) ? account.currentRole : "seller";
    const nextRole = widen(current, account.requested);

    if (nextRole === current) {
        //   Includes the narrowing case: "both" asked to become "buyer" widens to
        //   "both", so it lands here rather than removing anything.
        return {
            kind: "no-change",
            reason: current === "both"
                ? "You are already registered to both buy and sell. "
                  + "To stop selling, contact support — they can see your listings first."
                : `You are already registered as a ${current}.`,
        };
    }

    const rolesToAdd: string[] = [];
    if (nextRole === "buyer" || nextRole === "both") rolesToAdd.push(FARM_NATION_BUYER_ROLE);
    if (nextRole === "seller" || nextRole === "both") rolesToAdd.push(FARM_NATION_SELLER_ROLE);

    return { kind: "grant", nextRole, rolesToAdd };
}
