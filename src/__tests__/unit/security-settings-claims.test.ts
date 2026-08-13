/**
 * @jest-environment node
 */

/**
 * The security settings screen told the operator a control existed.
 *
 * /admin/settings/security renders a Two-Factor Authentication toggle, and
 * beneath it:
 *
 *     {settings.enforceMfa ? "MFA is enforced for all admin accounts"
 *                          : "MFA is optional for admin accounts"}
 *
 * The toggle defaults to on, so an admin opening that page was told MFA is
 * enforced for all admin accounts.
 *
 * #167 established that nothing enforces MFA anywhere: src/middleware.ts has no
 * MFA logic, the mfa_verified cookie is read by nothing, and requiresMFA() —
 * which names withdrawal, loan approval and role change — has no callers.
 *
 * A settings panel that does nothing is a bug. A SECURITY settings panel that
 * states a control is active, to the person whose job is to check exactly that,
 * is worse: it is the screen someone would consult to answer the question, and
 * it answered wrongly.
 *
 * THE WHOLE PANEL IS INERT, NOT JUST THIS
 * ---------------------------------------
 * Every reference to sessionDurationDays, idleTimeoutHours, maxLoginAttempts and
 * lockoutDurationMinutes is the form that edits them. Nothing on the server
 * reads platform_settings/security at all. The login limiter uses
 * rateLimitConfig.login and lib/security.ts reads MAX_LOGIN_ATTEMPTS from the
 * environment, so changing "Max login attempts" in the UI changes nothing.
 *
 * Only the MFA line is corrected here, because only it asserts that a control
 * is in force. The others are recorded below rather than reworded, since
 * "saved" is at least true of them and rewriting four labels is a design
 * decision rather than a correction.
 *
 * WHY THE COPY AND NOT THE WIRING
 * -------------------------------
 * Same reasoning as #167. Implementing five security controls — session
 * lifetime, idle timeout, lockout, attempt ceiling, MFA enforcement — is not an
 * audit's business, and MFA enforcement in particular must not go on before
 * backup codes can be redeemed. What can be fixed immediately is the platform
 * telling its operator something untrue.
 *
 * The test below couples the claim to the reality: it fails if the UI asserts
 * enforcement while requiresMFA still has no callers, and it fails the other
 * way once enforcement is built, so whoever builds it is told to restore the
 * confident wording.
 */

import { describe, it, expect } from '@jest/globals';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

/** Real, non-comment references to a symbol outside its own module. */
function callers(symbol: string, ownModule: string): string[] {
    return execSync(`grep -rn "${symbol}" src || true`, { encoding: 'utf-8', cwd: process.cwd() })
        .split('\n')
        .filter((l) => l.trim())
        .filter((l) => !l.includes('__tests__') && !l.includes(ownModule))
        .filter((l) => {
            const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
            return !body.startsWith('//') && !body.startsWith('*') && !body.startsWith('/*') && !body.startsWith('{/*');
        });
}

/**
 * Comment lines removed.
 *
 * The fix's own JSX comment quotes the old sentence to explain what was wrong
 * with it, so a raw `not.toContain` fails on the correction. That is the fifth
 * assertion in this audit to trip over prose describing the defect it checks
 * for; when the claim and its correction are both text, read the code.
 */
function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*');
        })
        .join('\n');
}

const page = codeOnly(source('src/app/admin/settings/security/page.tsx'));

describe('the screen does not claim a control it does not have', () => {
    it('no longer states that MFA is enforced', () => {
        // THE test. Shown by default, to the person checking whether it is.
        expect(page).not.toContain('MFA is enforced for all admin accounts');
    });

    it('says the preference is recorded but not in force', () => {
        expect(page).toContain('Not yet enforced');
        expect(page).toContain('Preference saved');
    });

    it('the claim matches reality, in both directions', () => {
        // The coupling that makes this durable rather than a one-off edit.
        //
        // If enforcement is built, requiresMFA gains a caller and this test
        // fails — telling whoever built it to restore the confident wording.
        // If the wording is restored while enforcement does not exist, it fails
        // the other way.
        const enforcementExists = callers('requiresMFA', 'src/lib/mfa.ts').length > 0;
        const uiClaimsEnforcement = page.includes('MFA is enforced');

        expect(uiClaimsEnforcement).toBe(enforcementExists);
    });

    it('still records the preference for whoever wires it up', () => {
        // Vacuity guard: deleting the toggle would satisfy every assertion
        // above and throw away a setting enforcement will need.
        expect(page).toContain('settings.enforceMfa');
        expect(source('src/app/api/admin/settings/security/route.ts'))
            .toContain('enforceMfa: Boolean(enforceMfa)');
    });
});

describe('the rest of the panel, recorded', () => {
    it('nothing on the server reads the stored security settings', () => {
        // Not corrected here — "saved" is true of these, and rewording four
        // labels is a design decision. Recorded so the state is visible.
        const readers = execSync('grep -rn "platform_settings" src || true', {
            encoding: 'utf-8',
            cwd: process.cwd(),
        })
            .split('\n')
            .filter((l) => l.trim())
            .filter((l) => !l.includes('__tests__'))
            .filter((l) => !l.includes('api/admin/settings'))
            .filter((l) => !l.includes('types/firestore.ts'))
            .filter((l) => !l.includes('targetType'));

        expect(readers).toEqual([]);
    });

    it('the login limit comes from config and the environment, not the setting', () => {
        // So "Max login attempts: 3" in the UI changes nothing.
        expect(source('src/lib/security.ts')).toContain("process.env.MAX_LOGIN_ATTEMPTS");
        expect(source('src/app/actions/auth.ts')).toContain('loginLimiter.check(ip)');
    });
});

describe('the settings routes themselves are guarded', () => {
    const route = source('src/app/api/admin/settings/security/route.ts');

    it('reading requires an admin', () => {
        expect(route).toContain('roles?.includes("admin")');
        expect(route).toContain('roles?.includes("super_admin")');
    });

    it('writing requires a super_admin', () => {
        // A stricter bar for the write than the read, which is the right way
        // round and worth pinning.
        const post = route.slice(route.indexOf('export async function POST'));

        expect(post).toContain('!session?.user?.roles?.includes("super_admin")');
        expect(post).toContain('Only super admins can change security settings');
    });

    it('records who changed it', () => {
        expect(route).toContain('updatedBy: session.user.id');
    });
});
