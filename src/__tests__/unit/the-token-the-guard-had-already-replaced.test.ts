/**
 * @jest-environment node
 */

/**
 *   #965 #951'S PREMISE WAS UNQUALIFIED, AND THE THING THAT QUALIFIES IT HAD NO
 *        TEST.
 *
 *   lib/stale-authorisation states the rule this programme converts doors by, and
 *   opens by citing #356: a JWT role claim "keeps its value for hours after the
 *   database loses it". Forty-four doors have been converted off
 *   `isAdmin(session.user.roles)` on the strength of that sentence, and three pull
 *   request bodies described the defect as an administrator keeping every admin
 *   power "until their token expires".
 *
 *   THAT IS NOT WHAT requireSession DOES. It force-syncs the live roles over the
 *   token before returning, and refuses an elevated session outright when the row
 *   cannot be read. So for the ordinary door — `await requireSession()`, then
 *   `isAdmin(session.user.roles)` — the token's roles are NOT what gets judged,
 *   except in one specific case.
 *
 *   Nothing executed that. Five suites read session-guard's source; none drove it.
 *   The same shape #366 found in hub-guard, one layer down, and this time it was
 *   load-bearing for a rule.
 *
 * ── WHY THIS IS MEASURED RATHER THAN ARGUED ─────────────────────────────────
 *
 *   The three cases below are the whole of it, and which one a door falls into
 *   decides whether converting it is a security fix, a no-op, or — as batch 4a
 *   discovered by breaking two suites — a REGRESSION that locks an administrator
 *   out. hub-guard's bypass and wave/_member's were both reverted on the strength
 *   of case 3, because liveRolesForDoor fails closed on a missing row and those
 *   two are pinned, by execution, to admit an admin who has none.
 *
 *   So this suite is the evidence for a rule, not coverage of a defect. It asserts
 *   what requireSession actually returns in each case, so that the qualification
 *   in stale-authorisation cannot go stale the way the sentence it qualifies did.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';

let sessionFromAuth: unknown = null;
let cached: unknown = null;

jest.mock('@/lib/auth', () => ({
    auth: async () => sessionFromAuth,
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => cached,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
    CacheKeys: { userProfile: (id: string) => `user:profile:${id}` },
}));

jest.mock('next/navigation', () => ({
    redirect: (to: string) => { throw new Error(`NEXT_REDIRECT;${to}`); },
}));

jest.mock('next/headers', () => ({
    headers: async () => new Map<string, string>(),
}));

let store: FakeDbHandle;

/**
 * The REAL requireSession, not the global mock jest.setup installs.
 *
 * jest.setup replaces the whole module with `requireSession: () =>
 * global.mockRequireSession()`, which is right for every suite driving a door and
 * useless for a suite whose subject IS the guard. requireActual is how the one
 * gets at what the other stands in for.
 */
async function realRequireSession() {
    const actual = jest.requireActual('@/lib/session-guard') as {
        requireSession: () => Promise<{ session: { user: { roles?: string[] } } | null; error: unknown }>;
    };
    return actual.requireSession();
}

function signedInAs(id: string, roles: string[]) {
    sessionFromAuth = { user: { id, roles, email: `${id}@example.com`, name: id } };
}

beforeEach(() => {
    jest.resetModules();
    store = installFakeDb();
    cached = null;
    sessionFromAuth = null;
});

describe('#965 — what requireSession hands a door, measured in all three cases', () => {
    it('CASE 1: THE ROW IS READABLE, SO THE ROLES A DOOR SEES ARE THE ROW\'S, NOT THE TOKEN\'S', async () => {
        /*
         *   The case that matters most, because it is the ordinary one — and the
         *   case in which `isAdmin(session.user.roles)` was ALREADY judging live
         *   roles. A revoked administrator, token still claiming admin, row already
         *   reduced: the door sees the reduced list.
         */
        signedInAs('was-an-admin', ['admin', 'super_admin']);
        store.seed('users', 'was-an-admin', {
            roles: ['general_user'], profileComplete: true, email: 'was-an-admin@example.com',
        });

        const result = await realRequireSession();

        expect(result.session).not.toBeNull();
        expect({ roles: result.session?.user?.roles })
            .toEqual({ roles: ['general_user'] });
    });

    it('AND THE TOKEN\'S OWN LIST IS NOT WHAT CAME BACK — the control on case 1', async () => {
        /*
         *   Without this, case 1 would pass if requireSession returned the token
         *   unchanged and the fixture happened to agree with the row. The two lists
         *   are made to disagree, and the assertion is that the TOKEN's is absent.
         */
        signedInAs('promoted', ['general_user']);
        store.seed('users', 'promoted', {
            roles: ['wave_admin'], profileComplete: true, email: 'promoted@example.com',
        });

        const result = await realRequireSession();

        expect({ roles: result.session?.user?.roles }).toEqual({ roles: ['wave_admin'] });
        expect(result.session?.user?.roles).not.toContain('general_user');
    });

    it('CASE 2: THE ROW IS ABSENT, AND A ROWLESS ADMIN IS DOWNGRADED — not admitted on the token', async () => {
        /*
         *   THIS IS WHERE I EXPECTED THE TOKEN TO SURVIVE, AND IT DOES NOT.
         *
         *   The first draft of this test asserted `['super_admin']` — the reading
         *   that `data` stays null when the row is missing, so the raw token session
         *   is returned. Execution said `['general_user']`.
         *
         *   session-guard AUTO-REPAIRS a missing row: it writes one with
         *   `roles: ["general_user"], profileComplete: false` and assigns it to
         *   `data`, which the force-sync then puts on the session. So a token
         *   claiming super_admin against a non-existent row yields a session holding
         *   general_user — the account is downgraded, and a row now exists.
         *
         *   THAT LEAVES NO PRODUCTION CASE IN WHICH A DOOR BEHIND requireSession
         *   JUDGES ADMIN ROLES THAT CAME FROM THE TOKEN. Which in turn means the two
         *   suites that made me revert batch 4a — hub-guard-is-executed's "ALL TEN
         *   ADMIN ROLES ARE ADMITTED WITHOUT A USER ROW" and wave-member-scope's
         *   equivalent — are pinning a state requireSession cannot hand them. They
         *   mock requireSession, so their fixture supplies admin roles with an empty
         *   store directly. The behaviour they describe is a property of the fixture.
         *
         *   Recorded here rather than acted on: those two suites assert something
         *   real about their doors (the bypass admits all ten roles, #353's fix), and
         *   the no-row part of the setup is incidental to that. Rewriting them is a
         *   separate decision from measuring this.
         */
        signedInAs('rowless-admin', ['super_admin']);
        //   Deliberately nothing seeded.

        const result = await realRequireSession();

        expect(result.session).not.toBeNull();
        expect({ roles: result.session?.user?.roles }).toEqual({ roles: ['general_user'] });
    });

    it('AND THE REPAIR REALLY WROTE THE ROW, so the downgrade is durable and not a per-request quirk', async () => {
        /*
         *   The half that makes the case above consequential. If the minted profile
         *   were only held in memory the next request would repeat the whole dance;
         *   because it is written, the account is a general_user from now on and an
         *   operator has to grant the roles again deliberately.
         */
        signedInAs('rowless-admin-2', ['admin']);

        await realRequireSession();

        expect({ written: store.get('users', 'rowless-admin-2') })
            .toEqual({ written: expect.objectContaining({ roles: ['general_user'] }) });
    });

    it('and an ordinary caller with no row is treated identically, so this is not an admin rule', async () => {
        //   The repair path is not role-dependent. Stating it stops the case above
        //   reading as "admins are singled out here" — they are not; what singles
        //   them out is case 3.
        signedInAs('rowless-member', ['general_user']);

        const result = await realRequireSession();

        expect({ roles: result.session?.user?.roles }).toEqual({ roles: ['general_user'] });
    });

    /*
     *   CASE 3 — THE ROW READ THREW — IS NOT MEASURED HERE, AND THAT IS A RECORDED
     *   LIMIT RATHER THAN AN OVERSIGHT.
     *
     *   session-guard's own comment states the policy and the code implements it at
     *   the `verificationFailed && isAdmin(...)` guard: an unverifiable elevated
     *   session is refused outright, while an ordinary member rides the blip out.
     *   Driving it needs a read failure injected into the store, and
     *   lib/testing/fake-db has no failure injection — seed, get, all, size,
     *   collections, clear, and nothing that throws.
     *
     *   Writing a weak version of it — mocking getAdminDb out from under
     *   installFakeDb for two tests — would assert against a harness rather than
     *   against the guard, which is the failure mode this whole suite exists to
     *   correct. So the case is named, its consequence is stated, and it is left
     *   unmeasured until the fake db can express it.
     *
     *   WHAT IT WOULD ADD IF MEASURED: nothing to the argument below. Cases 1 and 2
     *   already establish that no door behind requireSession judges admin roles that
     *   came from the token; case 3 only makes the door unreachable, which cannot
     *   make that conclusion weaker.
     */
});

describe('#965 — and the rule stated in stale-authorisation says so now', () => {
    it('THE QUALIFICATION IS IN THE RULE, not only in this suite', () => {
        /*
         *   A measurement nobody reads is how the unqualified sentence survived
         *   four findings. The rule file is where a door's converter looks, so the
         *   three cases are named there, and this asserts they still are.
         *
         *   Pinned on the SUBSTANCE — the name of the function that does the
         *   syncing and the word for the case that survives it — rather than on a
         *   sentence, so a rewording does not break it and a deletion does.
         */
        const rule = require('fs').readFileSync(
            require('path').join(process.cwd(), 'src/lib/stale-authorisation.ts'), 'utf-8',
        ) as string;

        expect(rule).toContain('requireSession');
        expect(rule).toMatch(/force-sync|force sync|syncs the live roles/i);
        expect(rule).toMatch(/row is absent|absent row|no row/i);
    });
});
