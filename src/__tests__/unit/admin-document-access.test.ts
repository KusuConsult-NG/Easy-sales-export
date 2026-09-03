/**
 * @jest-environment node
 */

/**
 * WHO MAY READ SOMEBODY ELSE'S IDENTITY DOCUMENT WAS DECIDED BY A ROLE THAT
 * DOES NOT EXIST.
 *
 * /api/admin/documents/[docId] serves the raw file a member uploaded for KYC —
 * an ID card, a passport photograph, a proof of address — as bytes. Its guard
 * read:
 *
 *     const isAdmin = userRoles.some(r =>
 *         ["admin", "super_admin", "cooperative_manager", "superadmin"].includes(r));
 *
 * `cooperative_manager` is not a role. It is in no permission table, in no role
 * union, and nowhere else in this repository — a name that has never matched
 * anything, sitting in the guard on identity documents. It is the fourth
 * hardcoded role list this audit has found deciding a question
 * admin-permissions.ts already answers, and the third that disagreed with it.
 *
 * WHAT WAS AND WAS NOT CHANGED
 * ----------------------------
 * `superadmin` is the legacy spelling of super_admin and does match, so the
 * list's REAL effect was {admin, super_admin}. `users:export` has exactly that
 * holder set — "held by super_admin and admin only — deliberately NOT by
 * support, moderator, or any module admin" — so naming it removes the dead
 * entry and the drift while changing nobody's access.
 *
 * The wider alternative is `users:read`, which the matrix's own note says
 * covers "reading one member's record to answer their support ticket" and which
 * every admin role holds. Adopting it would hand every module admin the
 * identity documents of every member. That is a policy decision rather than a
 * defect fix, so it is named in the route and left to the owner — and this test
 * pins the narrow set so the choice cannot be made by accident.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { hasAdminPermission } from '@/lib/admin-permissions';

const ALL_ROLES = [
    'super_admin', 'admin', 'moderator', 'support', 'wave_admin',
    'cooperative_admin', 'marketplace_admin', 'export_admin',
    'farm_nation_admin', 'academy_admin',
];

const ROUTE = 'src/app/api/admin/documents/[docId]/route.ts';

function source(): string {
    return readFileSync(join(process.cwd(), ROUTE), 'utf-8');
}

describe('the permission that gates an identity document', () => {
    it('IS HELD BY super_admin AND admin, AND BY NOBODY ELSE', () => {
        // The whole point of naming it: this set is now a property of the
        // matrix rather than of a list somebody typed into a route.
        const holders = ALL_ROLES.filter((r) => hasAdminPermission([r], 'users:export'));

        expect(holders).toEqual(['super_admin', 'admin']);
    });

    it('and that is exactly what the old hardcoded list really admitted', () => {
        /**
         * The list was ["admin", "super_admin", "cooperative_manager",
         * "superadmin"]. Two of those four are the roles above; `superadmin` is
         * the legacy spelling that role-mapping still honours elsewhere; and
         * `cooperative_manager` matched nothing.
         *
         * Asserted so the claim "this widens nobody's access" is checked rather
         * than stated.
         */
        const OLD_LIST = ['admin', 'super_admin', 'cooperative_manager', 'superadmin'];
        const oldEffect = ALL_ROLES.filter((r) => OLD_LIST.includes(r));
        const newEffect = ALL_ROLES.filter((r) => hasAdminPermission([r], 'users:export'));

        expect(newEffect.slice().sort()).toEqual(oldEffect.slice().sort());
    });

    it('AND cooperative_manager IS NOT A ROLE, WHICH IS WHY THE LIST WAS WRONG', () => {
        // The premise, asserted rather than assumed. If this role is ever
        // introduced, the finding's reasoning changes and this fails.
        expect(hasAdminPermission(['cooperative_manager'], 'users:export')).toBe(false);
        expect(hasAdminPermission(['cooperative_manager'], 'users:read')).toBe(false);
    });
});

describe('the route asks the matrix, not a list', () => {
    it('names the permission', () => {
        expect(source()).toContain('hasAdminPermission(session.user.roles, "users:export")');
    });

    it('AND CARRIES NO HARDCODED ROLE LIST AT ALL', () => {
        // Comments quote the old list to explain it, so the check is against
        // code. A list in a string array is what this finding is about.
        const code = source()
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        expect(code).not.toMatch(/\[\s*"admin"/);
        expect(code).not.toContain('cooperative_manager');
        expect(code).not.toContain('superadmin');
    });

    it('and still lets the owner read their own document without any role', () => {
        // The other half of the guard, which the permission must not replace:
        // a member reading back the ID they uploaded is not an admin action.
        const code = source();

        expect(code).toContain('data.userId !== session.user.id');
    });

    it('and still refuses an unauthenticated caller before reading anything', () => {
        const code = source();
        const authCheck = code.indexOf('if (!session?.user?.id)');
        const read = code.indexOf('.doc(docId).get()');

        expect(authCheck).toBeGreaterThan(-1);
        expect(read).toBeGreaterThan(authCheck);
    });
});
