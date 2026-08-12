/**
 * @jest-environment node
 */

/**
 * admin-users.ts — 100 lines, two endpoints, and the two functions disagreed
 * with each other.
 *
 * DEFECT 1: THE DROPDOWN OFFERED PEOPLE THE ASSIGNMENT THEN REFUSED
 * -----------------------------------------------------------------
 * `getAdminUsersAction` deliberately queries for BOTH roles to populate the
 * assignment picker, and tags each result:
 *
 *     role: (d.roles as string[])?.includes("super_admin") ? "super_admin" : "admin"
 *
 * `assignDisputeAction`, forty lines below, validated the chosen assignee with
 * `hasRole(roles, "admin")` — a literal `includes("admin")`. A super_admin who
 * did not also hold the plain 'admin' role appeared in the list and was then
 * rejected with "Assignee is not an admin", about an administrator.
 *
 * DEFECT 2: THE NAME ON THE RECORD CAME FROM THE CALLER
 * ----------------------------------------------------
 * `assigneeName` arrived as a parameter and was written to the dispute as
 * `assignedAdminName` and into the audit log — while the assignee's own
 * document had already been loaded, one line above, to check their role. So the
 * attribution on an escalated dispute was whatever the caller typed, and the
 * audit entry agreed with it.
 *
 * The same shape as the certificate title in #116 and the property title in
 * #103: a value the server already holds, taken from the client instead. It is
 * admin-only and so the smallest instance of that pattern in this audit — but
 * the correct name was sitting in a variable two lines away.
 *
 * WHAT WAS ALREADY RIGHT
 * ----------------------
 * Both endpoints call requireAdmin(). And assignDisputeAction verifies the
 * assignee IS an administrator before assigning — the check most files audited
 * this week were missing about their own subject. It also confirms the dispute
 * exists rather than writing into a document that does not.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const ADMIN = 'admin-1';
const SUPER = 'super-1';
const OUTSIDER = 'seller-1';
const DISPUTE = 'dispute-abcdef123456';

const mockRequireAdmin = jest.fn() as jest.Mock<any>;
const mockAuditLog = jest.fn(async () => ({})) as jest.Mock<any>;
const mockNotify = jest.fn(async () => ({})) as jest.Mock<any>;

jest.mock('@/lib/require-admin', () => ({
    requireAdmin: (...a: any[]) => mockRequireAdmin(...a),
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: (...a: any[]) => mockAuditLog(...a),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: (...a: any[]) => mockNotify(...a),
}));

/**
 * requireAdmin returns `{ userId } | { error }` — an object either way, so
 * callers must test `"error" in check`. Mocked, because the real one reads the
 * database and would refuse every caller under test, which is how an earlier
 * suite passed with its guards deleted.
 */
function setCaller(isAdmin: boolean) {
    mockRequireAdmin.mockResolvedValue(isAdmin ? { userId: ADMIN } : { error: 'Unauthorized' });
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: ADMIN, email: 'a@e.com', roles: isAdmin ? ['admin'] : ['seller'] } },
        error: null,
    }));
}

/** The assignee document and the dispute, answered by id. */
function setWorld(opts: { assignee?: Record<string, any> | null; disputeExists?: boolean } = {}) {
    const assignee = opts.assignee === undefined
        ? { roles: ['admin'], displayName: 'Real Admin Name', email: 'real@e.com' }
        : opts.assignee;
    const disputeExists = opts.disputeExists ?? true;

    (global as any).mockFirestoreGet.mockImplementation((id: string) => {
        if (id === DISPUTE) {
            return Promise.resolve(
                disputeExists
                    ? { exists: true, empty: false, docs: [], data: () => ({ status: 'escalated' }) }
                    : { exists: false, empty: true, docs: [], data: () => undefined }
            );
        }
        if (assignee === null) {
            return Promise.resolve({ exists: false, empty: true, docs: [], data: () => undefined });
        }
        return Promise.resolve({ exists: true, empty: false, docs: [], data: () => assignee });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: false, empty: true, docs: [], data: () => ({}),
    }));
}

function disputePatch(): Record<string, any> | undefined {
    return (global as any).mockFirestoreUpdate.mock.calls
        .map((c: any[]) => c[c.length - 1])
        .find((p: any) => p && 'assignedAdminId' in p);
}

async function assign(assigneeId: string, claimedName: string) {
    const { assignDisputeAction } = await import('@/app/actions/admin-users');
    return assignDisputeAction(DISPUTE, assigneeId, claimedName);
}

describe('assignDisputeAction — a super_admin is an administrator', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(true);
    });

    it('accepts a super_admin who does not hold the plain admin role', async () => {
        // THE test. getAdminUsersAction puts this person in the dropdown; the
        // assignment used to reject them.
        setWorld({ assignee: { roles: ['super_admin'], displayName: 'Senior Admin' } });

        const r: any = await assign(SUPER, 'Senior Admin');

        expect(r.success).toBe(true);
        expect(disputePatch()?.assignedAdminId).toBe(SUPER);
    });

    it('still accepts a plain admin', async () => {
        setWorld({ assignee: { roles: ['admin'], displayName: 'Real Admin Name' } });

        const r: any = await assign(ADMIN, 'Real Admin Name');

        expect(r.success).toBe(true);
    });

    it('still refuses somebody who is not an administrator at all', async () => {
        // The guard that was already correct, and the reason this endpoint is
        // careful in the first place — a dispute decides who keeps the money.
        setWorld({ assignee: { roles: ['seller'], displayName: 'A Seller' } });

        const r: any = await assign(OUTSIDER, 'A Seller');

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not an admin/i);
        expect(disputePatch()).toBeUndefined();
    });

    it('refuses an assignee who does not exist', async () => {
        setWorld({ assignee: null });

        const r: any = await assign('ghost-1', 'Ghost');

        expect(r.success).toBe(false);
        expect(disputePatch()).toBeUndefined();
    });

    it('refuses a dispute that does not exist', async () => {
        setWorld({ disputeExists: false });

        const r: any = await assign(ADMIN, 'Real Admin Name');

        expect(r.success).toBe(false);
        expect(disputePatch()).toBeUndefined();
    });
});

describe('assignDisputeAction — the name comes from the record', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setCaller(true);
        setWorld({ assignee: { roles: ['admin'], displayName: 'Real Admin Name', email: 'real@e.com' } });
    });

    it('ignores the name the caller supplied', async () => {
        // The assignee's own document was already loaded to check their role.
        await assign(ADMIN, 'Somebody Else Entirely');

        expect(disputePatch()?.assignedAdminName).toBe('Real Admin Name');
        expect(disputePatch()?.assignedAdminName).not.toBe('Somebody Else Entirely');
    });

    it('records the same verified name in the audit log', async () => {
        // An audit entry that agrees with a false attribution is worse than no
        // entry — it corroborates it.
        await assign(ADMIN, 'Somebody Else Entirely');

        expect(mockAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                metadata: expect.objectContaining({ assigneeName: 'Real Admin Name' }),
            })
        );
    });

    it('falls back to the email when the record has no name', async () => {
        setWorld({ assignee: { roles: ['admin'], email: 'real@e.com' } });

        await assign(ADMIN, 'Invented');

        expect(disputePatch()?.assignedAdminName).toBe('real@e.com');
    });

    it('notifies the assignee, not whoever the caller named', async () => {
        await assign(ADMIN, 'Somebody Else Entirely');

        expect(mockNotify).toHaveBeenCalledWith(
            expect.objectContaining({ userId: ADMIN })
        );
    });
});

describe('both endpoints require an admin', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setWorld();
    });

    it('assignDisputeAction refuses a non-admin caller', async () => {
        setCaller(false);

        const r: any = await assign(ADMIN, 'Real Admin Name');

        expect(r.success).toBe(false);
        expect(disputePatch()).toBeUndefined();
    });

    it('getAdminUsersAction refuses a non-admin caller', async () => {
        // Listing the administrators is itself worth guarding: it names who
        // holds power on the platform.
        setCaller(false);
        const { getAdminUsersAction } = await import('@/app/actions/admin-users');

        const r: any = await getAdminUsersAction();

        expect(r.success).toBe(false);
    });

    it('getAdminUsersAction serves an admin, so the refusal is not vacuous', async () => {
        setCaller(true);
        const { getAdminUsersAction } = await import('@/app/actions/admin-users');

        const r: any = await getAdminUsersAction();

        expect(r.success).toBe(true);
    });
});
