import { auth } from "@/lib/auth";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin, hasAdminPermission, type AdminPermission } from "@/lib/admin-permissions";

/**
 * requireAdmin — Live Role Re-Validation
 *
 * Re-fetches the user's roles directly from Firestore on every call.
 * This ensures role revocations take effect immediately, rather than
 * waiting up to 8h for the JWT to expire.
 *
 * Usage in server actions:
 *   const result = await requireAdmin();
 *   if ("error" in result) return { success: false, error: result.error };
 *   const { userId } = result;
 *
 * Pass a permission to require more than "is an admin at all":
 *   const result = await requireAdmin("finance:resolve_disputes");
 *
 *   #356 THIS GATE CARRIED THE SAME HAND-WRITTEN ROLE TEST #353 HAD JUST
 *        REMOVED FROM hub-guard.ts, AND IT GUARDS FIFTEEN ADMIN ACTION FILES.
 *
 *        It was:
 *
 *            roles.some(r => r === "admin" || r === "super_admin"
 *                            || r.endsWith("_admin"))
 *
 *        `moderator` and `support` are neither literal and neither ends in
 *        `_admin`, so both were refused by every action that routes through
 *        here — the land queue, the withdrawal queue, legacy onboarding, the
 *        SMS and in-app broadcasts, dispute escalation, maintenance. A support
 *        account could not do any of the work its role exists for.
 *
 *        And the suffix was a trap in the other direction: any future role
 *        ending in those seven characters would have been admitted without
 *        being an admin. #353 said the suffix is not the fact and membership
 *        of PERMISSION_MATRIX is; that fix landed on hub-guard alone, and this
 *        was one of five more copies of the same test. isAdmin() is now asked
 *        here, exactly as it is there.
 *
 *   #374/#375 EVERY GATE NAMES ITS PERMISSION NOW — ONE EXCEPTION, STATED.
 *
 *        The docstring above says "Pass a permission to require more than 'is
 *        an admin at all'". #374 measured it: TWO of thirty call sites did. The
 *        other twenty-eight admitted all ten admin roles, including the
 *        withdrawal queue, legacy onboarding, land verification, export window
 *        creation, every broadcast, all of maintenance and the hard-reset route.
 *
 *        #374 fixed the one that was not a judgement call — _resolveDisputeAction
 *        released escrow money on a bare gate while its own file's escalate path
 *        demanded finance:resolve_disputes — and RECORDED the rest, because
 *        narrowing a live gate can lock out a role that is doing that work today.
 *
 *        #375 TAKES THAT DECISION. Each gate now names the permission that
 *        matches what the action does, chosen so the module admin who
 *        legitimately runs a queue keeps running it:
 *
 *          announcements:manage         every broadcast surface — bulk email,
 *          (admin, super_admin)         announcements, SMS, in-app, and the
 *                                       broadcast diagnostic. These reach every
 *                                       member; #202 already established that a
 *                                       demoted admin must not.
 *          config:update                maintenance's four repair/reset/cleanup
 *          (admin, super_admin)         actions and the hard-reset route.
 *          finance:process_withdrawals  _processWithdrawalAction. Money out.
 *          (admin, super_admin)
 *          finance:resolve_disputes     _releaseEscrowAction and
 *          (admin, super_admin)         assignDisputeAction. Money out, and the
 *                                       assignment of the case that moves it.
 *          users:create                 _onboardLegacyMemberAction. It creates
 *          (admin, super_admin)         accounts; #62 settled that admin holds
 *                                       this.
 *          export:approve_applications  createExportWindowAction. Deliberately
 *          (+ export_admin)             includes export_admin — it is their
 *                                       queue.
 *          land:verify_listings         _verifyLandListing. Deliberately
 *          (+ farm_nation_admin)        includes farm_nation_admin — theirs.
 *          users:read                   getAdminUsersAction, which populates the
 *          (all ten)                    dispute-assignee picker.
 *          audit:read                   global-aggregation's five metric
 *          (all ten)                    readers.
 *
 *        The last two hold all ten roles, so they change no behaviour. They are
 *        named anyway: an explicit, matrix-backed rule follows the matrix if it
 *        is ever narrowed, where a bare gate would not.
 *
 *        THE ONE REMAINING BARE GATE IS DELIBERATE.
 *        escalation-notes.ts::getEscalationNotesAction stays on requireAdmin().
 *        #356 decided that, and recorded why: "narrowing the read alone would
 *        show a moderator the dispute with a hole in it". getDisputeByIdAction
 *        uses `isResolver` to decide HOW MUCH of a dispute to show rather than
 *        whether to show it, so a moderator can legitimately open the screen.
 *        #374's first draft "fixed" it and #356's ratchet caught the regression.
 *
 *        require-admin-names-its-permission.test.ts pins the count at 29 named
 *        and exactly 1 bare, with that one named, so a new bare gate fails the
 *        build.
 */
export async function requireAdmin(permission?: AdminPermission): Promise<
    { userId: string } | { error: string }
> {
    // 1. Verify the user has an active NextAuth session
    const session = await auth();
    if (!session?.user?.id) {
        return { error: "Unauthenticated" };
    }

    try {
        // 2. Re-fetch roles live from Firestore (bypasses the stale JWT)
        const db = getAdminDb();
        const userDoc = await db
            .collection(COLLECTIONS.USERS)
            .doc(session.user.id)
            .get();

        if (!userDoc.exists) {
            return { error: "User profile not found" };
        }

        const data = userDoc.data();
        const roles: string[] = data?.roles || [];

        // 3. Check for banned / suspended status while we have the document
        if (data?.isBanned === true || data?.status === "banned" || data?.suspended === true) {
            return { error: "Account suspended. Contact support." };
        }

        // 4. Verify the live role — see the #356 note above for what this was.
        if (!isAdmin(roles)) {
            return { error: "Unauthorized: Admin access required" };
        }

        // 5. And, when the caller named one, the specific permission. Asked of
        //    PERMISSION_MATRIX rather than by naming roles at the call site,
        //    which is how one screen ends up gated two ways.
        if (permission && !hasAdminPermission(roles, permission)) {
            return { error: "Unauthorized: Admin access required" };
        }

        return { userId: session.user.id };
    } catch (error) {
        console.error("[requireAdmin] Firestore lookup failed:", error);
        // Fail closed — never grant access if we cannot verify the live role
        return { error: "Authorization check failed. Please try again." };
    }
}
