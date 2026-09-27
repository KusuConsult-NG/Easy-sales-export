/**
 * @jest-environment node
 */

/**
 * #954 ELEVEN FILES GRANT ROLES FROM THE TOKEN, AND THE DOOR LEDGER HAD BEEN
 *      SWEEPING ONE SPELLING OF TWO.
 *
 * #750 moved admin/_users.ts and bulk-user-operations.ts off the JWT. It was
 * precise about why those two: they "are the only two writes on the platform that
 * can put 'super_admin' into a roles array", because "every other role-touching
 * write uses arrayUnion with a fixed participant role". Correct, and it names its
 * own deferral.
 *
 * #951 summarised that in one line as "the two role-writing files, converted
 * WHOLE", losing the qualifier that did the work — and this finding began by
 * measuring against MY summary rather than against #750. The count was never
 * wrong. A summary of it was, and the eleven deferred files travelled in prose
 * from then on.
 *
 * Two things went wrong at once, and they are separable:
 *
 *   1. THE DEFERRAL WAS CARRIED IN PROSE. #750 cannot be faulted for deferring
 *      the lesser risk; it can only be followed up, and nothing was watching.
 *      The risk is not nil: a revoked admin can still grant paid Academy access,
 *      cooperative membership or seller status for the life of their token, and
 *      the grant outlives the revocation. #948's lesson applies — a note that
 *      cannot tell you it has gone stale is not a ledger.
 *
 *   2. THE LEDGER COUNTED `hasAdminPermission(` ONLY. Every door count in #951,
 *      #952 and #953 — 75, then 64, then 60 — came from that one sweep.
 *      `isAdmin(session.user.roles)` reads the same JWT array and refuses on the
 *      same stale claim, and there are 53 of those in refusal position plus 3
 *      positive admin fast-paths. The number went DOWN three findings in a row,
 *      which is what made it hard to notice: it looked like progress, and it was
 *      progress, on a little over half the doors.
 *
 * WHAT THIS SUITE HOLDS
 * ---------------------
 *   - the instrument, on fixtures, including the two shapes a naive version got
 *     wrong in ways that would have flattered the ledger
 *   - three ledgers, each ratcheting in both directions
 *   - the two clauses #951's rule was missing, which the measurement forced
 *   - the four academy gates this finding converted, per GATE
 */

import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import {
    findRoleWrites,
    findTokenGates,
    findRoleLiteralGates,
    findIsAdminDoors,
    scanRoleWriteDoors,
    scanRoleLiteralGates,
    scanIsAdminDoors,
    roleWritersOnTheToken,
    unclassifiedRoleSources,
    rolesSourceOf,
} from '@/lib/testing/role-write-doors';
import {
    mustRevalidateLive,
    mustRevalidateLiveForDoor,
    IRREVERSIBLE_PERMISSIONS,
    REVERSIBLE_PERMISSIONS,
    NO_ROLE_LITERALS_IN_GATES,
} from '@/lib/stale-authorisation';
import { ledgerVerdict, LEDGER_HELD } from '@/lib/testing/ledger';
import { stripComments } from '@/lib/testing/strip-comments';

const SRC = path.join(process.cwd(), 'src');
const DIRS = ['app', 'lib', 'components'] as const;

function code(rel: string): string {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
}

/**
 * The scanners take COMMENT-STRIPPED source, and the first version of this suite
 * handed them raw source — so the comment in _ac_admin_review.ts that QUOTES the
 * gate it replaced was counted as seven live token gates. A finding that explains
 * itself in a comment is exactly the file most likely to trip that.
 */
function stripped(rel: string): string {
    return stripComments(code(rel), { minRetainedRatio: 0, label: rel });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('the instrument, before any number it produces is believed', () => {
    it('finds a role write inside a write call', () => {
        const src = `await userRef.update({ roles: FieldValue.arrayUnion("x"), updatedAt: 1 });`;
        expect(findRoleWrites(src).map((w) => w.shape)).toEqual(['in-call']);
    });

    it('finds a role write in a payload built in a local first', () => {
        //   The shape I added for completeness and wrote off as absent. It is
        //   present nine times, and six files have NOTHING ELSE — see the next
        //   test, which is the one that matters.
        const src = [
            'const patch = { roles: nextRoles, updatedAt: now };',
            'await userRef.update(patch);',
        ].join('\n');
        expect(findRoleWrites(src).map((w) => w.shape)).toEqual(['via-local']);
    });

    it('finds a role write routed through a named write helper', () => {
        /*
         *   The third shape, and the assertion below is what found it. No write
         *   METHOD appears: the payload is an argument to writeGuard, which is an
         *   argument to atomicUpdateUser. admin/_users.ts — the file #750
         *   converted and NAMED — writes roles only this way, so the scanner
         *   reported the file that started this finding as writing none.
         */
        const src = [
            'await atomicUpdateUser(userId, writeGuard(',
            '    UserRolesWriteSchema, { roles: roles }, "admin/updateUserRoles"));',
        ].join('\n');
        expect(findRoleWrites(src).length).toBeGreaterThanOrEqual(1);
    });

    it('sees admin/_users.ts as a role writer — the vacuity guard that caught the above', () => {
        const doors = scanRoleWriteDoors(DIRS, SRC);
        const users = doors.find((d) => d.file === 'app/actions/admin/_users.ts');

        expect(users).toBeDefined();
        expect(users!.roleWrites.length).toBeGreaterThan(0);
        //   And it is still converted, which is the point of watching it at all.
        expect(users!.tokenGates).toEqual([]);
        expect(users!.liveGates).toBeGreaterThan(0);
    });

    it('WOULD HAVE MISSED SIX FILES, ONE OF THEM A ROLE WRITER ON THE TOKEN', () => {
        /*
         *   The counterfactual, measured rather than argued. Removing the
         *   via-local clause is simulated by keeping only in-call writes.
         *
         *   actions/cooperative/_coop_admin_members.ts grants and revokes
         *   cooperative membership roles in three places and gates all five of
         *   its doors on the token. Every one of its three role payloads is built
         *   in a local, so an in-call-only scanner reports it as writing no roles
         *   — and the ledger below would read 10 files instead of 11, look
         *   complete, and be wrong in the only direction that matters.
         */
        const doors = scanRoleWriteDoors(DIRS, SRC);
        const vanished = doors.filter((d) => d.roleWrites.every((w) => w.shape === 'via-local'));

        expect(vanished.map((d) => d.file)).toContain('app/actions/cooperative/_coop_admin_members.ts');
        expect(vanished.length).toBeGreaterThanOrEqual(6);

        const coop = doors.find((d) => d.file === 'app/actions/cooperative/_coop_admin_members.ts');
        expect(coop?.roleWrites).toHaveLength(3);
        expect(coop?.roleWrites.every((w) => w.shape === 'via-local')).toBe(true);

        /*
         *   #955 THIS USED TO PIN coop.tokenGates AT 5, AND #955 CONVERTED TWO OF
         *   THEM — so the control failed on the fix it was describing. Fourth time
         *   in this programme (#952, #953, and admin-permission-gates' fallback
         *   control in this same finding).
         *
         *   "Five gates" was the illustration; the property is that this file's
         *   role writes are ALL via-local, so an in-call-only scanner loses the file
         *   entirely — and losing it still costs the ledger a role writer that is on
         *   the token. That holds at 5 gates and at 1, which is why it is asserted
         *   this way now. The exact gate count lives in the ledger below, where it
         *   is meant to move.
         */
        expect(coop!.tokenGates.length).toBeGreaterThan(0);
    });

    it('TELLS A TOKEN READ FROM A LIVE ONE — mine did not, and #532\'s always has', () => {
        /*
         *   #956 THE LOOSE SWEEP WAS MINE.
         *
         *   #532's ledger has always been `/hasAdminPermission\(\s*session/` — the
         *   token in the first argument — and its counts were never wrong. The
         *   version I wrote in #954 matched any hasAdminPermission call, so
         *   _coop_admin_members.ts stayed on the ledger below after #955 converted
         *   its gates: what remained is line 846, hasAdminPermission(liveRoles, …),
         *   feeding the member PII decision from roles that really are live. A
         *   ledger that cannot reach zero stops being read.
         *
         *   Measured tree-wide: 138 calls, 107 token, 5 live, 26 whose first
         *   argument is a variable the call site does not explain.
         *
         *   A CLASSIFICATION, NOT A FILTER, and the direction is why. Narrowing a
         *   sweep LOWERS a count, which reads exactly like progress — #948's finding
         *   is that a count falling because the instrument went blind cannot be told
         *   from one falling because sites were fixed. So "unknown" is carried and
         *   pinned below rather than dropped into whichever bucket is convenient.
         */
        expect(rolesSourceOf('session.user.roles')).toBe('token');
        expect(rolesSourceOf('session?.user?.roles')).toBe('token');

        expect(rolesSourceOf('liveRoles')).toBe('live');
        expect(rolesSourceOf('[...liveRoles]')).toBe('live');
        expect(rolesSourceOf('gate.roles')).toBe('live');
        expect(rolesSourceOf('userDoc.data()?.roles')).toBe('live');

        //   Names that say nothing about provenance. Guessing either way is the
        //   mistake; they get their own bucket.
        expect(rolesSourceOf('callerRoles')).toBe('unknown');
        expect(rolesSourceOf('roles')).toBe('unknown');
        expect(rolesSourceOf('viewer.roles')).toBe('unknown');
    });

    it('and the live read in _coop_admin_members is NOT on the backlog', () => {
        //   The concrete instance. #955 converted this file's two token gates; the
        //   hasAdminPermission(liveRoles, …) left behind is correct code, and the
        //   loose sweep kept the file listed as though it were not.
        const doors = scanRoleWriteDoors(DIRS, SRC);
        const coop = doors.find((d) => d.file === 'app/actions/cooperative/_coop_admin_members.ts');

        expect(coop).toBeDefined();
        expect(coop!.tokenGates.map((g) => g.source)).toEqual(['live']);
        expect(roleWritersOnTheToken(doors).map((d) => d.file))
            .not.toContain('app/actions/cooperative/_coop_admin_members.ts');
    });

    it('NO GATE HAS AN UNCLASSIFIABLE ROLES SOURCE — pinned so a new one is noticed', () => {
        //   Zero today among role-writing files. Pinned rather than assumed,
        //   because "unknown" is the bucket that would otherwise absorb a real
        //   token read and make the ledger look finished.
        expect(unclassifiedRoleSources(scanRoleWriteDoors(DIRS, SRC))).toEqual([]);
    });

    it('does NOT count a response projection as a grant', () => {
        //   The first version of this scan was a grep for `roles:` and reported
        //   thirteen files. Two of them could not grant anything: they map a user
        //   row to a row a screen renders. A security ledger with two entries
        //   nobody can act on is a ledger people learn to skip.
        const src = [
            'return rows.map((u) => ({',
            '    id: u.id, name: u.fullName, email: u.email, roles: u.roles || [],',
            '}));',
        ].join('\n');
        expect(findRoleWrites(src)).toEqual([]);
    });

    it('does NOT count a type declaration, an interface or a logger field', () => {
        expect(findRoleWrites('interface U { roles: string[]; }')).toEqual([]);
        expect(findRoleWrites('const S = z.object({ roles: z.array(z.string()) });')).toEqual([]);
        expect(findRoleWrites('logger.warn("no admin in scope", { roles: userRoles });')).toEqual([]);
    });

    it('counts token gates per CALL, not per file', () => {
        //   #952's M41 survived a per-file sweep: reverting one of three gates
        //   left the file still containing the live form, so the sweep passed.
        const src = [
            'if (!hasAdminPermission(session.user.roles, "users:update")) return a;',
            'if (!hasAdminPermission(session.user.roles, "users:read")) return b;',
        ].join('\n');
        expect(findTokenGates(src).map((g) => g.permission)).toEqual(['users:update', 'users:read']);
    });

    it('sees a role literal that forgives the refusal, across a line break', () => {
        const src = [
            'if (!session?.user || !hasAdminPermission(session.user.roles, "users:update") &&',
            '    !session.user.roles?.includes("academy_admin")) {',
            '    return refuse;',
        ].join('\n');
        const found = findRoleLiteralGates(src);
        expect(found).toHaveLength(1);
        expect(found[0].permission).toBe('users:update');
        expect(found[0].role).toBe('academy_admin');
    });

    it('does not cry role literal at a plain permission gate', () => {
        const src = 'if (!hasAdminPermission(session.user.roles, "users:update")) return refuse;';
        expect(findRoleLiteralGates(src)).toEqual([]);
    });

    it('reads a single-line `if (… && !isAdmin(…)) return x;` as a refusal', () => {
        /*
         *   The bug this replaced, kept as a fixture because it failed CLOSED —
         *   it called a door a binding, which subtracts from the door count.
         *
         *   Taking a fixed character window from the match put the window's start
         *   after the statement's first `;`, which for a same-line body is the one
         *   ENDING the return. So the scanner looked past the refusal it was
         *   trying to classify. actions/certificates.ts:160 is the real instance.
         */
        const src = 'if (!await isOwnedBySession(userId, session.user.id) && !isAdmin(session.user.roles)) return [];';
        const found = findIsAdminDoors(src);
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe('refusal');
        expect(found[0].ownerOrAdmin).toBe(true);
    });

    it('tells a refusal, an admission and a binding apart', () => {
        expect(findIsAdminDoors('if (!isAdmin(session.user.roles)) { return { error: "no" }; }')[0].kind)
            .toBe('refusal');
        //   The admin FAST PATH. It decides authorisation from the token exactly as
        //   a refusal does, and is the easier of the two to read past.
        expect(findIsAdminDoors('if (isAdmin(session.user.roles)) { return everything; }')[0].kind)
            .toBe('admission');
        //   Decides what to SHOW, not whether to admit. #535's rule, and
        //   mayRevealMemberPii is its live-reading form.
        expect(findIsAdminDoors('const viewerIsAdmin = isAdmin(session?.user?.roles);')[0].kind)
            .toBe('binding');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the rule gains the two clauses the measurement forced', () => {
    it('a disjunction takes the MAXIMUM over its disjuncts', () => {
        /*
         *   Three gates in actions/admin/_exports.ts admit `users:update` OR
         *   `export:approve_applications` — one irreversible, one reversible.
         *   mustRevalidateLive is total over permissions and had no answer for a
         *   door naming two.
         *
         *   The rule settles it, because of what it is about: the EFFECT belongs
         *   to the door, and does not change depending on which branch of an ||
         *   let the caller in. Taking the minimum would give the export_admin a
         *   stale window on the very act the admin beside them is re-checked for.
         */
        expect(mustRevalidateLive('users:update')).toBe(true);
        expect(mustRevalidateLive('export:approve_applications')).toBe(false);

        expect(mustRevalidateLiveForDoor({
            permissions: ['users:update', 'export:approve_applications'],
        })).toBe(true);
        //   Order must not decide it.
        expect(mustRevalidateLiveForDoor({
            permissions: ['export:approve_applications', 'users:update'],
        })).toBe(true);
    });

    it('two reversible permissions stay reversible — the clause only ever adds', () => {
        expect(mustRevalidateLiveForDoor({
            permissions: ['export:approve_applications', 'academy:manage_courses'],
        })).toBe(false);
    });

    it('a role write forces a live read even on a reversible permission', () => {
        /*
         *   Nine of the eleven role-writing files gate on a permission this rule
         *   calls reversible, and the classifications are RIGHT — a cooperative
         *   membership approved is a membership revoked. The door granting it
         *   writes `roles`, and #750's compounding case then applies in full: the
         *   grant outlives the granter's own revocation, and nobody goes looking
         *   for access that was granted legitimately eight hours ago.
         */
        expect(mustRevalidateLive('cooperatives:approve_members')).toBe(false);
        expect(mustRevalidateLiveForDoor({
            permissions: ['cooperatives:approve_members'],
            writesRoles: true,
        })).toBe(true);

        for (const p of REVERSIBLE_PERMISSIONS) {
            expect(mustRevalidateLiveForDoor({ permissions: [p], writesRoles: true })).toBe(true);
        }
    });

    it('agrees with mustRevalidateLive on every single-permission door', () => {
        for (const p of [...IRREVERSIBLE_PERMISSIONS, ...REVERSIBLE_PERMISSIONS]) {
            expect(mustRevalidateLiveForDoor({ permissions: [p] })).toBe(mustRevalidateLive(p));
        }
    });

    it('throws on a door with no permissions rather than guessing', () => {
        //   A gate admitting nobody by permission decides from something that is
        //   not the matrix — a role literal, most likely. Defaulting either way is
        //   how the next door gets decided by accident.
        expect(() => mustRevalidateLiveForDoor({ permissions: [] })).toThrow(/no permissions/);
        expect(NO_ROLE_LITERALS_IN_GATES).toMatch(/never from a role name/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the four gates this finding converted, per GATE', () => {
    const REVIEW = 'app/actions/academy/_ac_admin_review.ts';
    const APPS = 'app/actions/academy/_ac_admin_applications.ts';

    it('_ac_admin_review has THREE live gates and no token gate', () => {
        //   Per-gate, not per-file: an exact count is what stops one of the three
        //   being reverted while the file still contains the live spelling.
        const src = code(REVIEW);
        expect((src.match(/requireAdmin\("academy:approve_applications"\)/g) ?? [])).toHaveLength(3);
        expect(findTokenGates(stripped(REVIEW))).toEqual([]);
        expect(findRoleLiteralGates(stripped(REVIEW))).toEqual([]);
    });

    it('_ac_admin_applications has ONE live gate, and keeps its three isAdmin doors', () => {
        /*
         *   The three `isAdmin(session.user.roles)` gates in this file are NOT
         *   converted by this finding and the count is pinned so that saying so
         *   stays honest — they are part of the 56-door ledger below, not of this
         *   change. Pinning it also stops the file being "finished" by deleting
         *   them.
         */
        const src = code(APPS);
        expect((src.match(/requireAdmin\("academy:approve_applications"\)/g) ?? [])).toHaveLength(1);
        expect(findTokenGates(stripped(APPS))).toEqual([]);
        expect(findRoleLiteralGates(stripped(APPS))).toEqual([]);
        expect(findIsAdminDoors(stripped(APPS)).filter((d) => d.kind === 'refusal')).toHaveLength(3);
    });

    it('the converted doors still write what they wrote, so the gate is not the whole change', () => {
        //   Vacuity guard. "No token gate" is also satisfied by a file that no
        //   longer does anything.
        const src = code(REVIEW);
        expect(src).toContain('roles: FieldValue.arrayUnion("academy_participant")');
        expect(src).toContain('roles: FieldValue.arrayRemove(...moduleGrantRoles("academy"))');
        expect(src).toContain('"serviceRegistrations.academy.plan": normalisedPlan');
    });

    it('the pending queue pays for its live read once, not twice', () => {
        //   #758 gave mayRevealMemberPii a liveRoles parameter precisely so a
        //   caller that already holds a live gate does not read the same row again.
        //   Converting the gate without passing them would have added a query to
        //   a queue this audit spent #283–#289 making cheaper.
        expect(code(APPS)).toContain('mayRevealMemberPii("academy:approve_applications", gate.roles)');
    });

    it('and the refusal names a permission the door actually requires', () => {
        /*
         *   The old refusal read "Unauthorized: Permission required - users:update"
         *   at a door that did not require users:update — it admitted academy_admin,
         *   who holds that permission nowhere. requireAdmin names what it checked.
         */
        const { hasAdminPermission } = require('@/lib/admin-permissions');
        expect(hasAdminPermission(['academy_admin'], 'users:update')).toBe(false);
        expect(hasAdminPermission(['academy_admin'], 'academy:approve_applications')).toBe(true);

        for (const rel of [REVIEW, APPS]) {
            expect(code(rel)).not.toContain('Permission required - users:update');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('THE LEDGERS', () => {
    it('NO GATE IN THE TREE DECIDES FROM A ROLE NAME', () => {
        /*
         *   Closed, so pinned at zero rather than ratcheted. #365 shut this shape
         *   in _exports.ts and _marketplace.ts and recorded that THERE the literal
         *   "admitted nobody the permissions did not"; in the academy it admitted
         *   academy_admin, who reached four doors outside the matrix entirely —
         *   three of which write roles.
         *
         *   Zero is the right pin because there is no legitimate instance: a gate
         *   decides from a permission, and a role name hand-copies a set the matrix
         *   already defines.
         */
        const literals = scanRoleLiteralGates(DIRS, SRC);
        expect(literals.map((g) => `${g.file}:${g.line}`)).toEqual([]);
    });

    it('ROLE-WRITING FILES STILL ON THE TOKEN — recorded 10', () => {
        /*
         *   #955 10 -> 9 files, 32 -> 26 gates: the cooperative gates that read the
         *   record only when the token said no.
         *
         *   #956 9 -> 3 files, 26 -> 17 gates, AND IT MOVED FOR TWO REASONS. Reported
         *   separately because #948's whole finding is that a ledger reporting the net
         *   of two causes tells you nothing:
         *
         *     9 -> 8 files, 26 -> 25 gates   THE INSTRUMENT, not progress. The sweep
         *                                    counted hasAdminPermission(liveRoles, …)
         *                                    in _coop_admin_members as a token read.
         *     8 -> 3 files, 25 -> 17 gates   REAL: eight gates converted — three in
         *                                    _fn_admin, two in _wv_admin_applications,
         *                                    one in each marketplace seller route.
         *
         *   What is left is the three admin/* files, deliberately: _exports.ts (7,
         *   three of them users:update OR export:approve_applications disjunctions
         *   that requireAdmin(P) cannot express), _academy.ts (5), _marketplace.ts (5).
         */
        const RECORDED_FILES = 3;
        const RECORDED_GATES = 17;

        const doors = scanRoleWriteDoors(DIRS, SRC);
        const onToken = roleWritersOnTheToken(doors);
        const gates = onToken.reduce((n, d) => n + d.tokenGates.length, 0);

        //   Vacuity floor: if the scan stopped finding role writes at all, both
        //   numbers would fall to zero and read as a clean sweep.
        expect(doors.length).toBeGreaterThanOrEqual(26);

        expect(ledgerVerdict(onToken.length, RECORDED_FILES)).toBe(LEDGER_HELD);
        expect(ledgerVerdict(gates, RECORDED_GATES)).toBe(LEDGER_HELD);

        //   And the two #750 converted stay converted.
        for (const rel of ['app/actions/admin/_users.ts', 'app/actions/bulk-user-operations.ts']) {
            const d = doors.find((x) => x.file === rel);
            expect(d?.tokenGates ?? []).toEqual([]);
            expect(d?.liveGates ?? 0).toBeGreaterThan(0);
        }
    });

    it('THE SECOND SPELLING — isAdmin doors, recorded 70 of which 61 are on the token', () => {
        /*
         *   The count #951, #952 and #953 never took. 53 refusals and 3 positive
         *   admin fast-paths, against the 60 `hasAdminPermission` doors those
         *   findings were working down — so the door backlog is a little under
         *   twice what the ledger said, and the three conversions that came before
         *   this one were real progress on a little over half of it.
         *
         *   Recorded here rather than converted here. 56 gates across 26 files is
         *   not one change, and 15 of the refusals are the owner-or-admin shape
         *   OWNER_OR_ADMIN_SHAPE already records as needing a per-site edit: the
         *   live read has to sit inside the non-owner branch, or every member pays
         *   a database read to act on their own row and is then refused for not
         *   being an admin.
         */
        /*
         *   #959 THIS LEDGER MOVED 56 -> 70 FOR TWO REASONS AND BOTH ARE STATED,
         *        WHICH IS #948'S RULE. Reporting the net would hide each behind
         *        the other.
         *
         *   LEG ONE, AND IT IS NOT PROGRESS: +14 DOORS THE SCAN COULD NOT SEE.
         *   The regex was `isAdmin\(\s*session[^)]*\)` — the roles named inside
         *   the call. Fourteen doors name them one line earlier instead:
         *
         *       const roles = sessionResult.session?.user?.roles || [];
         *       if (!isAdmin(roles)) redirect("/dashboard");
         *
         *   That is components/admin/AdminShell.tsx, THE DOOR EVERY OTHER ADMIN
         *   SCREEN SITS BEHIND, and it was not in the 56. The owner reported being
         *   refused by it — "my admin credentials takes me to the users dashboard
         *   not the admin portal" — while every admin ACTION admitted them, and
         *   this ledger had no row for the thing that was refusing them.
         *
         *   A count that cannot see the largest instance of what it counts is
         *   worse than no count: 75 -> 64 -> 60 -> 56 read as four rounds of
         *   progress while the biggest door was never in the denominator.
         *
         *   LEG TWO, AND IT IS ONE DOOR: AdminShell now reads the row, so of the
         *   70 it is `live` rather than `token`. Without that fix this would be 62
         *   token and 4 live; it is 61 and 5.
         *
         *   WHY THE TOKEN COUNT IS NOW THE HEADLINE. 70 counts doors; 61 counts
         *   the ones still deciding from a two-minute-old JWT claim, which is what
         *   #951 is working down. The total can only fall as files are deleted; the
         *   token count falls as doors are converted, which is the work.
         */
        const RECORDED_DOORS = 70;
        /**
         *   #962 61 -> 48, AND THE TOTAL DID NOT MOVE. Both halves matter.
         *
         *   Thirteen doors now read the row: export-admin.ts (5),
         *   admin/_marketplace.ts (4), cooperative/_loans_applications.ts (4).
         *   The owner's decision was live read, KEEP isAdmin's ten roles — so
         *   `support` and `moderator` lose nothing, and this is a security fix
         *   with no width change. RECORDED_OWNER_OR_ADMIN is unchanged at 15 for
         *   the same reason.
         *
         *   THE FIRST ATTEMPT AT THIS LEDGER LIED, AND IT LIED THE WAY #954's
         *   HEADER SAYS LEDGERS LIE. Converting a door gives it an argument that
         *   is a CALL — `isAdmin(await liveRolesForDoor(...))` — which matched
         *   neither of the scan's two patterns, so the thirteen VANISHED instead
         *   of moving. The door total fell 70 -> 57, token fell 61 -> 48, and
         *   live did not move at all. Two of those three numbers were right and
         *   the thirteen looked like progress.
         *
         *   A ledger must not lose sight of a door for being FIXED. The scan has
         *   a third pattern now, and the live count below is asserted so a
         *   conversion has to show up as a GAIN somewhere rather than only as a
         *   decrease — which is the shape that hid this.
         */
        /*
         *   #962 BATCH 2: 48 -> 35 on the token, 18 -> 31 live. Thirteen more —
         *   academy/_ac_admin_applications (3), _ac_admin_catalog (2),
         *   _ac_admin_reports (2), admin-analytics (3), and cooperative/
         *   _coop_admin_reports (3). Total still 70; every door that left the
         *   token arrived at `live`, which is the invariant the third assertion
         *   below checks.
         */
        const RECORDED_TOKEN_DOORS = 35;
        const RECORDED_LIVE_DOORS = 31;
        const RECORDED_OWNER_OR_ADMIN = 15;

        /*
         *   The four doors whose roles this resolver cannot follow, named rather
         *   than left in a bucket — because "unknown" is where a token door goes
         *   to hide, and an unnamed bucket that grows is indistinguishable from one
         *   that is merely imprecise. Each checked by hand:
         *
         *     admin/_users.ts:1380      judges the roles the REQUEST proposes
         *                               ("cannot remove your own admin
         *                               privileges"), not an authorisation read.
         *                               Not a door at all, strictly.
         *     admin-permissions.ts:578  adminLandingPath — the RULE, a parameter.
         *     admin-permissions.ts:753  adminSiloRedirect — the RULE, a parameter.
         *     module-access-check.ts:125 isAdmin(jwtRoles) — genuinely a token
         *                               door, and a function parameter, so no
         *                               number of resolution hops reaches it. The
         *                               one real gap, recorded as one.
         */
        const RECORDED_UNKNOWN = 4;
        const UNKNOWN_SITES = [
            'app/actions/admin/_users.ts',
            'lib/admin-permissions.ts',
            'lib/module-access-check.ts',
        ];

        const all = scanIsAdminDoors(DIRS, SRC);
        const doors = all.filter((d) => d.kind === 'refusal' || d.kind === 'admission');

        //   Vacuity floor, and it is the one that matters most here: this ledger
        //   is only meaningful while the scan still finds the BINDINGS too. If
        //   isAdmin stopped being recognised at all, every count goes to zero.
        expect(all.length).toBeGreaterThanOrEqual(60);
        expect(all.filter((d) => d.kind === 'binding').length).toBeGreaterThanOrEqual(9);

        expect(ledgerVerdict(doors.length, RECORDED_DOORS)).toBe(LEDGER_HELD);
        expect(ledgerVerdict(
            doors.filter((d) => d.source === 'token').length,
            RECORDED_TOKEN_DOORS,
        )).toBe(LEDGER_HELD);

        /*
         *   #962 — the counterweight. `token` falling is only progress if the
         *   doors went somewhere; this says where. A door lost to a scanner blind
         *   spot lowers the first number and not this one, which is precisely
         *   what happened on the first attempt.
         */
        const live = doors.filter((d) => d.source === 'live').length;
        expect({ live }).toEqual({ live: RECORDED_LIVE_DOORS });
        //   And the three sources still account for every door.
        expect(live + doors.filter((d) => d.source === 'token').length
            + doors.filter((d) => d.source === 'unknown').length).toBe(doors.length);
        expect(ledgerVerdict(
            doors.filter((d) => d.ownerOrAdmin).length,
            RECORDED_OWNER_OR_ADMIN,
        )).toBe(LEDGER_HELD);

        const unknown = doors.filter((d) => d.source === 'unknown');
        expect(ledgerVerdict(unknown.length, RECORDED_UNKNOWN)).toBe(LEDGER_HELD);
        //   And they are the four that were checked, not four others.
        expect([...new Set(unknown.map((d) => d.file))].sort()).toEqual(UNKNOWN_SITES);
    });

    it('AND THE DOOR THAT GATES THE WHOLE PORTAL READS THE ROW — #959, pinned', () => {
        /*
         *   The one conversion this finding made, asserted by provenance rather
         *   than by count, so it cannot be satisfied by some other door moving.
         *
         *   app/admin/page.tsx is the OTHER half of the same bounce and is not
         *   here, because it does not call isAdmin — it asks adminLandingPath,
         *   which is a third spelling this scan still does not sweep. Recorded as
         *   a known limit rather than implied away: the behavioural coverage for
         *   that door is in the-portal-that-sent-you-to-the-other-dashboard.
         */
        const doors = scanIsAdminDoors(DIRS, SRC)
            .filter((d) => d.file === 'components/admin/AdminShell.tsx');

        expect(doors.length).toBeGreaterThan(0);
        for (const d of doors) {
            expect({ line: d.line, source: d.source }).toEqual({ line: d.line, source: 'live' });
        }
    });

    it('SEVEN OF THE TEN ARE INVISIBLE TO THE PER-PERMISSION RULE — the claim, checked', () => {
        /*
         *   stale-authorisation.ts states this number in prose, and the whole
         *   lesson of this finding is that prose cannot tell you it has gone
         *   stale — #951's one-line summary of #750 is how eleven deferred files
         *   came to travel uncounted. So the claim in the rule is pinned here
         *   rather than trusted.
         *
         *   What it says: seven of the ten role-writing files still on the token
         *   gate ENTIRELY on permissions the rule calls reversible. Those seven
         *   are the ones the per-permission rule alone would never have indicted,
         *   and they are the reason the writesRoles clause exists at all. If this
         *   fell to zero the clause would be redundant; if it rose, the rule's
         *   own description of its reach would be understating it.
         */
        /*
         *   #955 7 -> 6. #956 6 -> ZERO, which is the end state and needs saying.
         *
         *   Every role-writing gate still on the token now sits in one of the three
         *   admin/* files, and those name users:update and content:approve among
         *   others — permissions #951 already calls irreversible. So the
         *   per-permission rule alone indicts all of them and the writesRoles clause
         *   has no remaining subject in the tree.
         *
         *   THE CLAUSE IS NOT THEREFORE UNTESTED, and that distinction is the reason
         *   this is recorded rather than deleted: the loop below is vacuous at zero,
         *   but `a role write forces a live read even on a reversible permission`
         *   above exercises mustRevalidateLiveForDoor directly against every entry in
         *   REVERSIBLE_PERMISSIONS. That is what keeps the clause honest once its
         *   instances are gone, and it is what would catch a NEW all-reversible role
         *   writer — which is the case the clause exists for.
         */
        const RECORDED_INVISIBLE = 0;

        const onToken = roleWritersOnTheToken(scanRoleWriteDoors(DIRS, SRC));
        const invisible = onToken.filter((d) => {
            const perms = [...new Set(d.tokenGates.map((g) => g.permission).filter(Boolean))] as string[];
            return perms.length > 0 && perms.every((perm) => {
                try {
                    return !mustRevalidateLive(perm as Parameters<typeof mustRevalidateLive>[0]);
                } catch {
                    return false;
                }
            });
        });

        expect(ledgerVerdict(invisible.length, RECORDED_INVISIBLE)).toBe(LEDGER_HELD);
        //   And every one of them IS indicted once the door's own behaviour counts.
        for (const d of invisible) {
            const perms = d.tokenGates.map((g) => g.permission).filter(Boolean) as string[];
            expect(mustRevalidateLiveForDoor({
                permissions: perms as Parameters<typeof mustRevalidateLiveForDoor>[0]['permissions'],
                writesRoles: true,
            })).toBe(true);
        }
    });

    it('and the two spellings are counted by ONE instrument, so neither can drift alone', () => {
        /*
         *   The failure this prevents is the one that produced this finding:
         *   a door count taken from one sweep, improving honestly, while a second
         *   spelling of the same defect sat uncounted beside it.
         *
         *   Asserted as a property of the module rather than a number — both
         *   sweeps exist and both return something — because a number here would
         *   be a fourth ledger to keep in step with the three above.
         */
        const hasPerm = scanRoleWriteDoors(DIRS, SRC)
            .reduce((n, d) => n + d.tokenGates.length, 0);
        const hasIsAdmin = scanIsAdminDoors(DIRS, SRC).length;

        expect(hasPerm).toBeGreaterThan(0);
        expect(hasIsAdmin).toBeGreaterThan(0);
    });
});
