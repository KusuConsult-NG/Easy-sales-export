/**
 * @jest-environment node
 */

/**
 * The WAVE review desk, EXECUTED — approve, reject, and the queue.
 *
 * At 30.3%. WAVE has more recorded defects than any other module and two of them
 * are in this file:
 *
 *   - APPROVE AND REJECT RACED EACH OTHER, not just themselves. Both read the
 *     same two statuses and wrote opposite answers inside runTransaction, which
 *     takes no lock on this adapter. An approval and a rejection landing together
 *     both passed, so the applicant was granted the wave_participant role AND
 *     marked rejected. Both go through a CAS now, so exactly one verdict lands.
 *   - THE "APPROVED" TAB COULD NOT DISTINGUISH A MEMBER FROM AN APPLICANT.
 *
 * The approval is also a role grant — wave_participant, isVerified, and the
 * registration entry checkModuleAccess reads — so it is an authorisation
 * boundary, and every claim about it is a claim about stored documents.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

// @upstash/redis pulls in `uncrypto`, which ships ESM only and Jest cannot
// parse. The import failure lands inside the action's own try/catch and comes
// back as "Failed to fetch applications" — which reads exactly like a defect in
// the code under test. Mocked to a no-op cache: these tests are about the query,
// not about Redis.
jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
    redis: null,
}));

const sendWaveApplicationEmail = jest.fn(
    async (_to: string, _name: string, _kind: string, _reason?: string) => undefined);
jest.mock('@/lib/email-notifications', () => ({
    sendWaveApplicationEmail: (to: string, name: string, kind: string, reason?: string) =>
        sendWaveApplicationEmail(to, name, kind, reason),
    sendEmail: jest.fn(async () => undefined),
}));

/**
 * The verdict goes through the Postgres CAS, which the fake deliberately does
 * not implement. Mocked so the ACTION's decisions are testable — which statuses
 * it will move from, what it puts in the patch, and what it does with a refusal.
 */
const claimStatusTransitionFromAny = jest.fn(async (_args: unknown) =>
    ({ claimed: true, status: 'pending', exists: true } as {
        claimed: boolean; status: string | null; exists?: boolean;
    }));
jest.mock('@/lib/status-transition', () => ({
    claimStatusTransitionFromAny: (args: unknown) => claimStatusTransitionFromAny(args),
    claimStatusTransition: (args: unknown) => claimStatusTransitionFromAny(args),
}));

let store: FakeDbHandle;

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
    claimStatusTransitionFromAny.mockImplementation(async () =>
        ({ claimed: true, status: 'pending', exists: true }));
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/wave/_wv_admin_applications');
}

const APP = 'wave-app-1';
const APPLICANT = 'applicant-1';

function seedApplication(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.WAVE_APPLICATIONS, APP, {
        userId: APPLICANT,
        email: 'applicant@example.com',
        firstName: 'Ada',
        surname: 'Obi',
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedApplicant(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, APPLICANT, {
        email: 'applicant@example.com',
        firstName: 'Ada',
        roles: ['user'],
        ...extra,
    });
}

// ─── approval ────────────────────────────────────────────────────────────────

describe('approving a WAVE application', () => {
    beforeEach(() => {
        seedApplication();
        seedApplicant();
    });

    it('grants the role, the verification and the registration together', async () => {
        const { approveWaveApplicationAction } = await actions();
        const result = await approveWaveApplicationAction(APP);

        expect(result.success).toBe(true);
        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.roles).toContain('wave_participant');
        expect(user.isVerified).toBe(true);
        expect(user.verifiedBy).toBe('admin-1');
        expect(user.serviceRegistrations.wave.status).toBe('approved');
        expect(user.serviceRegistrations.wave.paymentStatus).toBe('completed');
        expect(user.waveStatus).toBe('active');
    });

    it('moving ONLY from a reviewable state', async () => {
        // The CAS is what makes an approval and a rejection mutually exclusive.
        // The states it will move FROM are the decision this action makes; the
        // serialisation is the database's.
        const { approveWaveApplicationAction } = await actions();
        await approveWaveApplicationAction(APP);

        const [[args]] = claimStatusTransitionFromAny.mock.calls as unknown as [[{
            fromAny: string[]; to: string; patch: Record<string, unknown>;
        }]];
        expect(args.fromAny.sort()).toEqual(['pending', 'under_review']);
        expect(args.to).toBe('approved');
        expect(args.patch.approvedBy).toBe('admin-1');
        expect(args.patch.reviewedBy).toBe('admin-1');
    });

    it('and granting NOTHING when the claim is refused', async () => {
        // THE race. Under the old read-then-write both verdicts could land, so
        // the applicant was granted the role AND marked rejected. A refused claim
        // must leave the user document untouched.
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'rejected', exists: true }));

        const { approveWaveApplicationAction } = await actions();
        const result = await approveWaveApplicationAction(APP);

        expect(result.success).toBe(false);
        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.roles).not.toContain('wave_participant');
        expect(user.isVerified).toBeUndefined();
        expect(user.serviceRegistrations).toBeUndefined();
    });

    it('keeping the roles the applicant already had', async () => {
        store.seed(COLLECTIONS.USERS, APPLICANT, {
            email: 'applicant@example.com', roles: ['user', 'seller'],
        });

        const { approveWaveApplicationAction } = await actions();
        await approveWaveApplicationAction(APP);

        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.roles)
            .toEqual(expect.arrayContaining(['user', 'seller', 'wave_participant']));
    });

    it('creating a user document when the applicant has none', async () => {
        // A WAVE applicant can exist before their user record does. Writing a role
        // onto nothing would approve somebody the platform cannot identify.
        store.clear();
        store.seed(COLLECTIONS.WAVE_APPLICATIONS, APP, {
            userId: 'ghost-applicant',
            email: 'ghost@example.com',
            firstName: 'Ghost',
            otherNames: 'Middle',
            surname: 'Applicant',
            status: 'pending',
        });

        const { approveWaveApplicationAction } = await actions();
        await approveWaveApplicationAction(APP);

        const created = store.get(COLLECTIONS.USERS, 'ghost-applicant')!;
        expect(created.roles).toContain('wave_participant');
        expect(created.isVerified).toBe(true);
        expect(created.email).toBe('ghost@example.com');
        expect(created.fullName).toBe('Ghost Middle Applicant');
    });

    it('bumping the version separately, because the CAS patch is JSONB', async () => {
        // FieldValue sentinels are not resolved inside the CAS patch — it is
        // written as JSONB — so an increment placed there would store the sentinel
        // object rather than a number.
        const { approveWaveApplicationAction } = await actions();
        await approveWaveApplicationAction(APP);

        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, APP)!._version).toBe(1);
    });

    it('and refusing an application that does not exist', async () => {
        const { approveWaveApplicationAction } = await actions();
        const result = await approveWaveApplicationAction('no-such-application');

        expect(result.success).toBe(false);
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });
});

// ─── rejection ───────────────────────────────────────────────────────────────

describe('rejecting a WAVE application', () => {
    beforeEach(() => {
        seedApplication();
        seedApplicant();
    });

    it('records the reason and marks the registration rejected', async () => {
        const { rejectWaveApplicationAction } = await actions();
        const result = await rejectWaveApplicationAction(APP, 'Identity documents unreadable');

        expect(result.success).toBe(true);

        const [[args]] = claimStatusTransitionFromAny.mock.calls as unknown as [[{
            to: string; patch: Record<string, unknown>;
        }]];
        expect(args.to).toBe('rejected');
        expect(args.patch.rejectionReason).toBe('Identity documents unreadable');

        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.serviceRegistrations.wave.status).toBe('rejected');
        expect(user.waveStatus).toBe('rejected');
    });

    it('and grants NOTHING — no role, no verification', async () => {
        const { rejectWaveApplicationAction } = await actions();
        await rejectWaveApplicationAction(APP, 'Identity documents unreadable');

        const user = store.get(COLLECTIONS.USERS, APPLICANT)!;
        expect(user.roles).not.toContain('wave_participant');
        expect(user.isVerified).toBeUndefined();
    });

    it('moving from the SAME states the approval moves from', async () => {
        // The two verdicts must contest the same set, or one of them can act on a
        // state the other has already left — which is the race in a different
        // form.
        const a = await actions();

        await a.approveWaveApplicationAction(APP);
        const approveFrom = (claimStatusTransitionFromAny.mock.calls[0][0] as { fromAny: string[] }).fromAny;

        claimStatusTransitionFromAny.mockClear();
        await a.rejectWaveApplicationAction(APP, 'A long enough reason');
        const rejectFrom = (claimStatusTransitionFromAny.mock.calls[0][0] as { fromAny: string[] }).fromAny;

        expect(rejectFrom.sort()).toEqual(approveFrom.sort());
    });

    it('and writing nothing when the claim is refused', async () => {
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'approved', exists: true }));

        const { rejectWaveApplicationAction } = await actions();
        const result = await rejectWaveApplicationAction(APP, 'A long enough reason');

        expect(result.success).toBe(false);
        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.serviceRegistrations).toBeUndefined();
    });

    it('notifying the applicant, once', async () => {
        const { rejectWaveApplicationAction } = await actions();
        await rejectWaveApplicationAction(APP, 'Identity documents unreadable');

        expect(sendWaveApplicationEmail).toHaveBeenCalledTimes(1);
        expect(sendWaveApplicationEmail).toHaveBeenCalledWith(
            'applicant@example.com', expect.any(String), 'rejected',
            'Identity documents unreadable');
    });

    it('and NOT notifying when the claim was refused', async () => {
        // An applicant told they were rejected by a verdict that never landed is
        // worse than no email.
        claimStatusTransitionFromAny.mockImplementation(async () =>
            ({ claimed: false, status: 'approved', exists: true }));

        const { rejectWaveApplicationAction } = await actions();
        await rejectWaveApplicationAction(APP, 'A long enough reason');

        expect(sendWaveApplicationEmail).not.toHaveBeenCalled();
    });

    it('and refusing an empty reason', async () => {
        const { rejectWaveApplicationAction } = await actions();
        const result = await rejectWaveApplicationAction(APP, '');

        expect(result.success).toBe(false);
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
    });
});

// ─── the guards ──────────────────────────────────────────────────────────────

describe('both verdicts need wave:approve_applications', () => {
    beforeEach(() => {
        seedApplication();
        seedApplicant();
    });

    it('refusing an admin of another module', async () => {
        // isAdmin() is true for every admin role. The matrix grants this one to
        // super_admin, admin and wave_admin.
        const { hasAdminPermission, isAdmin } = await import('@/lib/admin-permissions');
        expect(isAdmin(['academy_admin'])).toBe(true);
        expect(hasAdminPermission(['academy_admin'], 'wave:approve_applications')).toBe(false);

        actAs('academy-admin', ['academy_admin']);
        const a = await actions();

        expect((await a.approveWaveApplicationAction(APP)).success).toBe(false);
        expect((await a.rejectWaveApplicationAction(APP, 'A long enough reason')).success).toBe(false);
        expect(claimStatusTransitionFromAny).not.toHaveBeenCalled();
        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.roles).not.toContain('wave_participant');
    });

    it('while a wave_admin may, so the refusals are not vacuous', async () => {
        actAs('wave-admin', ['wave_admin']);
        const { approveWaveApplicationAction } = await actions();

        expect((await approveWaveApplicationAction(APP)).success).toBe(true);
        expect(store.get(COLLECTIONS.USERS, APPLICANT)!.roles).toContain('wave_participant');
    });

    it('and an unauthenticated caller reaches neither', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const a = await actions();
        expect((await a.approveWaveApplicationAction(APP)).success).toBe(false);
        expect((await a.rejectWaveApplicationAction(APP, 'A long enough reason')).success).toBe(false);
        expect(store.get(COLLECTIONS.WAVE_APPLICATIONS, APP)!.status).toBe('pending');
    });
});

// ─── the queue ───────────────────────────────────────────────────────────────

describe('the application queue', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.WAVE_APPLICATIONS, {
            p1: { userId: 'u1', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' },
            p2: { userId: 'u2', status: 'under_review', createdAt: '2026-02-01T00:00:00.000Z' },
            a1: { userId: 'u3', status: 'approved', createdAt: '2026-03-01T00:00:00.000Z' },
            r1: { userId: 'u4', status: 'rejected', createdAt: '2026-04-01T00:00:00.000Z' },
        });
    });

    it('lists the applications for an admin, with the applicant resolved', async () => {
        // `data.applications`, not a bare array — asserted the other way first.
        // Each row carries a `user` block built by extractCanonicalUser, which is
        // what the queue renders; an application with no resolvable applicant
        // would otherwise show a blank row.
        store.seed(COLLECTIONS.USERS, 'u1',
            { email: 'one@example.com', fullName: 'One Applicant', phone: '08031111111' });

        const { getWaveApplicationsAction } = await actions();
        const result = await getWaveApplicationsAction();

        expect(result.success).toBe(true);
        const rows = result.data!.applications as Array<{ id: string; user: { email: string } }>;
        expect(rows.length).toBeGreaterThan(0);

        const row = rows.find((r) => r.id === 'p1')!;
        expect(row.user.email).toBe('one@example.com');
    });

    it('reporting truncation to the CALLER, not only to the log', async () => {
        // A queue silently capped at a scan limit tells an admin the backlog is
        // smaller than it is. The flag is in `meta` so a screen can say so.
        const { getWaveApplicationsAction } = await actions();
        const result = await getWaveApplicationsAction();

        expect(result.meta).toMatchObject({ truncated: false });
        expect(typeof result.meta.scanLimit).toBe('number');
    });

    it('and refuses a caller who is not an admin at all', async () => {
        actAs('member', ['user']);
        const { getWaveApplicationsAction } = await actions();
        expect((await getWaveApplicationsAction()).success).toBe(false);
    });

    it('the standard list narrows by status', async () => {
        const { getStandardWaveApplicationsAction } = await actions();

        const pending = await getStandardWaveApplicationsAction({ status: 'pending' });
        expect(pending.success).toBe(true);

        const approved = await getStandardWaveApplicationsAction({ status: 'approved' });
        expect(approved.success).toBe(true);
        // Whatever the shape, an approved-only view must not carry a rejected one.
        expect(JSON.stringify(approved.data ?? {})).not.toContain('"rejected"');
    });

    it('and is refused to a non-admin', async () => {
        actAs('member', ['user']);
        const { getStandardWaveApplicationsAction } = await actions();
        expect((await getStandardWaveApplicationsAction({})).success).toBe(false);
    });
});
