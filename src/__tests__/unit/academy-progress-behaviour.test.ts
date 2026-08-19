/**
 * @jest-environment node
 */

/**
 * Academy progress, EXECUTED — lesson completion, quiz grading, the aggregate
 * dashboard and the learning streak.
 *
 * At 6.2%. This file is where the module's arithmetic lives: the weighted
 * 70/30 progress formula, the optimistic-locking `_version` guard, and a
 * server-side quiz grader that replaced a browser-side one which had been
 * handed the answer key. None of it had ever run in a test, because every
 * action here is a read-modify-write and the old harness could not read back
 * what it wrote.
 *
 * IT ADDRESSES DOCUMENTS BY PATH
 * ------------------------------
 * `db.doc("user_progress/<uid>/courses/<courseId>")`, not
 * `collection().doc()`. The fake grew a top-level `db.doc(path)` for this,
 * reproducing the adapter's split-on-"/" and its refusal of an odd segment
 * count — see lib/testing/firestore-mock-db.js.
 *
 * WHAT RUNNING IT FOUND
 * ---------------------
 * Finding #81, in calculateStreakAction. The writer names each day document
 * `new Date().toISOString().split("T")[0]` — a UTC calendar date. The reader
 * walked the LOCAL calendar: `setHours(0,0,0,0)` then `toISOString()`. On a UTC
 * server those agree; east of UTC they do not, and the walk began one day
 * behind the id the writer had just created, so today's lesson never counted.
 *
 * A process's timezone cannot be changed from inside a test, so that one is
 * measured in src/__tests__/tz/academy-streak-lagos.test.ts under
 * TZ=Africa/Lagos — where the app's learners are — and
 * src/__tests__/unit/timezone-sensitive-suites-run.test.ts spawns it so
 * `npm run test` still covers it. The end-to-end assertion at the foot of the
 * calculateStreakAction block below is the UTC half of the same guarantee.
 *
 * TWO ASYMMETRIES PINNED RATHER THAN CHANGED
 * ------------------------------------------
 *   - completeLessonAction checks `_version` only when the lesson is NOT
 *     already in the list. Re-completing a lesson is a no-op, so a stale
 *     version is not an error there. submitQuizScoreAction checks it
 *     unconditionally, because a resubmission always writes.
 *   - getUserAggregateProgressAction returns "Action failed" for an identity
 *     mismatch while its five siblings return "Unauthorized". Same refusal,
 *     different string; the wording is what the dashboard already renders.
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

function actAs(id: string | null): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve(
            id === null
                ? { session: null, error: 'Unauthorized' }
                : { session: { user: { id, roles: ['user'], email: `${id}@example.com` } }, error: null },
        ),
    );
}

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

async function actions() {
    return import('@/app/actions/academy/_ac_progress');
}

// ─── seeds ───────────────────────────────────────────────────────────────────

/** A course with `lessonsPerModule` lessons in each module, quizzes optional. */
function seedCourse(opts: {
    id?: string;
    modules: Array<{
        id: string;
        lessons: string[];
        quiz?: { passingScore?: number; questions: Array<{ id: string; correctAnswer?: number }> };
    }>;
}): void {
    store.seed(COLLECTIONS.ACADEMY_COURSES, opts.id ?? COURSE, {
        title: 'Export Fundamentals',
        modules: opts.modules.map((m) => ({
            id: m.id,
            title: m.id,
            lessons: m.lessons.map((l) => ({ id: l, title: l })),
            ...(m.quiz
                ? {
                      quiz: {
                          passingScore: m.quiz.passingScore,
                          questions: m.quiz.questions.map((q) => ({
                              id: q.id,
                              options: ['a', 'b', 'c', 'd'],
                              correctAnswer: q.correctAnswer,
                          })),
                      },
                  }
                : {}),
        })),
    });
}

function seedProgress(extra: Record<string, unknown> = {}, courseId = COURSE, userId = LEARNER): void {
    store.seed(progressPath(userId), courseId, {
        userId,
        courseId,
        completedLessons: [],
        completedModules: [],
        quizScores: {},
        overallProgress: 0,
        ...extra,
    });
}

const readProgress = (courseId = COURSE, userId = LEARNER) =>
    store.get(progressPath(userId), courseId) as Record<string, any> | undefined;

// ─────────────────────────────────────────────────────────────────────────────
describe('completeLessonAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('refuses to complete a lesson on behalf of another learner', async () => {
        actAs('someone-else');
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        seedProgress();

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
        // And nothing was written.
        expect(readProgress()?.completedLessons).toEqual([]);
    });

    it('refuses when the learner is not enrolled', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({
            success: false,
            error: 'Not enrolled in this course',
        });
    });

    it('refuses when the course document is gone', async () => {
        seedProgress();
        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({
            success: false,
            error: 'Course not found',
        });
    });

    it('refuses a lesson id that is in no module of the course', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress();

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l-from-another-course')).toMatchObject({
            success: false,
            error: 'Lesson not found',
        });
        expect(readProgress()?.completedLessons).toEqual([]);
    });

    it('finds a lesson in the SECOND module, not only the first', async () => {
        seedCourse({
            modules: [
                { id: 'm1', lessons: ['l1'] },
                { id: 'm2', lessons: ['l2'] },
            ],
        });
        seedProgress();

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l2')).toMatchObject({ success: true });
        expect(readProgress()?.completedLessons).toEqual(['l2']);
    });

    it('records the lesson, stamps lastAccessedAt and bumps _version', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress();

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({ success: true });

        const p = readProgress()!;
        expect(p.completedLessons).toEqual(['l1']);
        expect(p._version).toBe(1);
        expect(typeof p.lastAccessedAt).toBe('string');
    });

    it('computes overall progress as a plain lesson percentage when the course has no quiz', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2', 'l3', 'l4'] }] });
        seedProgress();

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');

        expect(readProgress()!.overallProgress).toBe(25);
    });

    it('weights lessons at 70% and quizzes at 30% when the course has a quiz', async () => {
        // 2 lessons, 1 quiz module. One lesson done, quiz not passed:
        // (50 * 0.7) + (0 * 0.3) = 35.
        seedCourse({
            modules: [
                { id: 'm1', lessons: ['l1', 'l2'], quiz: { questions: [{ id: 'q1', correctAnswer: 0 }] } },
            ],
        });
        seedProgress();

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');

        expect(readProgress()!.overallProgress).toBe(35);
    });

    it('counts an already-passed quiz module towards the 30% share', async () => {
        // One lesson done of two, and the one quiz module already passed:
        // (50 * 0.7) + (100 * 0.3) = 65.
        seedCourse({
            modules: [
                { id: 'm1', lessons: ['l1', 'l2'], quiz: { questions: [{ id: 'q1', correctAnswer: 0 }] } },
            ],
        });
        seedProgress({ completedModules: ['m1'] });

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');

        expect(readProgress()!.overallProgress).toBe(65);
    });

    it('stamps completedAt when the last lesson takes the course to 100', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress({ completedLessons: ['l1'] });

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l2');

        const p = readProgress()!;
        expect(p.overallProgress).toBe(100);
        expect(typeof p.completedAt).toBe('string');
    });

    it('does NOT stamp completedAt while the quiz share is still outstanding', async () => {
        // Every lesson done but the quiz unpassed: (100 * 0.7) + 0 = 70.
        seedCourse({
            modules: [
                { id: 'm1', lessons: ['l1'], quiz: { questions: [{ id: 'q1', correctAnswer: 0 }] } },
            ],
        });
        seedProgress();

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');

        const p = readProgress()!;
        expect(p.overallProgress).toBe(70);
        expect(p.completedAt).toBeUndefined();
    });

    it('is idempotent — a repeat completion neither duplicates the lesson nor bumps the version', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress();

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');
        const first = readProgress()!;

        await completeLessonAction(LEARNER, COURSE, 'l1');
        const second = readProgress()!;

        expect(second.completedLessons).toEqual(['l1']);
        expect(second._version).toBe(first._version);
    });

    it('refuses a write whose expectedVersion is stale', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress({ _version: 4 });

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1', 2)).toMatchObject({
            success: false,
            error: 'Failed to mark lesson as complete',
        });
        expect(readProgress()!.completedLessons).toEqual([]);
    });

    it('accepts a matching expectedVersion — the stale refusal is not vacuous', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1', 'l2'] }] });
        seedProgress({ _version: 4 });

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1', 4)).toMatchObject({ success: true });
        expect(readProgress()!._version).toBe(5);
    });

    it('skips the version check entirely when the lesson is already complete', async () => {
        // Pinned as behaviour, not endorsed: re-completing writes nothing, so a
        // stale version has nothing to clobber.
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        seedProgress({ completedLessons: ['l1'], _version: 9 });

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1', 1)).toMatchObject({ success: true });
        expect(readProgress()!._version).toBe(9);
    });

    it('writes into the calling learner\'s own progress path, not a shared one', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        seedProgress();
        seedProgress({}, COURSE, 'learner-2');

        const { completeLessonAction } = await actions();
        await completeLessonAction(LEARNER, COURSE, 'l1');

        expect(readProgress()!.completedLessons).toEqual(['l1']);
        expect(readProgress(COURSE, 'learner-2')!.completedLessons).toEqual([]);
    });

    it('reports a failure rather than throwing when the progress record has no completedLessons array', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        store.seed(progressPath(), COURSE, { userId: LEARNER, courseId: COURSE });

        const { completeLessonAction } = await actions();
        expect(await completeLessonAction(LEARNER, COURSE, 'l1')).toMatchObject({
            success: false,
            error: 'Failed to mark lesson as complete',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('submitQuizScoreAction', () => {
    const quizCourse = () =>
        seedCourse({
            modules: [
                {
                    id: 'm1',
                    lessons: ['l1', 'l2'],
                    quiz: {
                        passingScore: 50,
                        questions: [
                            { id: 'q1', correctAnswer: 0 },
                            { id: 'q2', correctAnswer: 3 },
                        ],
                    },
                },
            ],
        });

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { submitQuizScoreAction } = await actions();
        expect(await submitQuizScoreAction(LEARNER, COURSE, 'm1', {})).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('refuses to submit on behalf of another learner', async () => {
        actAs('someone-else');
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        expect(await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 })).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
        expect(readProgress()!.quizScores).toEqual({});
    });

    it('refuses when the learner is not enrolled', async () => {
        quizCourse();
        const { submitQuizScoreAction } = await actions();
        expect(await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0 })).toMatchObject({
            success: false,
            error: 'Not enrolled in this course',
        });
    });

    it('grades from the STORED questions — all correct passes and completes the module', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 });

        expect(res).toMatchObject({ success: true });
        expect(res.data).toMatchObject({ passed: true, score: 100 });
        expect(res.data.results).toEqual({ q1: true, q2: true });
        expect(readProgress()!.completedModules).toEqual(['m1']);
        expect(readProgress()!.quizScores).toEqual({ m1: 100 });
    });

    it('marks each question individually and returns which ones were right', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 1 });

        expect(res.data.score).toBe(50);
        expect(res.data.results).toEqual({ q1: true, q2: false });
    });

    it('does not leak the correct answers back to the submitter', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 9, q2: 9 });

        // Every value in `results` is a boolean, never an index.
        expect(Object.values(res.data.results).every((v) => typeof v === 'boolean')).toBe(true);
        expect(JSON.stringify(res.data)).not.toContain('correctAnswer');
    });

    it('records the failing score without completing the module', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 1, q2: 1 });

        expect(res.data).toMatchObject({ passed: false, score: 0 });
        expect(readProgress()!.completedModules).toEqual([]);
        expect(readProgress()!.quizScores).toEqual({ m1: 0 });
    });

    it('a score the caller supplies as an "answer" cannot buy a pass', async () => {
        // The regression this action exists for: it used to take `score: number`
        // and store it, so submitQuizScoreAction(me, course, mod, 100) passed
        // any module. Answers are graded here now, and 100 is just a wrong
        // option index.
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', {
            q1: 100, q2: 100, score: 100, passed: true,
        } as any);

        expect(res.data).toMatchObject({ passed: false, score: 0 });
        expect(readProgress()!.completedModules).toEqual([]);
    });

    it('honours the module\'s own passingScore', async () => {
        seedCourse({
            modules: [
                {
                    id: 'm1',
                    lessons: ['l1'],
                    quiz: {
                        passingScore: 100,
                        questions: [{ id: 'q1', correctAnswer: 0 }, { id: 'q2', correctAnswer: 0 }],
                    },
                },
            ],
        });
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 1 });

        expect(res.data).toMatchObject({ score: 50, passed: false });
    });

    it('falls back to a 95 pass mark when the quiz declares none', async () => {
        seedCourse({
            modules: [
                {
                    id: 'm1',
                    lessons: ['l1'],
                    quiz: { questions: [{ id: 'q1', correctAnswer: 0 }, { id: 'q2', correctAnswer: 0 }] },
                },
            ],
        });
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        // 50% clears no default; 100% does.
        expect((await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 1 }) as any).data)
            .toMatchObject({ score: 50, passed: false });
        expect((await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 0 }) as any).data)
            .toMatchObject({ score: 100, passed: true });
    });

    it('does not add the module twice when the quiz is passed again', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 });
        await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 });

        expect(readProgress()!.completedModules).toEqual(['m1']);
    });

    it('scores a module that carries no quiz as 0 and never completes it', async () => {
        seedCourse({ modules: [{ id: 'm1', lessons: ['l1'] }] });
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0 });

        expect(res.data).toMatchObject({ passed: false, score: 0 });
        expect(readProgress()!.completedModules).toEqual([]);
    });

    it('scores a module id that is in no module of the course as 0', async () => {
        quizCourse();
        seedProgress();

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'not-a-module', { q1: 0 });

        expect(res.data).toMatchObject({ passed: false, score: 0 });
        expect(readProgress()!.quizScores).toEqual({ 'not-a-module': 0 });
    });

    it('still bumps the version when the course document is missing', async () => {
        // The whole grading block is skipped, but the write is not.
        seedProgress({ _version: 2 });

        const { submitQuizScoreAction } = await actions();
        const res: any = await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0 });

        expect(res).toMatchObject({ success: true });
        expect(res.data).toMatchObject({ passed: false, score: 0 });
        expect(readProgress()!._version).toBe(3);
        expect(readProgress()!.quizScores).toEqual({});
    });

    it('recomputes overall progress on the 70/30 weighting when the quiz passes', async () => {
        // 2 lessons, 1 already done, one quiz module now passed:
        // (50 * 0.7) + (100 * 0.3) = 65.
        quizCourse();
        seedProgress({ completedLessons: ['l1'] });

        const { submitQuizScoreAction } = await actions();
        await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 });

        expect(readProgress()!.overallProgress).toBe(65);
    });

    it('stamps completedAt when the pass takes the course to 100', async () => {
        quizCourse();
        seedProgress({ completedLessons: ['l1', 'l2'] });

        const { submitQuizScoreAction } = await actions();
        await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 });

        const p = readProgress()!;
        expect(p.overallProgress).toBe(100);
        expect(typeof p.completedAt).toBe('string');
    });

    it('refuses a stale expectedVersion, even for a resubmission', async () => {
        quizCourse();
        seedProgress({ _version: 7 });

        const { submitQuizScoreAction } = await actions();
        expect(await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 }, 3)).toMatchObject({
            success: false,
            error: 'Failed to submit quiz',
        });
        expect(readProgress()!.quizScores).toEqual({});
        expect(readProgress()!._version).toBe(7);
    });

    it('accepts a matching expectedVersion — the stale refusal is not vacuous', async () => {
        quizCourse();
        seedProgress({ _version: 7 });

        const { submitQuizScoreAction } = await actions();
        expect(await submitQuizScoreAction(LEARNER, COURSE, 'm1', { q1: 0, q2: 3 }, 7)).toMatchObject({
            success: true,
        });
        expect(readProgress()!._version).toBe(8);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserProgressAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getUserProgressAction } = await actions();
        expect(await getUserProgressAction(LEARNER, COURSE)).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('refuses to hand one learner another learner\'s quiz scores', async () => {
        // The fix this action carries: it had no session check at all and took
        // the user id as an argument, so anyone could read anyone's scores.
        actAs('nosy-1');
        seedProgress({ quizScores: { m1: 88 }, completedLessons: ['l1'] });

        const { getUserProgressAction } = await actions();
        const res: any = await getUserProgressAction(LEARNER, COURSE);

        expect(res).toMatchObject({ success: false, error: 'Unauthorized' });
        expect(JSON.stringify(res)).not.toContain('88');
    });

    it('returns the learner\'s own record', async () => {
        seedProgress({ quizScores: { m1: 88 }, completedLessons: ['l1'], overallProgress: 42 });

        const { getUserProgressAction } = await actions();
        const res: any = await getUserProgressAction(LEARNER, COURSE);

        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({ overallProgress: 42, completedLessons: ['l1'] });
        expect(res.data.quizScores).toEqual({ m1: 88 });
    });

    it('reports "not enrolled" as a success with null data, not an error', async () => {
        const { getUserProgressAction } = await actions();
        expect(await getUserProgressAction(LEARNER, 'course-nobody-joined')).toEqual({
            success: true,
            error: null,
            data: null,
        });
    });

    it('reads the record for the course asked for, not the first one stored', async () => {
        seedProgress({ overallProgress: 10 }, 'course-a');
        seedProgress({ overallProgress: 90 }, 'course-b');

        const { getUserProgressAction } = await actions();
        expect(((await getUserProgressAction(LEARNER, 'course-b')) as any).data.overallProgress).toBe(90);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('getUserAggregateProgressAction', () => {
    it('refuses a caller with no session', async () => {
        actAs(null);
        const { getUserAggregateProgressAction } = await actions();
        expect(await getUserAggregateProgressAction(LEARNER)).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('refuses to aggregate another learner\'s record', async () => {
        actAs('nosy-1');
        const { getUserAggregateProgressAction } = await actions();
        expect(await getUserAggregateProgressAction(LEARNER)).toMatchObject({
            success: false,
            error: 'Action failed',
        });
    });

    it('returns an empty dashboard for a learner enrolled in nothing', async () => {
        const { getUserAggregateProgressAction } = await actions();
        const res: any = await getUserAggregateProgressAction(LEARNER);

        expect(res.success).toBe(true);
        expect(res.data).toMatchObject({
            totalCourses: 0,
            completedCourses: 0,
            inProgressCourses: 0,
            totalLessons: 0,
            completedLessons: 0,
            overallProgress: 0,
            certificatesEarned: 0,
        });
    });

    it('counts completed, in-progress and untouched enrolments apart', async () => {
        seedCourse({ id: 'c-done', modules: [{ id: 'm1', lessons: ['a', 'b'] }] });
        seedCourse({ id: 'c-part', modules: [{ id: 'm1', lessons: ['a', 'b'] }] });
        seedCourse({ id: 'c-idle', modules: [{ id: 'm1', lessons: ['a', 'b'] }] });
        seedProgress({ completedLessons: ['a', 'b'], completedAt: '2026-02-01T00:00:00.000Z' }, 'c-done');
        seedProgress({ completedLessons: ['a'] }, 'c-part');
        seedProgress({ completedLessons: [] }, 'c-idle');

        const { getUserAggregateProgressAction } = await actions();
        const res: any = await getUserAggregateProgressAction(LEARNER);

        expect(res.data).toMatchObject({
            totalCourses: 3,
            completedCourses: 1,
            inProgressCourses: 1,
            completedLessons: 3,
            totalLessons: 6,
            overallProgress: 50,
        });
    });

    it('issues one certificate per completed course', async () => {
        seedCourse({ id: 'c1', modules: [{ id: 'm1', lessons: ['a'] }] });
        seedCourse({ id: 'c2', modules: [{ id: 'm1', lessons: ['a'] }] });
        seedProgress({ completedLessons: ['a'], completedAt: '2026-02-01T00:00:00.000Z' }, 'c1');
        seedProgress({ completedLessons: ['a'], completedAt: '2026-03-01T00:00:00.000Z' }, 'c2');

        const { getUserAggregateProgressAction } = await actions();
        expect(((await getUserAggregateProgressAction(LEARNER)) as any).data.certificatesEarned).toBe(2);
    });

    it('estimates half an hour per completed lesson', async () => {
        seedCourse({ id: 'c1', modules: [{ id: 'm1', lessons: ['a', 'b', 'c'] }] });
        seedProgress({ completedLessons: ['a', 'b', 'c'] }, 'c1');

        const { getUserAggregateProgressAction } = await actions();
        expect(((await getUserAggregateProgressAction(LEARNER)) as any).data.totalHoursLearned).toBe(1.5);
    });

    it('sums lessons across every module of every enrolled course', async () => {
        seedCourse({
            id: 'c1',
            modules: [{ id: 'm1', lessons: ['a', 'b'] }, { id: 'm2', lessons: ['c'] }],
        });
        seedProgress({ completedLessons: ['a'] }, 'c1');

        const { getUserAggregateProgressAction } = await actions();
        const res: any = await getUserAggregateProgressAction(LEARNER);
        expect(res.data.totalLessons).toBe(3);
        expect(res.data.overallProgress).toBe(33);
    });

    it('contributes nothing for an enrolment whose course document is gone', async () => {
        seedCourse({ id: 'c1', modules: [{ id: 'm1', lessons: ['a', 'b'] }] });
        seedProgress({ completedLessons: ['a'] }, 'c1');
        seedProgress({ completedLessons: ['x'] }, 'deleted-course');

        const { getUserAggregateProgressAction } = await actions();
        const res: any = await getUserAggregateProgressAction(LEARNER);

        expect(res.data.totalCourses).toBe(2);
        expect(res.data.totalLessons).toBe(2);
        // The orphaned enrolment's lessons still count as completed, which is
        // why overall progress can exceed the course lesson count. Pinned so a
        // future change to the denominator is a decision, not a surprise.
        expect(res.data.completedLessons).toBe(2);
        expect(res.data.overallProgress).toBe(100);
    });

    it('never reaches into another learner\'s progress path', async () => {
        seedCourse({ id: 'c1', modules: [{ id: 'm1', lessons: ['a'] }] });
        seedProgress({ completedLessons: ['a'] }, 'c1', 'learner-2');

        const { getUserAggregateProgressAction } = await actions();
        expect(((await getUserAggregateProgressAction(LEARNER)) as any).data.totalCourses).toBe(0);
    });

    it('returns the enrolled records alongside the totals', async () => {
        seedCourse({ id: 'c1', modules: [{ id: 'm1', lessons: ['a'] }] });
        seedProgress({ completedLessons: ['a'], overallProgress: 100 }, 'c1');

        const { getUserAggregateProgressAction } = await actions();
        const res: any = await getUserAggregateProgressAction(LEARNER);

        expect(res.data.enrolledCourses).toHaveLength(1);
        expect(res.data.enrolledCourses[0]).toMatchObject({ courseId: 'c1', overallProgress: 100 });
    });

    it('reports a failure rather than throwing when an enrolment has no completedLessons array', async () => {
        store.seed(progressPath(), 'c1', { userId: LEARNER, courseId: 'c1' });

        const { getUserAggregateProgressAction } = await actions();
        expect(((await getUserAggregateProgressAction(LEARNER)) as any).success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('logLessonActivityAction', () => {
    const dayId = () => new Date().toISOString().split('T')[0];
    const days = (userId = LEARNER) => `${COLLECTIONS.USER_ACTIVITY_LOGS}/${userId}/days`;

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { logLessonActivityAction } = await actions();
        expect(await logLessonActivityAction()).toMatchObject({ success: false, error: 'Unauthorized' });
    });

    it('names the day document after the UTC calendar date', async () => {
        const { logLessonActivityAction } = await actions();
        expect(await logLessonActivityAction()).toMatchObject({ success: true });

        const doc = store.get(days(), dayId());
        expect(doc).toBeDefined();
        expect(doc!.date).toBe(dayId());
    });

    it('counts up rather than overwriting when a second lesson lands the same day', async () => {
        const { logLessonActivityAction } = await actions();
        await logLessonActivityAction();
        await logLessonActivityAction();
        await logLessonActivityAction();

        expect(store.get(days(), dayId())!.lessonsCompletedCount).toBe(3);
    });

    it('derives the learner from the session and never from an argument', async () => {
        actAs('learner-9');
        const { logLessonActivityAction } = await actions();
        // The action takes no parameters at all; extra arguments cannot redirect it.
        await (logLessonActivityAction as (...a: unknown[]) => Promise<unknown>)(LEARNER);

        expect(store.size(days('learner-9'))).toBe(1);
        expect(store.size(days(LEARNER))).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('calculateStreakAction', () => {
    const days = (userId = LEARNER) => `${COLLECTIONS.USER_ACTIVITY_LOGS}/${userId}/days`;

    /** The UTC day `offset` days before now, in the id format the writer uses. */
    function utcDay(offset: number): string {
        const d = new Date();
        d.setUTCHours(0, 0, 0, 0);
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().split('T')[0];
    }

    function seedDays(offsets: number[], userId = LEARNER): void {
        for (const o of offsets) {
            const id = utcDay(o);
            store.seed(days(userId), id, { date: id, lessonsCompletedCount: 1 });
        }
    }

    it('refuses a caller with no session', async () => {
        actAs(null);
        const { calculateStreakAction } = await actions();
        expect(await calculateStreakAction(LEARNER)).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('refuses to read another learner\'s activity record', async () => {
        actAs('nosy-1');
        seedDays([0, 1, 2]);

        const { calculateStreakAction } = await actions();
        expect(await calculateStreakAction(LEARNER)).toMatchObject({
            success: false,
            error: 'Unauthorized',
        });
    });

    it('returns null data when the learner has never logged a day', async () => {
        const { calculateStreakAction } = await actions();
        expect(await calculateStreakAction(LEARNER)).toEqual({
            success: true,
            error: null,
            data: null,
        });
    });

    it('counts consecutive days ending today', async () => {
        seedDays([0, 1, 2, 3]);
        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 4 });
    });

    it('stops at the first gap', async () => {
        seedDays([0, 1, 3, 4, 5]);
        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 2 });
    });

    it('allows today to be missing so far, and counts from yesterday', async () => {
        seedDays([1, 2, 3]);
        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 3 });
    });

    it('allows only ONE day of grace — a two-day gap ends the streak at zero', async () => {
        seedDays([2, 3, 4]);
        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 0 });
    });

    it('counts a single day today as a streak of one', async () => {
        seedDays([0]);
        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 1 });
    });

    it('keys on the document id, not on the `date` field inside it', async () => {
        // Worth pinning: the two are written together but only the id is read,
        // so a day filed under the wrong id is invisible however right its body.
        store.seed(days(), 'not-a-date', { date: utcDay(0), lessonsCompletedCount: 1 });

        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 0 });
    });

    it('reads only the calling learner\'s days', async () => {
        seedDays([0, 1, 2, 3, 4], 'learner-2');
        seedDays([0]);

        const { calculateStreakAction } = await actions();
        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 1 });
    });

    it('what logLessonActivityAction writes is what calculateStreakAction counts', async () => {
        // End to end across the pair, so the two calendars cannot drift apart
        // again without a test noticing.
        const { logLessonActivityAction, calculateStreakAction } = await actions();
        await logLessonActivityAction();

        expect(((await calculateStreakAction(LEARNER)) as any).data).toEqual({ streak: 1 });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Finding #81 — the streak walked the LOCAL calendar over UTC-named documents.
 *
 * Not measurable here: this process is UTC, where the two calendars coincide,
 * and a process's timezone cannot be changed once its first Date exists. It is
 * measured in src/__tests__/tz/academy-streak-lagos.test.ts, which
 * src/__tests__/unit/timezone-sensitive-suites-run.test.ts spawns under
 * TZ=Africa/Lagos.
 */
