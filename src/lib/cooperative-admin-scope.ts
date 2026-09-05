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
 * That assumption is not met by anything. NOTHING anywhere writes
 * `cooperativeId` onto a USER document — dashboard.ts established the same
 * thing for its own read of the same field, and #319 for cron/release-escrow's.
 * A member's cooperative lives on their COOPERATIVE_MEMBERS record, not on
 * their user row.
 *
 * #385 CORRECTS WHAT THIS COMMENT USED TO SAY. It named one writer —
 * JoinCooperativeModal — and described it as "a client-side Firebase-SDK
 * component from before the Supabase migration". Every part of that was wrong:
 * the write went through the Supabase adapter, it ran inside a server function,
 * and `git log -S` shows the file never at any commit imported firebase. I
 * repeated the description in the #248 pass instead of reading the file. That
 * modal has since been fixed — it wrote a savings balance nobody had paid — and
 * with it gone the count of writers is ZERO, which the ratchet in
 * cooperative-admin-scope-is-inert.test.ts now pins.
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
 * cooperative_admin administers, written by a screen that does not exist.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * #248 — THE DECISION: COOPERATIVE ADMINS ARE NOT SCOPED
 * ─────────────────────────────────────────────────────────────────────────────
 * #320 raised "should they be, and by what fact?" as an owner decision. Taken,
 * and the answer is no. Three measurements, each checkable:
 *
 * 1. THERE IS ONE COOPERATIVE AND NO WAY TO CREATE A SECOND. Nothing in src
 *    writes to COLLECTIONS.COOPERATIVES — no add, no set, anywhere. Every read
 *    of that collection is the LEGACY nested Firebase-era path
 *    (cooperatives/{id}/members/{uid}), kept for members whose records predate
 *    the root collection. joinCooperativeAction, the one action that requires a
 *    cooperative document to exist, has no caller: every mention of it in the
 *    tree is a comment about the row shape it produces. What the live flow
 *    actually uses is a constant — _dashboard.ts synthesises
 *    `cooperativeId: "easy-sales-cooperative"`, and four other sites fall back
 *    to the literal "default". Scoping partitions an estate of one.
 *
 * 2. THE ROLE IS A MODULE ROLE, NOT A TENANT ROLE. types/roles.ts defines
 *    cooperative_admin as "Manages the cooperative module", beside nine
 *    siblings — marketplace_admin, export_admin, academy_admin, wave_admin,
 *    farm_nation_admin and the rest — not one of which is scoped to a
 *    sub-entity. Per-cooperative administration is not a concept this platform
 *    has anywhere else.
 *
 * 3. SWITCHING IT ON AS IT STOOD WOULD HAVE BEEN UNSAFE, NOT MERELY NARROWING.
 *    The two withdrawal guards read
 *
 *        if (adminScope && withdrawalData?.cooperativeId && ... !== adminScope)
 *
 *    and TWO OF THE THREE doors that create a cooperative withdrawal wrote no
 *    cooperativeId at all (_coop_money.ts and api/cooperative/withdraw). So a
 *    scoped admin could approve or reject every withdrawal from those doors,
 *    whatever their scope. A partition that admits a whole class of row is
 *    security-shaped and gates nothing.
 *
 * WHAT WAS DONE INSTEAD OF BUILDING IT
 * ------------------------------------
 * The mechanism is kept — nothing is deleted — and the trap in it is removed,
 * so it is safe to switch on if a second cooperative is ever created. Both
 * withdrawal doors now record the cooperativeId from the MEMBERSHIP (never from
 * the caller — platform.ts takes that field from a form, and a caller-supplied
 * value would let a member choose which admin may act on their money), and the
 * three guards refuse a row they cannot attribute instead of waving it through.
 * None of that changes any behaviour today, because getAdminScope still returns
 * null for every caller and the guards short-circuit.
 *
 * WHAT IS DELIBERATELY NOT DONE. The read below is not repointed at
 * COOPERATIVE_MEMBERS. Membership is not administration, and on a live platform
 * making the lookup succeed would take the estate away from admins who
 * administer it today. No tenancy screen is built either: recording which
 * cooperative an admin runs, for a platform with one cooperative and no way to
 * make another, is a screen announcing something the product does not have.
 *
 * The pin is src/__tests__/unit/cooperative-admin-scope-is-inert.test.ts, and
 * it fails in BOTH directions — if a writer for the scoping fact appears, or a
 * writer for COOPERATIVES, it tells whoever added it to come back and re-check
 * these ten guards and this decision.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isPlatformAdmin } from "@/lib/admin-permissions";

export async function getAdminScope(userId: string, userRoles: string[]): Promise<string | null> {
    // Super Admins and Platform Admins see everything.
    if (isPlatformAdmin(userRoles)) return null;

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
