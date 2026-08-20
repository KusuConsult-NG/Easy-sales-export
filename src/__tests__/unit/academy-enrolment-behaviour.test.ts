/**
 * @jest-environment node
 */

/**
 * Academy enrolment, EXECUTED — the status check, the tier-gated enrolment, the
 * auto-enrolment sweep that runs on every dashboard load, and the enrolled-course
 * list.
 *
 * At 27%. This file has been corrected four times from source reading alone —
 * the rejected applicant who could enrol their way back in (#225), the
 * `resolvedUserId` field rename that made two dedup queries match nothing, the
 * session-derived caller on autoEnrollPaidUser, three revalidatePath targets
 * with no route behind them — and not one of those fixes has ever been run.
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
const COURSE = 'course-1';
const progressPath = (userId = LEARNER) => `user_progress/${userId}/courses`;

/** The session, including the serviceRegistrations requireSession force-syncs onto it. */
function actAs(
    id: string | null,
    academy?: Record<string, unknown> | null,
    roles: string[] = ['academy_participant'],
): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: { error: 'Unauthorized' } }
                : {
                      session: {
                          user: {
                              id,
                              roles,
                              email: `${id}@example.com`,
                              serviceRegistrations: academy === undefined ? {} : { academy },
                          },
                      },
                      error: null,
                  },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER, { plan: 'elite', status: 'approved' });
});

async function actions() {
    return import('@/app/actions/academy/_ac_enrollment');
}

// ─── seeds ───────────────────────────────────────────────────────────────────

function seedLearner(academy: Record<string, unknown> | null, roles: string[] = []): void {
    store.seed(COLLECTIONS.USERS, LEARNER, {
        email: `${LEARNER}@example.com`,
        name: 'Amaka',
        roles,
        ...(academy === null ? {} : { serviceRegistrations: { academy } }),
    });
}

function seedCourse(id: string, tier: string | null, lessons = ['l1', 'l2']): void {
    store.seed(COLLECTIONS.ACADEMY_COURSES, id, {
        title: `Course ${id}`,
        instructor: 'Ngozi Eze',
        thumbnail: `/img/${id}.png`,
        ...(tier === null ? {} : { tier }),
        modules: [{ id: 'm1', title: 'One', lessons: lessons.map((l) => ({ id: l, title: l })) }],
        createdAt: new Date('2026-01-01').toISOString(),
    });
}

const readProgress = (courseId = COURSE, userId = LEARNER) =>
    store.get(progressPath(userId), courseId) as Record<string, any> | undefined;

// ─── enrollInCourseAction ────────────────────────────────────────────────────

describe('enrollInCourseAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { enrollInCourseAction } = await actions();

        expect(await enrollInCourseAction(LEARNER, COURSE)).toMatchObject({
            success: false, error: 'Unauthorized',
        });
    });

    it('refuses a caller enrolling somebody else', async () => {
        // The user id is an ARGUMENT, so this is the check that stops
        // enrollInCourseAction(someoneElse, course) from working.
        seedLearner({ plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        const { enrollInCourseAction } = await actions();

        expect(await enrollInCourseAction('someone-else', COURSE)).toMatchObject({
            success: false, error: 'Unauthorized',
        });
        expect(store.size(progressPath('someone-else'))).toBe(0);
    });

    it('refuses a user document that does not exist', async () => {
        seedCourse(COURSE, 'free');
        const { enrollInCourseAction } = await actions();

        expect(await enrollInCourseAction(LEARNER, COURSE)).toMatchObject({
            success: false, error: 'User not found',
        });
    });

    it('enrols an elite learner in an elite course', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        const { enrollInCourseAction } = await actions();

        expect(await enrollInCourseAction(LEARNER, COURSE)).toMatchObject({ success: true });

        const progress = readProgress();
        expect(progress).toMatchObject({
            userId: LEARNER, courseId: COURSE, completedLessons: [], overallProgress: 0,
        });
    });

    it('grants academy_participant on the way in, once', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        seedCourse('course-2', 'elite');
        const { enrollInCourseAction } = await actions();

        await enrollInCourseAction(LEARNER, COURSE);
        expect(store.get(COLLECTIONS.USERS, LEARNER)?.roles).toContain('academy_participant');

        await enrollInCourseAction(LEARNER, 'course-2');
        const roles = store.get(COLLECTIONS.USERS, LEARNER)?.roles as string[];
        expect(roles.filter((r) => r === 'academy_participant')).toHaveLength(1);
    });

    it('counts the enrolment on the course', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        const { enrollInCourseAction } = await actions();

        await enrollInCourseAction(LEARNER, COURSE);
        expect(store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)?.enrolledCount).toBe(1);
    });

    it('refuses a second enrolment in the same course', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        const { enrollInCourseAction } = await actions();

        await enrollInCourseAction(LEARNER, COURSE);
        const again = await enrollInCourseAction(LEARNER, COURSE);

        expect(again).toMatchObject({ success: false, error: 'Already enrolled in this course' });
        // And the refusal does not double-count.
        expect(store.get(COLLECTIONS.ACADEMY_COURSES, COURSE)?.enrolledCount).toBe(1);
    });

    it('refuses a course that does not exist', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        const { enrollInCourseAction } = await actions();

        expect(await enrollInCourseAction(LEARNER, 'no-such-course')).toMatchObject({
            success: false, error: 'Course not found',
        });
    });

    describe('the tier gate', () => {
        it('refuses a tier the plan does not open, and names the tier', async () => {
            seedLearner({ plan: 'foundation', status: 'approved' });
            seedCourse(COURSE, 'elite');
            const { enrollInCourseAction } = await actions();

            const result = await enrollInCourseAction(LEARNER, COURSE);
            expect(result.success).toBe(false);
            expect(result.error).toContain('foundation package does not grant access');
            expect(result.error).toContain('Elite tier or higher');
            expect(readProgress()).toBeUndefined();
        });

        it('and does not name a package the learner never bought', async () => {
            seedLearner({ status: 'approved' });
            seedCourse(COURSE, 'standard');
            const { enrollInCourseAction } = await actions();

            const result = await enrollInCourseAction(LEARNER, COURSE);
            expect(result.error).toContain('does not include a course package yet');
        });

        it('opens a free or untiered course to a learner with no package', async () => {
            seedLearner({ status: 'approved' });
            seedCourse(COURSE, 'free');
            seedCourse('untiered', null);
            const { enrollInCourseAction } = await actions();

            expect(await enrollInCourseAction(LEARNER, COURSE)).toMatchObject({ success: true });
            expect(await enrollInCourseAction(LEARNER, 'untiered')).toMatchObject({ success: true });
        });
    });

    describe('the decided-against gate (#225)', () => {
        it.each(['rejected', 'suspended', 'revoked'])(
            'refuses a %s applicant even on a free course',
            async (status: string) => {
                seedLearner({ plan: 'elite', status });
                seedCourse(COURSE, 'free');
                const { enrollInCourseAction } = await actions();

                const result = await enrollInCourseAction(LEARNER, COURSE);
                expect(result.success).toBe(false);
                expect(result.error).toContain('was not approved');
                expect(readProgress()).toBeUndefined();
            },
        );

        it('and does not hand back the role the rejection revoked (#210)', async () => {
            // THE point of #225: step 4 of the enrolment grants
            // academy_participant, and checkModuleAccess grants the module on
            // that role alone. Enrolling was a way to undo the rejection.
            seedLearner({ plan: 'elite', status: 'rejected' }, []);
            seedCourse(COURSE, 'free');
            const { enrollInCourseAction } = await actions();

            await enrollInCourseAction(LEARNER, COURSE);
            expect(store.get(COLLECTIONS.USERS, LEARNER)?.roles ?? []).not.toContain('academy_participant');
        });

        it('while a pending applicant enrols normally', async () => {
            seedLearner({ plan: 'elite', status: 'pending' });
            seedCourse(COURSE, 'elite');
            const { enrollInCourseAction } = await actions();

            expect(await enrollInCourseAction(LEARNER, COURSE)).toMatchObject({ success: true });
        });
    });
});

// ─── autoEnrollPaidUser ──────────────────────────────────────────────────────

describe('autoEnrollPaidUser', () => {
    it('takes the caller from the session, not from its arguments', async () => {
        // It is an export of a "use server" module, so it is directly
        // addressable: autoEnrollPaidUser(myOwnId, "elite") used to enrol the
        // caller in every elite course. Both values come from the session now
        // and the parameters are deliberately ignored.
        seedLearner({ plan: 'foundation', status: 'approved' });
        actAs(LEARNER, { plan: 'foundation', status: 'approved' });
        seedCourse('elite-course', 'elite');
        seedCourse('foundation-course', 'foundation');

        const { autoEnrollPaidUser } = await actions();
        await autoEnrollPaidUser('victim-id', 'elite');

        expect(store.get(progressPath(LEARNER), 'foundation-course')).toBeDefined();
        expect(store.get(progressPath(LEARNER), 'elite-course')).toBeUndefined();
        expect(store.size(progressPath('victim-id'))).toBe(0);
    });

    it('does nothing without a session', async () => {
        actAs(null);
        seedCourse('elite-course', 'elite');

        const { autoEnrollPaidUser } = await actions();
        await autoEnrollPaidUser(LEARNER, 'elite');

        expect(store.size(progressPath(LEARNER))).toBe(0);
    });

    it('enrols an elite learner in every tier at once', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });
        seedCourse('free-course', 'free');
        seedCourse('foundation-course', 'foundation');
        seedCourse('elite-course', 'elite');

        const { autoEnrollPaidUser } = await actions();
        await autoEnrollPaidUser(LEARNER, 'elite');

        for (const id of ['free-course', 'foundation-course', 'elite-course']) {
            expect(store.get(progressPath(LEARNER), id)).toBeDefined();
            expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${id}`)).toBeDefined();
        }
        expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(3);
    });

    it('refuses a decided-against registration, which runs on every dashboard load', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'rejected' });
        seedCourse('elite-course', 'elite');

        const { autoEnrollPaidUser } = await actions();
        await autoEnrollPaidUser(LEARNER, 'elite');

        expect(store.size(progressPath(LEARNER))).toBe(0);
        expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(0);
    });

    it('does nothing for a learner on no plan', async () => {
        actAs(LEARNER, { status: 'approved' });
        seedCourse('free-course', 'free');

        const { autoEnrollPaidUser } = await actions();
        await autoEnrollPaidUser(LEARNER, 'free');

        expect(store.size(progressPath(LEARNER))).toBe(0);
    });

    describe('the field-name rename that made both dedup queries match nothing', () => {
        it('does not zero the progress of a learner who has already worked', async () => {
            // THE regression. `existingProgresses` was always empty, so this
            // re-set COURSE_PROGRESS with progressPercent: 0, completed: false,
            // completedAt: null merged over real progress — on every dashboard
            // load.
            actAs(LEARNER, { plan: 'elite', status: 'approved' });
            seedCourse('elite-course', 'elite');
            store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`, {
                userId: LEARNER, courseId: 'elite-course',
                progressPercent: 80, completed: false, lastWatchedSecond: 640,
            });

            const { autoEnrollPaidUser } = await actions();
            await autoEnrollPaidUser(LEARNER, 'elite');

            const progress = store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`);
            expect(progress?.progressPercent).toBe(80);
            expect(progress?.lastWatchedSecond).toBe(640);
        });

        it('and recognises a row the bug wrote under the wrong field name', async () => {
            // Rows written while the name was wrong carry `resolvedUserId`.
            // Reading both names and taking the union is what stops them being
            // zeroed one final time — no backfill needed.
            actAs(LEARNER, { plan: 'elite', status: 'approved' });
            seedCourse('elite-course', 'elite');
            store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`, {
                resolvedUserId: LEARNER, courseId: 'elite-course', progressPercent: 55,
            });
            store.seed(COLLECTIONS.COURSE_ENROLLMENTS, 'legacy-row', {
                resolvedUserId: LEARNER, courseId: 'elite-course', status: 'active',
            });

            const { autoEnrollPaidUser } = await actions();
            await autoEnrollPaidUser(LEARNER, 'elite');

            expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`)?.progressPercent).toBe(55);
            // And no duplicate enrolment row beside the legacy one.
            expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(1);
        });

        it('writes userId, which is the field every other reader queries', async () => {
            actAs(LEARNER, { plan: 'elite', status: 'approved' });
            seedCourse('elite-course', 'elite');

            const { autoEnrollPaidUser } = await actions();
            await autoEnrollPaidUser(LEARNER, 'elite');

            const [, enrolment] = store.all(COLLECTIONS.COURSE_ENROLLMENTS)[0];
            expect(enrolment.userId).toBe(LEARNER);
            expect(enrolment).not.toHaveProperty('resolvedUserId');
            expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_elite-course`)?.userId).toBe(LEARNER);
        });

        it('and is idempotent across dashboard loads', async () => {
            // It runs on every load, so "twice" is the ordinary case, not an edge.
            actAs(LEARNER, { plan: 'elite', status: 'approved' });
            seedCourse('elite-course', 'elite');

            const { autoEnrollPaidUser } = await actions();
            await autoEnrollPaidUser(LEARNER, 'elite');
            await autoEnrollPaidUser(LEARNER, 'elite');

            expect(store.size(COLLECTIONS.COURSE_ENROLLMENTS)).toBe(1);
            expect(store.get(COLLECTIONS.ACADEMY_COURSES, 'elite-course')?.enrolledCount).toBe(1);
        });
    });
});

// ─── getEnrolledCoursesWithDetailsAction ─────────────────────────────────────

describe('getEnrolledCoursesWithDetailsAction', () => {
    it('reports progress against the course it belongs to', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite', ['l1', 'l2', 'l3', 'l4']);
        store.seed(progressPath(LEARNER), COURSE, {
            userId: LEARNER, courseId: COURSE, completedLessons: ['l1', 'l2'], overallProgress: 50,
        });

        const { getEnrolledCoursesWithDetailsAction } = await actions();
        const result: any = await getEnrolledCoursesWithDetailsAction();

        expect(result.success).toBe(true);
        expect(result.data.courses).toHaveLength(1);
        expect(result.data.courses[0]).toMatchObject({
            courseId: COURSE,
            title: `Course ${COURSE}`,
            totalLessons: 4,
            completedLessons: 2,
            progress: 50,
            status: 'in-progress',
        });
    });

    it('calls a course with no lessons finished not-started', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        store.seed(progressPath(LEARNER), COURSE, { userId: LEARNER, courseId: COURSE, completedLessons: [] });

        const { getEnrolledCoursesWithDetailsAction } = await actions();
        const result: any = await getEnrolledCoursesWithDetailsAction();

        expect(result.data.courses[0]).toMatchObject({ status: 'not-started', progress: 0 });
    });

    it('and a finished one completed', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        store.seed(progressPath(LEARNER), COURSE, {
            userId: LEARNER, courseId: COURSE,
            completedLessons: ['l1', 'l2'], completedAt: new Date('2026-02-01').toISOString(),
        });

        const { getEnrolledCoursesWithDetailsAction } = await actions();
        const result: any = await getEnrolledCoursesWithDetailsAction();

        expect(result.data.courses[0]).toMatchObject({ status: 'completed', progress: 100 });
    });

    it('skips a progress row whose course has been deleted', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });
        seedCourse(COURSE, 'elite');
        store.seed(progressPath(LEARNER), COURSE, { userId: LEARNER, courseId: COURSE, completedLessons: [] });
        store.seed(progressPath(LEARNER), 'deleted-course', {
            userId: LEARNER, courseId: 'deleted-course', completedLessons: [],
        });

        const { getEnrolledCoursesWithDetailsAction } = await actions();
        const result: any = await getEnrolledCoursesWithDetailsAction();

        expect(result.data.courses.map((c: any) => c.courseId)).toEqual([COURSE]);
    });

    /**
     * FOUR HAND-ROLLED ANSWERS TO "IS THIS A PAID PLAN?", AND ONE REAL ONE.
     *
     *   _getEnrolledCoursesWithDetailsAction  ["elite","standard","foundation","advanced"]
     *   api/academy/dashboard/route.ts        the same four, copy-pasted
     *   autoEnrollPaidUser                    eleven entries, including the
     *                                         STATUSES "active", "enrolled" and
     *                                         "approved" and four plan names
     *                                         nothing sells
     *   normaliseAcademyPlan                  the rule the access check two
     *                                         lines later actually uses
     *
     * All three gates call `.toLowerCase()` and none of them trims.
     * normaliseAcademyPlan does both, and academy-course-access.test.ts asserts
     * that checkCourseAccess(" Elite ", "elite") is true.
     *
     * So a plan stored with a stray space opens every elite course in the
     * catalogue and hands over every video through getCourseByIdAction — and
     * fails every one of these gates, so the auto-enrolment sweep never runs for
     * them. The learner is shown the whole catalogue unlocked and a dashboard
     * that says they are enrolled in nothing. This is #228 one file over.
     */
    describe('the paid-plan gate agrees with the access rule it gates', () => {
        it('runs the sweep for a plan the access rule opens', async () => {
            // THE test. checkCourseAccess(" Elite ", "elite") is true, so this
            // learner can already watch every elite video.
            actAs(LEARNER, { plan: ' Elite ', status: 'approved' });
            seedCourse('elite-course', 'elite');
            store.seed(progressPath(LEARNER), 'seed-only', { userId: LEARNER, courseId: 'seed-only' });

            const { getEnrolledCoursesWithDetailsAction } = await actions();
            await getEnrolledCoursesWithDetailsAction();

            expect(store.get(progressPath(LEARNER), 'elite-course')).toBeDefined();
        });

        it('and the same for the legacy "advanced" spelling of standard', async () => {
            actAs(LEARNER, { plan: 'ADVANCED', status: 'approved' });
            seedCourse('standard-course', 'standard');
            store.seed(progressPath(LEARNER), 'seed-only', { userId: LEARNER, courseId: 'seed-only' });

            const { getEnrolledCoursesWithDetailsAction } = await actions();
            await getEnrolledCoursesWithDetailsAction();

            expect(store.get(progressPath(LEARNER), 'standard-course')).toBeDefined();
        });

        it('and not for a plan it does not open', async () => {
            // Vacuity guard: "registration" is what every application row
            // carried for a while, and it buys nothing.
            actAs(LEARNER, { plan: 'registration', status: 'approved' });
            seedCourse('foundation-course', 'foundation');
            store.seed(progressPath(LEARNER), 'seed-only', { userId: LEARNER, courseId: 'seed-only' });

            const { getEnrolledCoursesWithDetailsAction } = await actions();
            await getEnrolledCoursesWithDetailsAction();

            expect(store.get(progressPath(LEARNER), 'foundation-course')).toBeUndefined();
        });

        it('there is one copy of the predicate, and the four lists are gone', () => {
            // The API dashboard route is the copy with no behavioural test on it
            // — it is a route handler, not an action — so its gate is pinned by
            // shape. Matched as a token list rather than an exact substring, so
            // reinstating it with different spacing does not slip through.
            const { readFileSync } = require('fs');
            const { join } = require('path');
            const handRolledList = /\[\s*["']elite["']\s*,[\s\S]{0,200}?["']advanced["']\s*(,[\s\S]{0,200}?)?\]/;

            for (const rel of [
                'src/app/actions/academy/_ac_enrollment.ts',
                'src/app/api/academy/dashboard/route.ts',
                'src/app/actions/course-actions.ts',
            ]) {
                const src = readFileSync(join(process.cwd(), rel), 'utf-8')
                    .replace(/\/\*[\s\S]*?\*\//g, '')
                    .split('\n').filter((l: string) => !l.trim().startsWith('//')).join('\n');
                expect(src).not.toMatch(handRolledList);
            }

            for (const rel of [
                'src/app/actions/academy/_ac_enrollment.ts',
                'src/app/api/academy/dashboard/route.ts',
            ]) {
                expect(readFileSync(join(process.cwd(), rel), 'utf-8')).toContain('isPaidAcademyPlan(');
            }
        });
    });

    it('returns an empty list, not a null, for a learner enrolled in nothing', async () => {
        actAs(LEARNER, { plan: 'elite', status: 'approved' });

        const { getEnrolledCoursesWithDetailsAction } = await actions();
        const result: any = await getEnrolledCoursesWithDetailsAction();

        expect(result.success).toBe(true);
        expect(result.data.courses).toEqual([]);
    });
});

// ─── checkAcademyStatusAction ────────────────────────────────────────────────

describe('checkAcademyStatusAction', () => {
    it('returns the status recorded on the user document', async () => {
        seedLearner({ plan: 'elite', status: 'approved' });
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ success: true, data: 'approved' });
    });

    it('falls back to the application record when the user document is behind', async () => {
        seedLearner(null);
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: LEARNER, status: 'pending', submittedAt: new Date('2026-01-01').toISOString(),
        });
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'pending' });
    });

    it('and backfills the user document when the application says approved', async () => {
        seedLearner({ status: 'pending' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'app-1', {
            userId: LEARNER, status: 'approved', submittedAt: new Date('2026-01-01').toISOString(),
        });
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'approved' });
        expect(store.get(COLLECTIONS.USERS, LEARNER)?.serviceRegistrations?.academy?.status).toBe('approved');
    });

    it('reads the LATEST application when a learner has more than one', async () => {
        // The decision that counts is the most recent one. A reapplication that
        // was rejected must not be outranked by the approval it superseded.
        seedLearner({ status: 'pending' });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'old', {
            userId: LEARNER, status: 'approved', submittedAt: new Date('2026-01-01').toISOString(),
        });
        store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'new', {
            userId: LEARNER, status: 'rejected', submittedAt: new Date('2026-06-01').toISOString(),
        });
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'rejected' });
    });

    /**
     * THE FALLBACK LOOKUPS DECIDED BY AN ARBITRARY APPLICATION, AND PERSISTED IT.
     *
     * The query above sorts by submittedAt and takes the newest, because a
     * learner can have more than one application and the decision that counts is
     * the last one. Neither of the two fallbacks did.
     *
     * They are reached when no application carries `userId` — legacy rows, from
     * before the submit flow recorded it. One looks the application up by
     * `serviceRegistrations.academy.applicationId`; the other queries
     * `personalInfo.email` with `.limit(1)` and no `orderBy`, so Postgres
     * returns whichever row it likes.
     *
     * Picking wrong would be bad enough. What makes it permanent is what the
     * branch below then does with the answer: on `status === "approved"` it
     * WRITES `serviceRegistrations.academy.status = "approved"` onto the user
     * document, and it backfills `userId` onto the application it chose — so the
     * ordered query above finds only that one from then on, and the guess
     * becomes the record.
     *
     * The promotion is one-directional: only "approved" is written back. So a
     * learner with an old approved application and a newer rejected one could
     * have the rejection undone by loading a page — which is #207-#209 exactly,
     * reappearing through the two branches that fix did not reach.
     */
    describe('the fallback lookups', () => {
        function seedTwoUnlinkedApplications(): void {
            // Deliberately named so the APPROVED one sorts first by id: with no
            // orderBy, that is the one an unordered `.limit(1)` returns.
            store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'a-approved', {
                personalInfo: { email: `${LEARNER}@example.com` },
                status: 'approved', submittedAt: new Date('2026-01-01').toISOString(),
            });
            store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'b-rejected', {
                personalInfo: { email: `${LEARNER}@example.com` },
                status: 'rejected', submittedAt: new Date('2026-06-01').toISOString(),
            });
        }

        it('found by email, take the latest application and not an arbitrary one', async () => {
            // THE test. This returned "approved" for a learner whose most recent
            // application had been rejected.
            seedLearner({});
            seedTwoUnlinkedApplications();
            const { checkAcademyStatusAction } = await actions();

            expect(await checkAcademyStatusAction()).toMatchObject({ data: 'rejected' });
        });

        it('and do not write that guess onto the user document', async () => {
            seedLearner({});
            seedTwoUnlinkedApplications();
            const { checkAcademyStatusAction } = await actions();

            await checkAcademyStatusAction();
            expect(store.get(COLLECTIONS.USERS, LEARNER)?.serviceRegistrations?.academy?.status)
                .not.toBe('approved');
        });

        it('found by applicationId, still take the latest', async () => {
            // The stored applicationId points at the approval it was written by.
            // A later application that was rejected supersedes it.
            seedLearner({ applicationId: 'a-approved' });
            seedTwoUnlinkedApplications();
            const { checkAcademyStatusAction } = await actions();

            expect(await checkAcademyStatusAction()).toMatchObject({ data: 'rejected' });
        });

        it('link the application they settled on to the learner', async () => {
            // Vacuity guard: the self-healing backfill is the reason these
            // branches exist, and it has to keep working — on the right row.
            seedLearner({});
            seedTwoUnlinkedApplications();
            const { checkAcademyStatusAction } = await actions();

            await checkAcademyStatusAction();
            expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'b-rejected')?.userId).toBe(LEARNER);
        });

        it('and still promote a genuine lone approval', async () => {
            // Vacuity guard the other way: with one application and nothing
            // newer, the backfill is correct and must survive.
            seedLearner({});
            store.seed(COLLECTIONS.ACADEMY_APPLICATIONS, 'only', {
                personalInfo: { email: `${LEARNER}@example.com` },
                status: 'approved', submittedAt: new Date('2026-01-01').toISOString(),
            });
            const { checkAcademyStatusAction } = await actions();

            expect(await checkAcademyStatusAction()).toMatchObject({ data: 'approved' });
            expect(store.get(COLLECTIONS.USERS, LEARNER)?.serviceRegistrations?.academy?.status)
                .toBe('approved');
            expect(store.get(COLLECTIONS.ACADEMY_APPLICATIONS, 'only')?.userId).toBe(LEARNER);
        });
    });

    it('reports a completed payment when there is no registration at all', async () => {
        seedLearner(null);
        store.seed(COLLECTIONS.PROCESSED_PAYMENTS, 'p1', {
            userId: LEARNER, type: 'academy_registration', status: 'completed',
        });
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ data: 'payment_completed' });
    });

    it('and null when there is nothing to report', async () => {
        seedLearner(null);
        const { checkAcademyStatusAction } = await actions();

        expect(await checkAcademyStatusAction()).toMatchObject({ success: true, data: null });
    });
});
