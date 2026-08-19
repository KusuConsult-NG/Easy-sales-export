/**
 * @jest-environment node
 */

/**
 * The Academy review desk, EXECUTED — approve, reject, under review, and the
 * manual enrolment.
 *
 * At 8.8%. Approval grants `academy_participant` and writes the registration
 * entry checkModuleAccess reads, and the manual enrolment does the same WITHOUT
 * an application — an admin putting somebody straight into a paid programme.
 * That last one is the interesting path: it also reaches back and writes an
 * application record so the admin dashboard has something to show, creating one
 * if none exists.
 *
 * Every action here is a query plus a write, so with a call-recorder harness the
 * query returned whatever the test stubbed and none of it could be checked.
 *
 * ONE ASYMMETRY WORTH KNOWING BEFORE READING
 * ------------------------------------------
 * The three review actions gate on a hand-written role list —
 * `admin | super_admin | academy_admin` — while the manual enrolment gates on
 * hasAdminPermission(roles, "users:update"). They are NOT the same set, and the
 * difference is deliberate: enrolling somebody in a paid programme with no
 * application is a user-management act, not a review. Pinned below so it reads
 * as a decision rather than an oversight.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('resend', () => ({
    Resend: class { emails = { send: async () => ({ error: null }) }; },
}));

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
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
    store = installFakeDb();
    actAs('admin-1', ['super_admin']);
});

async function actions() {
    return import('@/app/actions/admin/_academy');
}

const APP = 'academy-app-1';
const LEARNER = 'learner-1';

function seedApplication(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, APP, {
        userId: LEARNER,
        status: 'pending',
        personalInfo: { email: 'learner@example.com', fullName: 'Ada Obi' },
        createdAt: '2026-01-01T00:00:00.000Z',
        ...extra,
    });
}

function seedLearner(extra: Record<string, unknown> = {}): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: 'learner@example.com',
        fullName: 'Ada Obi',
        roles: ['user'],
        ...extra,
    });
}

// ─── approval ────────────────────────────────────────────────────────────────

describe('approving an academy application', () => {
    beforeEach(() => {
        seedApplication();
        seedLearner();
    });

    it('marks the application approved and records the reviewer', async () => {
        const { approveAcademyApplicationAction } = await actions();
        const result = await approveAcademyApplicationAction(APP);

        expect(result.success).toBe(true);
        const app = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!;
        expect(app.status).toBe('approved');
        expect(app.reviewedBy).toBe('admin-1');
        expect(app.reviewedAt).toBeTruthy();
    });

    it('and grants the role with the registration entry', async () => {
        const { approveAcademyApplicationAction } = await actions();
        await approveAcademyApplicationAction(APP);

        const user = store.get(COLLECTIONS.USERS, LEARNER)!;
        expect(user.roles).toContain('academy_participant');
        expect(user.serviceRegistrations.academy.status).toBe('approved');
        expect(user.serviceRegistrations.academy.paymentStatus).toBe('completed');
    });

    it('keeping the roles the learner already had', async () => {
        store.seed(COLLECTIONS.USERS, LEARNER, {
            email: 'learner@example.com', roles: ['user', 'seller'],
        });

        const { approveAcademyApplicationAction } = await actions();
        await approveAcademyApplicationAction(APP);

        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles)
            .toEqual(expect.arrayContaining(['user', 'seller', 'academy_participant']));
    });

    it('refusing an application that does not exist', async () => {
        const { approveAcademyApplicationAction } = await actions();
        const result = await approveAcademyApplicationAction('no-such-application');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not found/i);
        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles).not.toContain('academy_participant');
    });

    it('and one with no userId, rather than granting a role to nobody', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'orphan', {
            status: 'pending', personalInfo: { email: 'nobody@example.com' },
        });

        const { approveAcademyApplicationAction } = await actions();
        const result = await approveAcademyApplicationAction('orphan');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/missing user id/i);
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'orphan')!.status).toBe('pending');
    });
});

// ─── rejection ───────────────────────────────────────────────────────────────

describe('rejecting an academy application', () => {
    beforeEach(() => {
        seedApplication();
        seedLearner();
    });

    it('marks the application and the registration rejected', async () => {
        const { rejectAcademyApplicationAction } = await actions();
        const result = await rejectAcademyApplicationAction(APP, 'Documents unreadable');

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!.status).toBe('rejected');
        expect(store.get(COLLECTIONS.USERS, LEARNER)!.serviceRegistrations.academy.status)
            .toBe('rejected');
    });

    it('and grants NOTHING', async () => {
        // Approve and reject share a shape. A rejection that granted the role
        // would be indistinguishable from an approval to checkModuleAccess.
        const { rejectAcademyApplicationAction } = await actions();
        await rejectAcademyApplicationAction(APP, 'Documents unreadable');

        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles)
            .not.toContain('academy_participant');
    });

    it('and refuses an application that does not exist', async () => {
        const { rejectAcademyApplicationAction } = await actions();
        const result = await rejectAcademyApplicationAction('no-such-application', 'A reason');

        expect(result.success).toBe(false);
    });
});

describe('marking an application under review', () => {
    it('changes the status without touching the learner', async () => {
        // A holding state. It must not grant anything, and it must not revoke
        // anything either — the reviewer has not decided yet.
        seedApplication();
        seedLearner({ roles: ['user', 'academy_participant'] });

        const { markAcademyApplicationUnderReviewAction } = await actions();
        const result = await markAcademyApplicationUnderReviewAction(APP);

        expect(result.success).toBe(true);
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!.status).toBe('under_review');

        const user = store.get(COLLECTIONS.USERS, LEARNER)!;
        expect(user.roles).toEqual(['user', 'academy_participant']);
        expect(user.serviceRegistrations).toBeUndefined();
    });
});

// ─── the three decisions are distinct ────────────────────────────────────────

describe('the three review decisions', () => {
    it('leave three different states, and only one grants a role', async () => {
        seedLearner();
        seedApplication({}, );
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-reject',
            { userId: 'u-reject', status: 'pending', personalInfo: { email: 'r@example.com' } });
        store.seed(COLLECTIONS.USERS, 'u-reject', { email: 'r@example.com', roles: ['user'] });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-review',
            { userId: 'u-review', status: 'pending', personalInfo: { email: 'v@example.com' } });
        store.seed(COLLECTIONS.USERS, 'u-review', { email: 'v@example.com', roles: ['user'] });

        const a = await actions();
        await a.approveAcademyApplicationAction(APP);
        await a.rejectAcademyApplicationAction('a-reject', 'A reason');
        await a.markAcademyApplicationUnderReviewAction('a-review');

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!.status).toBe('approved');
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-reject')!.status).toBe('rejected');
        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-review')!.status).toBe('under_review');

        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles).toContain('academy_participant');
        expect(store.get(COLLECTIONS.USERS, 'u-reject')!.roles).not.toContain('academy_participant');
        expect(store.get(COLLECTIONS.USERS, 'u-review')!.roles).not.toContain('academy_participant');
    });
});

// ─── manual enrolment ────────────────────────────────────────────────────────

describe('manual enrolment', () => {
    beforeEach(() => {
        seedLearner();
    });

    it('puts the learner straight into a plan, with no application at all', async () => {
        const { manualAcademyEnrollmentAction } = await actions();
        const result = await manualAcademyEnrollmentAction(LEARNER, 'elite');

        expect(result.success).toBe(true);
        const user = store.get(COLLECTIONS.USERS, LEARNER)!;
        expect(user.roles).toContain('academy_participant');
        expect(user.serviceRegistrations.academy.status).toBe('active');
        expect(user.serviceRegistrations.academy.plan).toBe('elite');
        expect(user.serviceRegistrations.academy.paymentStatus).toBe('completed');
    });

    it('and CREATES an application record so the dashboard has something to show', async () => {
        // Without it, a manually enrolled learner is active on the module and
        // absent from every admin list — which is how a paying member becomes
        // invisible to the people administering the programme.
        const { manualAcademyEnrollmentAction } = await actions();
        await manualAcademyEnrollmentAction(LEARNER, 'standard');

        const created = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, `manual_${LEARNER}`)!;
        expect(created.status).toBe('approved');
        expect(created.plan).toBe('standard');
        expect(created.source).toBe('manual_enrollment');
        expect(created.reviewedBy).toBe('admin-1');
    });

    it('or UPDATES the existing ones rather than adding a second', async () => {
        // A learner who applied and was then enrolled by hand must not end up with
        // two records saying different things.
        store.seedAll(COLLECTIONS.ACADEMY_APPLICATIONS, {
            existing1: { userId: LEARNER, status: 'pending' },
            existing2: { userId: LEARNER, status: 'under_review' },
        });

        const { manualAcademyEnrollmentAction } = await actions();
        await manualAcademyEnrollmentAction(LEARNER, 'foundation');

        expect(store.size(COLLECTIONS.ACADEMY_APPLICATIONS)).toBe(2);
        for (const id of ['existing1', 'existing2']) {
            const app = store.get(COLLECTIONS.ACADEMY_APPLICATIONS, id)!;
            expect(app.status).toBe('approved');
            expect(app.plan).toBe('foundation');
            expect(app.paymentStatus).toBe('completed');
        }
    });

    it('and does not touch ANOTHER learner’s application', async () => {
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'someone-else',
            { userId: 'other-learner', status: 'pending' });

        const { manualAcademyEnrollmentAction } = await actions();
        await manualAcademyEnrollmentAction(LEARNER, 'standard');

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'someone-else')!.status).toBe('pending');
    });

    it('refusing a user who does not exist', async () => {
        const { manualAcademyEnrollmentAction } = await actions();
        const result = await manualAcademyEnrollmentAction('no-such-user', 'elite');

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/user not found/i);
        expect(store.size(COLLECTIONS.ACADEMY_APPLICATIONS)).toBe(0);
    });

    it.each(['foundation', 'standard', 'elite'])('recording the %s plan as given', async (plan) => {
        const { manualAcademyEnrollmentAction } = await actions();
        await manualAcademyEnrollmentAction(LEARNER, plan as never);

        expect(store.get(COLLECTIONS.USERS, LEARNER)!.serviceRegistrations.academy.plan)
            .toBe(plan);
    });
});

// ─── the guards, and the asymmetry between them ──────────────────────────────

describe('the review actions take a hand-written role list', () => {
    beforeEach(() => {
        seedApplication();
        seedLearner();
    });

    it('admitting admin, super_admin and academy_admin', async () => {
        for (const role of ['admin', 'super_admin', 'academy_admin']) {
            store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, APP,
                { userId: LEARNER, status: 'pending', personalInfo: { email: 'l@example.com' } });
            actAs(`x-${role}`, [role]);

            const { markAcademyApplicationUnderReviewAction } = await actions();
            expect((await markAcademyApplicationUnderReviewAction(APP)).success).toBe(true);
        }
    });

    it('and refusing an admin of a different module', async () => {
        actAs('wave-admin', ['wave_admin']);
        const a = await actions();

        expect((await a.approveAcademyApplicationAction(APP)).success).toBe(false);
        expect((await a.rejectAcademyApplicationAction(APP, 'A reason')).success).toBe(false);
        expect((await a.markAcademyApplicationUnderReviewAction(APP)).success).toBe(false);

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!.status).toBe('pending');
        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles).not.toContain('academy_participant');
    });

    it('while the manual enrolment asks a DIFFERENT question — users:update', async () => {
        // The asymmetry, stated as a decision. Enrolling somebody in a paid
        // programme with no application is a user-management act, not a review, so
        // an academy_admin who may approve applications does NOT necessarily hold
        // it — and this pins which way round that is rather than leaving it to be
        // discovered.
        const { hasAdminPermission } = await import('@/lib/admin-permissions');
        const academyMayReview = ['academy_admin'];
        const academyMayEnrol = hasAdminPermission(academyMayReview, 'users:update');

        actAs('academy-admin', academyMayReview);
        const { manualAcademyEnrollmentAction } = await actions();
        const result = await manualAcademyEnrollmentAction(LEARNER, 'elite');

        expect(result.success).toBe(academyMayEnrol);
        expect(store.get(COLLECTIONS.USERS, LEARNER)!.roles.includes('academy_participant'))
            .toBe(academyMayEnrol);
    });

    it('and a super_admin holds both, so neither refusal is vacuous', async () => {
        actAs('boss', ['super_admin']);
        const a = await actions();

        expect((await a.approveAcademyApplicationAction(APP)).success).toBe(true);
        expect((await a.manualAcademyEnrollmentAction(LEARNER, 'elite')).success).toBe(true);
    });

    it('and an unauthenticated caller reaches none of them', async () => {
        (globalThis as { mockRequireSession: { mockImplementation: (f: () => unknown) => void } })
            .mockRequireSession.mockImplementation(() => Promise.resolve({
                session: null, error: { error: 'Authentication required' },
            }));

        const a = await actions();
        expect((await a.approveAcademyApplicationAction(APP)).success).toBe(false);
        expect((await a.rejectAcademyApplicationAction(APP, 'A reason')).success).toBe(false);
        expect((await a.markAcademyApplicationUnderReviewAction(APP)).success).toBe(false);
        expect((await a.manualAcademyEnrollmentAction(LEARNER, 'elite')).success).toBe(false);

        expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, APP)!.status).toBe('pending');
    });
});

// ─── the queue ───────────────────────────────────────────────────────────────

describe('the application queue', () => {
    beforeEach(() => {
        store.seedAll(COLLECTIONS.ACADEMY_APPLICATIONS, {
            p1: { userId: 'u1', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z' },
            r1: { userId: 'u2', status: 'under_review', createdAt: '2026-02-01T00:00:00.000Z' },
            a1: { userId: 'u3', status: 'approved', createdAt: '2026-03-01T00:00:00.000Z' },
        });
        store.seedAll(COLLECTIONS.USERS, {
            u1: { email: 'one@example.com', fullName: 'One' },
            u2: { email: 'two@example.com', fullName: 'Two' },
            u3: { email: 'three@example.com', fullName: 'Three' },
        });
    });

    it('lists applications for an academy admin', async () => {
        actAs('academy-admin', ['academy_admin']);
        const { getAcademyApplicationsAction } = await actions();
        const result = await getAcademyApplicationsAction({});

        expect(result.success).toBe(true);
    });

    it('and refuses a member', async () => {
        actAs('member', ['user']);
        const { getAcademyApplicationsAction } = await actions();
        expect((await getAcademyApplicationsAction({})).success).toBe(false);
    });
});
