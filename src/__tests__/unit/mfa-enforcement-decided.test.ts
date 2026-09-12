/**
 * @jest-environment node
 */

/**
 *   #663 THE RECORD OF A REVERSED DECISION.
 *
 *   This file replaces `mfa-not-enforced.test.ts`, which existed to assert that
 *   the MFA feature was built and connected to nothing, and carried this:
 *
 *       "OWNER DECISION (#445): DO NOT ENFORCE. Asked directly, told directly.
 *        This is no longer my judgement held open pending an answer — it is the
 *        answer, and these tests are the record of it."
 *
 *   ON 2026-09-12 THE OWNER REVERSED IT, in as many words: "go ahead with the
 *   MFA enforcement", and then, on being shown #445: "ignore my decision for
 *   earlier but do not break production."
 *
 *   The old decision was recorded plainly and the new one is recorded the same
 *   way, because a repository holding two contradictory owner decisions with
 *   only one of them written down is worse than one holding neither.
 *
 *   The old file also said what would have to be true first:
 *
 *       "If it is ever revisited, the order matters […] wire verifyBackupCode()
 *        first, THEN enforcement. Turning enforcement on while recovery is
 *        unwired locks anyone who loses their authenticator out of their own
 *        money, using the recovery path they were promised at setup."
 *
 *   That order was followed. The verify route accepts a backup code before any
 *   gate closes, and `the-second-factor-that-guarded-nothing` proves it by
 *   running the route rather than reading it.
 *
 * ── AND WHAT IS STILL NOT ENFORCED, SAID PLAINLY ────────────────────────────
 *
 *   Enrolment is enforced for administrators. The per-action gate — a fresh
 *   verification before each of the ten actions `requiresMFA()` names — is NOT
 *   wired, and the assertions below keep that honest rather than letting the
 *   screens imply a control that does not exist.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { issueMfaVerifiedValue, isMfaVerifiedValueFor } from '@/lib/mfa';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Non-comment, non-test references to a symbol. */
function callers(symbol: string, excludeFile: string): string[] {
    return execSync(`grep -rn "${symbol}" src || true`, { encoding: 'utf-8', cwd: process.cwd() })
        .split('\n')
        .filter((l) => l.trim())
        .filter((l) => !l.includes('__tests__') && !l.includes(excludeFile))
        .filter((l) => {
            const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
            return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*');
        });
}

describe('#663 — what is enforced now', () => {
    it('THE MIDDLEWARE CHECKS ENROLMENT', () => {
        //   Was: `expect(source('src/middleware.ts')).not.toMatch(/mfa|MFA/i)`.
        //   That assertion existed to record an absence and is now the
        //   assertion of its presence.
        expect(source('src/middleware.ts')).toMatch(/adminMfaGate/);
    });

    it('AND THE RECOVERY PATH IS WIRED, WHICH HAD TO COME FIRST', () => {
        //   Was: `callers('verifyBackupCode', …)` must be empty. The eight
        //   codes issued at setup, over the words "Each can only be used once",
        //   can be redeemed now.
        expect(source('src/app/api/auth/mfa/setup/route.ts')).toContain('generateBackupCodes(8)');
        expect(callers('verifyBackupCode', 'src/lib/mfa.ts').length).toBeGreaterThan(0);
    });
});

describe('#663 — and what is still not, which nothing may imply otherwise', () => {
    it('requiresMFA STILL HAS NO CALLERS — THE PER-ACTION GATE IS NOT WIRED', () => {
        /*
         *   Kept from the file this replaces, and still true. It names
         *   withdrawal, fund_release, loan_approval, escrow_release,
         *   role_change and admin_action, and nothing asks it about any of
         *   them.
         *
         *   Wiring ten actions across the money paths is a change with its own
         *   blast radius and belongs in its own commit — not folded into the
         *   one that changes the session token. When it is done, this test
         *   fails and security-settings-claims fails with it, which is the
         *   coupling that makes the screen's wording follow the code.
         */
        expect(callers('requiresMFA', 'src/lib/mfa.ts')).toEqual([]);
    });

    it('AND THE EMAIL-CODE PATH IS UNCALLED TOO', () => {
        expect(callers('verifyMFACode', 'src/lib/mfa.ts')).toEqual([]);
    });
});

describe('the routes themselves, which do work', () => {
    it('disable requires a valid current token', () => {
        //   The one that matters most now that enforcement exists: an attacker
        //   with a session must not be able to switch MFA off.
        const disable = source('src/app/api/auth/mfa/disable/route.ts');

        expect(disable).toContain('verifyTOTPToken');
    });

    it('and the mfa_verified cookie is bound to its user', () => {
        /*
         *   Kept from the replaced file. The value was the literal "true",
         *   which says nothing about WHO verified — and the cookie has a
         *   wildcard domain, a thirty-minute life, and is not cleared by
         *   sign-out. On a shared browser user B inherited user A's.
         */
        const value = issueMfaVerifiedValue('user-a', 'a-key-for-this-test-only');

        expect(isMfaVerifiedValueFor(value, 'user-a', 'a-key-for-this-test-only')).toBe(true);
        expect(isMfaVerifiedValueFor(value, 'user-b', 'a-key-for-this-test-only')).toBe(false);
        expect(isMfaVerifiedValueFor('true', 'user-a', 'a-key-for-this-test-only')).toBe(false);
    });
});
