/**
 * @jest-environment node
 */

/**
 *   #663 THE WHOLE MFA FEATURE WAS WIRED TO NOTHING.
 *
 *   Four working routes — setup, enable, verify, disable — a TOTP
 *   implementation, encrypted backup codes with an atomic single-use claim, and
 *   a `mfa_verified` cookie bound to its user by HMAC. Every piece correct. The
 *   verify route's own header says what they added up to:
 *
 *       "NOTHING READS THAT COOKIE, AND NOTHING ENFORCES MFA. […] So a user who
 *        enables MFA scans a QR code, saves recovery codes, and their account is
 *        protected exactly as much as it was before."
 *
 *   `requiresMFA()` names ten sensitive actions — withdrawal, fund_release,
 *   loan_approval, escrow_release, role_change, admin_action among them — and
 *   had NO CALLERS. `verifyBackupCode()` had none either, so the eight recovery
 *   codes handed to a user at setup, over the words "Each can only be used
 *   once", could not be redeemed anywhere.
 *
 *   A declared rule nothing consults, on the most privileged operations the
 *   platform has — and the single largest instance of this audit's most common
 *   finding.
 *
 * ── THE PREREQUISITE CAME FIRST, BECAUSE THAT NOTE WAS RIGHT ────────────────
 *
 *   The same header explains why nobody had switched it on: "switching
 *   enforcement on for those ten actions while backup codes cannot be redeemed
 *   would lock anyone who loses their authenticator out of withdrawals with no
 *   way back."
 *
 *   So the verify route accepts a backup code now, ROUTED BY SHAPE rather than
 *   tried as a fallback — a fallback would SPEND a single-use code on a mistyped
 *   authenticator digit, because the claim is taken before the caller knows
 *   which kind of credential they offered.
 *
 * ── THE POLICY, AND WHY RULE 2 IS NARROW ────────────────────────────────────
 *
 *   1. Every one of the TEN admin roles must have MFA enrolled.
 *   2. A sensitive action needs a recent verification FROM A USER WHO HAS MFA.
 *
 *   `requiresMFA()` lists `withdrawal` and `loan_application`, which members
 *   perform. Demanding a second factor from members who have none would lock
 *   every member out of their own money the day this deployed — this audit's
 *   own defect, committed by the fix for another one.
 *
 * ── AND THE LOOP IS THE REAL DANGER ─────────────────────────────────────────
 *
 *   An unenrolled administrator redirected to a page that redirects them back
 *   is worse than no enforcement: they can reach neither the admin panel nor the
 *   screen that fixes it. /profile, /auth/* and /api/auth/* are never gated, and
 *   that is asserted below more carefully than the gate itself.
 *
 *   MUTATION-TESTED, WITH A CONTROL — table at the foot of this file.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';

import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

import { stripComments } from '@/lib/testing/strip-comments';
import {
    adminMfaGate,
    adminMfaVerdict,
    graceActive,
    mfaEnrolmentRequired,
    MFA_SETUP_PATH,
} from '@/lib/mfa-policy';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel });

/**
 * The environment with no override, and an instant AFTER the built-in
 * enforcement date — so these assertions are about the enforced world and do
 * not quietly become assertions about the grace window when the clock moves.
 */
const NO_GRACE: NodeJS.ProcessEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
const NOW = Date.parse('2026-10-01T12:00:00.000Z');

/** An instant before it, which is where production sits on the day this ships. */
const DURING_GRACE = Date.parse('2026-09-12T12:00:00.000Z');

const ADMIN_ROLES = [
    'admin', 'super_admin', 'wave_admin', 'cooperative_admin',
    'marketplace_admin', 'export_admin', 'farm_nation_admin', 'academy_admin',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — who has to have a second factor', () => {
    it.each(ADMIN_ROLES)('%s MUST ENROL', (role) => {
        /*
         *   ALL TEN ADMIN ROLES, not the narrower isPlatformAdmin set. That one
         *   covers only roles holding `config:update`, which excludes the six
         *   module admins — and a cooperative_admin approves loans and releases
         *   member money, a marketplace_admin resolves disputes and escrow.
         */
        expect(mfaEnrolmentRequired([role])).toBe(true);
    });

    it('AND A MEMBER DOES NOT', () => {
        //   THE positive control. A rule that required it of everyone would
        //   pass every assertion above and lock the platform's members out on
        //   the day it deployed.
        expect(mfaEnrolmentRequired(['general_user'])).toBe(false);
        expect(mfaEnrolmentRequired(['field_officer'])).toBe(false);
        expect(mfaEnrolmentRequired(['seller', 'marketplace_buyer'])).toBe(false);
        expect(mfaEnrolmentRequired([])).toBe(false);
        expect(mfaEnrolmentRequired(undefined)).toBe(false);
    });

    it('AND AN ADMIN WHO HAS ENROLLED IS ASKED FOR NOTHING FURTHER', () => {
        expect(adminMfaVerdict({ roles: ['admin'], mfaEnabled: true }, NO_GRACE, NOW))
            .toEqual({ outcome: 'ok' });
    });

    it('AND AN ABSENT FLAG READS AS NOT ENROLLED', () => {
        //   `mfaEnabled === true`, not truthy. A missing field on a legacy user
        //   document must not read as "has a second factor".
        for (const mfaEnabled of [undefined, null, false]) {
            expect(adminMfaVerdict({ roles: ['admin'], mfaEnabled }, NO_GRACE, NOW).outcome)
                .toBe('enrol');
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — the rollout valve expires, and fails closed', () => {
    const withGrace = (v: string) => ({ NODE_ENV: 'test', MFA_ADMIN_GRACE_UNTIL: v } as NodeJS.ProcessEnv);

    it('NOTHING CHANGES ON THE DAY THIS DEPLOYS', () => {
        /*
         *   THE assertion that keeps this from breaking production. Not one
         *   administrator account has a second factor today, so enforcing at
         *   deploy would refuse every one of them at once.
         */
        expect(graceActive(NO_GRACE, DURING_GRACE)).toBe(true);
        expect(adminMfaVerdict({ roles: ['admin'] }, NO_GRACE, DURING_GRACE).outcome).toBe('warn');
    });

    it('AND THEN IT ARRIVES BY ITSELF, WITH NOBODY SETTING ANYTHING', () => {
        /*
         *   The other half, and the reason the date is in the code. Every
         *   "temporarily disabled" flag this audit has found was still
         *   disabled; a deadline nobody has to remember cannot be forgotten.
         */
        expect(graceActive(NO_GRACE, NOW)).toBe(false);
        expect(adminMfaVerdict({ roles: ['admin'] }, NO_GRACE, NOW).outcome).toBe('enrol');
    });

    it('AND IT CAN BE BROUGHT FORWARD, OR EXTENDED ONCE', () => {
        expect(graceActive(withGrace('2026-09-11T00:00:00.000Z'), DURING_GRACE)).toBe(false);
        expect(graceActive(withGrace('2027-01-01T00:00:00.000Z'), NOW)).toBe(true);
    });

    it('AND A TYPO FALLS BACK TO THE BUILT-IN DATE, NOT TO "never"', () => {
        //   A valve that fails open on a misspelling is not a valve. Both of
        //   these are the built-in deadline answering, not the override.
        expect(graceActive(withGrace('next tuesday'), NOW)).toBe(false);
        expect(graceActive(withGrace('next tuesday'), DURING_GRACE)).toBe(true);
        expect(graceActive(withGrace(''), NOW)).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — and an unenrolled administrator can always reach the way out', () => {
    const unenrolledAdmin = { roles: ['admin'], mfaEnabled: false };

    it.each([
        '/profile',
        '/profile/bank-account',
        '/auth/login',
        '/auth/logout',
        '/api/auth/mfa/setup',
        '/api/auth/mfa/enable',
        '/api/auth/session',
    ])('IS NOT GATED ON %s', (pathname) => {
        /*
         *   THE assertion this whole finding turns on. A redirect loop leaves an
         *   administrator unable to reach the admin panel AND unable to reach
         *   the screen that would fix it — strictly worse than no enforcement.
         *
         *   /profile carries the setup UI, /auth/* is sign-in and sign-out, and
         *   /api/auth/mfa/* is the API that UI calls.
         */
        expect(adminMfaGate(pathname, unenrolledAdmin, NO_GRACE, NOW)).toBeNull();
    });

    it('AND THE PLACE IT SENDS THEM IS ONE OF THOSE', () => {
        //   The two halves have to agree. A setup path that the gate itself
        //   would bounce is the loop, written in two files instead of one.
        const gate = adminMfaGate('/admin', unenrolledAdmin, NO_GRACE, NOW);
        expect(gate).toEqual({ kind: 'redirect', to: MFA_SETUP_PATH, reason: expect.any(String) });

        const target = new URL(MFA_SETUP_PATH, 'https://example.test').pathname;
        expect(adminMfaGate(target, unenrolledAdmin, NO_GRACE, NOW)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — what the gate does on the admin surface', () => {
    const unenrolledAdmin = { roles: ['cooperative_admin'], mfaEnabled: false };

    it.each(['/admin', '/admin/users', '/loans/approve'])('REDIRECTS A PAGE: %s', (pathname) => {
        expect(adminMfaGate(pathname, unenrolledAdmin, NO_GRACE, NOW))
            .toMatchObject({ kind: 'redirect', to: MFA_SETUP_PATH });
    });

    it.each(['/api/admin/users', '/api/admin/finance/paystack-sync'])('REFUSES AN API ROUTE: %s', (pathname) => {
        /*
         *   Not a redirect. Redirecting a fetch to an HTML page turns "you must
         *   enrol" into a JSON parse error at the caller — the caller is told
         *   nothing and the screen shows a crash.
         */
        expect(adminMfaGate(pathname, unenrolledAdmin, NO_GRACE, NOW))
            .toMatchObject({ kind: 'deny' });
    });

    it('AND LETS EVERYTHING ELSE THROUGH UNTOUCHED', () => {
        //   The control. A gate that returned a decision for every path would
        //   satisfy both assertions above and break the entire application.
        for (const pathname of ['/', '/dashboard', '/marketplace', '/cooperatives/loans', '/api/health']) {
            expect(adminMfaGate(pathname, unenrolledAdmin, NO_GRACE, NOW)).toBeNull();
        }
    });

    it('AND DOES NOTHING AT ALL TO A MEMBER, OR TO AN ENROLLED ADMIN', () => {
        expect(adminMfaGate('/admin', { roles: ['general_user'] }, NO_GRACE, NOW)).toBeNull();
        expect(adminMfaGate('/admin', { roles: ['admin'], mfaEnabled: true }, NO_GRACE, NOW)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — and it is wired to the two things that run', () => {
    it('MIDDLEWARE CALLS IT, AND ACTS ON BOTH ANSWERS', () => {
        const mw = code('src/middleware.ts');
        expect(mw).toContain('adminMfaGate(');
        expect(mw).toContain("mfaGate?.kind === \"deny\"");
        expect(mw).toContain("mfaGate?.kind === \"redirect\"");
        expect(mw).toContain('MFA_ENROLMENT_REQUIRED');
    });

    it('AND THE ADMIN GATE CHECKS IT AGAINST THE LIVE DOCUMENT', () => {
        /*
         *   Both, on purpose. Middleware reads the session token, synced every
         *   two minutes; requireAdmin reads the document it has already fetched,
         *   so an admin who disabled MFA a minute ago is refused there even
         *   though their token still says otherwise.
         *
         *   Kept as a source assertion only because the BEHAVIOUR is exercised
         *   in the block below — see the note there about what this assertion
         *   alone was worth.
         */
        const guard = code('src/lib/require-admin.ts');
        expect(guard).toContain('adminMfaVerdict(');
        expect(guard).toContain('mfaEnabled: data?.mfaEnabled === true');
    });

    it('AND THE ENROLMENT FLAG REACHES THE SESSION AT ALL', () => {
        //   Without this the middleware half reads undefined for everybody and
        //   redirects every administrator for ever — which is why it is asserted
        //   rather than assumed.
        expect(code('src/lib/user-cache.ts')).toContain('mfaEnabled: userData.mfaEnabled === true');
        expect(code('src/lib/auth.ts')).toContain('token.mfaEnabled = cachedProfile.mfaEnabled === true');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — and the recovery path works before the gate closes', () => {
    const verify = code('src/app/api/auth/mfa/verify/route.ts');

    it('A BACKUP CODE IS ACCEPTED', () => {
        //   THE prerequisite. verifyBackupCode was written, correct, and called
        //   by nothing — so the codes handed out at setup could not be redeemed.
        expect(verify).toContain('verifyBackupCode');
    });

    it('AND IT IS ROUTED BY SHAPE, SO A MISTYPED TOTP DOES NOT SPEND ONE', () => {
        /*
         *   A fallback — try TOTP, then try the backup code — takes the
         *   single-use claim before anyone knows which kind of credential was
         *   offered. Eight codes, and a fat-fingered authenticator digit spends
         *   one. Backup codes are XXXX-XXXX; a TOTP is six digits.
         */
        expect(verify).toContain('/^[0-9]{4}-[0-9]{4}$/');
        expect(verify).toContain('looksLikeBackupCode');
    });

    it('AND A FAILURE DOES NOT SAY WHICH KIND OF CREDENTIAL WAS WRONG', () => {
        //   Two messages would tell an attacker which they are closer to.
        const failures = verify.split('Invalid verification code').length - 1;
        expect(failures).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — requireAdmin, RUN rather than read', () => {
    /*
     *   THE SOURCE ASSERTION ABOVE WAS NOT ENOUGH, AND THE MUTATION RUN SAID SO.
     *   A mutant that turned `if (verdict.outcome === "enrol")` into
     *   `if (false)` SURVIVED: the file still contained `adminMfaVerdict(`, so a
     *   check on the presence of a call passed while the call decided nothing.
     *
     *   The same sentence as #649's and #651's surviving mutants, and #659's.
     *   A check on the presence of a line is not a check on what the line does,
     *   so this block calls the guard.
     */
    let store: FakeDbHandle;

    const signedInAs = async (id: string) => {
        const { auth } = await import('@/lib/auth');
        (auth as unknown as jest.Mock).mockImplementation(
            () => Promise.resolve({ user: { id, email: `${id}@example.test` } }),
        );
    };

    const callRequireAdmin = async () =>
        (await import('@/lib/require-admin')).requireAdmin();

    const ORIGINAL_GRACE = process.env.MFA_ADMIN_GRACE_UNTIL;

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        /*
         *   ENFORCEMENT BROUGHT FORWARD FOR THIS BLOCK, and the first version
         *   of it failed because it was not — the built-in deadline had not
         *   arrived, so the guard warned and admitted, which is exactly what
         *   production will do on the day this deploys.
         *
         *   requireAdmin reads the clock through the same policy function, so
         *   the only honest way to test the enforced world is to say when it
         *   is. This is also the documented way to bring the date forward.
         */
        process.env.MFA_ADMIN_GRACE_UNTIL = '2000-01-01T00:00:00.000Z';
    });

    afterEach(() => {
        if (ORIGINAL_GRACE === undefined) delete process.env.MFA_ADMIN_GRACE_UNTIL;
        else process.env.MFA_ADMIN_GRACE_UNTIL = ORIGINAL_GRACE;
    });

    it('REFUSES AN ADMINISTRATOR WHO HAS NOT ENROLLED', async () => {
        store.seed(COLLECTIONS.USERS, 'a1', { roles: ['admin'], email: 'a1@example.test' });
        await signedInAs('a1');

        const result = await callRequireAdmin();

        expect(result).toEqual({ error: expect.stringContaining('Two-factor authentication is required') });
    });

    it('AND ADMITS THE SAME ACCOUNT ONCE IT HAS', async () => {
        //   THE positive control. A guard that refused every administrator
        //   passes the assertion above and takes the admin panel offline.
        store.seed(COLLECTIONS.USERS, 'a2', { roles: ['admin'], email: 'a2@example.test', mfaEnabled: true });
        await signedInAs('a2');

        expect(await callRequireAdmin()).toEqual({ userId: 'a2', roles: ['admin'] });
    });

    it('AND DURING THE ROLLOUT WINDOW IT ADMITS THEM, WHICH IS WHAT SHIPS', async () => {
        /*
         *   The behaviour on the day this deploys. Not one administrator has a
         *   second factor, so the guard must let them through and say so —
         *   otherwise the fix for an unwired security feature takes the admin
         *   panel offline, which is the defect this audit exists to stop.
         */
        delete process.env.MFA_ADMIN_GRACE_UNTIL;
        store.seed(COLLECTIONS.USERS, 'a3', { roles: ['admin'], email: 'a3@example.test' });
        await signedInAs('a3');

        expect(await callRequireAdmin()).toEqual({ userId: 'a3', roles: ['admin'] });
    });

    it('AND STILL REFUSES A NON-ADMIN FOR THE ORIGINAL REASON', async () => {
        //   The MFA verdict runs last, so it cannot turn "not an admin" into a
        //   message about two-factor authentication.
        store.seed(COLLECTIONS.USERS, 'm1', { roles: ['general_user'], email: 'm1@example.test' });
        await signedInAs('m1');

        expect(await callRequireAdmin()).toEqual({ error: 'Unauthorized: Admin access required' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#663 — the verify route, RUN rather than read', () => {
    /*
     *   The source assertions above said the backup-code branch exists. A
     *   mutant that turned `if (looksLikeBackupCode)` into `if (false)`
     *   SURVIVED them — both strings were still in the file while the branch
     *   decided nothing. So the route is called here, and what is asserted is
     *   WHICH credential each shape is checked against.
     */
    let store: FakeDbHandle;
    const verifyTOTPToken = jest.fn();
    const verifyBackupCode = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        store = installFakeDb();
        store.seed(COLLECTIONS.USERS, 'admin-id', {
            email: 'admin@example.com', roles: ['admin'],
            mfaEnabled: true, totpSecret: 'encrypted-secret',
        });
        process.env.MFA_SECRET_KEY = 'a-key-for-this-test-only-not-a-real-one';

        jest.doMock('@/lib/mfa', () => ({
            verifyTOTPToken: (...a: unknown[]) => verifyTOTPToken(...a),
            verifyBackupCode: (...a: unknown[]) => verifyBackupCode(...a),
            issueMfaVerifiedValue: () => 'admin-id.signed',
        }));
        jest.doMock('@/lib/security', () => ({ decryptData: () => 'THE-SECRET' }));
    });

    const post = async (code: string) => {
        const { POST } = await import('@/app/api/auth/mfa/verify/route');
        const request = {
            json: async () => ({ code }),
            headers: { get: () => 'www.example.test' },
        };
        return (POST as unknown as (r: unknown) => Promise<Response>)(request);
    };

    it('A BACKUP-CODE SHAPE IS REDEEMED AS A BACKUP CODE', async () => {
        verifyBackupCode.mockResolvedValue({ success: true } as never);

        const res = await post('1234-5678');

        expect(verifyBackupCode).toHaveBeenCalledWith('admin-id', '1234-5678');
        expect(verifyTOTPToken).not.toHaveBeenCalled();
        expect(res.status).toBe(200);
    });

    it('AND A SIX-DIGIT SHAPE IS CHECKED AGAINST THE AUTHENTICATOR', async () => {
        verifyTOTPToken.mockReturnValue(true as never);

        const res = await post('123456');

        expect(verifyTOTPToken).toHaveBeenCalledWith('123456', 'THE-SECRET');
        expect(res.status).toBe(200);
    });

    it('AND A MISTYPED AUTHENTICATOR CODE DOES NOT SPEND A BACKUP CODE', async () => {
        /*
         *   THE reason this is routed by shape rather than tried as a fallback.
         *   verifyBackupCode takes the single-use claim BEFORE the caller knows
         *   which kind of credential was offered, so a fallback would burn one
         *   of eight recovery codes on a fat-fingered digit.
         */
        verifyTOTPToken.mockReturnValue(false as never);

        const res = await post('123457');

        expect(verifyBackupCode).not.toHaveBeenCalled();
        expect(res.status).toBe(400);
    });

    it('AND A WRONG BACKUP CODE IS REFUSED IN THE SAME WORDS AS A WRONG TOTP', async () => {
        verifyBackupCode.mockResolvedValue({ success: false, error: 'Invalid or already used backup code' } as never);

        const res = await post('1111-2222');
        const body = await res.json() as { error: string };

        expect(res.status).toBe(400);
        //   Saying which kind was wrong tells an attacker which they are closer
        //   to guessing.
        expect(body.error).toBe('Invalid verification code');
    });
});

/*
 * ── MUTATION TESTING ────────────────────────────────────────────────────────
 *
 *   Baseline green, one anchored swap at a time, restored and diffed after each.
 *
 *     MUTANT                                                        RESULT
 *     THE DEFECT: the gate returns null for every path                KILLED
 *     enrolment is required of members too                            KILLED
 *     module admins stop being covered (isPlatformAdmin)              KILLED
 *     an absent mfaEnabled reads as enrolled                          KILLED
 *     a past grace date still opens the valve                         KILLED
 *     an unparseable grace date opens the valve                       KILLED
 *     the setup path is changed to one the gate itself blocks         KILLED
 *     an API route is redirected rather than refused                  KILLED
 *     middleware stops acting on the deny answer                      KILLED
 *     requireAdmin stops checking                                     KILLED
 *     the flag stops being carried into the session                   KILLED
 *     the backup-code branch is removed                               KILLED
 *     backup codes are tried as a FALLBACK after TOTP                 KILLED
 *     enforcement lands on deploy instead of on the date              KILLED
 *     the deadline never arrives                                      KILLED
 *     an unparseable override disables enforcement                    KILLED
 *
 *     CONTROL — SHOULD SURVIVE
 *     reword this header                                              SURVIVED ✓
 *
 * ── THREE SURVIVED THE FIRST RUN. TWO WERE MY ASSERTIONS ────────────────────
 *
 *   "requireAdmin stops checking" and "the backup-code branch is removed" both
 *   survived, because both were asserted by reading the SOURCE for a function
 *   name. `if (false)` leaves the name in the file. The same sentence #649,
 *   #651 and #659 each produced: a check on the presence of a line is not a
 *   check on what the line does. Both are now executed — requireAdmin against a
 *   seeded user, the verify route against a mocked authenticator — and what is
 *   asserted is which credential each shape is checked against.
 *
 *   The third, "/profile is no longer an escape hatch", was a NO-OP mutant and
 *   the finding is in the code rather than the test: isAdminSurface() has
 *   already excluded every escape-hatch path by the time isEscapeHatch() is
 *   asked, so gutting it changes nothing. Said so in that function rather than
 *   quietly deleting it — the invariant that really guards the loop is "the
 *   gate never blocks the path it redirects to", which IS exercised: pointing
 *   MFA_SETUP_PATH at an /admin path turns this suite red.
 *
 * ── AND IT DOES NOT BREAK PRODUCTION ON THE DAY IT DEPLOYS ──────────────────
 *
 *   NOT ONE ADMINISTRATOR ACCOUNT HAS MFA TODAY, so enforcing at deploy would
 *   refuse every one of them at once. The first version of this change did
 *   exactly that and NINETEEN SUITES went red — the fixtures model production
 *   faithfully, so the suite was telling the truth about deployment day.
 *
 *   Enforcement has a date instead: MFA_ADMIN_ENFORCE_FROM, in the code rather
 *   than in a flag somebody has to remember. Before it, an unenrolled
 *   administrator is warned and let through and nothing changes for anyone;
 *   after it, they are sent to enrol, with nobody having to set anything.
 *
 *   Measured rather than reasoned about: the whole suite is green BOTH with the
 *   clock as it is AND with `MFA_ADMIN_GRACE_UNTIL` set to the year 2000, which
 *   is the enforced world. The fixtures carry an enrolled administrator so they
 *   answer the same question either side of the date — a suite that starts
 *   failing on a calendar day is a trap, not a ratchet.
 *
 * ── WHAT IS NOT DONE HERE, AND IS SAID SO PLAINLY ───────────────────────────
 *
 *   Rule 2 — a fresh verification before each of the ten sensitive actions — is
 *   NOT wired at every call site by this change. Enrolment is enforced and the
 *   recovery path works, which is what makes the rest safe to add; wiring ten
 *   actions across the money paths is a separate change with its own blast
 *   radius, and doing it in the same commit as the auth-token change would make
 *   both impossible to roll back independently.
 */
