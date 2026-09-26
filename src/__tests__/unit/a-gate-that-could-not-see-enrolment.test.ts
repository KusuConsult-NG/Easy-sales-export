/**
 * @jest-environment node
 */

/**
 *   #937 THE MFA GATE COULD NOT SEE ENROLMENT, AND FROM MIDNIGHT THAT WAS A
 *        REDIRECT LOOP AROUND THE WHOLE ADMIN PANEL.
 *
 *   Found by a red e2e run. Ten specs failed at once and every one of them was an
 *   admin surface — "admin users SHOULD access admin dashboard", the admin
 *   dashboards, loan approval, dispute resolution, the health diagnostics. The
 *   date had rolled past MFA_ADMIN_ENFORCE_FROM (2026-09-26T00:00:00.000Z), so
 *   the obvious reading was "the fixture has no second factor". It did not. But
 *   that was not the whole of it.
 *
 *   middleware decides whether to send an administrator to enrol from
 *
 *       adminMfaGate(pathname, { roles, mfaEnabled })
 *
 *   and it was reading that flag off `req.auth.user`, which is built by the
 *   session callback in auth.config. That callback maps THIRTEEN fields from the
 *   token onto the session. `mfaEnabled` was not one of them. The jwt callback
 *   has set `token.mfaEnabled` since #663 — nothing carried it the last step.
 *
 *   So the value middleware read was ALWAYS `undefined`: every administrator read
 *   as unenrolled, whether they had enrolled or not.
 *
 *   ── WHY IT WAS INVISIBLE FOR FOURTEEN DAYS, AND THEN A LOCKOUT ─────────────
 *
 *   While the grace window was open adminMfaVerdict returned "warn" and
 *   adminMfaGate dropped everything that is not "enrol", so a wrong answer cost
 *   nothing. From the enforcement date the same wrong answer is a redirect to the
 *   enrolment screen on every admin page — including for an administrator who has
 *   just enrolled. The setup path is an escape hatch, so they can reach it and
 *   cannot leave it: enrol, open /admin, get sent back.
 *
 *   requireAdmin, the server-action gate, reads the DATABASE and was always
 *   right. That asymmetry is why this could not be seen from the actions: the
 *   server admitted an enrolled admin the browser could not reach.
 *
 *   ── AND A CAST IS WHY NOTHING SAID SO ─────────────────────────────────────
 *
 *       (req.auth?.user as { mfaEnabled?: boolean } | undefined)?.mfaEnabled
 *
 *   Session["user"] never declared `mfaEnabled`, so without that cast the
 *   compiler would have refused the read. The check existed and was talked out
 *   of, in the one line where the gate meets the session.
 *
 *   The field is declared and mapped now, and the cast is gone — so the same
 *   mistake is a build failure. The sweep below is the general form: every field
 *   middleware reads off the session must be one the session sets.
 *
 *   MUTATION-TESTED, WITH CONTROLS — table at the foot of this file.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { adminMfaGate, MFA_SETUP_PATH } from '@/lib/mfa-policy';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => stripComments(read(rel), { label: rel, minRetainedRatio: 0.15 });

const MIDDLEWARE = 'src/middleware.ts';
const CONFIG = 'src/lib/auth.config.ts';
const AUTH = 'src/lib/auth.ts';

/** Enforcement is on; the grace override is not what is being tested here. */
const ENFORCING = {
    NODE_ENV: 'test', MFA_ADMIN_GRACE_UNTIL: '2000-01-01T00:00:00.000Z',
} as NodeJS.ProcessEnv;
const NOW = Date.parse('2026-09-26T12:00:00.000Z');

// ─────────────────────────────────────────────────────────────────────────────
describe('#937 — the defect, at the level the gate works on', () => {
    it('AN ENROLLED ADMINISTRATOR IS LET THROUGH', () => {
        //   What the browser could not do before this fix, because the flag never
        //   arrived: the gate itself was always willing.
        const verdict = adminMfaGate('/admin', { roles: ['admin'], mfaEnabled: true }, ENFORCING, NOW);

        expect(verdict).toBeNull();
    });

    it('AND AN UNENROLLED ONE IS SENT TO ENROL — the control', () => {
        const verdict = adminMfaGate('/admin', { roles: ['admin'], mfaEnabled: false }, ENFORCING, NOW);

        expect(verdict).toEqual({ kind: 'redirect', to: MFA_SETUP_PATH, reason: expect.any(String) });
    });

    it('AND `undefined` IS TREATED AS UNENROLLED, which is what made this a lockout', () => {
        /*
         *   The value middleware actually received. The gate is not wrong to
         *   refuse it — an absent flag must not admit anybody — which is exactly
         *   why the missing session field was invisible: every layer behaved
         *   correctly on the input it was given.
         */
        const verdict = adminMfaGate('/admin', { roles: ['admin'] }, ENFORCING, NOW);

        expect(verdict).toEqual({ kind: 'redirect', to: MFA_SETUP_PATH, reason: expect.any(String) });
    });

    it('and the enrolment screen itself stays reachable, or there is no way out', () => {
        expect(adminMfaGate(MFA_SETUP_PATH, { roles: ['admin'] }, ENFORCING, NOW)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#937 — the session now carries what the gate reads', () => {
    it('THE JWT SETS IT, AND THE SESSION COPIES IT', () => {
        expect(code(AUTH)).toContain('token.mfaEnabled = cachedProfile.mfaEnabled === true;');
        expect(code(CONFIG)).toContain('session.user.mfaEnabled = token.mfaEnabled === true;');
    });

    it('AND Session["user"] DECLARES IT, so the read needs no cast', () => {
        const auth = code(AUTH);

        expect(auth).toContain('mfaEnabled?: boolean;');
        expect(code(MIDDLEWARE)).toContain('mfaEnabled: req.auth?.user?.mfaEnabled,');
        //   The cast that silenced the compiler is gone.
        expect(code(MIDDLEWARE)).not.toContain('as { mfaEnabled?: boolean }');
    });

    it('THE SWEEP: every field middleware reads off the session is one the session sets', () => {
        /*
         *   The general form of this defect, and the assertion that would have
         *   caught it. Four of the five reads were mapped; the fifth was behind a
         *   cast, which is why a count would not have found it either — this
         *   matches the property NAMES.
         */
        const middleware = code(MIDDLEWARE);
        const config = code(CONFIG);

        const readFields = new Set(
            //   One `?` per optional link. The first version escaped each as
            //   `\?\?` — two literal question marks — and matched nothing; the
            //   size control below is what said so rather than the suite passing
            //   on an empty set.
            [...middleware.matchAll(/req\.auth\?\.user\?\.([A-Za-z_$][\w$]*)/g)]
                .map((m) => m[1]),
        );

        //   The control first: if this regex stops matching, every assertion below
        //   passes on an empty set.
        expect(readFields.size).toBeGreaterThanOrEqual(5);
        expect([...readFields].sort()).toContain('mfaEnabled');

        for (const field of readFields) {
            expect({ field, mapped: config.includes(`session.user.${field} =`) })
                .toEqual({ field, mapped: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#937 — and the e2e admin carries a second factor', () => {
    it('THE FIXTURE IS ENROLLED, because from the enforcement date it must be', () => {
        //   Ten e2e specs failed at midnight on this. The gate reads a flag rather
        //   than demanding a live challenge — #663 left per-action verification
        //   unwired — so the fixture needs no TOTP, just the enrolment.
        const seed = code('scripts/seed-local.ts');

        expect(seed).toContain('mfaEnabled: true');
        expect(seed).toContain("r === 'admin' || r === 'super_admin'");
    });

    it('AND ONLY THE ADMIN PERSONAS, so a member fixture still tests a member', () => {
        const seed = code('scripts/seed-local.ts');

        expect(seed).toContain('isAdminPersona ? { mfaEnabled: true } : {}');
    });
});

/**
 * ── MUTATION LOG ────────────────────────────────────────────────────────────
 *
 *   MUTANT                                          CAUGHT BY
 *   ──────────────────────────────────────────────  ───────────────────────────
 *   remove the session.user.mfaEnabled mapping       "THE JWT SETS IT, AND THE
 *     (the defect)                                   SESSION COPIES IT" and the
 *                                                    sweep
 *   restore the `as { mfaEnabled?: boolean }` cast    "Session["user"] DECLARES
 *     in middleware                                  IT"
 *   read a sixth session field in middleware that    the sweep, naming it
 *     the session callback does not set
 *   make adminMfaGate admit an absent flag           "`undefined` IS TREATED AS
 *                                                    UNENROLLED"
 *   make adminMfaGate refuse an enrolled admin       "AN ENROLLED ADMINISTRATOR
 *                                                    IS LET THROUGH"
 *   drop mfaEnabled from the e2e admin fixture       "THE FIXTURE IS ENROLLED"
 */
