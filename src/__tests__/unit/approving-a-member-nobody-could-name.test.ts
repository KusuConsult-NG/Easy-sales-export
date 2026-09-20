/**
 * @jest-environment node
 */

/**
 *   AN ADMIN COULD ADMIT SOMEBODY THE COOPERATIVE CANNOT IDENTIFY.
 *
 *   Counted against production: 1,840 cooperative membership rows, 800 of
 *   them with no completed onboarding, 723 of those paid, and 715 of THOSE
 *   reading "active". Split by cause — 328 carry the `approvedBy` that
 *   api/admin/cooperative/approve-member stamps, and 387 became active some
 *   other way.
 *
 *   This file is the 328.
 *
 * ── TWO DOORS, NEITHER ASKING ───────────────────────────────────────────────
 *
 *   api/admin/cooperative/approve-member wrote
 *
 *       txn.update(memberRef, { membershipStatus: "active", approvedBy, ... })
 *
 *   on nothing but the row existing. _updateMemberStatusAction — the server
 *   action the same screen calls, onto the same field — wrote it
 *   unconditionally too, its own comment noting "No status guard here".
 *   Fixing one of two doors is the defect class this codebase has recorded
 *   more than a dozen times, so both are tested here.
 *
 * ── AND THE SCREEN COULD NOT HAVE TOLD THEM ─────────────────────────────────
 *
 *   `onboardingCompleted` was on the admin members page's own type and was
 *   never rendered, so a member who had never filled the form looked exactly
 *   like one who had. The admins who pressed Approve were doing the
 *   reasonable thing with what was shown. The badge is in the same change as
 *   this guard, because a refusal an admin cannot anticipate is its own
 *   defect.
 *
 * ── WHAT MUST STILL WORK ────────────────────────────────────────────────────
 *
 *   A guard that blocks legitimate approvals gets removed. The controls below
 *   are as much of the test as the refusals: a completed onboarding approves,
 *   a record carrying a name and a phone approves on that evidence alone, and
 *   SUSPENDING an incomplete member is never blocked — that is precisely a
 *   record an admin may need to act against.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';
import { approvalReadiness, isAdmittingStatus } from '@/lib/cooperative-approval-readiness';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

jest.mock('@/lib/cooperative-admin-scope', () => ({ getAdminScope: async () => null }));

jest.mock('@/lib/cache-invalidation', () => ({
    invalidateCooperativeCache: async () => undefined,
    invalidateAdminGlobalStats: async () => undefined,
    invalidateServiceCache: async () => undefined,
    deleteCache: async () => undefined,
}));

jest.mock('@/lib/schema-normalizer', () => ({
    normalizeUserUpdate: (d: any) => d, normalizeUserDoc: (d: any) => d,
}));

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: async () => undefined,
    recordAdminAction: async () => undefined,
}));

const BLANK = 'member-blank';
const COMPLETE = 'member-complete';
const NAMED = 'member-named-no-flag';

let store: FakeDbHandle;

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();

    store.seed(COLLECTIONS.USERS, 'admin-1', { roles: ['super_admin'], email: 'admin@ese.ng' });

    //   The shape the owner photographed: paid, no form, no identity.
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, BLANK, {
        userId: 'uid-blank', membershipStatus: 'pending', paymentStatus: 'completed',
        gender: 'male', stateOfOrigin: 'Kogi',
    });
    store.seed(COLLECTIONS.USERS, 'uid-blank', { email: 'alzakkatintegratedltd@gmail.com' });

    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, COMPLETE, {
        userId: 'uid-complete', membershipStatus: 'pending', paymentStatus: 'completed',
        onboardingCompleted: true, firstName: 'Musa', lastName: 'Abdullahi',
        phone: '+2348030001111',
    });
    store.seed(COLLECTIONS.USERS, 'uid-complete', { email: 'musa@ese.ng' });

    //   Details on record, flag never set — the row the rule must not refuse.
    store.seed(COLLECTIONS.COOPERATIVE_MEMBERS, NAMED, {
        userId: 'uid-named', membershipStatus: 'pending', paymentStatus: 'completed',
        fullName: 'Ngozi Eledumare', phone: '+2348030002222',
    });
    store.seed(COLLECTIONS.USERS, 'uid-named', { email: 'ngozi@ese.ng' });

    mockRequireSession.mockResolvedValue({
        session: { user: { id: 'admin-1', roles: ['super_admin'], email: 'admin@ese.ng' } },
        error: null,
    });
});

const statusOf = (id: string) =>
    store.get(COLLECTIONS.COOPERATIVE_MEMBERS, id)?.membershipStatus;

// ─────────────────────────────────────────────────────────────────────────────

describe('api/admin/cooperative/approve-member', () => {
    async function approve(memberId: string) {
        const { POST } = await import('@/app/api/admin/cooperative/approve-member/route');
        const res = await POST({ json: async () => ({ memberId }) } as any);
        return { status: (res as any).status, body: await (res as any).json() };
    }

    it('THE REPORTED DEFECT: refuses a paid member the record does not name', async () => {
        const { status, body } = await approve(BLANK);

        expect(status).toBe(422);
        expect(body.success).toBe(false);
        expect(body.message).toMatch(/name and phone number or email address/);
    });

    it('AND WRITES NOTHING — the refusal is not just a message', async () => {
        await approve(BLANK);

        expect(statusOf(BLANK)).toBe('pending');
        expect(store.get(COLLECTIONS.COOPERATIVE_MEMBERS, BLANK)?.approvedBy).toBeUndefined();
        expect(store.get(COLLECTIONS.USERS, 'uid-blank')?.roles).toBeUndefined();
    });

    it('CONTROL: a completed onboarding is approved as before', async () => {
        const { status, body } = await approve(COMPLETE);

        expect(status).toBe(200);
        expect(body.success).toBe(true);
        expect(statusOf(COMPLETE)).toBe('active');
    });

    it('CONTROL: a name and a phone are evidence enough without the flag', async () => {
        const { body } = await approve(NAMED);

        expect(body.success).toBe(true);
        expect(statusOf(NAMED)).toBe('active');
    });

    it('tells the admin what to do about it, not just that they cannot', async () => {
        const { body } = await approve(BLANK);

        expect(body.message).toMatch(/complete onboarding|Import Legacy Member/i);
    });
});

describe('updateMemberStatusAction — the other door onto the same field', () => {
    async function setStatus(memberId: string, status: 'active' | 'approved' | 'suspended') {
        const { updateMemberStatusAction } =
            await import('@/app/actions/cooperative/_coop_admin_members');
        return await (updateMemberStatusAction as any)(memberId, status);
    }

    it('THE SECOND DOOR: refuses the same member the route refuses', async () => {
        const res = await setStatus(BLANK, 'active');

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/name and phone number or email address/);
        expect(statusOf(BLANK)).toBe('pending');
    });

    it('refuses "approved" as well as "active" — both admit', async () => {
        const res = await setStatus(BLANK, 'approved');

        expect(res.success).toBe(false);
        expect(statusOf(BLANK)).toBe('pending');
    });

    it('SUSPENSION IS NEVER BLOCKED', async () => {
        //   An incomplete record is precisely one an admin may need to act
        //   against. A guard that prevented this would be worse than the one
        //   that was missing.
        const res = await setStatus(BLANK, 'suspended');

        expect(res.success).toBe(true);
        expect(statusOf(BLANK)).toBe('suspended');
    });

    it('CONTROL: a complete member still activates', async () => {
        const res = await setStatus(COMPLETE, 'active');

        expect(res.success).toBe(true);
        expect(statusOf(COMPLETE)).toBe('active');
    });
});

describe('the rule itself', () => {
    it('a completed onboarding needs no other evidence', () => {
        expect(approvalReadiness({ onboardingCompleted: true }).ready).toBe(true);
    });

    it('a first and last name together count as a name', () => {
        expect(approvalReadiness({ firstName: 'Musa', lastName: 'Abdullahi', phone: '080' }).ready)
            .toBe(true);
    });

    it('an EMAIL reaches a member as well as a phone does', () => {
        //   The bar is "can this person be reached", not "is there a phone".
        //   Set at phone-only it refuses real, contactable members, which is
        //   how a guard gets removed instead of corrected.
        expect(approvalReadiness({ fullName: 'Musa Abdullahi', email: 'm@ese.ng' }).ready)
            .toBe(true);
    });

    it('a first name alone names somebody', () => {
        //   Deliberately low. Refusing a record over a missing SURNAME buys
        //   nothing: every one of the 715 carries no name field at all.
        expect(approvalReadiness({ firstName: 'Ada', email: 'a@ese.ng' }).ready).toBe(true);
    });

    it('but a name with no way to reach them is not enough', () => {
        const r = approvalReadiness({ fullName: 'Musa Abdullahi' });

        expect(r.ready).toBe(false);
        expect(r.missing).toEqual(['phone number or email address']);
    });

    it('IS NOT A COMPLETENESS CHECK — the other details are not its business', () => {
        //   A member with no date of birth, no LGA, no ward, no occupation and
        //   no next of kin is still approvable. Chasing those is the
        //   cooperative's job; this function only asks whether there is
        //   anybody there to admit.
        expect(approvalReadiness({ fullName: 'Musa Abdullahi', phone: '+2348030001111' }).ready)
            .toBe(true);
    });

    it('whitespace is not a name', () => {
        expect(approvalReadiness({ fullName: '   ', phone: '080' }).ready).toBe(false);
    });

    it('names both absences when the record is empty', () => {
        expect(approvalReadiness({}).missing)
            .toEqual(['name', 'phone number or email address']);
    });

    it('a missing record is not approvable', () => {
        expect(approvalReadiness(null).ready).toBe(false);
        expect(approvalReadiness(undefined).ready).toBe(false);
    });

    it('only active and approved admit; suspension and the rest do not', () => {
        expect(isAdmittingStatus('active')).toBe(true);
        expect(isAdmittingStatus('approved')).toBe(true);
        expect(isAdmittingStatus('APPROVED')).toBe(true);
        expect(isAdmittingStatus('suspended')).toBe(false);
        expect(isAdmittingStatus('rejected')).toBe(false);
        expect(isAdmittingStatus('pending')).toBe(false);
        expect(isAdmittingStatus(undefined)).toBe(false);
    });
});
