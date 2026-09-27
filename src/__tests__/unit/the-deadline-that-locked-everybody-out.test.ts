/**
 * @jest-environment node
 */

/**
 *   #958 THE DEADLINE ARRIVED BY ITSELF, AS DESIGNED, AND LOCKED EVERY
 *        ADMINISTRATOR OUT OF THE ADMIN PANEL.
 *
 *   Reported by the owner on 2026-09-27: "the admin portal is not loading".
 *
 *   It was loading. It was redirecting. MFA_ADMIN_ENFORCE_FROM is
 *   2026-09-26T00:00:00.000Z, the window had closed 38 hours earlier, and
 *   mfa-policy has said since #663 that NOT ONE ADMINISTRATOR ACCOUNT HAS MFA.
 *   So adminMfaVerdict returned `enrol` for every administrator, adminMfaGate
 *   turned that into a redirect to MFA_SETUP_PATH for every /admin page and a 403
 *   for every /api/admin route, and requireAdmin refused independently on top.
 *   All ten admin roles at once — `support` and `moderator` included, which #887
 *   had already made sure the rule covered.
 *
 * ── THE PART WORTH KEEPING ON THE RECORD ────────────────────────────────────
 *
 *   #887 PREDICTED THIS MORNING, IN THIS FILE'S OWN WORDS:
 *
 *       "IT HAS A DATE ON IT. Enforcement begins at MFA_ADMIN_ENFORCE_FROM and
 *        this file's own header records that NOT ONE ADMINISTRATOR ACCOUNT HAS
 *        MFA TODAY — so on that morning every administrator is bounced out of
 *        /admin onto a page that does not explain itself. Bounced, retried,
 *        bounced again is indistinguishable from 'the admin login is broken',
 *        which is a sentence this platform's owner has had to write too often."
 *
 *   It then improved the page's wording and shipped the deadline. The prediction
 *   was right, was written down, and was acted on cosmetically. A forecast that
 *   changes a redirect target but not the thing being forecast is a forecast
 *   wasted, and that is the lesson rather than the date.
 *
 * ── WHAT CHANGED, AND WHOSE DECISION IT WAS ─────────────────────────────────
 *
 *   The owner asked for the enforcement removed. Theirs to decide: it is their
 *   platform's security posture, and "MFA available, enrolment encouraged, nobody
 *   locked out of their own admin panel by a calendar" is how most platforms run.
 *
 *   So the lockout is OPT-IN: MFA_ADMIN_ENFORCE must be the string "true".
 *   Absent it, adminMfaVerdict returns `ok`.
 *
 *   NOT `warn`, and that is the one subtle part. `warn` carries `enforcementAt`
 *   and adminMfaGraceNotice counts down to it, so a `warn` with enforcement off
 *   would render a banner promising a deadline in NEGATIVE hours — a screen
 *   stating something untrue, which is the defect class this whole audit is
 *   about. `ok` means nothing is required of this account, which with the lockout
 *   off is simply true.
 *
 *   NOTHING WAS DELETED. The gate, the redirect, the 403, the banner, the
 *   per-request document read in requireAdmin and the date logic are all intact
 *   and still tested — the-second-factor-that-guarded-nothing and
 *   a-gate-that-could-not-see-enrolment set the flag and exercise every one.
 *   MFA_ADMIN_ENFORCE=true restores the designed behaviour whole.
 *
 * ── WHY THIS SUITE EXISTS AT ALL ────────────────────────────────────────────
 *
 *   Because mfa-policy.ts still contains a hardcoded enforcement date and a long
 *   argument for having one. A reader who finds MFA_ADMIN_ENFORCE_FROM and stops
 *   there will conclude that administrators must hold a second factor. On this
 *   deployment they need not, and nothing stops one who does not.
 *
 *   That is exactly "a comment claiming something the code does not do", so the
 *   claim is asserted here instead of trusted: the DEFAULT is measured, not read.
 */

import { describe, it, expect } from '@jest/globals';
import {
    adminMfaVerdict,
    adminMfaEnforcementEnabled,
    adminMfaEnforcementAt,
    adminMfaGate,
    adminMfaGraceNotice,
    MFA_ADMIN_ENFORCE_FROM,
} from '@/lib/mfa-policy';

/** No flag — production's default. */
const OFF = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
/** The flag, which is what a deployment wanting the lockout sets. */
const ON = { NODE_ENV: 'test', MFA_ADMIN_ENFORCE: 'true' } as NodeJS.ProcessEnv;

/** Well past the built-in deadline — the world the owner was locked out in. */
const AFTER = Date.parse(MFA_ADMIN_ENFORCE_FROM) + 38 * 60 * 60 * 1000;

const UNENROLLED_ADMIN = { roles: ['admin'], mfaEnabled: false };

// ─────────────────────────────────────────────────────────────────────────────
describe('#958 — the incident, reproduced before anything is claimed about the fix', () => {
    it('WITH ENFORCEMENT ON, THE DEADLINE LOCKS OUT AN UNENROLLED ADMINISTRATOR', () => {
        //   The reported symptom, at the level the gate works on. If this ever
        //   stops holding, the rest of this suite is measuring nothing.
        expect(adminMfaVerdict(UNENROLLED_ADMIN, ON, AFTER).outcome).toBe('enrol');

        expect(adminMfaGate('/admin', UNENROLLED_ADMIN, ON, AFTER))
            .toMatchObject({ kind: 'redirect' });
        expect(adminMfaGate('/api/admin/users', UNENROLLED_ADMIN, ON, AFTER))
            .toMatchObject({ kind: 'deny' });
    });

    it('AND IT IS EVERY ADMIN ROLE, NOT JUST THE OWNER', () => {
        //   #887 made the rule cover all ten deliberately, so the lockout did too.
        for (const role of ['super_admin', 'admin', 'moderator', 'support',
            'wave_admin', 'cooperative_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin']) {
            expect(adminMfaVerdict({ roles: [role], mfaEnabled: false }, ON, AFTER).outcome)
                .toBe('enrol');
        }
    });

    it('while an ordinary member was never governed by it', () => {
        expect(adminMfaVerdict({ roles: ['general_user'], mfaEnabled: false }, ON, AFTER).outcome)
            .toBe('ok');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#958 — the default, which is the thing a reader of mfa-policy will get wrong', () => {
    it('ENFORCEMENT IS OFF UNLESS SWITCHED ON', () => {
        expect(adminMfaEnforcementEnabled(OFF)).toBe(false);
        expect(adminMfaEnforcementEnabled(ON)).toBe(true);
    });

    it('SO THE SAME ADMINISTRATOR, PAST THE SAME DEADLINE, IS LET THROUGH', () => {
        //   The fix, stated as the difference from the first test in this file.
        expect(adminMfaVerdict(UNENROLLED_ADMIN, OFF, AFTER).outcome).toBe('ok');

        expect(adminMfaGate('/admin', UNENROLLED_ADMIN, OFF, AFTER)).toBeNull();
        expect(adminMfaGate('/api/admin/users', UNENROLLED_ADMIN, OFF, AFTER)).toBeNull();
    });

    it('AND NO ADMIN ROLE IS STOPPED BY ANYTHING', () => {
        for (const role of ['super_admin', 'admin', 'moderator', 'support',
            'wave_admin', 'cooperative_admin', 'marketplace_admin',
            'export_admin', 'farm_nation_admin', 'academy_admin']) {
            expect(adminMfaVerdict({ roles: [role], mfaEnabled: false }, OFF, AFTER).outcome)
                .toBe('ok');
        }
    });

    it('ONLY THE EXACT STRING "true" ENABLES IT, so a typo cannot lock anybody out', () => {
        /*
         *   The direction of mfa-policy's "a valve that fails OPEN on a typo is not
         *   a valve" is unchanged and worth restating, because here OPEN means
         *   LOCKED OUT. An unparseable value leaves administrators working.
         */
        for (const value of ['TRUE', 'True', '1', 'yes', 'on', '', 'false', ' true']) {
            expect(adminMfaEnforcementEnabled(
                { NODE_ENV: 'test', MFA_ADMIN_ENFORCE: value } as NodeJS.ProcessEnv,
            )).toBe(false);
        }
    });

    it('AND THE BANNER DOES NOT COUNT DOWN TO A DEADLINE THAT IS NOT COMING', () => {
        /*
         *   The reason the disabled verdict is `ok` rather than `warn`.
         *   adminMfaGraceNotice returns null for anything that is not `warn`, so
         *   with enforcement off there is no countdown — and in particular no
         *   NEGATIVE one, which is what a `warn` carrying a past enforcementAt
         *   would have produced.
         */
        expect(adminMfaGraceNotice(UNENROLLED_ADMIN, OFF, AFTER)).toBeNull();

        //   POSITIVE CONTROL: it does render while enforcement is coming, so
        //   "returns null" is not true of every input and this means something.
        const BEFORE = Date.parse(MFA_ADMIN_ENFORCE_FROM) - 3 * 24 * 60 * 60 * 1000;
        const notice = adminMfaGraceNotice(UNENROLLED_ADMIN, ON, BEFORE);
        expect(notice).not.toBeNull();
        expect(notice!.msLeft).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#958 — nothing was deleted, which is what makes this reversible', () => {
    it('THE DATE AND ITS OVERRIDE STILL GOVERN, ONCE ENFORCEMENT IS ON', () => {
        //   The machinery is intact: switching the flag on restores exactly the
        //   designed behaviour, deadline and override included.
        expect(adminMfaEnforcementAt(OFF)).toBe(Date.parse(MFA_ADMIN_ENFORCE_FROM));

        const extended = {
            NODE_ENV: 'test', MFA_ADMIN_ENFORCE: 'true',
            MFA_ADMIN_GRACE_UNTIL: '2027-01-01T00:00:00.000Z',
        } as NodeJS.ProcessEnv;
        expect(adminMfaVerdict(UNENROLLED_ADMIN, extended, AFTER).outcome).toBe('warn');
    });

    it('AN ENROLLED ADMINISTRATOR IS OK EITHER WAY, so the flag only ever relaxes', () => {
        const enrolled = { roles: ['admin'], mfaEnabled: true };

        for (const env of [OFF, ON]) {
            expect(adminMfaVerdict(enrolled, env, AFTER).outcome).toBe('ok');
        }
    });

    it('AND THE WAY OUT IS STILL OPEN under enforcement — /profile and /auth are exempt', () => {
        //   #663's rule, unchanged: a redirect loop would leave an administrator
        //   unable to reach either the admin panel or the screen that fixes it.
        for (const path of ['/profile', '/auth/login', '/api/auth/session']) {
            expect(adminMfaGate(path, UNENROLLED_ADMIN, ON, AFTER)).toBeNull();
        }
    });
});
