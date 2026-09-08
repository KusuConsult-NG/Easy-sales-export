/**
 * @jest-environment node
 */

/**
 *   #499 THE BULK BUTTON REFUSED TO REMOVE AN ADMIN ROLE. THE ROW EDITOR
 *        PERFORMED IT, AND ITS OWN COMMENT SAID IT DID NOT.
 *
 *   `_updateUserRolesAction` writes the roles array WHOLESALE and guarded one
 *   direction only:
 *
 *       if (includesPrivilegedRole(roles) && !isSuperAdmin(session.user.roles)) {
 *           return { error: "Only a super admin can grant admin roles" };
 *       }
 *
 *   `roles` there is the SUBMITTED array. A plain admin calling this on a
 *   super_admin's id with ["general_user"] submits a set containing nothing
 *   privileged, the guard passes, and the super_admin is demoted.
 *
 *   THE COMMENT ABOVE IT CLAIMED OTHERWISE:
 *
 *       "That also stops a plain admin editing an existing admin's unrelated
 *        roles, since the array has to carry 'admin' through to preserve it.
 *        Editing another admin's account is the case worth being strict about."
 *
 *   True of PRESERVING the role. Silent on STRIPPING it — which is the same
 *   sentence read from the other end, and the end that matters. A comment
 *   asserting a boundary the code does not have is how the next reader stops
 *   looking, which #493 and #495 both recorded in other files.
 *
 * ── AND THE OTHER DOOR ONTO THE SAME OPERATION ALREADY GUARDED IT ───────────
 *
 *   bulk-user-operations.ts:271, five hundred lines away:
 *
 *       if (rolesToRemove.includes("admin") || rolesToRemove.includes("super_admin")) {
 *           return { error: "Cannot remove admin roles via bulk operation" };
 *       }
 *
 *   So selecting ten admins and pressing the bulk button was refused, and
 *   opening each one and clearing the field was not. Two doors onto one
 *   operation, one hardened — #276, #277, #279, #281, #294, #486, #497, and now
 *   this.
 *
 * ── WHY IT IS WORSE THAN AN ORDINARY PRIVILEGE BUG ──────────────────────────
 *
 *   It does not escalate anybody, and that is exactly what makes it bad. GRANTING
 *   a privileged role requires already being a super_admin. So a plain admin who
 *   demotes every super_admin leaves a platform where the role cannot be
 *   restored by anyone through the product — no path up, and no path back.
 *
 *   THE CHECK HAS TO READ THE TARGET, which is why the action now fetches the
 *   document. The submitted array cannot answer it: the submitted array is
 *   precisely the thing that omits the role being removed.
 *
 *   AND THE AUDIT ENTRY NOW SAYS WHAT THE ROLES WERE. "Somebody now holds
 *   [general_user]" cannot be read as a demotion, a promotion or a no-op, which
 *   is the only question anyone brings to that log.
 *
 * ── LEFT OPEN, DELIBERATELY AND WITH THE REASON ─────────────────────────────
 *
 *   A super_admin can still demote the LAST super_admin — including themselves,
 *   since the self-guard tests `isAdmin(roles)`, which counts "support" and
 *   "moderator". Closing that needs a count of remaining super_admins before
 *   every role write, and a count query that fails open would hand back the very
 *   hole it was added to close. It wants its own measurement, and inventing one
 *   here is the thing this audit keeps catching.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the removal guard deleted                      KILLED
 *     the guard testing the SUBMITTED roles instead   KILLED
 *     of the target's current ones
 *     previousRoles dropped from the audit entry     KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: jest.fn(),
    revalidateTag: jest.fn(),
    unstable_cache: (fn: unknown) => fn,
}));

let store: FakeDbHandle;

const USERS = COLLECTIONS.USERS;

function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve(
        { session: { user: { id, roles, email: `${id}@example.com` } }, error: null },
    ));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/admin/_users');
}

const update = async (id: string, roles: string[]) =>
    (await (await actions()).updateUserRolesAction(id, roles)) as any;

const read = (id: string) => store.get(USERS, id) as Record<string, any>;

function seedUser(id: string, roles: string[] = ['general_user']): void {
    store.seed(USERS, id, {
        email: `${id}@example.com`,
        firstName: 'Ada',
        lastName: 'Obi',
        roles,
        createdAt: '2026-01-01T00:00:00.000Z',
    });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#499 — a plain admin cannot strip an admin role', () => {
    it('A PLAIN ADMIN DEMOTING A SUPER ADMIN IS REFUSED', async () => {
        //   THE test. The submitted array holds nothing privileged, so the
        //   existing grant-guard waved it through and the super_admin lost the
        //   role.
        actAs('admin-2', ['admin']);
        seedUser('boss', ['super_admin']);

        expect(await update('boss', ['general_user'])).toMatchObject({
            success: false,
            error: "Only a super admin can change an admin's roles",
        });
        expect(read('boss').roles).toEqual(['super_admin']);
    });

    it('AND DEMOTING A PLAIN ADMIN IS REFUSED TOO', async () => {
        //   bulk-user-operations.ts names both roles in its refusal; a fix that
        //   covered only super_admin would leave the other half open.
        actAs('admin-2', ['admin']);
        seedUser('peer', ['admin']);

        expect((await update('peer', ['general_user'])).success).toBe(false);
        expect(read('peer').roles).toEqual(['admin']);
    });

    it('AND EDITING AN ADMIN\'S UNRELATED ROLES IS REFUSED — what the comment claimed', async () => {
        //   The precise claim the old comment made. It was true only when the
        //   submitted array carried "admin" through, which the grant-guard then
        //   caught; when it did not, nothing did.
        actAs('admin-2', ['admin']);
        seedUser('peer', ['admin', 'investor']);

        expect((await update('peer', ['admin'])).success).toBe(false);
        expect(read('peer').roles).toEqual(['admin', 'investor']);
    });

    it('A SUPER ADMIN MAY STILL DO IT — the refusal is a permission, not a wall', async () => {
        //   The control. A guard that refused everybody would satisfy all three
        //   assertions above, and would lock the platform's own owner out of
        //   managing their staff.
        seedUser('peer', ['admin']);

        expect(await update('peer', ['general_user'])).toMatchObject({ success: true });
        expect(read('peer').roles).toEqual(['general_user']);
    });

    it('AND A PLAIN ADMIN STILL MANAGES ORDINARY USERS', async () => {
        //   The second control, and the one that matters day to day: this action
        //   exists so support can assign ordinary roles.
        actAs('admin-2', ['admin']);
        seedUser('u1', ['general_user']);

        expect(await update('u1', ['general_user', 'investor'])).toMatchObject({ success: true });
        expect(read('u1').roles).toEqual(['general_user', 'investor']);
    });

    it('and a moderator is not a privileged role, so that edit still goes through', async () => {
        //   PRIVILEGED_ROLES is derived — admin, super_admin, and anything
        //   holding a permission beyond admin's. moderator holds fewer, so it is
        //   outside the guard, exactly as bulk-user-operations.ts has it.
        actAs('admin-2', ['admin']);
        seedUser('mod', ['moderator']);

        expect((await update('mod', ['general_user'])).success).toBe(true);
    });

    it('and a target that does not exist is refused rather than written', async () => {
        expect(await update('ghost', ['general_user'])).toMatchObject({
            success: false, error: 'User not found',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#499 — the audit entry records the change, not just the result', () => {
    it('THE PREVIOUS ROLES ARE WRITTEN DOWN', async () => {
        //   "Somebody now holds [general_user]" cannot be read as a demotion, a
        //   promotion or a no-op.
        seedUser('peer', ['admin', 'investor']);

        await update('peer', ['general_user']);

        //   createAdminAuditLog is mocked globally in jest.setup.js, so the
        //   entry is asserted where it is actually written rather than in the
        //   store — the audit collection stays empty in unit tests by design.
        const calls = (globalThis as any).mockCreateAdminAuditLog.mock.calls as any[][];
        const entry = calls.map(([payload]) => payload)
            .find((p) => p?.action === 'user_role_change');

        expect(entry).toBeDefined();
        expect(entry.metadata.previousRoles).toEqual(['admin', 'investor']);
        expect(entry.metadata.roles).toEqual(['general_user']);
    });
});
