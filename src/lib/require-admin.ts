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
 *   #374 THE `permission` PARAMETER IS USED BY THREE OF THIRTY-FIVE CALL SITES.
 *
 *        The docstring above says "Pass a permission to require more than 'is
 *        an admin at all'". Measured across the repository, two call sites did.
 *        #374 fixed two more, because in each case the SAME FILE already named
 *        the permission for the same workflow:
 *
 *          _escrow_disputes.ts   _resolveDisputeAction released and refunded
 *                                ESCROW MONEY on requireAdmin(), while
 *                                _escalateDisputeAction — which only flags a
 *                                case for review — required
 *                                finance:resolve_disputes. The weaker gate was
 *                                on the action that moves the money, and the
 *                                live resolver in actions/disputes.ts had
 *                                already been fixed to demand the permission.
 *        AND ONE THAT LOOKED IDENTICAL AND WAS NOT. escalation-notes.ts reads a
 *        dispute's internal notes on a bare gate while its writer demands the
 *        permission — the same asymmetry. #374's first draft changed it, and
 *        #356's ratchet failed: #356 had already decided that one deliberately,
 *        because "narrowing the read alone would show a moderator the dispute
 *        with a hole in it". Reverted. An asymmetry between two gates is
 *        evidence, not a verdict.
 *
 *        THE OTHER THIRTY-TWO ARE RECORDED, NOT CHANGED. Every one of them
 *        currently admits all ten admin roles:
 *
 *          admin-communications.ts  sendBulkEmail, createAnnouncement,
 *                                   getEmailHistory
 *          cms.ts                   createAnnouncement, deactivateAnnouncement,
 *                                   createBanner, deactivateBanner (+1)
 *          sms-broadcast.ts         preview, send
 *          in-app-broadcast.ts      collectRecipientUserIds, preview, send
 *          diagnose-broadcast.ts    diagnoseBroadcastAction
 *          maintenance.ts           repairData, runConsistencyCheck,
 *                                   hardResetCache, cleanupAbandonedDrafts
 *          api/admin/maintenance/hard-reset  GET
 *          global-aggregation.ts    five metric readers
 *          admin-users.ts           getAdminUsers, assignDispute
 *          escalation-notes.ts      getEscalationNotes (deliberate — see above)
 *          export-aggregation.ts    createExportWindow
 *          admin/_land.ts           _verifyLandListing
 *          admin/_legacy.ts         _onboardLegacyMemberAction
 *          admin/_withdrawals.ts    _processWithdrawalAction
 *          marketplace/_escrow_lifecycle.ts  _releaseEscrowAction
 *
 *        The matrix has a plausible permission for nearly all of them —
 *        land:verify_listings, finance:process_withdrawals, users:create,
 *        announcements:manage, config:update, export:approve_applications.
 *        They are NOT applied here because narrowing a live gate can lock out a
 *        role that is doing that work today, and which roles actually operate
 *        each queue is not something this codebase records. The one above was
 *        safe precisely because its own file had already answered.
 *
 *        OWNER DECISION: assign a permission to each of the thirty-two, or say
 *        that "any admin" is the intended rule for them. Related to the open
 *        decision from #364/#365 about the files that still state the admin
 *        rule by hand — same question, asked of the shared gate instead.
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
