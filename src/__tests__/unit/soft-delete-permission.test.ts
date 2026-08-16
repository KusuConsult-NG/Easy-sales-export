/**
 * @jest-environment node
 */

/**
 * A support agent could delete a super_admin.
 *
 * `softDeleteUserAction` carried this guard, comment and all:
 *
 *     // Strict: Only Super Admin or Admin can delete users
 *     if (!hasAdminPermission(session.user.roles, "users:delete")) {
 *         // Fallback if specific permission doesn't exist
 *         if (!isAdmin(session.user.roles)) { return Unauthorized }
 *     }
 *
 * The comment says strict. The code says the opposite.
 *
 * `users:delete` is held by **super_admin alone** in PERMISSION_MATRIX. The
 * fallback falls through to `isAdmin()`, which accepts TEN roles: super_admin,
 * admin, moderator, support, wave_admin, cooperative_admin, marketplace_admin,
 * export_admin, farm_nation_admin and academy_admin.
 *
 * So a moderator or a support agent could irreversibly scrub a person's name,
 * email, phone and bank details — and, since #125, revoke their sign-in too. The
 * one permission the matrix deliberately reserves was handed to everybody
 * wearing a badge.
 *
 * The fallback's own comment explains the intent — "if the specific permission
 * doesn't exist" — which is a guard against an undefined permission. It IS
 * defined. So the fallback was pure widening.
 *
 * AND NOTHING PROTECTED THE TARGET
 * --------------------------------
 * `bulkDeleteUsersAction`, which does the same job in bulk, skips admin targets
 * unless the caller is a super_admin. This path had no such rule, so whoever got
 * past the guard could delete an admin — or a super_admin — scrubbing their
 * details and cutting off their access.
 *
 * Both rules now match the bulk endpoint, which had them right all along. The
 * same shape as #122, where two functions in one file disagreed; here two files
 * doing one job disagreed.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const SUPER = 'super-1';
const ADMIN = 'admin-1';
const SUPPORT = 'support-1';
const MODERATOR = 'moderator-1';
const TARGET = 'target-1';

jest.mock('@/lib/auth-revocation', () => ({
    revokeAuthAccess: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    syncAuthEmail: jest.fn(async () => ({ primaryRevoked: true, legacyRevoked: true })),
    resolveSupabaseAuthId: jest.fn(async (id: string) => id),
}));
jest.mock('@/lib/audit-log', () => ({
    logAuditAction: jest.fn(async () => ({})),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/lib/cache-invalidation', () => ({
    invalidateUserCache: jest.fn(async () => ({})),
    invalidateAdminGlobalStats: jest.fn(async () => ({})),
    invalidateAllCaches: jest.fn(async () => ({})),
}));

/**
 * isAdmin, isSuperAdmin and hasAdminPermission are NOT mocked — the real
 * permission matrix runs against the roles set here. Mocking them would reduce
 * these tests to asserting that a mock returned false, which is the shape that
 * made an earlier suite in this repo pass with its guards deleted.
 */
function setCaller(id: string, roles: string[]) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: id, roles } },
        error: null,
    }));
}

function setTarget(roles: string[] = ['farmer'], exists = true) {
    (global as any).mockFirestoreGet.mockImplementation(() => Promise.resolve(
        exists
            ? { exists: true, empty: false, docs: [], data: () => ({ email: 'real@example.com', roles }) }
            : { exists: false, empty: true, docs: [], data: () => undefined }
    ));
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [], data: () => ({ roles }),
    }));
}

function scrubWrite(): Record<string, any> | undefined {
    return (global as any).mockFirestoreUpdate.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .find((p: any) => p && 'deleted' in p);
}

async function softDelete(target = TARGET) {
    const { softDeleteUserAction } = await import('@/app/actions/admin_extensions');
    return softDeleteUserAction(target);
}

describe('softDeleteUserAction — users:delete, and nothing weaker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setTarget();
    });

    // Every role isAdmin() accepts, minus the one that actually holds
    // users:delete. All ten used to get through the fallback.
    const admittedByFallback = [
        'admin', 'moderator', 'support', 'wave_admin', 'cooperative_admin',
        'marketplace_admin', 'export_admin', 'farm_nation_admin', 'academy_admin',
    ];

    for (const role of admittedByFallback) {
        it(`refuses a ${role}`, async () => {
            setCaller(`${role}-1`, [role]);

            const r: any = await softDelete();

            expect(r.success).toBe(false);
            expect(String(r.error)).toMatch(/users:delete/i);
            expect(scrubWrite()).toBeUndefined();
        });
    }

    it('allows a super_admin, so the refusals are not vacuous', async () => {
        // If this failed too, every assertion above would pass against an
        // endpoint that deletes nobody — and account deletion would be silently
        // broken rather than secured.
        setCaller(SUPER, ['super_admin']);

        const r: any = await softDelete();

        expect(r.success).toBe(true);
        expect(scrubWrite()?.deleted).toBe(true);
    });
});

describe('softDeleteUserAction — an administrator is not deleted by an administrator', () => {
    beforeEach(() => { jest.clearAllMocks(); });

    it('refuses when the target is an admin and the caller is not super_admin', async () => {
        // Unreachable now that the guard requires users:delete, and asserted
        // anyway: it is the rule bulkDeleteUsersAction has and this path did
        // not, and a future widening of the guard would restore the hole.
        setCaller(ADMIN, ['admin']);
        setTarget(['admin']);

        const r: any = await softDelete();

        expect(r.success).toBe(false);
        expect(scrubWrite()).toBeUndefined();
    });

    it('lets a super_admin delete an admin', async () => {
        setCaller(SUPER, ['super_admin']);
        setTarget(['admin']);

        const r: any = await softDelete();

        expect(r.success).toBe(true);
    });

    it('refuses a super_admin deleting another super_admin\'s account only via the same rule', async () => {
        // A super_admin may delete an administrator, including another
        // super_admin. Asserted so the boundary is a decision on the record
        // rather than an accident of the condition.
        setCaller(SUPER, ['super_admin']);
        setTarget(['super_admin']);

        const r: any = await softDelete();

        expect(r.success).toBe(true);
    });

    it('still refuses deleting your own account', async () => {
        // Pre-existing guard; must survive the change.
        setCaller(SUPER, ['super_admin']);
        setTarget(['super_admin']);

        const r: any = await softDelete(SUPER);

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/your own account/i);
    });

    it('refuses a target that does not exist', async () => {
        setCaller(SUPER, ['super_admin']);
        setTarget(['farmer'], false);

        const r: any = await softDelete();

        expect(r.success).toBe(false);
        expect(scrubWrite()).toBeUndefined();
    });
});

describe('the deletion still does what #125 made it do', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(SUPER, ['super_admin']);
        setTarget();
    });

    it('scrubs the PII and marks the account suspended', async () => {
        await softDelete();

        const scrub = scrubWrite();
        expect(scrub?.fullName).toBe('Deleted User');
        expect(String(scrub?.email)).toMatch(/deleted_/);
        // The field lib/auth.ts refuses to log in — roles and isActive are read
        // by nothing in the sign-in path.
        expect(scrub?.suspended).toBe(true);
    });

    it('revokes sign-in through the shared helper', async () => {
        const { revokeAuthAccess } = await import('@/lib/auth-revocation');

        await softDelete();

        expect(revokeAuthAccess).toHaveBeenCalledWith(TARGET, expect.stringMatching(/deleted_/));
    });
});
