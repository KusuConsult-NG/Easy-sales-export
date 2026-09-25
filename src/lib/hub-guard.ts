import "server-only";
import { authErrorCodeFor } from "@/lib/auth-error-codes";
import { requireSession } from "@/lib/session-guard";
import { redirect } from "next/navigation";
import { getAdminDb } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAdmin } from "@/lib/admin-permissions";
import { resolveActiveUser } from "@/lib/user-identity";

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
        //   #927 A CODE, NOT THE PROSE. LoginForm renders only codes it knows —
        //   correctly, since arbitrary text in a URL on the password screen is a
        //   phishing hole — so the sentence this used to url-encode arrived as
        //   "Authentication failed." A suspended member read that as a typo.
        redirect(`/auth/login?error=${authErrorCodeFor(errorMessage)}`);
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
            /**
             *   #542 THE MIGRATION POINTER IS FOLLOWED HERE TOO.
             *
             *   This read was `USERS.doc(session.user.id)` and nothing else.
             *   session-guard, user-cache and the Paystack paths all walk
             *   `_migratedTo` / `supabaseAuthId` to the live row; this one did
             *   not, so for a migrated member /profile DISPLAYED the finished
             *   profile from the live row while this guard read the old row,
             *   found no `profileComplete`, and sent them to /hub/register —
             *   which forwards to /profile. Every login, forever.
             *
             *   The walk keeps the last row that EXISTS, so a dangling pointer
             *   degrades to the newest good profile rather than locking the
             *   member out of all sixteen module layouts.
             */
            const db = getAdminDb();
            const uid = sessionResult.session.user.id;
            const userDoc = await db.collection(COLLECTIONS.USERS).doc(uid).get();

            if (userDoc.exists) {
                const resolved = await resolveActiveUser(uid, async (id) => {
                    if (id === uid) return userDoc.data() ?? null;
                    const doc = await db.collection(COLLECTIONS.USERS).doc(id).get();
                    return doc.exists ? (doc.data() ?? null) : null;
                });
                userData = resolved.row ?? userDoc.data();
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
                    /*
                     *   "PROFILE IS INCOMPLETE" IS NOT THE WHOLE TRUTH FOR A
                     *   SPLIT ACCOUNT, AND THAT IS THE CASE THAT STRANDS PEOPLE.
                     *
                     *   The owner's log, one member over nine minutes:
                     *
                     *     SPLIT ACCOUNT (#888): 2 profile rows share <address>.
                     *       Signed in as bffe635d… ; the other row(s) —
                     *       KzQmr40lYtSR9CIIWTU8ca8KBKv1 — are not consulted
                     *     [HubGuard] Redirecting user bffe635d… - Profile is
                     *       incomplete.                              (x5)
                     *
                     *   Those two ids are a Supabase UUID and a Firebase uid:
                     *   a migration that never linked the rows with
                     *   `_migratedTo`. #542 taught this guard to WALK that
                     *   pointer, and a split account is precisely the shape
                     *   where there is no pointer to walk — so the walk
                     *   correctly stops on the signed-in row, correctly finds
                     *   no `profileComplete`, and says so.
                     *
                     *   THE LINE IS TRUE AND UNACTIONABLE. The member's
                     *   finished profile may be sitting on the row nobody
                     *   consulted, and the operator can only learn that by
                     *   correlating with a sign-in line from minutes earlier.
                     *   Same class as #716 and lib/rpc-unavailable: a message
                     *   that cannot tell two states apart reports the one that
                     *   reads as a fact.
                     *
                     *   WHAT THIS DELIBERATELY DOES NOT DO IS LET THEM IN.
                     *   #888 refuses that in as many words — "unioning roles
                     *   across rows would grant whatever the most privileged
                     *   duplicate holds, a privilege decision about real
                     *   accounts, made unattended" — and reconciliation is a
                     *   person's job at /admin/forensics/duplicates. This makes
                     *   the condition visible so they know to, which is what
                     *   #888 says the detection is for.
                     *
                     *   COST: one indexed lookup (idx_users_email, migration
                     *   036), ONLY on the path that is already terminal — this
                     *   request ends in a redirect either way. The admitted
                     *   path above returns without paying it.
                     */
                    const uid = sessionResult.session.user.id;
                    let siblings: string[] = [];
                    try {
                        const address = String(userData?.email ?? sessionResult.session.user.email ?? "");
                        if (address) {
                            const { findProfilesByEmail } = await import("@/lib/profile-lookup");
                            const { rows } = await findProfilesByEmail(address);
                            siblings = rows.map((r) => r.id).filter((id) => id !== uid);
                        }
                    } catch {
                        //   A diagnostic must never decide the redirect. The
                        //   member is going to /hub/register either way.
                    }

                    console.warn(
                        siblings.length > 0
                            ? `[HubGuard] Redirecting user ${uid} - profile is incomplete ON THE ROW THAT `
                              + `SIGNED IN, and this is a SPLIT ACCOUNT (#888): ${siblings.length} other row(s) `
                              + `share this address — ${siblings.join(", ")}. A finished profile on one of those `
                              + `is not read here, deliberately. Reconcile at /admin/forensics/duplicates.`
                            : `[HubGuard] Redirecting user ${uid} - Profile is incomplete.`,
                    );
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
