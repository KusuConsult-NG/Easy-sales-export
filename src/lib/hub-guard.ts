import "server-only";
import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";

/**
 * Enforces strict module onboarding checks.
 * A user MUST have completed Hub Registration before they can access any active module's onboarding logic.
 * 
 * Rules:
 * 1. Must be logged in (have a valid session).
 * 2. Must be fully registered in the database.
 * 3. Partially registered users are redirected to /hub/register
 */
export async function requireHubRegistration() {
    // 1. Session verification
    const sessionResult = await requireSession();
    
    // Automatically block users who are not even authenticated or are banned
    if (!sessionResult.session) {
        // Proper handling of the nested error object structure (result.error.error)
        const errorMessage = sessionResult.error?.error || "Authentication required";
        redirect(`/auth/login?error=${encodeURIComponent(errorMessage)}`);
    }
    
    /**
     * ── ADMIN BYPASS ─────────────────────────────────────────────────────────
     * Admin accounts are provisioned directly and are never subject to the hub
     * registration completeness check.
     *
     *   #353 THIS TEST LOCKED OUT TWO OF THE TEN ADMIN ROLES.
     *
     *        It was written by hand:
     *
     *            r === 'admin' || r === 'super_admin' || r.endsWith('_admin')
     *
     *        `moderator` and `support` are neither of the two literals and
     *        neither ends in `_admin`. They ARE admin roles — both are keys of
     *        PERMISSION_MATRIX and both make isAdmin() true — so an account
     *        holding one fell through to the profileComplete check below and
     *        was redirected to /hub/register.
     *
     *        This guard wraps six layouts (marketplace seller, buyer and
     *        onboarding, farm-nation member and onboarding, the export app), so
     *        a support or moderator account could not enter any of them. That
     *        is #265's shape — eight module-admin lockouts from a hand-written
     *        role list — repeating for the two roles that do not share the
     *        suffix.
     *
     *        `endsWith('_admin')` was also a latent trap in the other
     *        direction: any future role ending in those seven characters would
     *        have bypassed registration without being an admin at all. The
     *        suffix is not the fact; membership of PERMISSION_MATRIX is, and
     *        isAdmin() is where that lives.
     */
    const sessionRoles: string[] = (sessionResult.session.user as any)?.roles || [];
    if (isAdmin(sessionRoles)) {
        return sessionResult;
    }
    
    /**
     * Where to send the caller, decided inside the try and performed outside it.
     *
     *   #366 TWO OF THE THREE redirect() CALLS WERE INSIDE THE TRY BLOCK, AND
     *        THE CLOSING COMMENT OF THIS FUNCTION SAYS THEY MUST NOT BE.
     *
     *        Next's redirect() works by throwing NEXT_REDIRECT. Both
     *        /auth/reset-legacy-password redirects therefore landed in
     *
     *            } catch(err) {
     *                console.error("Hub Guard Exception:", err);
     *                throw err;
     *            }
     *
     *        The rethrow kept the BEHAVIOUR right — the redirect still
     *        happened, which is why nothing ever surfaced — and made the LOG
     *        wrong: every legacy member sent to change a temporary password
     *        produced a "Hub Guard Exception" naming a control-flow signal as a
     *        fault. A log that cries wolf on the normal path is how the real
     *        exception goes unread.
     *
     *        This was found by EXECUTING the guard for the first time; five
     *        suites had asserted things about this file by reading it.
     */
    let redirectTo: string | null = null;
    let shouldRedirect = false;

    // 2. Extrapolate db record for registration verification
    try {
        const { getCached, CacheKeys } = await import("@/lib/redis");
        const cacheKey = CacheKeys.userProfile(sessionResult.session.user.id);
        
        // Leverage cached user data populated by requireSession
        let userData: any = await getCached(cacheKey);
        
        // Maintain live Firestore validation fallback to prevent stale session exploits
        if (!userData) {
            const db = getAdminDb();
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(sessionResult.session.user.id).get();
            
            if (userDoc.exists) {
                userData = userDoc.data();
            }
        }
        
        if (!userData) {
            shouldRedirect = true;
        } else {
            // 3. Define "Fully Registered" Status
            // Strictly enforce userData.profileComplete === true. Deny dashboard or module access
            // to any account that does not meet this check.
            if (userData?.profileComplete === true) {
                // User has explicitly completed their profile.
                // CRITICAL: Check if they still need to secure their account (legacy members)
                if (userData.requiresPasswordChange) {
                    redirectTo = "/auth/reset-legacy-password";
                } else {
                    return sessionResult;
                }
            } else {
                // Check for legacy members who haven't completed profile yet but have the flag
                if (userData?.requiresPasswordChange) {
                    redirectTo = "/auth/reset-legacy-password";
                } else {
                    console.warn(`[HubGuard] Redirecting user ${sessionResult.session.user.id} - Profile is incomplete.`);
                    shouldRedirect = true;
                }
            }
        }
    } catch(err) {
        console.error("Hub Guard Exception:", err);
        // Rethrow the error so that the nearest Error Boundary catches it and offers a retry
        // rather than forcing a redirection to /hub/register on transient database drops.
        throw err;
    }
    
    // IMPORTANT: Next.js redirect() MUST be called outside the try/catch block
    // to prevent swallowing the NEXT_REDIRECT internal exception.
    //
    // #366. Both of these are now out here. The reset redirect used to be
    // inside, which is what the note above was written to prevent.
    if (redirectTo) {
        redirect(redirectTo);
    }

    if (shouldRedirect) {
        redirect("/hub/register");
    }
    
    return sessionResult;
}
