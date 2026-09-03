/**
 * @jest-environment node
 */

/**
 * TWO WAYS TO ENROL IN A COURSE, AND ONLY ONE ASKED WHO WAS ASKING.
 *
 * `checkCourseAccess` decides which course tiers a learner's plan opens and
 * `isDecidedAgainst` decides whether an admin has already refused their Academy
 * application. Both are consulted by `_enrollInCourseAction` in
 * actions/academy/_ac_enrollment.ts — the second of them added in #225, after a
 * rejected applicant was found to be able to enrol their way back into the
 * module.
 *
 * `enrollInCourse` in actions/course-actions.ts writes the same two records for
 * the same purpose and asked neither. Any signed-in account, any course.
 *
 * WHY AN ENDPOINT WITH NO CALLER IS STILL AN ENDPOINT
 * --------------------------------------------------
 * Nothing in the app imports `enrollInCourse`. But course-actions.ts is a
 * "use server" module and the lesson page imports `updateLessonProgress` and
 * `getLessonProgress` from it, so the module is in the client reference
 * manifest and every export of it carries an action id the browser can call.
 * That is the same reasoning that made `autoEnrollPaidUser` reachable when it
 * took its user id from its caller.
 *
 * WHAT IT ACTUALLY GRANTED
 * ------------------------
 * Not the videos. getCourseByIdAction strips locked material by tier, so the
 * lessons stayed shut. What it granted was a `course_enrollments` row and a
 * `course_progress` row — the records every dashboard, count and report reads
 * as a real enrolment — for a tier the learner had not bought, and for an
 * applicant an admin had rejected.
 *
 * AND THE LIST THAT RETURNED NOTHING
 * ----------------------------------
 * `getUserEnrolledCourses` in the same file ran its query, serialized the rows
 * into a local called `enrollments`, and returned `data: null`. The local was
 * never read. A caller could not tell that from a learner enrolled in nothing.
 * Its failure branch returned `courses: []` and its success branch had no
 * `courses` key at all, so a caller reading `.courses` got an array on failure
 * and `undefined` on success.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Unauthorized' } }
                : { session: { user: { id, roles: ['academy_participant'], email: `${id}@example.com` } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

async function actions() {
    return import('@/app/actions/course-actions');
}

/** A learner whose Academy registration holds `plan` and `status`. */
function seedLearner(opts: { plan?: string | null; status?: string } = {}): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: `${LEARNER}@example.com`,
        name: 'Amaka',
        roles: ['academy_participant'],
        serviceRegistrations: {
            academy: {
                ...(opts.plan === undefined ? {} : { plan: opts.plan }),
                status: opts.status ?? 'approved',
            },
        },
    });
}

function seedCourse(id: string, tier: string | null): void {
    store.seed(COLLECTIONS.ACADEMY_COURSES, id, {
        title: `Course ${id}`,
        ...(tier === null ? {} : { tier }),
        modules: [{ id: 'm1', title: 'One', lessons: [{ id: 'l1', title: 'Intro' }] }],
    });
}

// ─── the tier gate ───────────────────────────────────────────────────────────

describe('enrollInCourse refuses a tier the plan does not open', () => {
    it('a foundation learner cannot enrol in an elite course', async () => {
        seedLearner({ plan: 'foundation' });
        seedCourse('elite-course', 'elite');

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'elite-course' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('foundation package does not grant access');
        // Nothing was written. This is the whole point: the refusal has to
        // happen before the records other screens read into existence.
        expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(0);
        expect(store.size(COLLECTIONS.COURSE_PROGRESS)).toBe(0);
    });

    it('and is told to upgrade to the tier it actually needs', async () => {
        seedLearner({ plan: 'foundation' });
        seedCourse('standard-course', 'standard');

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'standard-course' });

        expect(result.error).toContain('Standard tier or higher');
    });

    it('a learner who bought no tier is not told to upgrade from one', async () => {
        // Registration is free and an admin can approve an application without
        // a package, so "no plan" is a real state — and naming a package the
        // learner never held is the confusion _ac_enrollment.ts already fixed.
        seedLearner({ plan: null });
        seedCourse('standard-course', 'standard');

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'standard-course' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not include a course package yet');
        expect(result.error).not.toContain('package does not grant access');
    });

    it('an elite learner enrols in an elite course', async () => {
        seedLearner({ plan: 'elite' });
        seedCourse('elite-course', 'elite');

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'elite-course' });

        expect(result.success).toBe(true);
        expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(1);
        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`)).toBeDefined();
    });

    it('a free course stays open to a learner with no plan at all', async () => {
        // checkCourseAccess returns true for an absent or "free" tier, and this
        // gate must not narrow that: free courses are the catalogue's entry.
        seedLearner({ plan: null });
        seedCourse('free-course', 'free');
        seedCourse('untiered-course', null);

        const { enrollInCourse } = await actions();
        expect((await enrollInCourse({ courseId: 'free-course' })).success).toBe(true);
        expect((await enrollInCourse({ courseId: 'untiered-course' })).success).toBe(true);
    });

    it('reads the plan through the same normaliser the access rule uses', async () => {
        // checkCourseAccess(" Elite ", "elite") is true — academy-course-access
        // asserts it — so a gate doing raw string equality would refuse a
        // learner the rest of the module admits.
        seedLearner({ plan: ' Elite ' });
        seedCourse('elite-course', 'elite');

        const { enrollInCourse } = await actions();
        expect((await enrollInCourse({ courseId: 'elite-course' })).success).toBe(true);
    });

    it('refuses a course that is in neither course collection', async () => {
        seedLearner({ plan: 'elite' });

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'no-such-course' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Course not found');
        expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(0);
    });

    it('finds a course stored in the legacy `courses` collection', async () => {
        // loadCourseForCompletion already tried both; the tier now comes from
        // whichever one holds the document, so the gate cannot be dodged by
        // which collection a course happens to live in.
        seedLearner({ plan: 'foundation' });
        store.seed(COLLECTIONS.COURSES, 'legacy-elite', { title: 'Legacy', tier: 'elite', modules: [] });

        const { enrollInCourse } = await actions();
        const result = await enrollInCourse({ courseId: 'legacy-elite' });

        expect(result.success).toBe(false);
        expect(result.error).toContain('does not grant access');
    });
});

// ─── the decided-against gate ────────────────────────────────────────────────

describe('enrollInCourse refuses a registration decided against', () => {
    it.each(['rejected', 'suspended', 'revoked'])(
        'a %s applicant cannot enrol, even in a free course',
        async (status: string) => {
            // Free tier is open to everybody — that is exactly the hole #225
            // closed on the other endpoint. A rejected applicant enrolled in a
            // free course, and enrolment is what the dashboards count.
            seedLearner({ plan: 'elite', status });
            seedCourse('free-course', 'free');

            const { enrollInCourse } = await actions();
            const result = await enrollInCourse({ courseId: 'free-course' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('was not approved');
            expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(0);
            expect(store.size(COLLECTIONS.COURSE_PROGRESS)).toBe(0);
        },
    );

    it('the refusal is checked before the tier, as it is on the sibling', async () => {
        // A rejected applicant holding elite must not be told their package is
        // fine; the decision is the answer.
        seedLearner({ plan: 'elite', status: 'rejected' });
        seedCourse('elite-course', 'elite');

        const { enrollInCourse } = await actions();
        expect((await enrollInCourse({ courseId: 'elite-course' })).error).toContain('was not approved');
    });

    it('a pending applicant is not refused — undecided is not decided against', async () => {
        seedLearner({ plan: null, status: 'pending' });
        seedCourse('free-course', 'free');

        const { enrollInCourse } = await actions();
        expect((await enrollInCourse({ courseId: 'free-course' })).success).toBe(true);
    });
});

// ─── the list that returned nothing ──────────────────────────────────────────

describe('getUserEnrolledCourses returns the enrolments it fetched', () => {
    it('returns the active rows rather than null', async () => {
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e1', {
            userId: LEARNER, courseId: 'course-a', status: 'active',
        });
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e2', {
            userId: LEARNER, courseId: 'course-b', status: 'active',
        });

        const { getUserEnrolledCourses } = await actions();
        const result = await getUserEnrolledCourses();

        expect(result.success).toBe(true);
        const courses = (result as any).data?.courses ?? [];
        expect(courses.map((c: any) => c.courseId).sort()).toEqual(['course-a', 'course-b']);
        // Both shapes carry it: the failure branch has always returned
        // `courses`, so the success branch has to as well or a caller reading
        // it sees the two outcomes inverted.
        expect((result as any).courses).toHaveLength(2);
    });

    it('does not return another learner\'s enrolments', async () => {
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'mine', {
            userId: LEARNER, courseId: 'course-a', status: 'active',
        });
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'theirs', {
            userId: 'someone-else', courseId: 'course-z', status: 'active',
        });

        const { getUserEnrolledCourses } = await actions();
        const courses = ((await getUserEnrolledCourses()) as any).data?.courses ?? [];

        expect(courses).toHaveLength(1);
        expect(courses[0].courseId).toBe('course-a');
    });

    it('leaves out cancelled enrolments', async () => {
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'live', {
            userId: LEARNER, courseId: 'course-a', status: 'active',
        });
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'dead', {
            userId: LEARNER, courseId: 'course-b', status: 'cancelled',
        });

        const { getUserEnrolledCourses } = await actions();
        const courses = ((await getUserEnrolledCourses()) as any).data?.courses ?? [];

        expect(courses.map((c: any) => c.courseId)).toEqual(['course-a']);
    });

    it('an empty result is an empty list, not a null', async () => {
        const { getUserEnrolledCourses } = await actions();
        const result = await getUserEnrolledCourses();

        expect(result.success).toBe(true);
        expect((result as any).data?.courses).toEqual([]);
    });

    it('publishes the same rows under both key names', async () => {
        // Two audits of this file independently named the payload, one
        // `courses` and one `enrollments`, and there is no production caller
        // to settle which is right. Both are populated so neither reading
        // breaks; this pins that they stay the SAME rows rather than drifting
        // into two lists that answer differently.
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e1', {
            userId: LEARNER, courseId: 'course-a', status: 'active',
        });
        store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'e2', {
            userId: LEARNER, courseId: 'course-b', status: 'active',
        });

        const result: any = await (await actions()).getUserEnrolledCourses();

        expect(result.data.enrollments).toHaveLength(2);
        expect(result.data.enrollments).toEqual(result.data.courses);
        expect(result.data.enrollments).toEqual(result.courses);
    });
});
