/**
 * @jest-environment node
 */

/**
 *   #353 TWO MODULES THAT LOOK LIKE THE ACCESS CONTROL AND ARE NOT IT.
 *
 *        (a) hub-guard's ADMIN BYPASS LOCKED OUT TWO OF THE TEN ADMIN ROLES.
 *
 *            requireHubRegistration wraps six layouts — marketplace seller,
 *            buyer and onboarding, farm-nation member and onboarding, the
 *            export app — and let admin accounts past the profileComplete
 *            check with a hand-written test:
 *
 *                r === 'admin' || r === 'super_admin' || r.endsWith('_admin')
 *
 *            `moderator` and `support` are neither literal and neither ends in
 *            `_admin`. Both are keys of PERMISSION_MATRIX and both make
 *            isAdmin() true, so they are admin roles by the only definition
 *            this codebase has — and they fell through to the registration
 *            check and were redirected to /hub/register. A support account
 *            could not open any module-guarded page.
 *
 *            That is #265's shape — module admins locked out by a hand-written
 *            role list — recurring for the two roles that happen not to share
 *            the suffix. And `endsWith('_admin')` was a trap in the other
 *            direction too: any future role ending in those seven characters
 *            would have bypassed registration without being an admin.
 *
 *        (b) lib/permissions.ts IS A SECOND, UNUSED, INCOMPLETE MATRIX.
 *
 *            A full ROUTE_PERMISSIONS and FEATURE_PERMISSIONS table with three
 *            exported predicates, ZERO importers, and 0% coverage. Its header
 *            said "Defines which roles can access which features and routes",
 *            which reads as authoritative and describes no request this
 *            application serves.
 *
 *            Nine of the twenty-one UserRole values are missing from it,
 *            including every module admin and both standardised marketplace
 *            roles. Wired up as-is it would refuse a marketplace_seller at
 *            /marketplace, an academy_participant at /academy (the route it
 *            marks "all users"), and all six module admins at /admin.
 *
 *            Kept, not deleted. This file is the ratchet on it: while it has no
 *            importers it may drift, and the moment anything imports it its
 *            vocabulary must match the real role set.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const GUARD = 'src/lib/hub-guard.ts';
const MATRIX = 'src/lib/permissions.ts';

/** Every role the UserRole union declares. */
function declaredRoles(): string[] {
    const roles = source('src/lib/types/roles.ts');
    const block = roles.slice(roles.indexOf('export type UserRole ='));
    return [...block.slice(0, block.indexOf(';')).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Every role lib/permissions.ts names anywhere. */
function matrixRoles(): string[] {
    return [...source(MATRIX).matchAll(/"([a-z_]+)"/g)]
        .map((m) => m[1])
        .filter((r) => !r.startsWith('/'));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#353 — the hub guard admits every admin role', () => {
    const code = source(GUARD);

    it('IT USES isAdmin, NOT A HAND-WRITTEN SUFFIX TEST', () => {
        // THE test. `endsWith('_admin')` is not the fact; membership of
        // PERMISSION_MATRIX is.
        expect(code).toContain('if (isAdmin(sessionRoles)) {');
        expect(code).not.toContain("r.endsWith('_admin')");
        expect(code).not.toMatch(/r === 'admin' \|\| r === 'super_admin'/);
    });

    it('AND moderator AND support REALLY WERE EXCLUDED BY THE OLD TEST', async () => {
        // The cost, executed rather than asserted. If either role ever stops
        // being an admin this fails and the write-up has to change.
        const { isAdmin } = await import('@/lib/admin-permissions');
        const oldTest = (r: string) => r === 'admin' || r === 'super_admin' || r.endsWith('_admin');

        for (const role of ['moderator', 'support']) {
            expect(isAdmin([role])).toBe(true);      // it IS an admin role
            expect(oldTest(role)).toBe(false);       // and the old test said no
        }
    });

    it('and every one of the ten admin roles passes now', async () => {
        const { isAdmin, ALL_ADMIN_ROLES } = await import('@/lib/admin-permissions');

        expect(ALL_ADMIN_ROLES.length).toBe(10);     // vacuity guard
        for (const role of ALL_ADMIN_ROLES) {
            expect(isAdmin([role])).toBe(true);
        }
    });

    it('while an ordinary member still does not', async () => {
        // The other side: the bypass must not have widened.
        const { isAdmin } = await import('@/lib/admin-permissions');

        for (const role of ['general_user', 'marketplace_seller', 'cooperative_member', 'field_officer']) {
            expect(isAdmin([role])).toBe(false);
        }
    });

    it('a role that merely ENDS in _admin no longer bypasses', async () => {
        // The trap in the other direction. `pending_admin` is not a role today;
        // the point is that inventing one would no longer grant the bypass.
        const { isAdmin } = await import('@/lib/admin-permissions');

        expect(isAdmin(['pending_admin'])).toBe(false);
        expect(isAdmin(['former_admin'])).toBe(false);
    });

    it('and the guard really does wrap the layouts this costs', () => {
        // Pinned rather than remembered.
        const importers: string = execSync(
            "grep -rl 'requireHubRegistration' --include='layout.tsx' src/app || true",
            { encoding: 'utf-8' },
        );

        expect(importers.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(5);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#353 — the second permission matrix is not the authority', () => {
    it('IT STILL HAS NO IMPORTERS', () => {
        // The claim the write-up rests on, measured. If this ever fails, the
        // ratchet below stops being advisory and starts being a requirement.
        const importers: string = execSync(
            `grep -rl "from ['\\"]@/lib/permissions['\\"]" --include='*.ts' --include='*.tsx' src `
            + "| grep -v __tests__ || true",
            { encoding: 'utf-8' },
        );

        expect(importers.split('\n').filter(Boolean)).toEqual([]);
    });

    it('and its header says so, rather than claiming to define access', () => {
        const raw = readFileSync(MATRIX, 'utf-8');

        expect(raw).toMatch(/NOTHING IMPORTS THIS FILE/);
        expect(raw).toMatch(/lib\/admin-permissions\.ts\s+PERMISSION_MATRIX/);
    });

    it('THE ROLES IT IS MISSING ARE STILL THE NINE NAMED IN ITS HEADER', () => {
        // The measurement, kept honest: if the union changes, the header has to.
        const missing = declaredRoles().filter((r) => !matrixRoles().includes(r));

        expect(missing.sort()).toEqual([
            'academy_admin', 'academy_participant', 'cooperative_admin',
            'export_admin', 'farm_nation_admin', 'marketplace_admin',
            'marketplace_buyer', 'marketplace_seller', 'wave_admin',
        ]);

        const raw = readFileSync(MATRIX, 'utf-8');
        for (const role of missing) {
            expect(raw).toContain(role);   // each one is named in the write-up
        }
    });

    it('the exclusions it would cause are real, not hypothetical', async () => {
        // Executed against the module itself. These are the refusals a reader
        // would get if they wired it up without completing it first.
        const { canAccessRoute } = await import('@/lib/permissions');

        expect(canAccessRoute(['marketplace_seller'] as any, '/marketplace')).toBe(false);
        expect(canAccessRoute(['academy_participant'] as any, '/academy')).toBe(false);
        expect(canAccessRoute(['marketplace_admin'] as any, '/admin')).toBe(false);
        expect(canAccessRoute(['support'] as any, '/admin')).toBe(false);

        // And the roles it DOES know still work, so the module is not simply
        // broken — it is incomplete, which is harder to notice.
        expect(canAccessRoute(['seller'] as any, '/marketplace')).toBe(true);
        expect(canAccessRoute(['super_admin'] as any, '/admin')).toBe(true);
    });

    it('THE RATCHET: if it ever gains an importer, it must know every role', () => {
        // The condition under which this stops being a document. Written as one
        // assertion so the failure message says what to do.
        const importers: string = execSync(
            `grep -rl "from ['\\"]@/lib/permissions['\\"]" --include='*.ts' --include='*.tsx' src `
            + "| grep -v __tests__ || true",
            { encoding: 'utf-8' },
        );
        const isWired = importers.split('\n').filter(Boolean).length > 0;
        const missing = declaredRoles().filter((r) => !matrixRoles().includes(r));

        if (isWired) {
            expect({ wired: true, rolesItDoesNotKnow: missing })
                .toEqual({ wired: true, rolesItDoesNotKnow: [] });
        } else {
            expect(missing.length).toBeGreaterThan(0);   // still the documented state
        }
    });
});
