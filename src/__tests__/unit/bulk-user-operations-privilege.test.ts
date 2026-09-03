/**
 * @jest-environment node
 */

/**
 * A PLAIN ADMIN COULD SUSPEND EVERY SUPER ADMIN ON THE PLATFORM.
 *
 * bulkSuspendUsersAction is gated on `users:suspend`, which the matrix gives to
 * super_admin AND admin. Inside the loop it then tried to protect the accounts
 * an admin must not touch:
 *
 *     const userRoles = userData?.roles || [];
 *     if (userRoles.includes("admin") && !isSuperAdmin(session.user.roles)) {
 *         failedIds.push(userId);
 *         continue;
 *     }
 *
 * That protects a target whose roles array literally contains the string
 * "admin". A super_admin whose roles are ["super_admin"] — the ordinary shape —
 * contains no such string and was not protected. Neither was cooperative_admin,
 * which holds a permission the matrix deliberately withholds from `admin`.
 *
 * Executed before the fix: acting as ["admin"] against a target with roles
 * ["super_admin"], the action returned { success: true, suspended: 1 } and the
 * target's document came back carrying suspended: true.
 *
 * `suspended: true` is not cosmetic. It is what lib/auth.ts refuses a login for
 * at its ban check, and what the jwt callback turns into token.isBanned, which
 * nulls session.user on the next sync. So the role hierarchy inverted: the
 * lower role could lock the higher one out of the platform, sessions included.
 *
 * THE ANSWER WAS ALREADY IMPORTED INTO THE FILE
 * ---------------------------------------------
 * includesPrivilegedRole — a set DERIVED from PERMISSION_MATRIX — was on line
 * 15 of this module and used 165 lines below in bulkAssignRolesAction, under a
 * comment explaining that a hand-written ["admin", "super_admin"] had gone
 * stale once six module-admin roles were added. admin/_users.ts and
 * admin/_legacy.ts both use it for exactly this. One file, four places asking
 * "is this target privileged", three different spellings, and every
 * hand-written one was wrong:
 *
 *     suspend        includes("admin")                        → fixed
 *     delete         includes("admin")                        → fixed
 *     assign (add)   includesPrivilegedRole                   → already right
 *     assign (remove) includes("admin") || includes("super_admin")  → fixed
 *     impersonate    includes("admin") || includes("super_admin")   → fixed
 *
 * WHAT IS AND IS NOT LIVE, SAID PLAINLY
 * -------------------------------------
 * Only the suspend one is reachable today. `users:delete` and
 * `users:impersonate` are held by super_admin alone, so in those functions
 * `!isSuperAdmin(session.user.roles)` is always false and the branch cannot be
 * entered. They are fixed anyway — each is one matrix edit from being reached,
 * and a guard that reads as protection while being wrong is worse than none,
 * because the next person to grant `users:delete` to `admin` has no reason to
 * look at that line. The premise is asserted below, so if the matrix ever
 * changes, these tests say so rather than quietly becoming load-bearing.
 *
 * The last test is the one that matters most: it does not name any role. It
 * walks every admin role there is and requires the action's behaviour to equal
 * what the derived set says, so the guard is coupled to the matrix by execution
 * and cannot drift from it again.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import {
    ALL_ADMIN_ROLES,
    PRIVILEGED_ROLES,
    includesPrivilegedRole,
    hasAdminPermission,
} from '@/lib/admin-permissions';

jest.mock('@/lib/redis', () => ({
    redis: { setex: jest.fn(async () => 'OK'), del: jest.fn(async () => 1) },
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => undefined),
    invalidateAdminGlobalStats: jest.fn(async () => undefined),
}));
jest.mock('@/lib/audit-log', () => ({
    ...(jest.requireActual('@/lib/audit-log') as object),
    logAuditAction: jest.fn(async () => undefined),
    recordAdminAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('next/cache', () => ({
    revalidateTag: jest.fn(), updateTag: jest.fn(), revalidatePath: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

declare const global: any;

let store: FakeDbHandle;

function actAs(roles: string[]) {
    global.mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: 'caller', roles, email: 'caller@example.com' } },
        error: null,
    }));
}

function seedTarget(id: string, roles: string[]) {
    store.seed(COLLECTIONS.USERS, id, { email: `${id}@example.com`, roles });
}

const REASON = 'Investigating an incident report filed on Tuesday';

async function suspend(callerRoles: string[], targetId: string) {
    actAs(callerRoles);
    const { bulkSuspendUsersAction } = await import('@/app/actions/bulk-user-operations');
    return (await bulkSuspendUsersAction([targetId], REASON)) as any;
}

function isSuspended(id: string): boolean {
    return store.get(COLLECTIONS.USERS, id)?.suspended === true;
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

describe('an admin suspending accounts above them', () => {
    it('CANNOT SUSPEND A SUPER ADMIN — this reported success and did it', async () => {
        seedTarget('the-owner', ['super_admin']);

        const res = await suspend(['admin'], 'the-owner');

        expect(isSuspended('the-owner')).toBe(false);
        expect(res.data).toEqual({ suspended: 0, failed: ['the-owner'] });
    });

    it('cannot suspend a cooperative_admin either', async () => {
        // In PRIVILEGED_ROLES because it holds a permission `admin` does not.
        // A typed-out ["admin", "super_admin"] would still have missed it.
        seedTarget('coop-boss', ['cooperative_admin']);

        await suspend(['admin'], 'coop-boss');

        expect(isSuspended('coop-boss')).toBe(false);
    });

    it('still cannot suspend a plain admin, which is what the guard always meant', async () => {
        seedTarget('peer', ['admin']);

        await suspend(['admin'], 'peer');

        expect(isSuspended('peer')).toBe(false);
    });
});

describe('the guard has not become a wall', () => {
    it('an admin can still suspend an ordinary member', async () => {
        seedTarget('member', ['general_user']);

        const res = await suspend(['admin'], 'member');

        expect(isSuspended('member')).toBe(true);
        expect(res.data).toEqual({ suspended: 1, failed: [] });
    });

    it('a super_admin can still suspend an admin', async () => {
        seedTarget('peer', ['admin']);

        expect((await suspend(['super_admin'], 'peer')).data.suspended).toBe(1);
        expect(isSuspended('peer')).toBe(true);
    });

    it('a super_admin can still suspend another super_admin', async () => {
        seedTarget('other-owner', ['super_admin']);

        await suspend(['super_admin'], 'other-owner');

        expect(isSuspended('other-owner')).toBe(true);
    });

    it('and a refused target is reported, not silently dropped', async () => {
        seedTarget('the-owner', ['super_admin']);
        seedTarget('member', ['general_user']);
        actAs(['admin']);
        const { bulkSuspendUsersAction } = await import('@/app/actions/bulk-user-operations');

        const res: any = await bulkSuspendUsersAction(['the-owner', 'member'], REASON);

        expect(res.data).toEqual({ suspended: 1, failed: ['the-owner'] });
        expect(isSuspended('member')).toBe(true);
        expect(isSuspended('the-owner')).toBe(false);
    });
});

describe('the guard is the matrix, not a list somebody typed', () => {
    it.each(ALL_ADMIN_ROLES.map((r) => [r]))(
        'an admin suspending a %s does exactly what the derived set says',
        async (role) => {
            /**
             * The test that names no role. Whatever PRIVILEGED_ROLES contains,
             * the ACTION's behaviour must agree with it — so adding a role to
             * the matrix that holds a permission `admin` lacks protects that
             * role here automatically, and the pair can never drift again.
             */
            seedTarget(`t-${role}`, [role]);

            await suspend(['admin'], `t-${role}`);

            expect(isSuspended(`t-${role}`)).toBe(!includesPrivilegedRole([role]));
        },
    );

    it('and an ordinary member is in no privileged set at all', () => {
        // The premise of the row above for the non-admin case.
        expect(includesPrivilegedRole(['general_user'])).toBe(false);
        expect(PRIVILEGED_ROLES).toContain('super_admin');
        expect(PRIVILEGED_ROLES).toContain('admin');
    });
});

describe('bulk role assignment guards both directions with the same set', () => {
    async function assign(callerRoles: string[], add: string[], remove: string[]) {
        actAs(callerRoles);
        const { bulkAssignRolesAction } = await import('@/app/actions/bulk-user-operations');
        return (await bulkAssignRolesAction(['member'], add, remove)) as any;
    }

    beforeEach(() => { seedTarget('member', ['general_user', 'cooperative_admin']); });

    it('refuses to strip cooperative_admin, which the typed-out pair allowed', async () => {
        const res = await assign(['admin'], [], ['cooperative_admin']);

        expect(res.success).toBe(false);
        expect(res.error).toBe('Cannot remove admin roles via bulk operation');
        expect(store.get(COLLECTIONS.USERS, 'member')?.roles).toContain('cooperative_admin');
    });

    it('still refuses to strip admin and super_admin', async () => {
        expect((await assign(['super_admin'], [], ['admin'])).success).toBe(false);
        expect((await assign(['super_admin'], [], ['super_admin'])).success).toBe(false);
    });

    it('and an ordinary role can still be removed', async () => {
        const res = await assign(['admin'], [], ['general_user']);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, 'member')?.roles).not.toContain('general_user');
    });

    it('and the add side is unchanged: an admin cannot grant a privileged role', async () => {
        const res = await assign(['admin'], ['super_admin'], []);

        expect(res.error).toBe('Only a super admin can grant admin roles');
    });
});

describe('impersonation refuses every admin role, not two of them', () => {
    async function impersonate(targetId: string) {
        actAs(['super_admin']);
        const { createImpersonationTokenAction } =
            await import('@/app/actions/bulk-user-operations');
        return (await createImpersonationTokenAction(
            targetId,
            'Reproducing a reported checkout failure for this account',
            30,
        )) as any;
    }

    it('will not mint a token for a cooperative_admin', async () => {
        seedTarget('coop-boss', ['cooperative_admin']);

        const res = await impersonate('coop-boss');

        expect(res.success).toBe(false);
        expect(res.error).toBe('Cannot impersonate admin users');
    });

    it('still refuses admin and super_admin', async () => {
        seedTarget('a1', ['admin']);
        seedTarget('s1', ['super_admin']);

        expect((await impersonate('a1')).success).toBe(false);
        expect((await impersonate('s1')).success).toBe(false);
    });

    it('and still mints one for an ordinary member', async () => {
        seedTarget('member', ['general_user']);

        const res = await impersonate('member');

        expect(res.success).toBe(true);
        expect(typeof res.data.token).toBe('string');
    });
});

describe('what is live and what is a ratchet', () => {
    it('users:suspend IS held by plain admin — which is why that one was live', () => {
        expect(hasAdminPermission(['admin'], 'users:suspend')).toBe(true);
    });

    it('users:delete and users:impersonate are super_admin only — so those branches are not reachable today', () => {
        // Stated as a premise rather than as a claim about severity. If either
        // of these ever becomes true for `admin`, this test fails and the guard
        // in that function stops being a ratchet and starts being load-bearing.
        expect(hasAdminPermission(['admin'], 'users:delete')).toBe(false);
        expect(hasAdminPermission(['admin'], 'users:impersonate')).toBe(false);
        expect(ALL_ADMIN_ROLES.filter((r) => hasAdminPermission([r], 'users:delete')))
            .toEqual(['super_admin']);
    });

    it('and no privilege test in this file is spelled by hand any more', () => {
        const code = readFileSync(
            join(process.cwd(), 'src/app/actions/bulk-user-operations.ts'), 'utf-8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');

        expect(code).not.toMatch(/includes\(\s*["']admin["']\s*\)/);
        expect(code).not.toMatch(/includes\(\s*["']super_admin["']\s*\)/);
        // Four sites: suspend, delete, assign-add, assign-remove, impersonate.
        expect(code.match(/includesPrivilegedRole\(/g)?.length).toBe(5);
    });
});
