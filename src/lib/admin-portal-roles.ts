import "server-only";

import { readUserDocOnce } from "@/lib/current-user-doc";

/**
 * The roles the ADMIN PORTAL'S DOOR judges, read from the database.
 *
 *   #959 THE DOOR THAT GATES THE ENTIRE ADMIN PORTAL ASKED THE TOKEN.
 *
 *   The owner: "my admin credentials takes me to the users dashboard not the
 *   admin portal", and then, after enrolling a second factor, "I turned on 2FA
 *   and still lands at users dashboard not admin".
 *
 *   Two screens send them there, and until now both decided from
 *   `session.user.roles`:
 *
 *       components/admin/AdminShell.tsx   !isAdmin(roles)            -> /dashboard
 *       app/admin/page.tsx                adminLandingPath(roles)===null -> /dashboard
 *
 *   That claim is minted at sign-in from whatever getUserProfile returned — a
 *   Redis copy, else the Supabase row, else Firestore, and then walked through
 *   resolveActiveUser's migration pointers — and refreshed on a two-minute
 *   cycle. requireAdmin, which guards every admin ACTION, reads the row by id
 *   instead. When the two disagree, an administrator is admitted to every admin
 *   action on the platform and refused the screens that invoke them.
 *
 * ── WHY THIS IS A READ AND NOT A CHEAPER CHECK ──────────────────────────────
 *
 *   #951's rule is that a door must re-read when acting on stale authorisation
 *   produces an effect revoking the admin cannot undo. This door decides
 *   admission to the whole portal, so it fails in both directions: a REVOKED
 *   admin keeps the console for up to two minutes, and a GRANTED one — or one
 *   whose token was built from a row that disagrees — cannot get in at all.
 *
 *   The tempting cheap version is "trust the token when it says yes, read only
 *   when it says no". That is the shape the cooperative gates had, and #86
 *   counts it as the defect it is: it fixes the lockout and keeps the
 *   revocation window, which is the half that matters for security. So the read
 *   is unconditional.
 *
 *   IT COSTS ONE READ PER ADMIN PAGE, NOT TWO. AdminShell draws the chrome and
 *   app/admin/page.tsx renders inside it, so both ask this question in one
 *   request. lib/current-user-doc memoises by user id for the life of that
 *   request and stores the in-flight promise, so the second caller joins the
 *   first one's read. Outside a React request scope — jest, a script — that
 *   memo is a pass-through, which is one read per caller: exactly what a direct
 *   `.doc(id).get()` would have cost.
 *
 * ── IT FAILS CLOSED, AND THAT IS DELIBERATE ─────────────────────────────────
 *
 *   No session id, no row, or a read that throws all yield `[]`, so the door
 *   refuses. A gate that admits on "I could not check" is not a gate, and
 *   requireAdmin already answers a failed read the same way — its catch returns
 *   an error its callers treat as refusal.
 *
 *   The cost of that is real and worth naming: a transient database error
 *   bounces an administrator to /dashboard rather than showing them an error.
 *   current-user-doc does not remember a rejected read, so the next attempt
 *   fetches again — which is why this is a retry rather than a lockout. The
 *   alternative, admitting on failure, would make the portal openable by
 *   arranging for the read to fail.
 *
 *   THE TOKEN'S ROLES ARE NOT A PARAMETER HERE ON PURPOSE. Handing them in
 *   would invite exactly the "fall back to the token" line that reintroduces
 *   the revocation window this exists to close.
 */
export async function liveRolesForPortal(userId: string | null | undefined): Promise<string[]> {
    if (!userId) return [];

    try {
        const snap = await readUserDocOnce(userId);
        if (!snap.exists) return [];

        const roles = snap.data?.roles;
        return Array.isArray(roles) ? roles : [];
    } catch {
        //   Fails closed — see the header. Not swallowed silently: the caller
        //   redirects, which is visible, and current-user-doc has already
        //   dropped the failed read so a retry re-fetches.
        return [];
    }
}
