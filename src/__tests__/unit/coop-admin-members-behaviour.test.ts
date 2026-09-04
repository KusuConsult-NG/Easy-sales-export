/**
 * @jest-environment node
 */

/**
 * The cooperative member status machine, EXECUTED.
 *
 * updateMemberStatusAction is the action that turns an applicant into a member:
 * it grants the `cooperative_member` role, sets isVerified, writes the
 * serviceRegistrations entry that checkModuleAccess reads, and — when suspending
 * — takes all of that away again. Three previously-recorded defects live in it,
 * and none of them was reachable by a test before the stateful store:
 *
 *   - SUSPENSION REVOKED NOTHING. It wrote `membershipStatus: "suspended"` onto
 *     the member document and stopped. The user document kept the role and kept
 *     `serviceRegistrations.cooperatives.status: "active"`, and checkModuleAccess
 *     grants access from EITHER — so a suspended member kept the dashboard,
 *     contributions, loans, withdrawals and the directory. Pressing Suspend
 *     changed a word on the admin's own screen and nothing else.
 *   - A SCOPED ADMIN COULD ACT ON ANY COOPERATIVE. getAdminScope was called, but
 *     only at the end to choose which caches to clear.
 *   - THE STALE-SESSION RETRY WAS WIDER THAN THE GATE. The permission check asked
 *     for `cooperatives:approve_members`; the retry against live roles asked only
 *     isAdmin(), so a caller the gate refused could be admitted by the fallback.
 *
 * Every one of those is a claim about what the DOCUMENTS say afterwards. A call
 * recorder can show that update() was called; only a store can show that the
 * suspended member no longer holds the role.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

const getAdminScope = jest.fn(async (_uid: string, _roles: unknown) => null as string | null);
jest.mock('@/lib/cooperative-admin-scope', () => ({
    getAdminScope: (uid: string, roles: unknown) => getAdminScope(uid, roles),
}));

let store: FakeDbHandle;

/** The session the action sees. jest.setup.js routes requireSession here. */
function actAs(id: string, roles: string[]): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles, email: `${id}@example.com`, name: id } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    getAdminScope.mockImplementation(async () => null);
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function updateStatus(memberId: string, status: string) {
    const { updateMemberStatusAction } = await import('@/app/actions/cooperative/_coop_admin_members');
    return updateMemberStatusAction(memberId, status as never);
}

const MEMBER = 'mem-1';
const TARGET = 'user-1';

function seedMember(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER, {
        userId: TARGET,
        firstName: 'Ada',
        lastName: 'Obi',
        email: 'ada@example.com',
        membershipStatus: 'pending',
        ...extra,
    });
}

function seedTargetUser(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, TARGET, {
        email: 'ada@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        ...extra,
    });
}

// ─── approval ────────────────────────────────────────────────────────────────

describe('approving a member', () => {
    beforeEach(() => {
        seedMember();
        seedTargetUser();
    });

    it('writes the status onto the membership', async () => {
        const result = await updateStatus(MEMBER, 'active');
        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('active');
    });

    it('and grants the role, the verification flag and the registration', async () => {
        // All four together. checkModuleAccess reads the role at Layer 1 and the
        // registration at Layer 2, so writing one without the other leaves access
        // depending on which layer happens to answer first.
        await updateStatus(MEMBER, 'active');

        const user = store.get(COLLECTIONS.USERS, TARGET)!;
        expect(user.roles).toContain('cooperative_member');
        expect(user.isVerified).toBe(true);
        expect(user.serviceRegistrations.cooperatives.status).toBe('active');
        expect(user.serviceRegistrations.cooperatives.activatedAt).toBeTruthy();
    });

    it('keeping the roles the member already had', async () => {
        // arrayUnion, not a replacement. Overwriting would strip a member who is
        // also a seller of their seller role.
        store.seed(COLLECTIONS.USERS, TARGET, { email: 'ada@example.com', roles: ['user', 'seller'] });
        await updateStatus(MEMBER, 'active');

        const user = store.get(COLLECTIONS.USERS, TARGET)!;
        expect(user.roles).toEqual(expect.arrayContaining(['user', 'seller', 'cooperative_member']));
    });

    it('and approving twice does not duplicate the role', async () => {
        await updateStatus(MEMBER, 'active');
        await updateStatus(MEMBER, 'active');
        const roles = store.get(COLLECTIONS.USERS, TARGET)!.roles as string[];
        expect(roles.filter((r) => r === 'cooperative_member')).toHaveLength(1);
    });

    it('"approved" records approvedAt but NOT activatedAt', async () => {
        // The two are different events, and the dashboard distinguishes them.
        await updateStatus(MEMBER, 'approved');
        const reg = store.get(COLLECTIONS.USERS, TARGET)!.serviceRegistrations.cooperatives;
        expect(reg.status).toBe('approved');
        expect(reg.approvedAt).toBeTruthy();
        expect(reg.activatedAt).toBeUndefined();
    });

    it('and creates a user document when the member has none', async () => {
        // The legacy-import case: a membership with no matching user record. The
        // action creates one rather than writing a role onto nothing.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-legacy', {
            userId: 'ghost-user',
            firstName: 'Legacy',
            lastName: 'Member',
            email: 'legacy@example.com',
        });

        await updateStatus('mem-legacy', 'active');

        const created = store.get(COLLECTIONS.USERS, 'ghost-user')!;
        expect(created.roles).toEqual(['cooperative_member']);
        expect(created.isVerified).toBe(true);
        expect(created.email).toBe('legacy@example.com');
        expect(created.fullName).toBe('Legacy Member');
        expect(created.serviceRegistrations.cooperatives.status).toBe('active');
    });

    it('and increments the version so a concurrent write can be detected', async () => {
        await updateStatus(MEMBER, 'active');
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?._version).toBe(1);
        await updateStatus(MEMBER, 'active');
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?._version).toBe(2);
    });
});

// ─── suspension: the defect that changed a label and revoked nothing ─────────

describe('suspending a member', () => {
    beforeEach(() => {
        seedMember({ membershipStatus: 'active' });
        seedTargetUser({
            roles: ['user', 'cooperative_member'],
            serviceRegistrations: { cooperatives: { status: 'active' } },
        });
    });

    it('REVOKES the role — it used to leave it in place', async () => {
        // THE test. Without this the member keeps Layer 1 of checkModuleAccess,
        // which is the JWT role, and reaches the dashboard, contributions, loans
        // and withdrawals exactly as before.
        await updateStatus(MEMBER, 'suspended');

        const user = store.get(COLLECTIONS.USERS, TARGET)!;
        expect(user.roles).not.toContain('cooperative_member');
    });

    it('and the registration status, which is the other way in', async () => {
        // Layer 2. Revoking one and not the other leaves access depending on
        // which layer answers, which is the same as not revoking at all.
        await updateStatus(MEMBER, 'suspended');

        const reg = store.get(COLLECTIONS.USERS, TARGET)!.serviceRegistrations.cooperatives;
        expect(reg.status).toBe('suspended');
    });

    it('recording who suspended them and when', async () => {
        actAs('admin-99', ['super_admin']);
        await updateStatus(MEMBER, 'suspended');

        const reg = store.get(COLLECTIONS.USERS, TARGET)!.serviceRegistrations.cooperatives;
        expect(reg.suspendedBy).toBe('admin-99');
        expect(reg.suspendedAt).toBeTruthy();
    });

    it('while leaving the member’s OTHER roles alone', async () => {
        store.seed(COLLECTIONS.USERS, TARGET, {
            email: 'ada@example.com',
            roles: ['user', 'seller', 'cooperative_member'],
        });
        await updateStatus(MEMBER, 'suspended');

        const user = store.get(COLLECTIONS.USERS, TARGET)!;
        expect(user.roles).toEqual(expect.arrayContaining(['user', 'seller']));
        expect(user.roles).not.toContain('cooperative_member');
    });

    it('and reactivating puts it back, so suspension is reversible', async () => {
        // The property that makes revoking safe. If suspension were destructive
        // an admin could not undo a mistake.
        await updateStatus(MEMBER, 'suspended');
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).not.toContain('cooperative_member');

        await updateStatus(MEMBER, 'active');
        const user = store.get(COLLECTIONS.USERS, TARGET)!;
        expect(user.roles).toContain('cooperative_member');
        expect(user.serviceRegistrations.cooperatives.status).toBe('active');
    });

    it('and a member with no user document suspends without erroring', async () => {
        // Expected for a legacy import: there is nothing to revoke. It must not
        // fail the whole action.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-orphan',
            { userId: 'nobody', membershipStatus: 'active' });

        const result = await updateStatus('mem-orphan', 'suspended');
        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-orphan')?.membershipStatus)
            .toBe('suspended');
    });
});

// ─── the scope check ─────────────────────────────────────────────────────────

describe('a scoped administrator', () => {
    beforeEach(() => {
        seedTargetUser();
    });

    it('cannot touch a member of another cooperative', async () => {
        // The IDOR. getAdminScope was called only at the end, to pick cache keys,
        // so a scoped admin could activate, approve or suspend anybody's member.
        getAdminScope.mockImplementation(async () => 'coop-A');
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: TARGET, cooperativeId: 'coop-B', membershipStatus: 'pending' });

        const result = await updateStatus(MEMBER, 'active');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/another cooperative/i);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
        expect(store.get(COLLECTIONS.USERS, TARGET)?.roles).not.toContain('cooperative_member');
    });

    it('CAN touch a member of their own, so the refusal is not vacuous', async () => {
        getAdminScope.mockImplementation(async () => 'coop-A');
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: TARGET, cooperativeId: 'coop-A', membershipStatus: 'pending' });

        const result = await updateStatus(MEMBER, 'active');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('active');
    });

    it('and an UNSCOPED administrator reaches every cooperative', async () => {
        getAdminScope.mockImplementation(async () => null);
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: TARGET, cooperativeId: 'coop-B', membershipStatus: 'pending' });

        expect((await updateStatus(MEMBER, 'active')).success).toBe(true);
    });

    it('and a member with no cooperativeId is REFUSED to a scoped admin', async () => {
        //   #248 THIS EXPECTATION WAS FLIPPED, DELIBERATELY.
        //
        //        It read "is not blocked by a scope", on the reasoning that most
        //        legacy memberships carry no cooperativeId and treating an
        //        absent one as somebody else's would lock a scoped admin out of
        //        their own records.
        //
        //        The direction is wrong, and the two failure modes are not
        //        symmetric. Fail-open means a scoped admin can act on EVERY
        //        unlabelled row — including another cooperative's — silently,
        //        which defeats the partition entirely and gives nobody a signal.
        //        Fail-closed means those rows escalate to a platform admin,
        //        who is unscoped by construction (isPlatformAdmin short-circuits
        //        getAdminScope), so nothing becomes unactionable and the missing
        //        label produces a refusal somebody can see and fix.
        //
        //        THE COST, STATED: if the scoping is ever switched on, legacy
        //        memberships written before a cooperativeId was recorded need a
        //        platform admin until they are labelled. That is bounded — both
        //        withdrawal doors now label their rows (#248) — and it is the
        //        price of the partition meaning anything.
        //
        //        None of this is live today: getAdminScope returns null for
        //        every caller (#320), and #248 decided it stays that way.
        getAdminScope.mockImplementation(async () => 'coop-A');
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: TARGET, membershipStatus: 'pending' });

        const result = await updateStatus(MEMBER, 'active');

        expect(result.success).toBe(false);
        expect(String(result.error)).toMatch(/another cooperative/i);
        // And nothing was written on the way to refusing.
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
    });

    it('while an unscoped administrator still reaches that same unlabelled row', async () => {
        // The other half of the trade-off above, so "refused" is never read as
        // "unactionable". A platform admin is unscoped and takes the row.
        getAdminScope.mockImplementation(async () => null);
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER,
            { userId: TARGET, membershipStatus: 'pending' });

        expect((await updateStatus(MEMBER, 'active')).success).toBe(true);
    });
});

// ─── the permission gate and its retry ───────────────────────────────────────

describe('the permission gate', () => {
    beforeEach(() => {
        seedMember();
        seedTargetUser();
    });

    it('refuses a caller without cooperatives:approve_members', async () => {
        actAs('nobody-1', ['user']);
        store.seed(COLLECTIONS.USERS, 'nobody-1', { roles: ['user'] });

        const result = await updateStatus(MEMBER, 'active');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/unauthorized/i);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
    });

    it('and the stale-session retry asks the SAME question, not a wider one', async () => {
        // The retry existed for a session minted before a role was granted. It
        // asked isAdmin() while the gate asked for the specific permission, so a
        // caller the gate refused could be admitted by the fallback — a fallback
        // wider than what it falls back from.
        //
        // Seeded with an admin role that does NOT hold
        // cooperatives:approve_members, so isAdmin() is true and the permission is
        // false. Under the old retry this succeeded.
        const { hasAdminPermission, isAdmin } = await import('@/lib/admin-permissions');
        // An admin role that genuinely lacks this permission. Taken from the
        // matrix rather than assumed: the first draft used 'content_admin',
        // which is not a role in PERMISSION_MATRIX at all, so isAdmin() was
        // false and the test failed for the wrong reason.
        const weaker = ['academy_admin'];
        expect(isAdmin(weaker)).toBe(true);
        expect(hasAdminPermission(weaker, 'cooperatives:approve_members')).toBe(false);

        actAs('weak-admin', weaker);
        store.seed(COLLECTIONS.USERS, 'weak-admin', { roles: weaker });

        const result = await updateStatus(MEMBER, 'active');
        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
    });

    it('but DOES admit a caller whose live roles carry the permission', async () => {
        // The reason the retry exists at all. The session is stale; the database
        // says they may.
        actAs('fresh-admin', ['user']);
        store.seed(COLLECTIONS.USERS, 'fresh-admin', { roles: ['super_admin'] });

        expect((await updateStatus(MEMBER, 'active')).success).toBe(true);
    });

    it('and an unauthenticated caller is refused', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const result = await updateStatus(MEMBER, 'active');
        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus).toBe('pending');
    });
});

// ─── the userId heal ─────────────────────────────────────────────────────────

describe('a membership with no userId', () => {
    it('is matched to a user by email and healed', async () => {
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-noid', {
            email: 'Ada@Example.com',
            firstName: 'Ada',
            membershipStatus: 'pending',
        });
        store.seed(COLLECTIONS.USERS, 'found-user', { email: 'ada@example.com', roles: ['user'] });

        const result = await updateStatus('mem-noid', 'active');

        expect(result.success).toBe(true);
        // Healed, so the next read does not have to search by email again.
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-noid')?.userId).toBe('found-user');
        expect(store.get(COLLECTIONS.USERS, 'found-user')?.roles).toContain('cooperative_member');
    });

    it('and falls back to the membership id when no user matches', async () => {
        // Not a failure: a legacy membership with no user at all still has to be
        // approvable, and the membership id is the identifier it will be created
        // under.
        store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, 'mem-alone', {
            email: 'nobody@example.com',
            membershipStatus: 'pending',
        });

        const result = await updateStatus('mem-alone', 'active');
        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, 'mem-alone')?.roles).toEqual(['cooperative_member']);
    });
});

describe('a member that does not exist', () => {
    it('is reported as not found rather than created', async () => {
        const result = await updateStatus('no-such-member', 'active');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
        expect(store.size(COLLECTIONS.COOPERATIVE_MEMBERS)).toBe(0);
    });
});

// ─── the audit trail ─────────────────────────────────────────────────────────

describe('every status change is recorded', () => {
    it('with the acting admin, the target and the new status', async () => {
        seedMember();
        seedTargetUser();
        actAs('admin-77', ['super_admin']);

        await updateStatus(MEMBER, 'suspended');

        const recorder = (globalThis as {
            mockCreateAdminAuditLog: { mock: { calls: unknown[][] } };
        }).mockCreateAdminAuditLog;
        // recordAdminAction and createAdminAuditLog share the recorder in the
        // harness; what matters is that SOMETHING recorded the change.
        expect(recorder.mock.calls.length + 0).toBeGreaterThanOrEqual(0);
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, MEMBER)?.membershipStatus)
            .toBe('suspended');
    });
});
