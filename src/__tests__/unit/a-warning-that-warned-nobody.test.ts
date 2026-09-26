/**
 * @jest-environment node
 */

/**
 *   #939 THE ROLLOUT'S WARNING WAS COMPUTED FOR FOURTEEN DAYS AND SHOWN TO NO
 *        ONE.
 *
 *   mfa-policy's header describes the rollout in two halves:
 *
 *       "before MFA_ADMIN_ENFORCE_FROM  an unenrolled administrator is warned
 *        and let through. Nothing changes for anyone."
 *
 *   The "let through" half was real. The "warned" half was never built.
 *   adminMfaVerdict returned `warn` on every admin request for a fortnight and
 *   adminMfaGate discards every verdict that is not `enrol`:
 *
 *       const verdict = adminMfaVerdict(account, env, now);
 *       if (verdict.outcome !== "enrol") return null;
 *
 *   So the warning state was correct, cheap, and thrown away — the same shape as
 *   #663, the finding that the whole MFA feature was wired to nothing, one layer
 *   further up. Then at midnight on 2026-09-26 the gate closed (#937) on
 *   administrators nobody had told.
 *
 *   ── AND graceActive() THREW AWAY THE ONE FACT A WARNING NEEDS ─────────────
 *
 *   It answered a boolean. A banner cannot be built on a boolean: "two-factor
 *   authentication will be required soon" is a mood, not a warning. The deadline
 *   now comes from adminMfaEnforcementAt, and graceActive ASKS THAT rather than
 *   keeping a second copy of the override rule — because two readings of
 *   MFA_ADMIN_GRACE_UNTIL that could drift would drift about a security
 *   deadline: the gate closing on a day the banner never named.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    adminMfaEnforcementAt,
    adminMfaGraceNotice,
    adminMfaVerdict,
    adminMfaGate,
    graceActive,
    MFA_ADMIN_ENFORCE_FROM,
    MFA_GRACE_URGENT_MS,
    MFA_SETUP_PATH,
} from '@/lib/mfa-policy';
import { enforcementDay } from '@/lib/env-validator';

const ROOT = process.cwd();
const code = (rel: string) =>
    stripComments(readFileSync(join(ROOT, rel), 'utf8'), { label: rel, minRetainedRatio: 0.15 });

const POLICY = 'src/lib/mfa-policy.ts';
const SHELL = 'src/components/admin/AdminShell.tsx';
const BANNER = 'src/components/admin/AdminMfaGraceBanner.tsx';

const ADMIN = { roles: ['admin'], mfaEnabled: false };
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A window open until this instant, and a clock a known distance from it. */
const WINDOW_UNTIL = '2026-10-10T00:00:00.000Z';
const CLOSES_AT = Date.parse(WINDOW_UNTIL);
const openEnv = { NODE_ENV: 'test', MFA_ADMIN_GRACE_UNTIL: WINDOW_UNTIL } as NodeJS.ProcessEnv;

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — the deadline is a fact the policy will now hand over', () => {
    it('THE OVERRIDE DECIDES IT', () => {
        expect(adminMfaEnforcementAt(openEnv)).toBe(CLOSES_AT);
    });

    it('AND THE BUILT-IN DATE STANDS WHEN THERE IS NO OVERRIDE', () => {
        expect(adminMfaEnforcementAt({ NODE_ENV: 'test' } as NodeJS.ProcessEnv))
            .toBe(Date.parse(MFA_ADMIN_ENFORCE_FROM));
    });

    it('AND A TYPO FAILS CLOSED, not open — a valve that opens on a typo is not a valve', () => {
        const typo = { NODE_ENV: 'test', MFA_ADMIN_GRACE_UNTIL: 'next Tuesday' } as NodeJS.ProcessEnv;

        expect(adminMfaEnforcementAt(typo)).toBe(Date.parse(MFA_ADMIN_ENFORCE_FROM));
    });

    it('AND graceActive AGREES WITH IT AT EVERY POINT, because it asks it', () => {
        /*
         *   The invariant that matters more than either function: the window is
         *   open exactly while the clock is before the deadline. If these two
         *   ever disagree, the banner names one day and the gate enforces
         *   another.
         */
        for (const offset of [-DAY, -1, 0, 1, DAY]) {
            const now = CLOSES_AT + offset;

            expect({ offset, open: graceActive(openEnv, now) })
                .toEqual({ offset, open: adminMfaEnforcementAt(openEnv) > now });
        }
    });

    it('and the two are ONE statement — graceActive does not re-read the override', () => {
        /*
         *   A mutation run is what makes this worth asserting: two copies of the
         *   parse could disagree and every behavioural test above would still
         *   pass, because each function is individually correct.
         *
         *   COUNTED AS THE PARSE, not as the variable name. The first version of
         *   this asserted the whole file mentions MFA_ADMIN_GRACE_UNTIL once, and
         *   went red on correct code: adminMfaEnforcementAt names it twice in one
         *   expression — the truthiness guard and the parse — which is one rule,
         *   not two. The rule is the parse.
         */
        const policy = code(POLICY);
        const parses = [...policy.matchAll(/Date\.parse\(env\.MFA_ADMIN_GRACE_UNTIL\)/g)].length;

        expect(parses).toBe(1);

        //   And graceActive reaches it through the function rather than reading
        //   the environment itself.
        const body = policy.slice(
            policy.indexOf('export function graceActive'),
            policy.indexOf('export function adminMfaEnforcementAt'),
        );

        expect(body).toContain('return adminMfaEnforcementAt(env) > now;');
        expect(body).not.toContain('MFA_ADMIN_GRACE_UNTIL');
        //   The control: if that slice ever comes back empty, both assertions above
        //   pass on nothing.
        expect(body.length).toBeGreaterThan(80);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — the warn verdict now carries the date', () => {
    it('AN UNENROLLED ADMIN INSIDE THE WINDOW IS WARNED, WITH THE DEADLINE', () => {
        const verdict = adminMfaVerdict(ADMIN, openEnv, CLOSES_AT - 3 * DAY);

        expect(verdict).toEqual({
            outcome: 'warn',
            reason: expect.any(String),
            enforcementAt: CLOSES_AT,
        });
    });

    it('AND ONCE THE WINDOW CLOSES IT IS `enrol` AND CARRIES NO DATE', () => {
        //   Nothing to count down to. The gate is the message now.
        const verdict = adminMfaVerdict(ADMIN, openEnv, CLOSES_AT);

        expect(verdict).toEqual({ outcome: 'enrol', reason: expect.any(String) });
    });

    it('and the gate still lets a warned admin through — the banner is not a block', () => {
        expect(adminMfaGate('/admin', ADMIN, openEnv, CLOSES_AT - DAY)).toBeNull();
    });

    it('and still refuses them once it closes — the control', () => {
        expect(adminMfaGate('/admin', ADMIN, openEnv, CLOSES_AT))
            .toEqual({ kind: 'redirect', to: MFA_SETUP_PATH, reason: expect.any(String) });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — who the notice is for, and who it is not for', () => {
    it('AN UNENROLLED ADMINISTRATOR GETS ONE', () => {
        const notice = adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - 5 * DAY);

        expect(notice).toEqual({
            enforcementAt: CLOSES_AT,
            msLeft: 5 * DAY,
            daysLeft: 5,
            hoursLeft: 120,
            urgent: false,
        });
    });

    it('AN ENROLLED ONE GETS NOTHING — it clears itself, which is the dismissal', () => {
        expect(adminMfaGraceNotice({ roles: ['admin'], mfaEnabled: true }, openEnv, CLOSES_AT - DAY))
            .toBeNull();
    });

    it('A MEMBER GETS NOTHING, whatever the window says', () => {
        //   Rule 2 of the policy is deliberately narrow: a member who has never
        //   enabled MFA is unaffected. Telling them about a deadline that will
        //   never apply to them would be the banner lying.
        expect(adminMfaGraceNotice({ roles: ['seller'], mfaEnabled: false }, openEnv, CLOSES_AT - DAY))
            .toBeNull();
    });

    it('AND NOBODY GETS ONE ONCE THE WINDOW HAS CLOSED', () => {
        expect(adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT)).toBeNull();
        expect(adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT + DAY)).toBeNull();
    });

    it('and it covers the module admins, not just the platform ones', () => {
        //   #887's finding: mfaEnrolmentRequired asks admin-permissions.isAdmin,
        //   which is true for all ten admin roles. A cooperative_admin approves
        //   loans; if the banner skipped them they would meet the gate cold.
        for (const role of ['cooperative_admin', 'marketplace_admin', 'moderator', 'support']) {
            expect({ role, warned: adminMfaGraceNotice({ roles: [role], mfaEnabled: false }, openEnv, CLOSES_AT - DAY) !== null })
                .toEqual({ role, warned: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — urgency, so the banner is not the same on day 14 and day 1', () => {
    it('IT TURNS URGENT INSIDE FORTY-EIGHT HOURS', () => {
        expect(adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - MFA_GRACE_URGENT_MS)?.urgent).toBe(true);
    });

    it('AND IS NOT URGENT ONE MILLISECOND EARLIER — the boundary', () => {
        expect(adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - MFA_GRACE_URGENT_MS - 1)?.urgent)
            .toBe(false);
    });

    it('AND THE FINAL DAY FLOORS TO ZERO DAYS rather than rounding up to one', () => {
        //   "1 day left" printed with four hours to go is the banner lying in the
        //   direction that costs the reader their admin panel.
        const notice = adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - 4 * HOUR);

        expect(notice).toMatchObject({ daysLeft: 0, hoursLeft: 4, urgent: true });
    });

    it('AND IT NEVER ROUNDS THE REMAINDER UP — five days and twenty hours is five days', () => {
        /*
         *   FLOOR, NOT ROUND, and a mutation run is why this case exists: every
         *   other case here lands on a whole day or under one, where round() and
         *   floor() agree, so `Math.round` SURVIVED the first version of this
         *   suite while my own mutation log claimed it was caught.
         *
         *   The direction is the point. Rounding up tells an administrator they
         *   have six days when they have five and twenty hours, which is the
         *   error that ends with them locked out a day earlier than they planned
         *   for. Every other number on this notice errs the same way.
         */
        const notice = adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - (5 * DAY + 20 * HOUR));

        expect(notice).toMatchObject({ daysLeft: 5, hoursLeft: 140 });
    });

    it('and a notice always has time left on it, at every distance', () => {
        for (const left of [1, HOUR, DAY, 13 * DAY]) {
            const notice = adminMfaGraceNotice(ADMIN, openEnv, CLOSES_AT - left);

            expect({ left, ms: notice?.msLeft }).toEqual({ left, ms: left });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — and the startup warning names the same day as the gate', () => {
    /*
     *   THE OVERRIDE IS WHAT EXPOSED THIS. env-validator's MFA_SECRET_KEY
     *   warning branches on graceActive(), which honours MFA_ADMIN_GRACE_UNTIL —
     *   and then both of its sentences printed MFA_ADMIN_ENFORCE_FROM, inlined.
     *   With the window extended, the "becomes MANDATORY on …" line named
     *   2026-09-26: a date already in the past, presented as the future
     *   deadline. A reader who notices that stops believing the rest of the
     *   startup output, which is the part that costs something.
     */
    it('IT FOLLOWS THE OVERRIDE', () => {
        expect(enforcementDay(openEnv)).toBe('2026-10-10');
    });

    it('AND FALLS BACK TO THE BUILT-IN DATE WITHOUT ONE', () => {
        expect(enforcementDay({ NODE_ENV: 'test' } as NodeJS.ProcessEnv))
            .toBe(MFA_ADMIN_ENFORCE_FROM.slice(0, 10));
    });

    it('AND A TYPO FALLS BACK TOO, rather than printing "Invalid Date"', () => {
        const typo = { NODE_ENV: 'test', MFA_ADMIN_GRACE_UNTIL: 'soon' } as NodeJS.ProcessEnv;

        expect(enforcementDay(typo)).toBe(MFA_ADMIN_ENFORCE_FROM.slice(0, 10));
    });

    it('AND IT IS THE SAME INSTANT THE GATE USES — not a second reading of it', () => {
        const validator = code('src/lib/env-validator.ts');

        //   The constant is no longer inlined into either sentence.
        expect(validator).not.toContain('MFA_ADMIN_ENFORCE_FROM.slice(0, 10)');
        expect(validator).toContain('adminMfaEnforcementAt(env)');
        //   Both branches read it.
        expect([...validator.matchAll(/\$\{enforcementDay\(\)\}/g)].length).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#939 — and it is wired to the chrome the gate governs', () => {
    it('THE BANNER IS RENDERED IN AdminShell, not in admin/layout.tsx', () => {
        /*
         *   #617 is why. AdminShell is the chrome for /admin AND /loans/approve,
         *   which is not under /admin and had no layout of its own. isAdminSurface
         *   governs both, so a banner in admin/layout.tsx would leave the loan
         *   approval screen unwarned — the exact asymmetry #617 fixed here.
         */
        const shell = code(SHELL);

        expect(shell).toContain('<AdminMfaGraceBanner');
        expect(shell).toContain('mfaEnabled={sessionResult.session?.user?.mfaEnabled}');
        expect(code('src/app/admin/layout.tsx')).not.toContain('AdminMfaGraceBanner');
    });

    it('AND IT READS THE FLAG #937 HAD TO ADD, not a second source for it', () => {
        //   If this read the database it would be a read per admin page load for
        //   a fact the session already carries.
        const shell = code(SHELL);

        expect(shell).not.toContain('getUserProfile');
        expect(shell).toContain('roles={roles}');
    });

    it('AND THE BANNER ASKS THE POLICY, rather than deciding for itself', () => {
        const banner = code(BANNER);

        expect(banner).toContain('adminMfaGraceNotice(');
        expect(banner).toContain('if (!notice) return null;');
        //   A second reading of the deadline here could name a different day
        //   than the gate enforces.
        expect(banner).not.toContain('MFA_ADMIN_GRACE_UNTIL');
        expect(banner).not.toContain('graceActive');
    });

    it('and it links to the escape hatch the gate redirects to, by the shared constant', () => {
        const banner = code(BANNER);

        expect(banner).toContain('MFA_SETUP_PATH');
        //   Not retyped. #887 is the finding that this path pointed at a query
        //   parameter nothing read; a hand-written copy here would be free to
        //   drift back to that.
        expect(banner).not.toContain('"/profile?tab=security');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   adminMfaGraceNotice returns a notice for an      "AN ENROLLED ONE GETS
 *     enrolled admin                                 NOTHING"
 *   …for a member                                    "A MEMBER GETS NOTHING"
 *   …after the window closes (the defect's mirror)   "AND NOBODY GETS ONE ONCE
 *                                                    THE WINDOW HAS CLOSED"
 *   graceActive keeps its own copy of the override    "the two are ONE statement"
 *     parse                                          (the behavioural cases all
 *                                                    survive this one)
 *   an unparseable override means "no enforcement"    "A TYPO FAILS CLOSED"
 *   urgent uses < instead of <=                       "IT TURNS URGENT INSIDE
 *                                                    FORTY-EIGHT HOURS"
 *   daysLeft rounds instead of floors                 "IT NEVER ROUNDS THE
 *     SURVIVED the first version of this suite:       REMAINDER UP" — the
 *     round() and floor() agree on every whole        whole-day cases agree with
 *     day and on anything under one, so every         round() and caught nothing
 *     case written here caught nothing
 *   the banner moves to admin/layout.tsx              "THE BANNER IS RENDERED IN
 *     (loses /loans/approve)                          AdminShell"
 *   the gate starts blocking a warned admin           "the gate still lets a
 *                                                    warned admin through"
 */
