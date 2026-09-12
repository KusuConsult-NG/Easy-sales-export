/**
 * @jest-environment node
 */

/**
 *   #526 THE ENDPOINT THAT GRANTS ROLES ASKED THE TOKEN WHO WAS ASKING.
 *
 *   POST/DELETE /api/admin/add-roles gated on
 *
 *       const callerRoles = session?.user?.roles ?? [];
 *       if (!isPlatformAdmin(callerRoles)) return 401;
 *
 *   which are the roles baked into the JWT. #356 established what that costs and
 *   requireAdmin exists because of it — its own step 2 reads "Re-fetch roles live
 *   from Firestore (bypasses the stale JWT)". So a just-revoked admin kept the
 *   ability to grant roles for as long as their token lived, ON THE ENDPOINT THAT
 *   GRANTS ROLES. requireAdmin also refuses a banned or suspended account while
 *   it has the document; this route never asked.
 *
 * ── AND THE PRIVILEGE CHECK LOOKED AT THE WRONG SIDE ────────────────────────
 *
 *       if (includesPrivilegedRole(roles) && !isSuperAdmin(callerRoles)) refuse
 *
 *   `roles` is what is being GRANTED. Nothing looked at who was being CHANGED.
 *   So a plain admin could revoke a non-privileged role from a SUPER_ADMIN, or
 *   grant one to them — every check above passes, because every check above is
 *   about the request rather than the target.
 *
 *   #499 FOUND AND FIXED THIS EXACT SHAPE in updateUserRolesAction, which is the
 *   other door onto the same operation, and its fix is one line: refuse when the
 *   target holds a privileged role and the caller is not a super_admin. This
 *   route never got it — the audit's most repeated finding, on role assignment.
 *
 * ── AND A ROLE CHANGE LEFT NO RECORD ANYBODY CAN QUERY ──────────────────────
 *
 *   It wrote `logger.info`. The sibling action writes createAdminAuditLog with
 *   the previous roles on it. A log line is not a record: it cannot be searched
 *   from the admin screens, and it is what a person looks for when asking who
 *   made somebody an admin. Both handlers write an audit entry now, under the
 *   platform's existing `user_role_change` action rather than two new names.
 *
 * ── WHAT WAS CHECKED AND IS NOT CLAIMED ─────────────────────────────────────
 *
 *   A plain admin granting a module role like wave_admin is NOT a defect: the
 *   route's own doc comment says "Regular admins can assign module-level roles"
 *   and includesPrivilegedRole is derived from PERMISSION_MATRIX, so a role that
 *   can do nothing its granter cannot is deliberately allowed. I checked that
 *   before touching it.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the gate back to the JWT roles                  KILLED
 *     the target-privilege check removed from POST    KILLED
 *     the target-privilege check removed from DELETE  KILLED
 *     the audit entries removed                       KILLED
 *     reword this header                              SURVIVED, as intended
 */

// #663 — mfaEnabled on the seeded administrator. requireAdmin now requires a second factor of admin accounts, and these fixtures were written when none did. Set here rather than left to the rollout window, so this suite does not start failing on the enforcement date.
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { auth } from '@/lib/auth';

let store: FakeDbHandle;

const CALLER = 'admin-1';
const TARGET = 'member-1';
const SUPER_TARGET = 'super-2';

/**
 * The session says one thing; the database is what decides.
 *
 * requireAdmin calls `auth()` from @/lib/auth — jest.setup mocks that module
 * with a jest.fn resolving null — NOT requireSession, so setting only
 * mockRequireSession leaves this route unauthenticated. The token roles set
 * here are deliberately allowed to disagree with the seeded record: that
 * disagreement IS the finding.
 */
function actAs(id: string, tokenRoles: string[]): void {
    (globalThis as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: tokenRoles, email: `${id}@example.com` } },
        error: null,
    }));
    (auth as unknown as jest.Mock).mockImplementation(() => Promise.resolve({
        user: { id, roles: tokenRoles, email: `${id}@example.com` },
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(CALLER, ['admin']);
    store.seed(COLLECTIONS.USERS, CALLER, { mfaEnabled: true, roles: ['admin'], email: 'admin@example.com' });
    store.seed(COLLECTIONS.USERS, TARGET, { mfaEnabled: true, roles: ['general_user'], email: 'ada@example.com' });
    store.seed(COLLECTIONS.USERS, SUPER_TARGET, { mfaEnabled: true, roles: ['super_admin'], email: 'boss@example.com' });
});

const call = async (method: 'POST' | 'DELETE', body: unknown) => {
    const mod = await import('@/app/api/admin/add-roles/route');
    const res = await (mod as any)[method](new Request('https://example.com/api/admin/add-roles', {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    }) as never);
    return { status: res.status, body: (await res.json()) as any };
};

const rolesOf = (id: string) => (store.get(COLLECTIONS.USERS, id) as any)?.roles;

// ─────────────────────────────────────────────────────────────────────────────
describe('#526 — a plain admin cannot change a super admin', () => {
    it('GRANTING A ROLE TO A SUPER ADMIN IS REFUSED', async () => {
        //   THE test. Every check in the old route was about the roles in the
        //   REQUEST, so a non-privileged role aimed at a super_admin passed.
        const res = await call('POST', { userId: SUPER_TARGET, roles: ['cooperative_member'] });

        expect(res.status).toBe(403);
        expect(rolesOf(SUPER_TARGET)).toEqual(['super_admin']);
    });

    it('AND REVOKING ONE FROM THEM IS REFUSED', async () => {
        const res = await call('DELETE', { userId: SUPER_TARGET, roles: ['cooperative_member'] });

        expect(res.status).toBe(403);
        expect(rolesOf(SUPER_TARGET)).toEqual(['super_admin']);
    });

    it('AND AN ORDINARY MEMBER CAN STILL BE GIVEN A MODULE ROLE', async () => {
        //   The vacuity guard, and the route's stated purpose: "Regular admins
        //   can assign module-level roles".
        const res = await call('POST', { userId: TARGET, roles: ['wave_participant'] });

        expect(res.status).toBe(200);
        expect(rolesOf(TARGET)).toContain('wave_participant');
    });

    it('and a super admin can still change another admin', async () => {
        actAs('boss-1', ['super_admin']);
        store.seed(COLLECTIONS.USERS, 'boss-1', { mfaEnabled: true, roles: ['super_admin'] });

        expect((await call('POST', { userId: SUPER_TARGET, roles: ['cooperative_member'] })).status).toBe(200);
    });

    it('and granting admin itself is still refused to a plain admin', async () => {
        //   The check that was already there and must survive the new one.
        expect((await call('POST', { userId: TARGET, roles: ['super_admin'] })).status).toBe(403);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#526 — the database decides, not the token', () => {
    it('A TOKEN CLAIMING admin IS REFUSED WHEN THE RECORD SAYS OTHERWISE', async () => {
        //   The revoked-admin case. #356's whole point: the JWT keeps its claim
        //   for hours after the record loses it.
        actAs(CALLER, ['admin']);                                   // token still says admin
        store.seed(COLLECTIONS.USERS, CALLER, { mfaEnabled: true, roles: ['general_user'] });  // record does not

        const res = await call('POST', { userId: TARGET, roles: ['wave_participant'] });

        expect(res.status).toBe(401);
        expect(rolesOf(TARGET)).toEqual(['general_user']);
    });

    it('AND A SUSPENDED ADMIN IS REFUSED', async () => {
        //   requireAdmin checks this while it has the document; the old gate
        //   never read a document at all.
        store.seed(COLLECTIONS.USERS, CALLER, { mfaEnabled: true, roles: ['admin'], suspended: true });

        expect((await call('POST', { userId: TARGET, roles: ['wave_participant'] })).status).toBe(401);
    });

    it('and the route no longer reads roles off the session', () => {
        //   Comments stripped: this fix quotes the old expression to explain it.
        const body = stripComments(
            readFileSync(join(process.cwd(), 'src/app/api/admin/add-roles/route.ts'), 'utf-8'),
            { label: 'add-roles route.ts' },
        );

        expect(body).not.toMatch(/session\?\.user\?\.roles/);
        expect(body).toContain('requireAdmin("users:update")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#526 — a role change leaves a record', () => {
    it('GRANTING WRITES AN AUDIT ENTRY WITH THE PREVIOUS ROLES', async () => {
        //   A logger.info is not something anybody can query later, and "who
        //   made this person an admin" is the question an audit log exists for.
        await call('POST', { userId: TARGET, roles: ['wave_participant'] });

        const calls = (globalThis as any).mockCreateAdminAuditLog.mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][0]).toMatchObject({
            action: 'user_role_change',
            targetId: TARGET,
            metadata: expect.objectContaining({ change: 'grant', previousRoles: ['general_user'] }),
        });
    });

    it('AND SO DOES REVOKING', async () => {
        store.seed(COLLECTIONS.USERS, TARGET, { mfaEnabled: true, roles: ['general_user', 'wave_participant'] });

        await call('DELETE', { userId: TARGET, roles: ['wave_participant'] });

        const calls = (globalThis as any).mockCreateAdminAuditLog.mock.calls;
        expect(calls[0][0]).toMatchObject({
            action: 'user_role_change',
            metadata: expect.objectContaining({ change: 'revoke' }),
        });
    });

    it('and it uses the vocabulary the platform already has', () => {
        //   `user_role_change` is what updateUserRolesAction records. Two new
        //   action names for one event is how a log becomes unsearchable.
        const body = stripComments(
            readFileSync(join(process.cwd(), 'src/app/api/admin/add-roles/route.ts'), 'utf-8'),
            { label: 'add-roles route.ts' },
        );

        expect(body).not.toMatch(/user_roles_(granted|revoked)/);
    });
});
