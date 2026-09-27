/**
 * The mock for lib/live-door-roles, for suites that drive a converted door.
 *
 *   #962 THIRTEEN DOORS STOPPED TRUSTING THE TOKEN, AND EVERY SUITE THAT SET UP
 *        AN ADMIN BY PUTTING ROLES ON THE SESSION STOPPED SEEING ONE.
 *
 *   `setSession(ADMIN, ['admin'])` — in one spelling or another — is how most of
 *   these suites establish an administrator. It sets the roles on the TOKEN. A
 *   converted door reads the row instead, and the row in those harnesses is
 *   whatever the global firestore recorder happens to return, which in
 *   export-admin-guards is a cocoa product. So an admin was refused and a
 *   vacuity guard reading "still serves an admin" went red.
 *
 *   That is the harness catching up with the code, not a defect in either.
 *
 * ── WHAT THIS DELIBERATELY DOES AND DOES NOT ASSERT ─────────────────────────
 *
 *   It makes the row AGREE with the token, which is the ordinary case: an
 *   administrator whose session was minted after their roles were granted. Those
 *   suites are about what the action DOES for an admin — the catalogue it
 *   returns, the status transitions it allows — and the provenance of the roles
 *   is not their subject.
 *
 *   SO IT MUST NOT BE MISTAKEN FOR COVERAGE OF THE THING #962 FIXED. A mock that
 *   answers from the session cannot show that production does not. The property
 *   — the row is read, the token is not trusted, and a member acting on their own
 *   row pays no read — is measured in
 *   a-door-that-read-the-row-without-charging-the-owner, which counts the reads
 *   at lib/current-user-doc and drives the real helper. This file exists so that
 *   seventy other suites do not have to care.
 *
 *   A suite that WANTS the row to disagree with the token — a revoked admin whose
 *   session has not caught up — passes its own roles instead of taking the
 *   default. That is the one case where the disagreement is the subject.
 *
 * ── WHY IT READS THE SESSION RATHER THAN TAKING A FIXED LIST ────────────────
 *
 *   Every one of these suites changes the session between tests, and several
 *   change it inside a single test. A fixed list would have to be reset in
 *   lockstep by hand, which is the kind of duplication that drifts — and the
 *   drift would look like a door refusing an admin, sending whoever hits it to
 *   read production code that is fine.
 */

/**
 * The module mock. Use as:
 *
 *     jest.mock('@/lib/live-door-roles', () =>
 *         require('@/lib/testing/live-door-roles-mock').liveRolesForDoorMock());
 *
 * Pass `roles` to make the row disagree with the token on purpose.
 */
export function liveRolesForDoorMock(roles?: readonly string[]) {
    return {
        liveRolesForDoor: async (userId: string | null | undefined): Promise<string[]> => {
            //   Fails closed on no id, exactly as the real one does — a suite
            //   asserting the unauthenticated refusal must still get it.
            if (!userId) return [];

            if (roles !== undefined) return [...roles];

            /*
             *   The session the suite has set, through whichever guard mock it
             *   drives. Both spellings are in use across the tree, so both are
             *   consulted rather than one being assumed.
             */
            const g = globalThis as Record<string, unknown>;
            const guard = (g.mockRequireSession ?? g.mockRequireAdmin) as
                undefined | (() => Promise<{ session?: { user?: { roles?: string[] } } }>);

            if (typeof guard !== "function") return [];

            try {
                const result = await guard();
                return result?.session?.user?.roles ?? [];
            } catch {
                //   A guard mock that throws is a suite testing the failure path;
                //   refusing is the honest answer and matches the real helper.
                return [];
            }
        },
    };
}
