/**
 * @jest-environment node
 */

/**
 * An action that cleared "you must change your password" without one.
 *
 * THE DEFECT
 * ----------
 * auth-extra.ts exported one thing:
 *
 *     export async function clearLegacyPasswordFlagAction() {
 *         const session = await auth();
 *         if (!session?.user?.id) return { success: false, error: "Unauthorized" };
 *         await userRef.update({ requiresPasswordChange: FieldValue.delete(), ... });
 *     }
 *
 * It authenticated the caller, scoped to their own record, and deleted the flag.
 * It verified nothing about a password.
 *
 * The reset page called it immediately after changePasswordAction returned
 * success, so the FLOW was correct. The FUNCTION was independently addressable:
 * every export of a "use server" file is an endpoint, and a user holding the
 * temporary password an admin generated could call this one directly, clear the
 * flag, and never change anything.
 *
 * WHAT THE FLAG DOES
 * ------------------
 * admin.ts sets requiresPasswordChange when an admin creates a user with a
 * temporary password. session-guard.ts and hub-guard.ts both read it and force
 * the user to the reset page while it is set; auth.ts reads it at login.
 *
 * So clearing it without a password change leaves the account running on a
 * credential a third party issued and knows — and stops the platform asking
 * about it. That is the point of the flag, removed by the endpoint named after
 * it.
 *
 * The same shape as autoEnrollPaidUser, whose own comment states it: "That
 * protected the CALL SITES and did nothing for the function, which is
 * independently addressable."
 *
 * THE FIX
 * -------
 * The flag is cleared inside changePasswordAction, which is the only code that
 * knows a password actually changed — it verifies the current one against
 * Supabase (with Firebase as the legacy fallback), enforces the registration
 * password policy, and updates both stores before reaching it.
 *
 * auth-extra.ts is deleted. There was nothing else in it, and leaving a
 * verified-nothing endpoint in place next to the real one is how the next
 * caller finds the wrong one.
 *
 * Best-effort on purpose: the password is already changed in both stores by the
 * time the flag is written, so failing the operation because a flag write failed
 * would tell the user their password did not change when it did. The worst case
 * is being asked to change it again.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
}

describe('the flag cannot be cleared without changing a password', () => {
    it('the standalone action is gone', () => {
        // THE test. It authenticated the caller and verified nothing else.
        expect(existsSync(join(process.cwd(), 'src/app/actions/auth-extra.ts'))).toBe(false);
    });

    it('nothing imports it any more', () => {
        const { execSync } = require('child_process') as typeof import('child_process');
        const refs = execSync('grep -rn "clearLegacyPasswordFlagAction" src || true', {
            encoding: 'utf-8',
            cwd: process.cwd(),
        })
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            .filter((l) => {
                const body = l.slice(l.indexOf(':', l.indexOf(':') + 1) + 1).trim();
                return !body.startsWith('//') && !body.startsWith('*');
            });

        expect(refs).toEqual([]);
    });

    it('no other action deletes the flag on its own', () => {
        // The general form. Only a password change may clear it — and
        // resetPasswordAction, which is the forgot-password flow, also sets a
        // new password before doing so.
        const { execSync } = require('child_process') as typeof import('child_process');
        const deletions = execSync(
            'grep -rn "requiresPasswordChange: FieldValue.delete()" src || true',
            { encoding: 'utf-8', cwd: process.cwd() }
        )
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'));

        // auth.ts (changePasswordAction) and password-reset.ts
        // (resetPasswordAction). Both set a password first.
        expect(deletions.length).toBe(2);
        expect(deletions.every((l) => /auth\.ts|password-reset\.ts/.test(l))).toBe(true);
    });
});

describe('changePasswordAction clears it, after doing the work', () => {
    const auth = source('src/app/actions/auth.ts');
    const changeFn = auth.slice(auth.indexOf('export async function changePasswordAction'));

    it('clears the flag', () => {
        expect(changeFn).toContain('requiresPasswordChange: FieldValue.delete()');
    });

    it('clears it only after the password store has been updated', () => {
        // Ordering is the whole point. Clearing first would reproduce the defect
        // inside the correct function.
        const supabaseUpdateAt = changeFn.indexOf('supabaseAdmin.auth.admin.updateUserById');
        const flagAt = changeFn.indexOf('requiresPasswordChange: FieldValue.delete()');

        expect(supabaseUpdateAt).toBeGreaterThan(-1);
        expect(flagAt).toBeGreaterThan(supabaseUpdateAt);
    });

    it('is not reached when the current password is wrong', () => {
        // The verification returns before anything is written.
        const flagAt = changeFn.indexOf('requiresPasswordChange: FieldValue.delete()');
        const rejectAt = changeFn.indexOf('Incorrect current password.');

        expect(rejectAt).toBeGreaterThan(-1);
        expect(flagAt).toBeGreaterThan(rejectAt);
    });

    it('is not reached when the new password fails policy', () => {
        const flagAt = changeFn.indexOf('requiresPasswordChange: FieldValue.delete()');
        const policyAt = changeFn.indexOf('passwordPolicySchema.safeParse(newPassword)');

        expect(policyAt).toBeGreaterThan(-1);
        expect(flagAt).toBeGreaterThan(policyAt);
    });

    it('does not fail the password change if the flag write fails', () => {
        // The password is already changed in both stores by then. Reporting
        // failure would tell the user it had not been.
        const tail = changeFn.slice(changeFn.indexOf('requiresPasswordChange: FieldValue.delete()'));

        expect(tail.slice(0, 700)).toContain('catch (flagErr');
        expect(tail.slice(0, 700)).toContain('logger.error');
    });
});

describe('the flag still means something', () => {
    it('an admin creating a user still sets it', () => {
        // Vacuity guard: if nothing set the flag, none of the above would
        // matter and the tests would pass against a dead feature.
        expect(source('src/app/actions/admin/_legacy.ts')).toContain('requiresPasswordChange = true');
    });

    it('the guards still enforce it', () => {
        // What made clearing it without a password change worth doing.
        expect(source('src/lib/session-guard.ts')).toContain('data.requiresPasswordChange');
        expect(source('src/lib/hub-guard.ts')).toContain('userData.requiresPasswordChange');
    });

    it('the reset page still changes the password before proceeding', () => {
        const page = source('src/app/auth/reset-legacy-password/page.tsx');

        expect(page).toContain('changePasswordAction(currentPassword, newPassword)');
        expect(codeOnly(page)).not.toContain('clearLegacyPasswordFlagAction');
    });
});
