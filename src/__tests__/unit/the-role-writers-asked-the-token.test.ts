/**
 * @jest-environment node
 */

/**
 *   #750 THE TWO ENDPOINTS THAT WRITE ROLES DECIDED WHO MAY WRITE ROLES FROM
 *        THE TOKEN — INCLUDING THE GUARD BUILT TO STOP SELF-PROMOTION.
 *
 *   #356 established the cost of a JWT role claim in one sentence: it "keeps its
 *   value for hours after the database loses it". That is why `requireAdmin`
 *   exists and re-reads roles from the user document on every call.
 *
 *   `_updateUserRolesAction` and `bulkAssignRolesAction` are the only two writes
 *   on the platform that can put "super_admin" into a roles array —
 *   role-escalation.test.ts measured that and wrote down why: every other
 *   role-touching write uses arrayUnion with a fixed participant role. Both of
 *   them made TWO decisions, and both decisions read `session.user.roles`:
 *
 *       const adminCheck = hasAdminPermission(session.user.roles, ...)   the gate
 *       if (includesPrivilegedRole(roles)
 *           && !isSuperAdmin(session.user.roles))                        the guard
 *
 *   So for the lifetime of their token a DEMOTED super_admin passed both, and
 *   could call either on their own id with ["super_admin"] — writing the role
 *   the platform had just removed back into the database, where it outlives
 *   the token that got it there. The demotion undoes itself.
 *
 *   The guard is the sharp part. It exists for precisely this act, and it was
 *   asking the one source #356 established cannot be trusted about it.
 *   admin-permissions.ts had already written the harm down:
 *
 *       "any admin could call either one on their own id and come back a
 *        super_admin... The boundary was described everywhere and enforced
 *        nowhere."
 *
 *   — and the enforcement that #499 and role-escalation added was then wired to
 *   the stale claim.
 *
 * ── WHY ALL TWELVE GATES IN THE TWO FILES, NOT THE TWO ──────────────────────
 *
 *   #532's ledger counts a file that gates two ways as HALF-CONVERTED, and its
 *   reasoning is that a file disagreeing with itself is both the sharpest
 *   evidence and the safest scope. Converting only the role writer would have
 *   left each file with one live gate and five token gates — manufacturing the
 *   exact shape that ratchet exists to catch, in the file whose defect this is.
 *
 *   The other ten change no audience: every permission named is the one that
 *   action already demanded, asked of the same matrix. What changes is that the
 *   answer now comes from the record, and a suspended account is refused on the
 *   way past — which a token check cannot see at all.
 *
 * ── AND ONE THING DELIBERATELY NOT CHANGED ──────────────────────────────────
 *
 *   `session.user.id` is still read, in both files, for the ACTING id on audit
 *   rows and for the "cannot remove your own admin privileges" self-test. That
 *   is the subject of the claim, not a privilege assertion — #356's finding is
 *   about role claims — and requireAdmin returns the same id from the same
 *   session. Sweeping it out would be a rename.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const USERS = 'src/app/actions/admin/_users.ts';
const BULK = 'src/app/actions/bulk-user-operations.ts';

const ACTOR = 'actor-1';
const TARGET = 'user-1';

/*
 *   A BESPOKE GATE MOCK, AND THE REASON IT IS NOT THE SHARED ONE.
 *
 *   lib/testing/require-admin-mock reads the SESSION's roles, deliberately: in a
 *   unit suite many harnesses blanket-stub every `.get()` to return one
 *   document, so reading the caller's row there judges the actor by the roles of
 *   whoever they are acting on.
 *
 *   This suite is about the token and the record DISAGREEING, so it needs them
 *   to be separately settable. `setLive` below is the database's answer;
 *   `setSession` sets the token's. A shared mock that conflated the two could
 *   not express this finding at all.
 *
 *   It reads the roles off `globalThis` rather than a module variable because a
 *   jest.mock factory may not close over out-of-scope bindings.
 */
jest.mock('@/lib/require-admin', () => ({
    requireAdmin: async (permission?: string) => {
        const { isAdmin, hasAdminPermission } = require('@/lib/admin-permissions');
        const roles = (globalThis as any).__liveRoles as string[];

        if (!isAdmin(roles)) {
            return {
                error: permission
                    ? `Unauthorized: Permission required - ${permission}`
                    : 'Unauthorized: Admin access required',
            };
        }
        if (permission && !hasAdminPermission(roles, permission)) {
            return { error: `Unauthorized: Permission required - ${permission}` };
        }
        return { userId: ACTOR, roles };
    },
    liveAdminRoles: async () => ({ roles: (globalThis as any).__liveRoles as string[] }),
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: jest.fn(async () => ({})),
    logAuditAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
    invalidateServiceCache: jest.fn(async () => ({})),
}));
jest.mock('@/lib/redis', () => ({
    redis: { setex: jest.fn(async () => 'OK'), del: jest.fn(async () => 1), get: jest.fn(async () => null) },
    getCached: jest.fn(async () => null),
    setCache: jest.fn(async () => undefined),
}));

/** What the TOKEN claims. */
function setSession(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/** What the DATABASE says, which is what requireAdmin reads. */
function setLive(roles: string[]) {
    (globalThis as any).__liveRoles = roles;
}

/** The target document both paths read before writing. */
function setTarget(roles: string[] = []) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: TARGET, ref: { id: TARGET }, data: () => ({ roles, email: 't@e.com' }) }],
        ref: { id: TARGET },
        data: () => ({ roles, email: 't@e.com' }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

const update = async (userId: string, roles: string[]) =>
    (await import('@/app/actions/admin')).updateUserRolesAction(userId, roles) as any;

const assign = async (add: string[], ids = [TARGET]) =>
    (await import('@/app/actions/bulk-user-operations'))
        .bulkAssignRolesAction(ids, add, []) as any;

// ─────────────────────────────────────────────────────────────────────────────
describe('#750 — a demoted super_admin cannot reinstate themselves', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setTarget([]);
    });

    it('THE SINGLE-USER WRITER REFUSES, THOUGH THE TOKEN STILL SAYS super_admin', async () => {
        /*
         *   THE finding, as one call. The token is the one they were issued
         *   before the demotion and is still valid for hours; the database has
         *   them as a plain admin. Under the old code both the gate and the
         *   escalation guard read the token, so this wrote ["super_admin"].
         */
        setSession(ACTOR, ['super_admin']);
        setLive(['admin']);

        const r = await update(ACTOR, ['admin', 'super_admin']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/super admin/i);
    });

    it('AND SO DOES THE BULK WRITER — the second door onto the same write', async () => {
        //   Fixing one would leave the escalation intact, which is the shape
        //   #499 and role-escalation both found on this pair.
        setSession(ACTOR, ['super_admin']);
        setLive(['admin']);

        const r = await assign(['super_admin'], [ACTOR]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/super admin/i);
    });

    it('AND A REVOKED ADMIN IS REFUSED AT THE GATE, NOT MERELY AT THE GUARD', async () => {
        /*
         *   The other half of the conversion. Someone whose admin rights are
         *   gone entirely still carries a token claiming them; the guard above
         *   would not catch an ordinary role assignment, because granting
         *   "buyer" trips no escalation rule. The GATE has to be the live one
         *   too, and the refusal names what was required.
         */
        setSession(ACTOR, ['super_admin']);
        setLive(['general_user']);

        const r = await update(TARGET, ['buyer']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toContain('users:assign_roles');
    });

    it('AND THE TOKEN CANNOT REFUSE SOMEBODY THE RECORD ADMITS EITHER', async () => {
        /*
         *   The direction that makes this a correctness fix and not only a
         *   security one: an admin PROMOTED to super_admin since their token
         *   was issued. The old code refused them on a claim that was merely
         *   out of date, and the only remedy was to sign out and back in.
         */
        setSession(ACTOR, ['admin']);
        setLive(['super_admin']);

        const r = await update(TARGET, ['admin']);

        expect(r.success).toBe(true);
    });

    it('and a genuine super_admin still appoints an admin — both paths', async () => {
        //   Vacuity guard. A blanket refusal would satisfy every test above and
        //   leave the platform unable to appoint anybody.
        setSession(ACTOR, ['super_admin']);
        setLive(['super_admin']);

        expect((await update(TARGET, ['admin'])).success).toBe(true);
        expect((await assign(['admin'])).success).toBe(true);
    });

    it('and an ordinary grant by a live admin still goes through', async () => {
        /*
         *   The second vacuity guard, and "buyer" rather than "seller" on
         *   purpose: the single-user path runs through writeGuard, which
         *   enforces an unrelated pre-existing rule about seller verification.
         */
        setSession(ACTOR, ['admin']);
        setLive(['admin']);

        expect((await update(TARGET, ['buyer'])).success).toBe(true);
        expect((await assign(['seller'])).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#750 — and neither file asks the token for a role any more', () => {
    it('EVERY GATE IN BOTH FILES IS requireAdmin WITH A NAMED PERMISSION', () => {
        for (const f of [USERS, BULK]) {
            const src = code(f);
            const named = [...src.matchAll(/requireAdmin\(\s*"[a-z_]+:[a-z_]+"\s*\)/g)];
            const bare = [...src.matchAll(/requireAdmin\(\s*\)/g)];

            expect({ f, named: named.length, bare: bare.length })
                .toEqual({ f, named: 6, bare: 0 });
        }
    });

    it('AND NOTHING IN EITHER FILE READS THE TOKEN FOR A ROLE', () => {
        /*
         *   Stated as an absence over the whole file rather than per call site:
         *   the defect was that TWO expressions read the claim, and a per-site
         *   assertion would have passed with the second still there.
         *
         *   A CORRECTION TO MY OWN FIRST DRAFT, which matched `session.user.roles`
         *   literally and reported both files clean while _users.ts still had
         *   `session?.user?.roles` in the users:read refusal. OPTIONAL CHAINING
         *   WALKED STRAIGHT THROUGH IT. The `\??` below is the fix, and the
         *   expression it found was a real one — see the #750 note at that
         *   refusal for what it was doing.
         */
        for (const f of [USERS, BULK]) {
            expect({ f, reads: /session\??\.user\??\.roles/.test(code(f)) })
                .toEqual({ f, reads: false });
        }
    });

    it('AND THE ESCALATION GUARDS DECIDE ON THE GATE\'S LIVE ROLES', () => {
        /*
         *   The vacuity guard on the assertion above: deleting the guards would
         *   satisfy "does not read the token" perfectly well.
         *
         *   THE PROPERTY, NOT THE SPELLING — corrected from a first draft that
         *   demanded `isSuperAdmin(actorRoles)` twice per file and failed on
         *   bulk-user-operations, which spells two of its three guards
         *   `isSuperAdmin(gate.roles)`. Those are the SAME live roles by a
         *   shorter route; pinning the local name would have called a correct
         *   file wrong, which is the class #741 filed. What matters is that
         *   every isSuperAdmin argument is gate-derived.
         */
        for (const f of [USERS, BULK]) {
            const args = [...code(f).matchAll(/isSuperAdmin\(\s*([^)]*?)\s*\)/g)].map((m) => m[1]);

            expect({ f, args: args.filter((a) => a !== 'actorRoles' && a !== 'gate.roles') })
                .toEqual({ f, args: [] });
            //   And there ARE guards to check. `args: []` passes on a file with
            //   none at all.
            expect({ f, guarded: args.length > 0 }).toEqual({ f, guarded: true });
        }
    });

    it('and actorRoles, where it is used, comes from the gate', () => {
        //   `const actorRoles = session.user.roles` would satisfy every
        //   assertion above except the token sweep — and would reintroduce the
        //   defect under a new name if that sweep were ever relaxed.
        for (const f of [USERS, BULK]) {
            expect({ f, from: code(f).includes('const actorRoles = gate.roles;') })
                .toEqual({ f, from: true });
        }
    });

    it('AND EVERY REFUSAL RELAYS THE GATE\'S OWN REASON', () => {
        /*
         *   Suspended, MFA, or the permission — requireAdmin worked out which,
         *   and an admin who cannot act needs to know. A hand-written
         *   "Unauthorized" discards it.
         *
         *   Counted against the number of GATES rather than pinned to a
         *   literal, so this cannot pass with five of six relaying. My first
         *   draft hard-coded 6 and caught the one that did not: getUsersAction
         *   composed its own message telling the admin to sign out and back in,
         *   which the live gate makes untrue.
         */
        for (const f of [USERS, BULK]) {
            const gates = [...code(f).matchAll(/const gate = await requireAdmin\(/g)].length;
            const relays = [...code(f).matchAll(/return \{[^}]*error: gate\.error/g)].length;

            expect({ f, gates, relays }).toEqual({ f, gates: 6, relays: 6 });
        }
    });

    it('and session.user.id is deliberately still read, for the ACTING id', () => {
        /*
         *   Recorded as a decision rather than left as an omission. #356's
         *   finding is about role CLAIMS; the subject of the claim is not one,
         *   and requireAdmin returns the same id from the same session.
         */
        for (const f of [USERS, BULK]) {
            expect({ f, reads: /session\??\.user\??\.id/.test(code(f)) })
                .toEqual({ f, reads: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#750 — the gate names the permission it refused', () => {
    /*
     *   Not cosmetic, and it is why this landed with the conversion rather than
     *   after it. Each action used to phrase its own refusal — "Unauthorized:
     *   Permission required - users:assign_roles" — and delegating to a gate
     *   that said only "Admin access required" would have silently reworded the
     *   refusal on every site #748, #749 and #750 converted.
     */
    const GATE = 'src/lib/require-admin.ts';

    it('AN ADMIN WITHOUT THE PERMISSION IS TOLD WHICH PERMISSION', () => {
        expect(code(GATE)).toContain('return { error: `Unauthorized: Permission required - ${permission}` };');
    });

    it('AND SO IS A CALLER WHO IS NOT AN ADMIN AT ALL, WHEN ONE WAS NAMED', () => {
        //   They lack it either way, and naming it is the more actionable of
        //   the two things that could be said.
        const gate = code(GATE);

        expect(gate).toContain('permission');
        expect(gate).toContain('? `Unauthorized: Permission required - ${permission}`');
        expect(gate).toContain(': "Unauthorized: Admin access required",');
    });

    it('and a BARE gate still says only that admin access is required', () => {
        /*
         *   There is nothing narrower to say, and #356/#374's one deliberate
         *   bare gate — getEscalationNotesAction — depends on this wording.
         *   Asserted through the real gate's behaviour in
         *   one-admin-test-not-six.test.ts; here as the shape on disk.
         */
        expect(code(GATE)).toContain('"Unauthorized: Admin access required"');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#750 — and the advice that went with the old gate went with it', () => {
    /**
     *   FOUND BY THE CONVERSION, AND NOT A TIDY-UP. Moving the decision to the
     *   database left two places telling a refused admin to SIGN OUT AND SIGN
     *   BACK IN, which was sound advice about a stale token and is now a loop
     *   that cannot change the answer:
     *
     *     _users.ts::getUsersAction   composed its own refusal — "your session
     *                                 does not have the 'users:read'
     *                                 permission. Current roles: [...]. Please
     *                                 sign out and sign back in" — printing the
     *                                 TOKEN's roles as "Current", which is the
     *                                 claim the gate had just declined to trust
     *     admin/users/page.tsx        showed the same guidance, with a Sign Out
     *                                 & Refresh button, for EVERY Unauthorized
     *
     *   Both also flattened four different refusals into one. A suspended
     *   account and an admin pending MFA enrolment were told they might have
     *   the wrong roles and should re-authenticate; neither is true, and for the
     *   suspended account the suggested remedy locks them out of the session
     *   they still had.
     */
    const PAGE = 'src/app/admin/users/page.tsx';

    it('THE ACTION NO LONGER PRESCRIBES A RE-LOGIN, OR QUOTES THE TOKEN BACK', () => {
        const src = code(USERS);

        expect(src).not.toContain('sign out and sign back in');
        expect(src).not.toContain("does not have the 'users:read' permission");
    });

    it('AND THE SCREEN OFFERS THE BUTTON ONLY WHEN SIGNING IN AGAIN WOULD HELP', () => {
        /*
         *   The distinction is real: an expired or missing session IS fixed by
         *   re-authenticating, and a refusal on roles, a suspension and an MFA
         *   verdict are not. Removing the button outright would have lost the
         *   one case it was right about.
         */
        const page = code(PAGE);

        //   THE BUTTON'S OWN GUARD, not the ternary that picks the wording
        //   above it. A first draft asserted only the bare condition text, and
        //   the mutant that made the button unconditional — `{(true) && (` —
        //   SURVIVED, because the ternary still carried that same text. Two
        //   things are conditioned on one fact here, and the test has to say
        //   which one it means. Anchored on the button element that follows.
        expect(page).toMatch(
            /\{\(error\.includes\("Unauthenticated"\) \|\| error\.includes\("expired"\)\) && \(\s*<button/);
        expect(page).toContain('signing out and back in will not change this');
    });

    it('AND IT STILL SHOWS THE GATE\'S OWN REASON, WHICH IS NOW THE USEFUL PART', () => {
        //   Vacuity guard in the other direction: a banner that says only
        //   "ask a super admin" and hides which permission was refused is worse
        //   than the advice it replaced.
        expect(code(PAGE)).toContain('Access Error: {error}');
        //   And it announces itself, like #742's read-failure banner — an admin
        //   who cannot see the list needs to be told, not left with a blank one.
        expect(code(PAGE)).toContain('role="alert"');
    });

    it('and the suspension case reaches the banner at all', () => {
        /*
         *   The gate's suspension refusal is "Account suspended. Contact
         *   support." — no "Unauthorized", no "session", no "expired" — so
         *   under the previous condition it fell through every branch and the
         *   screen showed nothing at all.
         */
        expect(code(PAGE)).toContain('error.includes("suspended")');
        expect(code('src/lib/require-admin.ts')).toContain('Account suspended');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#750 — and the stale-JWT ledger recorded the progress', () => {
    it('THE COUNT IS DOWN FROM 80 TO 78 (77 AS OF #757)', () => {
        /*
         *   #743's mechanism, third finding running. Two files left the
         *   population; under the `<= 88` ceiling that ledger replaced, this
         *   would have been silence and the slack would have grown again.
         */
        expect(code('src/__tests__/unit/half-converted-off-the-stale-token.test.ts'))
            .toContain('ledgerVerdict(jwtOnly.length, 77)');
    });

    it('AND THE NAMED-PERMISSION CENSUS COUNTED THE TWELVE NEW GATES (69 AS OF #757)', () => {
        //   55 → 67. That suite pins the permission each site names, so a gate
        //   added and forgotten fails it.
        expect(code('src/__tests__/unit/require-admin-names-its-permission.test.ts'))
            .toContain('expect(callSites().length).toBe(69)');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored from a snapshot copy
 *   keyed by FULL PATH, each mutant proving its edit landed by a unique string
 *   on disk.
 *
 *     MUTANT                                                        RESULT
 *     the single-user guard goes back to session.user.roles          KILLED
 *     the single-user CURRENT-roles guard goes back to the token     KILLED
 *     the bulk guard goes back to session.user.roles                 KILLED
 *     the single-user role gate drops its permission                 KILLED
 *     the bulk role gate drops its permission                        KILLED
 *     actorRoles is assigned from the session instead of the gate    KILLED
 *     one refusal swallows the gate's reason                         KILLED
 *     requireAdmin stops naming the permission it refused            KILLED
 *     the re-login advice is put back on the action                  KILLED
 *     the screen offers the sign-out button for every refusal        KILLED †
 *     the screen stops reaching the suspension case                  KILLED
 *     the ledger is raised back to 80                                KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                             SURVIVED ✓
 *
 *   † SURVIVED ON THE FIRST PASS, AND THE TEST WAS WRONG, NOT THE MUTANT.
 *     `{(true) && (<button` left the button unconditional and the assertion
 *     still passed, because it matched the condition's TEXT — which also
 *     appears in the ternary picking the wording above it. Two things are
 *     conditioned on one fact there and the test did not say which it meant.
 *     Re-anchored on the button element itself; killed.
 *
 *   AND ONE MUTANT THIS SUITE CANNOT KILL, NAMED RATHER THAN OMITTED:
 *
 *     requireAdmin reads the session's roles instead of the live ones
 *
 *   It survives here because this suite MOCKS the gate — deliberately, so the
 *   token and the record can disagree — and the real gate's body never runs. It
 *   is killed by one-admin-test-not-six.test.ts, which owns that behaviour and
 *   fails four tests on it. Verified by running the mutant against that suite
 *   rather than assumed.
 */
