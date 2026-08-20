/**
 * @jest-environment node
 */

/**
 *   #225 A REJECTED APPLICANT COULD ENROL THEIR WAY BACK IN.
 *
 *        enrollInCourseAction consulted the academy PLAN and never the
 *        registration STATUS. A free-tier course opens to everybody —
 *        checkCourseAccess returns true for a missing or "free" tier regardless
 *        of plan — so an applicant whose Academy application an admin had
 *        rejected could enrol in one, and the enrolment then granted them
 *        `academy_participant` for having done so:
 *
 *            if (!userData?.roles?.includes('academy_participant')) {
 *                transaction.update(userDoc.ref, { roles: FieldValue.arrayUnion('academy_participant') })
 *            }
 *
 *        checkModuleAccess grants the Academy module on that role alone
 *        (Layer 1), so the rejection was undone by a click.
 *
 *        This is a hole straight through #210, landed one commit earlier, which
 *        taught the rejection paths to revoke that exact role. Revoking a role
 *        means nothing if an unrelated action hands it back without asking why
 *        it was taken — and the two were written years apart, in different
 *        modules, by people solving different problems. That is how this class
 *        of defect survives: neither half is wrong on its own.
 *
 *        autoEnrollPaidUser had the same gap. It grants no role, so a rejected
 *        applicant could not reach the courses it enrolled them in — but it runs
 *        on EVERY academy dashboard load, so it kept writing enrolment and
 *        progress rows for somebody who had been refused.
 *
 *   #226 AND THE ENROLMENT WAS AUDITED AS 'user_update'.
 *        The catch-all for an unclassified write, so the one question the row
 *        exists to answer — who enrolled in which course — could not be asked of
 *        it. 'course_enrolled' was ALREADY in the AuditAction union; the writer
 *        simply did not use it. Same correction as #200's training_registered.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, redis: null,
}));

jest.mock('next/cache', () => ({
    revalidatePath: () => undefined,
    revalidateTag: () => undefined,
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;
const USERS = COLLECTIONS.USERS;
const COURSES = COLLECTIONS.ACADEMY_COURSES;
const LEARNER = 'learner-1';

const enrollment = async () => await import('@/app/actions/academy/_ac_enrollment');

/**
 * requireSession force-syncs roles and serviceRegistrations from the database
 * over the JWT — see session-guard.ts — so the session mirrors the user row.
 */
const sessionFor = (academy: Record<string, unknown> | null, roles: string[] = []) => ({
    session: {
        user: {
            id: LEARNER, email: 'learner@e.com', roles,
            serviceRegistrations: academy ? { academy } : null,
        },
    },
});

const seedLearner = (academy: Record<string, unknown> | null, roles: string[] = ['user']) => {
    store.seed(USERS, LEARNER, {
        email: 'learner@e.com',
        roles,
        ...(academy ? { serviceRegistrations: { academy } } : {}),
    });
    mockRequireSession.mockResolvedValue(sessionFor(academy, roles));
};

const seedCourse = (id: string, tier = 'free') => {
    store.seed(COURSES, id, {
        title: `Course ${id}`, tier, enrolledCount: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
    });
};

const progressOf = (courseId: string) =>
    store.get(`user_progress/${LEARNER}/courses`, courseId);

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#225 — a rejection is not undone by enrolling', () => {
    const enrol = async (courseId = 'c1') =>
        (await enrollment()).enrollInCourseAction(LEARNER, courseId) as any;

    it.each(['rejected', 'suspended', 'revoked', 'declined', 'cancelled'])(
        'REFUSES A LEARNER WHOSE REGISTRATION IS %s', async (status) => {
            seedLearner({ status, plan: 'elite' });
            seedCourse('c1', 'free');

            const res = await enrol();

            // Was: success — a free course opens to everybody, and the enrolment
            // then granted academy_participant, which is Layer 1 of the module
            // gate. The rejection was undone by a click.
            expect(res.success).toBe(false);
            expect(res.error).toMatch(/not approved/i);
            expect(progressOf('c1')).toBeUndefined();
        });

    it('AND DOES NOT HAND BACK THE ROLE #210 REVOKED', async () => {
        seedLearner({ status: 'rejected', plan: 'elite' }, ['user']);
        seedCourse('c1', 'free');

        await enrol();

        expect(store.get(USERS, LEARNER)?.roles).not.toContain('academy_participant');
    });

    it('does not inflate the course enrolment count either', async () => {
        seedLearner({ status: 'rejected', plan: 'elite' });
        seedCourse('c1', 'free');

        await enrol();

        expect(store.get(COURSES, 'c1')?.enrolledCount).toBe(0);
    });

    // ── and everything legitimate still works ────────────────────────────────

    it('still enrols an approved learner in a free course', async () => {
        seedLearner({ status: 'approved', plan: 'foundation' });
        seedCourse('c1', 'free');

        expect(await enrol()).toMatchObject({ success: true });
        expect(progressOf('c1')).toBeDefined();
    });

    it('still enrols a learner with no academy registration at all', async () => {
        // Registration is free and a free course is open to everybody. "Not
        // started" is not a decision, and the guard must not read it as one.
        seedLearner(null);
        seedCourse('c1', 'free');

        expect(await enrol()).toMatchObject({ success: true });
    });

    it('still enrols a pending applicant', async () => {
        seedLearner({ status: 'pending' });
        seedCourse('c1', 'free');

        expect(await enrol()).toMatchObject({ success: true });
    });

    it('still grants the role to a legitimate first enrolment', async () => {
        seedLearner({ status: 'approved', plan: 'elite' }, ['user']);
        seedCourse('c1', 'free');

        await enrol();

        expect(store.get(USERS, LEARNER)?.roles).toContain('academy_participant');
    });

    it('still refuses a tier the learner has not bought', async () => {
        seedLearner({ status: 'approved', plan: 'foundation' });
        seedCourse('c1', 'elite');

        const res = await enrol();
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/upgrade/i);
    });

    it('still refuses enrolling somebody else', async () => {
        seedLearner({ status: 'approved', plan: 'elite' });
        seedCourse('c1', 'free');

        expect(await (await enrollment()).enrollInCourseAction('another-user', 'c1'))
            .toMatchObject({ success: false });
    });

    it('still refuses a second enrolment in the same course', async () => {
        seedLearner({ status: 'approved', plan: 'elite' });
        seedCourse('c1', 'free');

        expect(await enrol()).toMatchObject({ success: true });
        expect(await enrol()).toMatchObject({ success: false });
    });

    it('still refuses a course that does not exist', async () => {
        seedLearner({ status: 'approved', plan: 'elite' });
        expect(await enrol('nope')).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#226 — the enrolment is audited as an enrolment', () => {
    it('FILES course_enrolled, NOT user_update', async () => {
        store.seed(USERS, LEARNER, {
            email: 'learner@e.com', roles: ['user'],
            serviceRegistrations: { academy: { status: 'approved', plan: 'elite' } },
        });
        mockRequireSession.mockResolvedValue(sessionFor({ status: 'approved', plan: 'elite' }, ['user']));
        seedCourse('c1', 'free');

        await (await enrollment()).enrollInCourseAction(LEARNER, 'c1');

        expect((globalThis as any).mockCreateAdminAuditLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'course_enrolled',
                userId: LEARNER,
                targetId: 'c1',
                targetType: 'course_enrollment',
            }),
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#225 — autoEnrollPaidUser stops at a decision too', () => {
    const autoEnrol = async () =>
        (await enrollment()).autoEnrollPaidUser(LEARNER, 'elite');

    beforeEach(() => {
        seedCourse('c1', 'foundation');
        seedCourse('c2', 'elite');
    });

    it('ENROLS NOBODY WHOSE REGISTRATION WAS REJECTED', async () => {
        seedLearner({ status: 'rejected', plan: 'elite' });

        await autoEnrol();

        // Was: every eligible course, on every dashboard load, for somebody the
        // module gate will not let in.
        expect(progressOf('c1')).toBeUndefined();
        expect(progressOf('c2')).toBeUndefined();
    });

    it('still enrols an approved elite learner in every tier', async () => {
        seedLearner({ status: 'approved', plan: 'elite' });

        await autoEnrol();

        expect(progressOf('c1')).toBeDefined();
        expect(progressOf('c2')).toBeDefined();
    });

    it('still respects the tier ceiling of the plan', async () => {
        seedLearner({ status: 'approved', plan: 'foundation' });

        await autoEnrol();

        expect(progressOf('c1')).toBeDefined();
        expect(progressOf('c2')).toBeUndefined();
    });

    it('enrols nobody on a free plan', async () => {
        seedLearner({ status: 'approved', plan: 'free' });

        await autoEnrol();

        expect(progressOf('c1')).toBeUndefined();
    });

    it('does nothing without a session, whatever the arguments say', async () => {
        mockRequireSession.mockResolvedValue({ session: null });

        // The parameters are ignored on purpose — the id and plan come from the
        // session. This is the check that keeps that true.
        await (await enrollment()).autoEnrollPaidUser('somebody-else', 'elite');

        expect(store.get('user_progress/somebody-else/courses', 'c2')).toBeUndefined();
        expect(progressOf('c2')).toBeUndefined();
    });
});
