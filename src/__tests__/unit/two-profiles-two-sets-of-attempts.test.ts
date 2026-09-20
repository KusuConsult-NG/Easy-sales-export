/**
 * @jest-environment node
 */

/**
 *   ACADEMY, OUTSIDE THE DIRECTORY THE ACADEMY TRANCHE SWEPT.
 *
 *   Tranche 6 resolved src/app/actions/academy. Three reads of the same
 *   learner's records sit outside it, and one of them is a LIMIT:
 *
 *       api/academy/quiz/submit      maxAttempts, counted per profile
 *       api/academy/dashboard        the certificates they have earned
 *       lib/academy-course-progress  the enrolment duplicate guard
 *
 *   THE QUIZ LIMIT IS NOT A LIVE DEFECT, AND THE TEST SAYS SO IN ITS SETUP.
 *
 *   It has to enable ACADEMY_QUIZ_API to reach the route at all, because #386
 *   retired this whole subsystem behind that flag after measuring it:
 *   COLLECTIONS.QUIZZES has one writer, on an admin screen nothing links, so
 *   the store is empty and QUIZ_ATTEMPTS has never been written. No learner
 *   has ever reset an attempt count here, because no learner has ever taken
 *   one of these quizzes.
 *
 *   It is widened anyway, and tested behind the flag, because #386 also
 *   records that this route is the MORE COMPLETE of the two quiz
 *   implementations precisely because it enforces the limit its sibling does
 *   not. Leaving a per-profile limit for whoever finishes the feature to
 *   switch on is not a saving.
 *
 *   The widening REFUSES MORE, which is the `isSamePerson` direction and the
 *   opposite of most of this sweep. The enrolment guard below is the same
 *   direction for the same reason — and that one IS live.
 *
 *   The enrolment guard is the same direction for the same reason: checked
 *   across every profile, written under one.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

const OLD = 'a-superseded-learner';
const LIVE = 'b-live-learner';
const STRANGER = 'c-another-learner';

const QUIZ = 'quiz-1';
const COURSE = 'course-1';

let store: FakeDbHandle;

function actAs(id: string): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, roles: ['user'], email: 'learner@example.com' } },
        error: null,
    }));
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    store.seed(COLLECTIONS.USERS, LIVE, { email: 'learner@example.com' });
    store.seed(COLLECTIONS.USERS, OLD, { email: 'learner@example.com', _migratedTo: LIVE });
    store.seed(COLLECTIONS.USERS, STRANGER, { email: 'other@example.com' });
    actAs(LIVE);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the enrolment guard counts the person, not the profile', () => {
    const enrol = async () => {
        const { ensureCourseEnrolmentRecord } =
            await import('@/lib/academy-course-progress');
        return await ensureCourseEnrolmentRecord(LIVE, COURSE);
    };

    const enrolments = () => store.all(COLLECTIONS.COURSE_ENROLLMENTS);

    it('THE test — an enrolment under the OLD profile is not duplicated', async () => {
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e-old', {
            userId: OLD, courseId: COURSE, status: 'active',
        });

        const created = await enrol();

        expect(created).toBe(false);
        expect(enrolments()).toHaveLength(1);
    });

    it('VACUITY CONTROL: a learner with no enrolment anywhere still gets one', async () => {
        //   Refusing more must not become refusing everything.
        const created = await enrol();

        expect(created).toBe(true);
        expect(enrolments()).toHaveLength(1);
    });

    it("VACUITY CONTROL: and another learner's enrolment does not block them", async () => {
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e-x', {
            userId: STRANGER, courseId: COURSE, status: 'active',
        });

        const created = await enrol();

        expect(created).toBe(true);
        expect(enrolments()).toHaveLength(2);
    });

    it('VACUITY CONTROL: and an enrolment on a DIFFERENT course does not block them', async () => {
        //   The courseId clause must survive the widening — without it the
        //   guard would refuse every course after the first.
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e-other-course', {
            userId: OLD, courseId: 'course-2', status: 'active',
        });

        expect(await enrol()).toBe(true);
    });

    it('and the row it creates carries the LIVE id, not the old one', async () => {
        //   Checked across every profile, written under one: a new enrolment
        //   belongs to the profile the learner is actually using.
        await enrol();

        const [, data] = enrolments()[0];
        expect(data.userId).toBe(LIVE);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the quiz attempt limit counts the person, not the profile', () => {
    const attempt = (id: string, userId: string) =>
        store.seed(COLLECTIONS.QUIZ_ATTEMPTS, id, {
            userId, quizId: QUIZ, score: 40, createdAt: new Date('2026-01-01'),
        });

    const submit = async () => {
        const { POST } = await import('@/app/api/academy/quiz/submit/route');
        const res = await POST(new Request('http://localhost/api/academy/quiz/submit', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            //   courseId is required AND cross-checked against the quiz's own
            //   courseId — a mismatch is a 400 long before the attempt limit.
            body: JSON.stringify({ quizId: QUIZ, courseId: COURSE, answers: [0] }),
        }) as any);
        return { status: res.status, ...(await res.json()) };
    };

    const originalFlag = process.env.ACADEMY_QUIZ_API;
    afterAll(() => { process.env.ACADEMY_QUIZ_API = originalFlag; });

    beforeEach(() => {
        //   The route's FIRST statement is a 410 refusal unless this is the
        //   exact word "enabled". Without it every assertion below reads 410
        //   and the limit is never reached — which is how the first version of
        //   this block failed, and it is also the proof that no learner in
        //   production reaches this code at all.
        process.env.ACADEMY_QUIZ_API = 'enabled';
        store.seed(COLLECTIONS.QUIZZES, QUIZ, {
            title: 'Module 1 quiz', courseId: COURSE, maxAttempts: 2, passingScore: 50,
            questions: [{ question: 'Q1', options: ['a', 'b'], correctAnswer: 0 }],
        });
    });

    it('THE test — attempts made under the OLD profile count against the limit', async () => {
        //   maxAttempts is 2. Two attempts under the superseded profile is the
        //   limit reached, and a fresh profile must not reset it.
        attempt('a1', OLD);
        attempt('a2', OLD);

        const r = await submit();

        expect(r.status).toBe(429);
        expect(r.message).toMatch(/No attempts remaining/);
    });

    it('and a mix across both profiles reaches the limit too', async () => {
        attempt('a1', OLD);
        attempt('a2', LIVE);

        expect((await submit()).status).toBe(429);
    });

    it('VACUITY CONTROL: one prior attempt still leaves one', async () => {
        attempt('a1', OLD);

        expect((await submit()).status).not.toBe(429);
    });

    it("VACUITY CONTROL: and another learner's attempts never count", async () => {
        attempt('x1', STRANGER);
        attempt('x2', STRANGER);

        expect((await submit()).status).not.toBe(429);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('the dashboard shows certificates earned under either profile', () => {
    it('THE test — a certificate issued before the migration is still theirs', async () => {
        //   A certificate is issued once and never reissued, so one earned
        //   under the old profile is the only copy. A dashboard that cannot
        //   see it tells the learner they never completed the course.
        store.seed(COLLECTIONS.CERTIFICATES, 'c-old', {
            userId: OLD, courseId: COURSE, issuedBy: 'platform',
            certificateNumber: 'CERT-1', completionDate: new Date('2026-01-01'),
        });

        const { GET } = await import('@/app/api/academy/dashboard/route');
        const res = await GET(new Request('http://localhost/api/academy/dashboard') as any);
        const body = await res.json();

        expect(JSON.stringify(body)).toContain('CERT-1');
    });
});
