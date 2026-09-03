/**
 * Which cooperative an administrator may act on.
 *
 * Returns null for platform-wide access and a cooperative id for a scoped
 * admin. Every action in cooperative/_admin.ts calls it — it was a private
 * helper there until that 1,770-line file was split by domain.
 *
 * NOT EXPORTED FROM A "use server" MODULE, DELIBERATELY
 * ----------------------------------------------------
 * Sharing it between the new domain files meant exporting it, and every export
 * of a "use server" module is a callable endpoint. Its parameters are
 * (userId, userRoles) — both of which a remote caller would then be supplying —
 * and its answer decides how much of the cooperative estate an admin screen
 * shows. An endpoint that takes the roles it is meant to check is not a check.
 *
 * A plain module cannot be called from a client. The callers pass the SESSION's
 * id and roles, as they always did.
 *
 * Same reasoning as @/lib/cooperative-provisioning (#204).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FUNCTION CURRENTLY RETURNS null FOR EVERY CALLER — #320
 * ─────────────────────────────────────────────────────────────────────────────
 * The comment that used to sit on the read below said:
 *
 *     // We assume admins with a 'cooperativeId' in their profile are scoped.
 *
 * That assumption is not met by anything. NOTHING on the server writes
 * `cooperativeId` onto a USER document — dashboard.ts established the same
 * thing for its own read of the same field, and #319 for cron/release-escrow's.
 * The only writer anywhere in the tree is JoinCooperativeModal, a client-side
 * Firebase-SDK component from before the Supabase migration. A member's
 * cooperative lives on their COOPERATIVE_MEMBERS record, not on their user row.
 *
 * So `data?.cooperativeId` is undefined, this returns null, and null means
 * unrestricted at every call site. TEN of them, across three files:
 *
 *   _coop_admin_money.ts     3 — transactions list, withdrawal approve, reject
 *   _coop_admin_reports.ts   3 — report queries
 *   _coop_admin_members.ts   4 — member list, membership status, and two more
 *
 * Each is written `if (adminScope) { ...restrict... }`, so each is skipped.
 * (The count is TEN, not nine: an eyeballed grep undercounted it, and the test
 * that counts them caught it. Membership cannot tell one call site from ten —
 * which is the same lesson three assertions in this audit have already had.)
 * That includes the guard at _coop_admin_members.ts:253, which THIS AUDIT added
 * after finding that a scoped admin could activate, approve or suspend a member
 * of any other cooperative — it is correct code that cannot currently fire.
 *
 * WHY IT IS NOT REPOINTED AT THE MEMBERSHIP RECORD HERE
 * -----------------------------------------------------
 * That is the fix #319 and dashboard.ts both used — read the fact from where it
 * actually lives. It does not transfer, for two reasons.
 *
 * First, it is the wrong fact. COOPERATIVE_MEMBERS says which cooperative
 * somebody BELONGS to. Scope is about which one they ADMINISTER. Deriving one
 * from the other assumes every cooperative admin is a member of the cooperative
 * they run, and nothing in this codebase records or requires that.
 *
 * Second, this platform is live, and the change is not safe in the direction it
 * would move. Today every cooperative_admin has platform-wide reach; making the
 * lookup succeed would narrow that, and any admin whose membership record names
 * a different cooperative — or names one at all, incidentally — would lose
 * access to the estate they currently administer. Turning a fail-open into a
 * fail-closed on a running system is not an audit's call to make silently.
 *
 * What is needed is a fact nobody has yet recorded: which cooperative each
 * cooperative_admin administers, written by a screen that does not exist. That
 * is an owner decision, raised as one. Same disposition as #167's MFA
 * enforcement and #314's session control: the false claim is corrected, the
 * inert state is pinned by a test, and the control is not invented.
 *
 * The pin is src/__tests__/unit/cooperative-admin-scope-is-inert.test.ts, and
 * it fails in BOTH directions — if a writer for the scoping fact appears, it
 * tells whoever added it to come back and re-check these ten guards.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function getAdminScope(userId: string, userRoles: string[]): Promise<string | null> {
    // Super Admins and Platform Admins see everything.
    if (userRoles.includes("super_admin") || userRoles.includes("admin")) return null;

    // The scoping read. See the note above: this field is not written by any
    // server path, so in practice this is undefined and every caller runs
    // unrestricted. Kept — not deleted — because it is the shape the scoping
    // mechanism will use once there is a writer for it, and because a legacy
    // row imported from the Firebase era may still carry the field.
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const data = userDoc.data();

    if (data?.cooperativeId) {
        return data.cooperativeId;
    }

    // No recorded scope. null is unrestricted at every call site — which is the
    // status quo for every non-platform admin role, not a considered default.
    return null;
}

/**
 * May an admin with this scope act on a record belonging to this cooperative?
 *
 * THE GUARD DEPENDED ON A FIELD MOST RECORDS DO NOT CARRY.
 *
 * Three places wrote this check inline — both withdrawal decisions in
 * _coop_admin_money.ts and the membership-status action in
 * _coop_admin_members.ts — all as:
 *
 *     if (adminScope && data?.cooperativeId && data.cooperativeId !== adminScope) {
 *         throw new Error("Unauthorized: ...another cooperative");
 *     }
 *
 * The middle conjunct is the hole. On a record with no cooperativeId the whole
 * condition is false, which reads as "allowed" — and most records have none:
 * the bulk legacy member import writes COOPERATIVE_MEMBERS rows without one,
 * and two of the three writers of cooperative_withdrawals omitted it too.
 *
 * On the withdrawal actions that is latent, because they gate on
 * finance:process_withdrawals, which only super_admin and admin hold and
 * getAdminScope returns null for. On the membership action it was LIVE: it
 * gates on cooperatives:approve_members, which cooperative_admin holds, so a
 * genuinely scoped admin could activate, approve or suspend a bulk-imported
 * member of any other cooperative.
 *
 * WHY ABSENCE IS "default" RATHER THAN A REFUSAL OR A WILDCARD
 * ------------------------------------------------------------
 * Refusing outright is the obvious fix and it is wrong. Most memberships are
 * unlabelled, so it would lock a scoped admin out of their OWN records — a
 * previous pass wrote a test pinning exactly that concern, and it was right.
 *
 * But the codebase has already named the unlabelled cooperative. Nine writers
 * spell it the same way:
 *
 *     cooperativeId: membership.cooperativeId || "default"
 *
 * — in _withdrawal.ts, _payment.ts, _coop_money.ts (twice), verify-payment,
 * withdraw, create-fixed-savings, payments/service.ts (twice). Absence already
 * MEANS "default" everywhere money is written. So it means "default" here too:
 * an admin scoped to "default" reaches those members, an admin scoped to
 * another cooperative does not, and a platform admin still reaches everything.
 *
 * That closes the cross-tenant hole without taking away any access a scoped
 * admin legitimately had, which neither failing open nor failing closed does.
 *
 * Shared rather than written at each call site because it WAS written at three
 * call sites and all three were wrong in the same way.
 */

/** What an unlabelled record's cooperative is called, per nine writers. */
export const DEFAULT_COOPERATIVE_ID = "default";

export function isWithinAdminScope(
    adminScope: string | null,
    recordCooperativeId: unknown,
): boolean {
    // Platform-wide admin: no scope to violate.
    if (adminScope === null) return true;

    const raw = typeof recordCooperativeId === "string" ? recordCooperativeId.trim() : "";
    const recordId = raw || DEFAULT_COOPERATIVE_ID;

    return recordId === adminScope;
}
