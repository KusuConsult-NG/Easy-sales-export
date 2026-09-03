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
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";

export async function getAdminScope(userId: string, userRoles: string[]): Promise<string | null> {
    // Super Admins and Platform Admins see everything
    if (userRoles.includes("super_admin") || userRoles.includes("admin")) return null;

    // Check if admin is restricted to a cooperative
    // We assume admins with a 'cooperativeId' in their profile are scoped.
    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const data = userDoc.data();

    // If they have a cooperativeId, they are scoped
    if (data?.cooperativeId) {
        return data.cooperativeId;
    }

    // Platform Admins (role 'admin' but no coopId) see everything
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
