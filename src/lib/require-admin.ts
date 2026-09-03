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
