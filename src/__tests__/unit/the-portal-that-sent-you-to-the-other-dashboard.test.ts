/**
 * @jest-environment node
 */

/**
 *   #959 THREE READERS ANSWERED "IS THIS PERSON AN ADMINISTRATOR", EACH KEYED
 *        DIFFERENTLY, AND THE ONE THAT CHOSE THE DESTINATION WAS NOT THE ONE
 *        THAT GUARDED IT.
 *
 *   Reported by the owner, twice: "my admin credentials takes me to the users
 *   dashboard not the admin portal", and then "I turned on 2FA and still lands at
 *   users dashboard not admin".
 *
 *   The second report is what settled it. #958 had just removed the MFA
 *   enforcement that locked every administrator out the morning before, and the
 *   MFA gate redirects to /profile, not /dashboard — so enrolling a second factor
 *   changing nothing ruled the second factor out entirely. What was left was the
 *   roles, and there were three sources of them:
 *
 *       lib/auth.ts authorize() -> getUserProfile(uid)   by uid, then walked
 *                                                        through migration
 *                                                        pointers  -> token.roles
 *       lib/require-admin.ts requireAdmin()              by uid, raw document
 *       actions/auth.ts getPostLoginRedirect(email)      by EMAIL QUERY
 *
 *   The third decides where login sends you. The first two decide whether you are
 *   let in. Nothing made them agree.
 *
 * ── THE TWO FAILURES THAT PRODUCE THE SAME SCREEN ───────────────────────────
 *
 *   BOUNCED. getPostLoginRedirect finds an admin row and returns /admin;
 *   AdminShell and app/admin/page.tsx read `session.user.roles`, do not see an
 *   admin, and redirect to /dashboard. Typing /admin by hand fails the same way.
 *
 *   NEVER SENT. The email query matches nothing, so userData is null and this
 *   function returns /dashboard — silently, and indistinguishably from "you are
 *   not an administrator". The token may hold the admin roles perfectly well, in
 *   which case typing /admin by hand WORKS. That asymmetry is the one observation
 *   that tells the two apart from outside, which is why it was worth asking for.
 *
 *   Both are fixed here, because both are defects whichever one was biting.
 *
 * ── WHY THE EMAIL QUERY CAN MATCH NOTHING ON THIS PLATFORM ──────────────────
 *
 *   Not hypothesised. getPostLoginRedirect's own docstring named the condition —
 *   "fails silently if the stored email field differs" — and both shapes exist
 *   here:
 *
 *     - scripts/backfill-blank-profile-emails.ts exists because two admin
 *       approval paths wrote FORTY-NINE profiles with `email: ""`.
 *     - admin/_legacy.ts writes `email: data.email` unnormalised at nine sites
 *       while registration lowercases at four, so a stored address can differ
 *       from the session's in case alone.
 *
 * ── AND THE DOCSTRING CLAIMED THE FIX THAT WAS NEVER APPLIED ────────────────
 *
 *   Above the email query, in the past tense:
 *
 *       "Bug fix: was querying Firestore by email (.where('email','==',email)),
 *        which is a full collection scan (slow, needs index) and fails silently
 *        if the stored email field differs. Now uses auth() to get the userId for
 *        a direct O(1) doc lookup. Falls back to email query if no session is
 *        ready yet."
 *
 *   There was no doc lookup in the function. The "fallback" was the only path, so
 *   it decided every sign-in on the platform — and the paragraph describing the
 *   repair sat directly above the code that still had the bug. That is this
 *   audit's dominant defect class, found this time in a docstring.
 *
 * ── WHY NO EXISTING TEST COULD HAVE CAUGHT IT ───────────────────────────────
 *
 *   Five suites drive getPostLoginRedirect. jest.setup.js mocks
 *   @/lib/supabase-db with a CALL RECORDER whose `where()` is a no-op, so a test
 *   asserting "an admin lands on /admin" passes whatever field the query filters
 *   on — or whether it filters at all. The reader could not be observed, so
 *   nothing pinned it.
 *
 *   This suite installs lib/testing/fake-db, where the key is real, and seeds
 *   rows the email query CANNOT find. Every assertion below therefore
 *   distinguishes the uid reader from the email one, which is the whole point.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

const ADMIN_UID = 'uid-owner-super-admin';
const SESSION_EMAIL = 'owner@easysalesexport.com';

type Seeded = { id: string; roles: string[]; email?: string } & Record<string, unknown>;

/**
 * Run getPostLoginRedirect against a seeded store, with a session that names
 * `sessionUserId` and `SESSION_EMAIL`.
 *
 * Kept as one helper so every test below differs ONLY in what is in the store —
 * which is what makes "the uid row won" a measurement rather than a claim.
 */
async function redirectFor(
    rows: Seeded[],
    sessionUserId: string | null = ADMIN_UID,
): Promise<string> {
    jest.resetModules();

    jest.doMock('@/lib/auth', () => ({
        auth: async () => (
            sessionUserId === null
                ? null
                : { user: { id: sessionUserId, email: SESSION_EMAIL } }
        ),
    }));

    const { installFakeDb } = require('@/lib/testing/fake-db');
    const { COLLECTIONS } = require('@/lib/types/firestore');
    const store = installFakeDb();

    for (const row of rows) {
        store.seed(COLLECTIONS.USERS, row.id, row);
    }

    const { getPostLoginRedirect } = await import('@/app/actions/auth');
    const res: any = await getPostLoginRedirect(SESSION_EMAIL);

    //   Both shapes this function returns carry the destination in a different
    //   place — success in `data`, the catch in a bare `redirectUrl`. Reading
    //   both means a thrown error shows up as its own destination rather than as
    //   `undefined`, which would pass a `not.toBe('/dashboard')` assertion.
    return res?.data?.redirectUrl ?? res?.redirectUrl;
}

beforeEach(() => {
    jest.clearAllMocks();
});

afterEach(() => {
    jest.resetModules();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#959 — the incident, reproduced on the reader rather than asserted', () => {
    it('AN ADMINISTRATOR WHOSE STORED EMAIL IS BLANK IS STILL SENT TO THE PORTAL', async () => {
        /*
         *   The documented shape: 49 profiles were written with `email: ""`.
         *   The email query cannot match this row. The uid read can, and this
         *   person is a super_admin.
         *
         *   THIS IS THE MUTATION TARGET. Put the email query back in front and
         *   this test is the one that goes red.
         */
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['super_admin'], email: '' },
        ]);

        expect(dest).toBe('/admin');
    });

    it('AND SO IS ONE WHOSE STORED EMAIL DIFFERS ONLY IN CASE', async () => {
        //   admin/_legacy.ts writes `email: data.email` unnormalised; the query
        //   lowercases the session's. `==` is a TEXT comparison in the adapter
        //   and in the fake, so these do not match.
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['admin'], email: SESSION_EMAIL.toUpperCase() },
        ]);

        expect(dest).toBe('/admin');
    });

    it('AND ONE WHOSE ROW CARRIES NO email FIELD AT ALL', async () => {
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['super_admin'] },
        ]);

        expect(dest).toBe('/admin');
    });

    it('THE NEGATIVE CONTROL: a member with the same blank email is NOT sent to the portal', async () => {
        /*
         *   Without this, every assertion above would also pass if the function
         *   simply returned '/admin' unconditionally. The uid read has to be
         *   reading the ROLES off the row it found, not merely finding one.
         */
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['general_user'], email: '' },
        ]);

        expect(dest).toBe('/dashboard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#959 — which row answers, when two rows could', () => {
    it('THE SESSION\'S OWN ROW DECIDES, NOT WHICHEVER ROW SHARES THE ADDRESS', async () => {
        /*
         *   The split-account shape, which this platform has seven live instances
         *   of at /admin/forensics/duplicates. Two rows, one address:
         *
         *     - the session's row, by id: super_admin
         *     - somebody else's row, matching the email: general_user
         *
         *   The email query would have answered from the SECOND one — a different
         *   person's record — and sent this administrator to /dashboard. The uid
         *   read answers from theirs.
         *
         *   Reconciling those duplicate rows is the owner's call and not this
         *   change's business. Making the gate and the destination read the SAME
         *   one of them is.
         */
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['super_admin'], email: '' },
            { id: 'uid-someone-else', roles: ['general_user'], email: SESSION_EMAIL },
        ]);

        expect(dest).toBe('/admin');
    });

    it('AND IT DECIDES IN THE OTHER DIRECTION TOO — a member is not promoted by a namesake', async () => {
        /*
         *   The security direction. If the email query were still consulted first,
         *   an ordinary member sharing an address with an admin row would be sent
         *   INTO the portal. They would be bounced by the door, so this is not a
         *   privilege escalation — but "sent somewhere you will be refused" is the
         *   defect being removed, and it has to be gone both ways or the fix is
         *   half a fix.
         */
        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['general_user'], email: '' },
            { id: 'uid-an-actual-admin', roles: ['super_admin'], email: SESSION_EMAIL },
        ]);

        expect(dest).toBe('/dashboard');
    });

    it('THE EMAIL QUERY IS STILL THERE, for a session whose id names no row', async () => {
        /*
         *   The fallback the docstring always described, and the reason it was not
         *   simply deleted: a migrated account can hold a session id that no
         *   longer names a row — the shape resolveActiveUser walks for
         *   getUserProfile. Second, so the collection scan is paid by the accounts
         *   that need one instead of by every login.
         */
        const dest = await redirectFor([
            { id: 'uid-the-row-that-survived', roles: ['admin'], email: SESSION_EMAIL },
        ]);

        expect(dest).toBe('/admin');
    });

    it('AND NO SESSION AT ALL STILL DESCRIBES NOBODY — #239\'s rule, not re-broken', async () => {
        /*
         *   This is a "use server" export, so it is a public endpoint. #239 found
         *   it answering for any email a caller typed, which let an
         *   unauthenticated caller walk an address list and map who is who. The
         *   generic dashboard describes nobody, and adding a uid read must not
         *   have opened a second way in.
         */
        const dest = await redirectFor(
            [{ id: ADMIN_UID, roles: ['super_admin'], email: SESSION_EMAIL }],
            null,
        );

        expect(dest).toBe('/dashboard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#959 — the door now reads the row, so login cannot promise what it refuses', () => {
    /**
     * liveRolesForPortal is what both admin doors ask. Exercised directly:
     * AdminShell and app/admin/page.tsx are server components whose refusal is a
     * `redirect()` throw, and what is worth pinning is the ANSWER they refuse on,
     * not Next's control flow.
     */
    async function portalRoles(rows: Seeded[], userId: string | null | undefined) {
        jest.resetModules();

        const { installFakeDb } = require('@/lib/testing/fake-db');
        const { COLLECTIONS } = require('@/lib/types/firestore');
        const store = installFakeDb();

        for (const row of rows) {
            store.seed(COLLECTIONS.USERS, row.id, row);
        }

        const { liveRolesForPortal } = await import('@/lib/admin-portal-roles');
        return liveRolesForPortal(userId);
    }

    it('A GRANTED ADMINISTRATOR IS ADMITTED THOUGH THE TOKEN HAS NOT CAUGHT UP', async () => {
        /*
         *   The owner's half. The row says super_admin; the token said nothing of
         *   the kind, and the doors used to read the token. Note that the token is
         *   not passed in at all — that is the point of the signature.
         */
        const roles = await portalRoles(
            [{ id: ADMIN_UID, roles: ['super_admin'], email: '' }],
            ADMIN_UID,
        );

        const { isAdmin, adminLandingPath } = await import('@/lib/admin-permissions');
        expect(isAdmin(roles)).toBe(true);
        expect(adminLandingPath(roles)).not.toBeNull();
    });

    it('AND A REVOKED ONE IS REFUSED, which the token could not have done for two minutes', async () => {
        /*
         *   The security half, and the reason the read is unconditional rather
         *   than "read only when the token says no". That cheaper shape fixes the
         *   lockout and keeps the revocation window — #86 counts it as a defect
         *   for exactly this reason.
         */
        const roles = await portalRoles(
            [{ id: ADMIN_UID, roles: ['general_user'], email: '' }],
            ADMIN_UID,
        );

        const { isAdmin } = await import('@/lib/admin-permissions');
        expect(isAdmin(roles)).toBe(false);
    });

    it('IT FAILS CLOSED on no id and on a row that is not there', async () => {
        const { isAdmin } = await import('@/lib/admin-permissions');

        for (const [label, userId] of [
            ['no id', undefined],
            ['null id', null],
            ['an id naming no row', 'uid-nobody'],
        ] as Array<[string, string | null | undefined]>) {
            const roles = await portalRoles(
                [{ id: ADMIN_UID, roles: ['super_admin'], email: '' }],
                userId,
            );

            expect({ label, roles }).toEqual({ label, roles: [] });
            expect(isAdmin(roles)).toBe(false);
        }
    });

    it('AND A ROW WHOSE roles IS NOT AN ARRAY DOES NOT BECOME ONE', async () => {
        /*
         *   isAdmin canonicalises, and a non-array reaching it is a shape error
         *   worth refusing rather than coercing. The legacy imports in this
         *   platform have produced stranger fields than this.
         */
        const roles = await portalRoles(
            [{ id: ADMIN_UID, roles: 'super_admin' as unknown as string[], email: '' }],
            ADMIN_UID,
        );

        expect(roles).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#959 — the two decisions agree for every admin role, which is the property', () => {
    it('WHERE LOGIN SENDS AN ADMIN IS SOMEWHERE THE DOOR WILL LET THEM IN', async () => {
        /*
         *   The defect stated as a property rather than as a case: for each admin
         *   role, the destination login computes must be one the portal's own
         *   landing rule agrees is theirs. Both now read the same row by the same
         *   key, so this holds by construction — and if somebody re-keys either
         *   reader, this is the test that says so.
         *
         *   All ten, because #887 made the MFA rule cover all ten and #356 found
         *   `support` and `moderator` excluded from six hand-written copies of the
         *   admin test. They are the two that keep getting left out.
         */
        const { adminLandingPath } = await import('@/lib/admin-permissions');

        const ADMIN_ROLES = ['super_admin', 'admin', 'moderator', 'support',
            'wave_admin', 'cooperative_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin'];

        for (const role of ADMIN_ROLES) {
            //   Blank stored email throughout: the condition the email query
            //   cannot survive, so each iteration exercises the uid reader.
            const dest = await redirectFor([
                { id: ADMIN_UID, roles: [role], email: '' },
            ]);

            const landing = adminLandingPath([role]);

            expect({ role, dest }).toEqual({ role, dest: landing ?? '/admin' });
            //   And the door's own answer for that row is not a refusal.
            expect({ role, landing }).not.toEqual({ role, landing: null });
        }
    });

    it('THE POSITIVE CONTROL ON THAT LOOP: a member disagrees with all ten', async () => {
        /*
         *   Without this the loop above would still pass if adminLandingPath
         *   returned a portal path for everybody, which would make the agreement
         *   vacuous.
         */
        const { adminLandingPath } = await import('@/lib/admin-permissions');

        expect(adminLandingPath(['general_user'])).toBeNull();

        const dest = await redirectFor([
            { id: ADMIN_UID, roles: ['general_user'], email: '' },
        ]);
        expect(dest).toBe('/dashboard');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#959 — the claim in the source, asserted rather than trusted', () => {
    const read = (p: string) => require('fs').readFileSync(require('path').join(process.cwd(), p), 'utf8');

    it('getPostLoginRedirect READS THE SESSION\'S ROW BY ID BEFORE IT QUERIES BY EMAIL', async () => {
        /*
         *   The behavioural tests above are the real gate. This one exists because
         *   the DOCSTRING was the defect: it described a uid lookup for however
         *   long, and nothing checked that the code beneath it agreed. Reading the
         *   order off the source is what makes that specific regression — a true
         *   sentence over a reverted implementation — fail here.
         */
        const { stripComments } = require('@/lib/testing/strip-comments');
        const src = stripComments(read('src/app/actions/auth.ts'), { minRetainedRatio: 0 });

        const fn = src.slice(src.indexOf('export async function getPostLoginRedirect'));
        const body = fn.slice(0, fn.indexOf('export async function preValidateLoginAction'));

        const docRead = body.indexOf('.doc(ownRowId)');
        const emailQuery = body.indexOf(".where('email'");

        expect(docRead).toBeGreaterThan(-1);
        expect(emailQuery).toBeGreaterThan(-1);
        expect(docRead).toBeLessThan(emailQuery);
    });

    it('AND NEITHER ADMIN DOOR JUDGES session.user.roles ANY MORE', () => {
        /*
         *   The two files that sent the owner to /dashboard. Pinned on the source
         *   because the defect was WHICH roles a correct-looking predicate was
         *   handed — `!isAdmin(roles)` reads right either way, so only the
         *   provenance of `roles` distinguishes the bug from the fix.
         */
        const { stripComments } = require('@/lib/testing/strip-comments');

        for (const file of [
            'src/components/admin/AdminShell.tsx',
            'src/app/admin/page.tsx',
        ]) {
            const src = stripComments(read(file), { minRetainedRatio: 0 });

            expect({ file, live: src.includes('liveRolesForPortal') })
                .toEqual({ file, live: true });

            //   The token's roles are no longer assigned to anything this file
            //   makes an admission decision from.
            expect({ file, token: /user\?\.roles|user\.roles/.test(src) })
                .toEqual({ file, token: false });
        }
    });
});
