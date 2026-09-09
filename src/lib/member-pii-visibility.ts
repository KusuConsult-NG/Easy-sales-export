import "server-only";

import { hasAdminPermission, type AdminPermission } from "@/lib/admin-permissions";
import { liveAdminRoles } from "@/lib/require-admin";
import { logger } from "@/lib/logger";

/**
 * May this caller be shown a member's bank details, identity numbers or
 * identity documents?
 *
 *   #535 THE DECISION THAT REVEALS A MEMBER'S ACCOUNT NUMBER AND ID PAPERS IS
 *        MADE SIXTEEN TIMES, AND FOURTEEN OF THEM ASKED THE TOKEN.
 *
 *   Sixteen admin lists hydrate a seller's, borrower's, applicant's or
 *   withdrawer's bank details — and at four of them the URLs of their ID card
 *   and business certificate, and their hashed BVN and NIN — behind a single
 *   expression:
 *
 *       const maySeeBankDetails = hasAdminPermission(<roles>, "<permission>");
 *
 *   Measured across the tree, <roles> is resolved four different ways:
 *
 *     _withdrawals.ts        gate.roles          live   (#532)
 *     _escrow_actions.ts     callerDoc.roles     live
 *     _coop_admin_money.ts   `roles`             LOOKS live, is not
 *     _coop_admin_members.ts `roles`             LOOKS live, is not
 *     ...and twelve more     session.user.roles  the JWT claim
 *
 *   #356 established what the JWT claim costs: it keeps its value for hours
 *   after the database loses it. So on fourteen of these sixteen screens, "may
 *   this person see every member's account number, ID card and BVN" was
 *   answered by a token, and a just-revoked admin kept seeing them until their
 *   session rolled over.
 *
 * ── THE TWO THAT LOOK LIVE AND ARE NOT ──────────────────────────────────────
 *
 *   _coop_admin_money and _coop_admin_members do
 *
 *       let roles = session.user.roles;
 *       if (!isAdmin(roles)) { ...read the live roles... }
 *
 *   and then comment, both of them, that "`roles` above is the LIVE set this
 *   action already resolves". It is not. The live read happens ONLY when the
 *   token is too NARROW — when the token already claims admin the database is
 *   never asked, which is exactly the revoked-admin case the pattern exists
 *   for. The fallback makes a too-small claim bigger and can never make a
 *   too-large one smaller. A comment asserting what the code does not do is
 *   worse than no comment, and both are corrected.
 *
 * ── WHY THIS IS NOT AN ACCESS GATE, AND IS NOT WRITTEN LIKE ONE ─────────────
 *
 *   A gate says who may CALL an action. This says what the RESPONSE may
 *   contain, and the two are deliberately different questions on these screens:
 *   every admin role may open the withdrawal queue, and only the roles that can
 *   pay one out may see where the money would go. #532 converted gates; this
 *   converts one field's visibility, and the call sites' own gates are untouched
 *   — they remain among the 88 files that gate on the token, which
 *   half-converted-off-the-stale-token.test.ts counts and caps.
 *
 *   Stating that plainly matters more than tidiness: this finding does NOT make
 *   those fourteen screens safe against a stale token. It makes the most
 *   sensitive FIELDS on them safe, and leaves the rest measured.
 *
 * ── FAILING CLOSED ──────────────────────────────────────────────────────────
 *
 *   Any refusal — unauthenticated, no profile, suspended, banned, not an admin,
 *   or a database read that threw — answers `false`. A list that renders without
 *   account numbers is a working screen; one that renders them because a lookup
 *   failed is the defect this exists to prevent.
 */
export async function mayRevealMemberPii(permission: AdminPermission): Promise<boolean> {
    try {
        const live = await liveAdminRoles();
        if ("error" in live) return false;
        return hasAdminPermission(live.roles, permission);
    } catch (error) {
        //   liveAdminRoles already fails closed on its own errors; this is the
        //   belt for anything it cannot catch. Logged loudly, because a screen
        //   silently losing its account numbers should be findable.
        logger.error("[member-pii] could not resolve live roles; withholding the sensitive fields", {
            permission,
            error: error instanceof Error ? error.message : String(error),
        });
        return false;
    }
}
