/**
 * @jest-environment node
 */

/**
 * The MFA feature is built and not connected.
 *
 * All four routes under /api/auth/mfa work, and are better than average:
 * setup encrypts the TOTP secret, enable and verify check the token, disable
 * REQUIRES a valid current token before clearing anything, and all four are
 * rate-limited. lib/mfa.ts has TOTP generation and verification, QR codes,
 * backup-code generation, storage and redemption, an email-code path, and a
 * policy function.
 *
 * None of it is enforced.
 *
 *   src/middleware.ts        contains no MFA logic at all
 *   `mfa_verified` cookie    written by the verify route, read by nothing
 *   requiresMFA()            names ten sensitive actions — withdrawal,
 *                            fund_release, loan_approval, escrow_release,
 *                            role_change, admin_action among them — and has
 *                            NO CALLERS
 *   verifyBackupCode()       never called, so the eight recovery codes handed
 *                            to the user at setup, over the words "Each can
 *                            only be used once", cannot be redeemed
 *   verifyMFACode()          the email-code path, also uncalled
 *
 * So a user who enables MFA scans a QR code, saves recovery codes, and their
 * account is protected exactly as much as it was before. The verify route's own
 * comment said the cookie was "used by middleware enforcement"; that middleware
 * does not exist.
 *
 * WHY THIS IS PINNED RATHER THAN FIXED
 * ------------------------------------
 * Turning enforcement on is a product decision with a live consequence.
 * requiresMFA covers withdrawals and loan approvals; enabling it while
 * verifyBackupCode has no caller would lock anyone who loses their
 * authenticator out of their own money, with the recovery path they were
 * promised unwired. That is not a change to make as a side effect of an audit.
 *
 * So the state is asserted here instead — the same choice made for the QoreID
 * bypass in #140, so that the decision is visible in the suite rather than only
 * in a pull request nobody re-reads. These tests are written to FAIL when
 * somebody wires enforcement up, at which point they should be replaced by
 * tests of the enforcement.
 *
 * WHAT WAS FIXED
 * --------------
 * The one thing that is unambiguously wrong today: the cookie's value was the
 * literal "true", which says nothing about who verified. It is issued with a
 * wildcard domain and a thirty-minute life, and sign-out clears cookies by name
 * without clearing this one — so on a shared browser, user A verifying and
 * signing out left a cookie user B would inherit. Whoever wires enforcement
 * would have inherited that bypass. It is bound to the user by an HMAC now.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { issueMfaVerifiedValue, isMfaVerifiedValueFor, requiresMFA } from '@/lib/mfa';

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

describe('the state of MFA enforcement, recorded', () => {
    it('the middleware does not check MFA', () => {
        expect(source('src/middleware.ts')).not.toMatch(/mfa|MFA/i);
    });

    it('nothing reads the mfa_verified cookie', () => {
        const readers = callers('mfa_verified', 'src/app/api/auth/mfa/verify/route.ts');

        expect(readers).toEqual([]);
    });

    it('requiresMFA has no callers', () => {
        // It names withdrawal, fund_release, loan_approval, escrow_release,
        // role_change and admin_action. Nothing asks it about any of them.
        expect(callers('requiresMFA', 'src/lib/mfa.ts')).toEqual([]);
    });

    it('recovery codes are issued but cannot be redeemed', () => {
        // setup generates eight and the UI tells the user "Each can only be used
        // once". verifyBackupCode is the only thing that could consume one.
        expect(source('src/app/api/auth/mfa/setup/route.ts')).toContain('generateBackupCodes(8)');
        expect(callers('verifyBackupCode', 'src/lib/mfa.ts')).toEqual([]);
    });

    it('the email-code path is uncalled too', () => {
        expect(callers('verifyMFACode', 'src/lib/mfa.ts')).toEqual([]);
    });

    it('the route documents that nothing enforces this', () => {
        // The header used to say the cookie was "used by middleware
        // enforcement". Describing a control that does not exist is how it stays
        // not existing.
        //
        // Asserted on the CORRECTION rather than on the absence of the old
        // phrase, because the new comment quotes that phrase to explain what was
        // wrong with it — so `not.toContain` would fail on the fix. That trap
        // has now caught four assertions in this audit; when both the claim and
        // its correction are prose, pin the claim you want to be true.
        const verify = source('src/app/api/auth/mfa/verify/route.ts');

        expect(verify).toContain('NOTHING READS THAT COOKIE, AND NOTHING ENFORCES MFA');
        expect(verify).toContain('src/middleware.ts contains no MFA logic');
    });
});

describe('the routes themselves, which do work', () => {
    it('disable requires a valid current token', () => {
        // The one that would matter most if enforcement existed: an attacker
        // with a session must not be able to switch MFA off.
        const disable = source('src/app/api/auth/mfa/disable/route.ts');

        expect(disable).toContain('verifyTOTPToken');
        expect(disable.indexOf('verifyTOTPToken')).toBeLessThan(disable.indexOf('mfaEnabled: false'));
    });

    it('all four routes are rate-limited', () => {
        for (const r of ['setup', 'enable', 'verify', 'disable']) {
            expect(source(`src/app/api/auth/mfa/${r}/route.ts`)).toContain('withRateLimit');
        }
    });

    it('the TOTP secret is stored encrypted', () => {
        expect(source('src/app/api/auth/mfa/verify/route.ts')).toContain('decryptData');
    });
});

describe('the mfa_verified cookie is bound to its user', () => {
    const SECRET = 'test-mfa-secret-key';

    it('a value issued for one user does not verify another', () => {
        // THE fix. The value was the literal "true", which cannot fail this.
        const forAlice = issueMfaVerifiedValue('alice', SECRET);

        expect(isMfaVerifiedValueFor(forAlice, 'alice', SECRET)).toBe(true);
        expect(isMfaVerifiedValueFor(forAlice, 'bob', SECRET)).toBe(false);
    });

    it('rejects the old literal value', () => {
        // A cookie left in a browser from before this change must not pass.
        expect(isMfaVerifiedValueFor('true', 'alice', SECRET)).toBe(false);
    });

    it('rejects a forged mac and a missing value', () => {
        expect(isMfaVerifiedValueFor('alice.deadbeef', 'alice', SECRET)).toBe(false);
        expect(isMfaVerifiedValueFor(undefined, 'alice', SECRET)).toBe(false);
        expect(isMfaVerifiedValueFor('', 'alice', SECRET)).toBe(false);
    });

    it('rejects a value signed with a different key', () => {
        const elsewhere = issueMfaVerifiedValue('alice', 'some-other-key');

        expect(isMfaVerifiedValueFor(elsewhere, 'alice', SECRET)).toBe(false);
    });

    it('refuses to verify when the key is missing', () => {
        // Fails closed rather than treating an unconfigured secret as a match.
        expect(isMfaVerifiedValueFor(issueMfaVerifiedValue('alice', SECRET), 'alice', '')).toBe(false);
    });

    it('the route issues the bound value, not "true"', () => {
        const verify = source('src/app/api/auth/mfa/verify/route.ts');

        expect(verify).toContain('issueMfaVerifiedValue(session.user.id, secretKey)');
        expect(verify).not.toContain('"mfa_verified", "true"');
    });
});

describe('the policy that would be enforced, if anything enforced it', () => {
    it('still names the sensitive actions', () => {
        // Left exactly as found. Recorded so that whoever wires this up can see
        // what the original author intended to cover, rather than inventing a
        // list.
        for (const action of ['withdrawal', 'loan_approval', 'escrow_release', 'role_change', 'admin_action']) {
            expect(requiresMFA(action)).toBe(true);
        }
        expect(requiresMFA('browse_products')).toBe(false);
    });
});
