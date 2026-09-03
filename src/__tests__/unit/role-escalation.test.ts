/**
 * @jest-environment node
 */

/**
 * An admin could promote themselves to super_admin.
 *
 * THE BOUNDARY
 * ------------
 * PERMISSION_MATRIX gives `admin` the "users:assign_roles" permission and
 * withholds three things, with the entry saying so in as many words:
 *
 *     admin: [
 *         // Standard admin permissions (no deletion, no impersonation, no
 *         // config rollback)
 *
 * "users:delete", "users:impersonate", "config:rollback", "finance:refund",
 * "audit:export" and "security:manage_mfa" are super_admin only.
 *
 * THE DEFECT
 * ----------
 * Both endpoints that write a roles array accepted whatever they were handed.
 *
 *   bulkAssignRolesAction   refused `rolesToRemove` containing admin or
 *                           super_admin — "Cannot remove admin roles via bulk
 *                           operation" — and placed NO restriction on
 *                           `rolesToAdd`
 *
 *   updateUserRolesAction   wrote the array wholesale. UserRoleSchema accepts
 *                           "admin" and "super_admin" as values, and the only
 *                           check was that you were not removing your OWN admin
 *                           rights — which adding a role never does
 *
 * So an admin could call either on their own id with ["super_admin"] and collect
 * exactly the permissions the matrix exists to withhold, including the ability
 * to delete users and to impersonate them.
 *
 * The near-miss is the tell: whoever wrote the bulk endpoint was thinking about
 * this boundary — they blocked removal — and stopped one line short of granting.
 *
 * WHY THESE TWO AND NO OTHERS
 * ---------------------------
 * "users:assign_roles" is held by super_admin and admin alone; no other role in
 * the matrix has it, or "users:update" or "users:suspend". So the escalation is
 * exactly admin → super_admin, and these were the only two endpoints that could
 * perform it. Every other role-touching write in the codebase uses
 * arrayUnion with a fixed participant role ("seller", "academy_participant"),
 * which cannot carry an admin role.
 *
 * WHAT WAS CHECKED AND FOUND CORRECT
 * ----------------------------------
 * The rest of bulk-user-operations.ts defends this boundary carefully, which is
 * why the gap stands out. Asserted below so it stays that way:
 *
 *   bulkSuspendUsersAction    skips admin targets unless caller is super_admin
 *   bulkDeleteUsersAction     super_admin only, refuses self-deletion, needs a
 *                             10-character reason
 *   createImpersonationToken  super_admin only, refuses an admin target, needs a
 *                             20-character reason, duration bounded to 5–120 min
 *   exportUserDataAction      users:read
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const SUPER = 'super-1';
const ADMIN = 'admin-1';
const TARGET = 'user-1';

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    logAuditAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
    logAdminFinancialAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
    invalidateServiceCache: jest.fn(async () => ({})),
}));
jest.mock('@/lib/redis', () => ({
    redis: { setex: jest.fn(async () => 'OK'), del: jest.fn(async () => 1), get: jest.fn(async () => null) },
    getCached: jest.fn(async () => null),
    setCache: jest.fn(async () => undefined),
}));

/**
 * hasAdminPermission, isSuperAdmin and includesPrivilegedRole are NOT mocked.
 * The real permission matrix runs against the roles set here — mocking it would
 * reduce these tests to asserting that a mock returned false.
 */
function setSession(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

/** The target user document every bulk loop reads before writing. */
function setTarget(roles: string[] = []) {
    const snap = {
        exists: true, empty: false,
        docs: [{ id: TARGET, ref: { id: TARGET }, data: () => ({ roles, email: 't@e.com' }) }],
        ref: { id: TARGET },
        data: () => ({ roles, email: 't@e.com' }),
    };
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(snap));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve(snap));
}

/** Role arrays written by the batch, if any. */
function rolesWritten(): string[][] {
    return (global as any).mockFirestoreBatchUpdate.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .filter((p: any) => p && Array.isArray(p.roles))
        .map((p: any) => p.roles);
}

describe('bulkAssignRolesAction — granting is as dangerous as removing', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setTarget([]);
    });

    async function assign(add: string[], remove: string[] = [], ids = [TARGET]) {
        const { bulkAssignRolesAction } = await import('@/app/actions/bulk-user-operations');
        return bulkAssignRolesAction(ids, add, remove);
    }

    it('refuses an admin granting super_admin to themselves', async () => {
        // THE test. This is the whole escalation: one call, own id.
        setSession(ADMIN, ['admin']);

        const r: any = await assign(['super_admin'], [], [ADMIN]);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/super admin/i);
        expect(rolesWritten()).toEqual([]);
    });

    it('refuses an admin granting admin to anybody else', async () => {
        // Minting a peer is the same escalation with an extra step.
        setSession(ADMIN, ['admin']);

        const r: any = await assign(['admin']);

        expect(r.success).toBe(false);
        expect(rolesWritten()).toEqual([]);
    });

    it('lets a super_admin grant admin', async () => {
        // Vacuity guard, and the reason the fix is not a blanket refusal:
        // appointing an admin has to remain possible.
        setSession(SUPER, ['super_admin']);

        const r: any = await assign(['admin']);

        expect(r.success).toBe(true);
        expect(rolesWritten().flat()).toContain('admin');
    });

    it('still lets an admin grant an ordinary role', async () => {
        // The second vacuity guard. Blocking every bulk role assignment would
        // satisfy the two refusals above and break routine administration.
        setSession(ADMIN, ['admin']);

        const r: any = await assign(['seller']);

        expect(r.success).toBe(true);
        expect(rolesWritten().flat()).toContain('seller');
    });

    it('still refuses to remove an admin role, as it did before', async () => {
        setSession(SUPER, ['super_admin']);

        const r: any = await assign([], ['admin']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/cannot remove admin/i);
    });
});

describe('updateUserRolesAction — the second path to the same place', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setTarget([]);
    });

    async function update(userId: string, roles: string[]) {
        const { updateUserRolesAction } = await import('@/app/actions/admin');
        return updateUserRolesAction(userId, roles);
    }

    it('refuses an admin writing super_admin onto their own account', async () => {
        // The bulk endpoint is the obvious route; this one writes the array
        // wholesale and was just as open. Fixing only the first would have left
        // the escalation intact.
        setSession(ADMIN, ['admin']);

        const r: any = await update(ADMIN, ['admin', 'super_admin']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/super admin/i);
    });

    it('refuses an admin writing admin onto somebody else', async () => {
        setSession(ADMIN, ['admin']);

        const r: any = await update(TARGET, ['admin']);

        expect(r.success).toBe(false);
    });

    it('lets a super_admin appoint an admin', async () => {
        // Vacuity guard.
        setSession(SUPER, ['super_admin']);

        const r: any = await update(TARGET, ['admin']);

        expect(r.success).toBe(true);
    });

    it('still lets an admin set an ordinary role', async () => {
        // "buyer", not "seller". This path runs through writeGuard, which
        // enforces a separate pre-existing rule — "Cannot assign 'seller' role
        // without 'approved' verification status" — so a seller here would fail
        // for a reason that has nothing to do with the escalation fix, and the
        // vacuity guard would be reporting the wrong thing.
        setSession(ADMIN, ['admin']);

        const r: any = await update(TARGET, ['buyer']);

        expect(r.success).toBe(true);
    });

    it('still refuses an admin removing their own admin rights', async () => {
        // Pre-existing guard; the new check must not shadow it.
        setSession(ADMIN, ['admin']);

        const r: any = await update(ADMIN, ['seller']);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/your own admin/i);
    });
});

describe('the boundary the rest of the file already defended', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('bulkSuspendUsersAction skips an admin target when the caller is not super_admin', async () => {
        setSession(ADMIN, ['admin']);
        setTarget(['admin']);
        const { bulkSuspendUsersAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await bulkSuspendUsersAction([TARGET], 'a sufficiently long reason');

        expect(r.data?.suspended).toBe(0);
        expect(r.data?.failed).toContain(TARGET);
    });

    it('bulkSuspendUsersAction still suspends an ordinary user', async () => {
        // Vacuity guard for the skip above.
        setSession(ADMIN, ['admin']);
        setTarget([]);
        const { bulkSuspendUsersAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await bulkSuspendUsersAction([TARGET], 'a sufficiently long reason');

        expect(r.data?.suspended).toBe(1);
    });

    it('bulkDeleteUsersAction refuses an admin outright', async () => {
        setSession(ADMIN, ['admin']);
        setTarget([]);
        const { bulkDeleteUsersAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await bulkDeleteUsersAction([TARGET], 'a sufficiently long reason');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/users:delete/i);
    });

    it('bulkDeleteUsersAction refuses a super_admin deleting themselves', async () => {
        setSession(SUPER, ['super_admin']);
        setTarget([]);
        const { bulkDeleteUsersAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await bulkDeleteUsersAction([SUPER], 'a sufficiently long reason');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/your own account/i);
    });

    it('createImpersonationTokenAction refuses an admin', async () => {
        setSession(ADMIN, ['admin']);
        setTarget([]);
        const { createImpersonationTokenAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await createImpersonationTokenAction(TARGET, 'a reason of at least twenty characters');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/users:impersonate/i);
    });

    it('createImpersonationTokenAction refuses a super_admin impersonating an admin', async () => {
        setSession(SUPER, ['super_admin']);
        setTarget(['admin']);
        const { createImpersonationTokenAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await createImpersonationTokenAction(TARGET, 'a reason of at least twenty characters');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/cannot impersonate admin/i);
    });

    it('createImpersonationTokenAction still issues a token for an ordinary user', async () => {
        // Vacuity guard: the two refusals above are satisfied by an endpoint
        // that never issues anything.
        setSession(SUPER, ['super_admin']);
        setTarget([]);
        const { createImpersonationTokenAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await createImpersonationTokenAction(TARGET, 'a reason of at least twenty characters');

        expect(r.success).toBe(true);
        expect(r.data?.token).toBeTruthy();
    });

    it('exportUserDataAction refuses a caller without users:read', async () => {
        setSession(TARGET, ['seller']);
        setTarget([]);
        const { exportUserDataAction } = await import('@/app/actions/bulk-user-operations');

        const r: any = await exportUserDataAction(TARGET);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/users:read/i);
    });
});
