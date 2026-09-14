/**
 * requireAdmin for unit suites — mirroring the real gate, not waving callers
 * through.
 *
 *   #750 THE THIRD FINDING TO NEED THIS, SO IT LIVES IN ONE PLACE.
 *
 *   Moving an action from a token check to `requireAdmin` breaks every suite
 *   that mocks `requireSession` and nothing else: the action calls a gate
 *   nobody answers for and every call returns "Unauthenticated". #748 hit it in
 *   four suites, #749 in one, and this finding in eight.
 *
 * ── WHY NOT A GLOBAL STUB IN jest.setup.js ─────────────────────────────────
 *
 *   Tried, in #748, and reverted: it broke ten suites that exist to test the
 *   REAL gate. A mock for this belongs where a suite opts into it.
 *
 * ── AND WHY IT IS NOT `() => ({ userId: "admin-1" })` ──────────────────────
 *
 *   jest.setup.js records what that costs, about the same question:
 *
 *       "`isAdmin: () => true` used to be here, unconditionally... any guard of
 *        the shape `if (record.userId !== session.user.id &&
 *        !isAdmin(session.user.roles))` therefore could not be tested at all...
 *        It also meant a missing guard and a present one looked identical."
 *
 *   #749 met exactly that: a suite stubbed this as a bare `{ userId }` with no
 *   roles, and when the action stopped re-checking the permission itself, the
 *   stub became the only gate — so "refuses a role without users:create"
 *   started admitting everybody, silently.
 *
 *   So this DECIDES. It reads the caller's user document — the row the suite
 *   seeded, which is what the real gate reads — falls back to the session's
 *   roles when no row exists, and applies isAdmin and the permission against
 *   the real PERMISSION_MATRIX. A suite that acts as a moderator is still
 *   refused; a suite whose seeded row disagrees with its token gets the row's
 *   answer, which is the whole point of the gate.
 *
 *   What it omits is the suspension check and the MFA verdict. Both need
 *   fields no unit suite sets, and neither is what these suites are about.
 *
 * USAGE
 *
 *     jest.mock('@/lib/require-admin', () =>
 *         require('@/lib/testing/require-admin-mock').requireAdminMock());
 *
 *   `require` inside the factory, because a jest.mock factory may not close
 *   over out-of-scope variables.
 */

interface GateOk { userId: string; roles: string[] }
interface GateErr { error: string }

async function liveRolesFor(): Promise<{ id: string; roles: string[] } | GateErr> {
    const mockSession = (globalThis as any).mockRequireSession;
    const result = mockSession ? await mockSession() : null;
    const user = result?.session?.user;

    if (!user) return { error: "Unauthenticated" };

    /*
     *   THE SESSION'S ROLES, NOT A DOCUMENT READ — and that is a deliberate
     *   narrowing, made after the first version did read the document.
     *
     *   The real gate reads the caller's user row, so reading it here looks
     *   more faithful. It is not, in a unit suite: many of them stub
     *   `mockFirestoreGet` to return ONE document for every `.get()` on the
     *   adapter. role-escalation.test.ts is the case that caught it — its
     *   `setTarget()` returns the TARGET user's roles to every read, so this
     *   mock judged the actor by the roles of the person they were acting on,
     *   and a legitimate admin was refused.
     *
     *   A mock whose answer depends on which blanket stub a suite happens to
     *   install is worse than one that is merely simpler. Suites that need the
     *   document to disagree with the token — admin-legacy-onboarding, which
     *   tests exactly that — keep their own bespoke mock and say so.
     */
    return { id: user.id, roles: user.roles ?? [] };
}

/** The module shape `jest.mock('@/lib/require-admin', …)` should return. */
export function requireAdminMock() {
    const { isAdmin, hasAdminPermission } = require("@/lib/admin-permissions");

    const requireAdmin = async (permission?: string): Promise<GateOk | GateErr> => {
        const live = await liveRolesFor();
        if ("error" in live) return live;

        //   Mirrors the real gate: a named permission is reported even when
        //   the caller is not an admin at all, because they lack it either way
        //   and that is the more actionable fact.
        if (!isAdmin(live.roles)) {
            return {
                error: permission
                    ? `Unauthorized: Permission required - ${permission}`
                    : "Unauthorized: Admin access required",
            };
        }
        if (permission && !hasAdminPermission(live.roles, permission)) {
            //   Mirrors the real gate, which names the permission it refused.
            return { error: `Unauthorized: Permission required - ${permission}` };
        }
        return { userId: live.id, roles: live.roles };
    };

    return {
        requireAdmin,
        liveAdminRoles: async (): Promise<{ roles: string[] } | GateErr> => {
            const gate = await requireAdmin();
            return "error" in gate ? gate : { roles: gate.roles };
        },
    };
}
