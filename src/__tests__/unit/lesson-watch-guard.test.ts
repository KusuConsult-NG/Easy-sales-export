/**
 * @jest-environment node
 */

/**
 * THE ANTI-CHEAT MEASURED ONE NUMBER AND THE CERTIFICATE DEPENDED ON ANOTHER.
 *
 * `updateLessonProgress` carries the platform's only defence against skimming a
 * video. It compares elapsed wall-clock time against claimed watch time and
 * clamps anything faster than 2x playback, logging "[LMS Progress Guard]
 * Watch-rate anomaly detected". Real care went into it.
 *
 * It clamps `lastWatchedSecond` — the resume position, which nothing decides
 * anything from. The line that matters is:
 *
 *     completed: finalProgressPercent >= 95
 *
 * and `finalProgressPercent` starts life as `validated.progressPercent`, a
 * number the browser sends. courseProgressSchema constrains it to 0..100 and
 * nothing else.
 *
 * The two are only ever tied together inside the clamp, and the clamp is behind
 * two conditions that a caller controls:
 *
 *     if (existingDoc.exists) {                    // ← skipped on the 1st write
 *         if (progressIncreaseSeconds > 0) {       // ← skipped if seconds don't rise
 *
 * So there are two ways past it, and neither needs any timing:
 *
 *   1. FIRST WRITE. No row exists, so the whole block is skipped. One request
 *      with progressPercent 100 stores completed: true.
 *
 *   2. EVERY WRITE AFTER THAT. Send `lastWatchedSecond` unchanged. The increase
 *      is 0, `> 0` is false, and progressPercent passes through untouched. The
 *      guard is not merely bypassed once — it never applies again.
 *
 * WHY IT IS WORTH MORE THAN THE VIDEO
 * -----------------------------------
 * `completeCourse` was hardened (course-completion.test.ts) so that completion
 * is no longer declared but derived — every lesson of the course must have a
 * lesson-progress row marked completed. Its comment says completion is "derived
 * from the per-lesson records that guard produces".
 *
 * The guard produces them on request. So the hardening moved the gate onto a
 * record the caller writes, and the chain — one request per lesson,
 * completeCourse, generateCourseCertificate — ends in a stored, numbered
 * credential. That earlier test named this gap in its own NOT ASSERTED section:
 * "that the watch-rate clamp itself works... is a different exercise". This is
 * that exercise, and the clamp did not work.
 *
 * THE FIX
 * -------
 * The server credits watch time instead of receiving it.
 *
 *   - The budget applies to EVERY write. On the first there is no baseline, so
 *     the budget is the grace buffer alone: a real player's first heartbeat
 *     (~10s in) is unaffected, and a claim of 100% is credited ~10 seconds.
 *   - Percent advances only by the FRACTION of the claimed watch time that was
 *     actually credited. Claim no new seconds and you earn no new percent,
 *     which is case 2 above.
 *   - Percent is monotonic. It is a progress record: scrubbing backwards moves
 *     the resume position, which is what that field is for, and does not
 *     un-complete a lesson.
 *
 * `completed` is then computed from the credited figure, so the number the
 * guard protects is the number the certificate rests on.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null,
    setCache: async () => undefined,
    deleteCache: async () => undefined,
}));
jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';
const COURSE = 'course-1';
const LESSON = 'l1';
const ROW = `${LEARNER}_${LESSON}`;

function actAs(id: string): void {
    (globalThis as {
        mockRequireSession: { mockImplementation: (f: () => unknown) => void };
    }).mockRequireSession.mockImplementation(() =>
        Promise.resolve({
            session: { user: { id, roles: ['academy_participant'], email: `${id}@example.com` } },
            error: null,
        }),
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

/**
 * An existing lesson row whose last write was `secondsAgo` seconds back.
 *
 * `updatedAt` is seeded as an ISO string because that is one of the two shapes
 * the guard reads (`instanceof Timestamp` else `new Date(...)`), and it is the
 * shape that lets a test place the previous write at a chosen moment. Elapsed
 * time is the input the whole budget is computed from, so it has to be an input
 * of the test rather than a property of how fast the suite runs.
 */
function seedRow(opts: { secondsAgo: number; second: number; percent: number; completed?: boolean }): void {
    store.seed(COLLECTIONS.LESSON_VIDEO_PROGRESS, ROW, {
        userId: LEARNER,
        courseId: COURSE,
        lessonId: LESSON,
        progressPercent: opts.percent,
        lastWatchedSecond: opts.second,
        completed: opts.completed ?? false,
        updatedAt: new Date(Date.now() - opts.secondsAgo * 1000).toISOString(),
    });
}

function row(): Record<string, any> {
    return (store.get(COLLECTIONS.LESSON_VIDEO_PROGRESS, ROW) ?? {}) as Record<string, any>;
}

// ─── the two ways past the guard ─────────────────────────────────────────────

describe('the first write is inside the budget, not outside it', () => {
    it('A SINGLE REQUEST CANNOT COMPLETE A LESSON', async () => {
        // Was: no row exists, so `if (existingDoc.exists)` is false and the
        // entire clamp is skipped. progressPercent 100 was stored verbatim and
        // `completed: finalProgressPercent >= 95` made it true.
        const { updateLessonProgress } = await actions();

        const res: any = await updateLessonProgress({
            courseId: COURSE,
            lessonId: LESSON,
            progressPercent: 100,
            lastWatchedSecond: 7200,
        });

        expect(res.success).toBe(true);
        expect(row().completed).toBe(false);
        expect(row().progressPercent).toBeLessThan(95);
    });

    it('credits a first heartbeat only up to the grace buffer', async () => {
        // The budget on a first write is the grace buffer alone — there is no
        // earlier write to measure elapsed time from, and the server does not
        // know when the video started.
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 100, lastWatchedSecond: 7200,
        });

        expect(row().lastWatchedSecond).toBeLessThanOrEqual(10);
    });

    it('AND A REAL PLAYER SENDING ITS FIRST HEARTBEAT IS UNTOUCHED', async () => {
        // The lesson page persists every ~10 seconds. A first heartbeat at 8
        // seconds into a 200-second lesson is 4%, and must arrive intact — a
        // guard that clamps honest traffic gets removed.
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 4, lastWatchedSecond: 8,
        });

        expect(row().lastWatchedSecond).toBe(8);
        expect(row().progressPercent).toBe(4);
    });
});

describe('percent cannot advance without watch time behind it', () => {
    it('CLAIMING 100% WITHOUT WATCHING A NEW SECOND EARNS NOTHING', async () => {
        // Was: progressIncreaseSeconds is 0, `> 0` is false, the clamp is
        // skipped and progressPercent is written verbatim. This is the durable
        // hole — it works on every write, not only the first, so a caller who
        // has watched ten honest seconds can then claim the other 99% for free.
        seedRow({ secondsAgo: 3600, second: 10, percent: 5 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 100, lastWatchedSecond: 10,
        });

        expect(row().progressPercent).toBe(5);
        expect(row().completed).toBe(false);
    });

    it('and scrubbing backwards claims nothing either', async () => {
        seedRow({ secondsAgo: 3600, second: 400, percent: 40 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 100, lastWatchedSecond: 20,
        });

        expect(row().progressPercent).toBe(40);
    });

    it('the resume position still follows a scrub back, because that is what it is for', async () => {
        seedRow({ secondsAgo: 3600, second: 400, percent: 40 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 40, lastWatchedSecond: 20,
        });

        expect(row().lastWatchedSecond).toBe(20);
    });

    it('percent is monotonic, so re-watching does not un-complete a lesson', async () => {
        seedRow({ secondsAgo: 3600, second: 900, percent: 100, completed: true });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 2, lastWatchedSecond: 15,
        });

        expect(row().progressPercent).toBe(100);
        expect(row().completed).toBe(true);
    });
});

describe('the budget itself', () => {
    it('honest watching at real time is credited in full', async () => {
        // 60 seconds elapsed, 55 seconds of new video claimed: well inside
        // 2x + 10. Percent arrives exactly as sent.
        seedRow({ secondsAgo: 60, second: 100, percent: 10 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 15, lastWatchedSecond: 155,
        });

        expect(row().lastWatchedSecond).toBe(155);
        expect(row().progressPercent).toBe(15);
    });

    it('2x playback is allowed, because the guard was written to allow it', async () => {
        // 60 seconds elapsed, 120 claimed. The multiplier is 2.0 and the buffer
        // is on top of it, so this is inside the budget by design.
        seedRow({ secondsAgo: 60, second: 0, percent: 0 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 30, lastWatchedSecond: 120,
        });

        expect(row().lastWatchedSecond).toBe(120);
        expect(row().progressPercent).toBe(30);
    });

    it('4x playback is credited half, and the percent is credited in the same proportion', async () => {
        // 60 elapsed → budget 130. Claim 260 new seconds: exactly half is
        // credited, so half of the claimed percent gain is too.
        seedRow({ secondsAgo: 60, second: 0, percent: 0 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 80, lastWatchedSecond: 260,
        });

        // Asserted with tolerance, unlike the within-budget cases above. When
        // the claim is clamped, the credited figure is a function of REAL
        // elapsed time — the milliseconds this test itself takes between
        // seeding `updatedAt` and calling the action land in the budget. An
        // exact 130 would be asserting the suite's own speed.
        expect(row().lastWatchedSecond).toBeCloseTo(130, 0);
        expect(row().progressPercent).toBeCloseTo(40, 0);
    });

    it('a long absence accrues budget, because the learner may have been watching', async () => {
        // The guard measures wall-clock elapsed time, not session time. An hour
        // away is an hour of budget — that is the existing design and this
        // change does not tighten it, it only stops the budget being skipped.
        seedRow({ secondsAgo: 3600, second: 0, percent: 0 });
        const { updateLessonProgress } = await actions();

        await updateLessonProgress({
            courseId: COURSE, lessonId: LESSON, progressPercent: 100, lastWatchedSecond: 1800,
        });

        expect(row().lastWatchedSecond).toBe(1800);
        expect(row().completed).toBe(true);
    });
});

// ─── the chain the guard is load-bearing for ─────────────────────────────────

describe('completeCourse rests on these rows, so it rests on this guard', () => {
    function seedCourse(): void {
        store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, {
            title: 'Export Documentation Fundamentals',
            tier: 'free',
            modules: [{ id: 'm1', title: 'One', lessons: [{ id: 'l1' }, { id: 'l2' }] }],
        });
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE, progressPercent: 0, completed: false,
        });
    }

    it('ONE REQUEST PER LESSON NO LONGER BUYS A COURSE COMPLETION', async () => {
        // The whole chain, end to end: this is what the two holes composed to.
        seedCourse();
        const { updateLessonProgress, completeCourse } = await actions();

        for (const lessonId of ['l1', 'l2']) {
            await updateLessonProgress({
                courseId: COURSE, lessonId, progressPercent: 100, lastWatchedSecond: 7200,
            });
        }

        const res: any = await completeCourse(COURSE);

        expect(res.success).toBe(false);
        expect(String(res.error)).toMatch(/still incomplete/i);
    });

    it('and a learner who actually watched both lessons still completes', async () => {
        // The fix has to leave the honest path open, or it has replaced one
        // broken behaviour with another.
        seedCourse();
        for (const lessonId of ['l1', 'l2']) {
            store.seed(COLLECTIONS.LESSON_VIDEO_PROGRESS, `${LEARNER}_${lessonId}`, {
                userId: LEARNER, courseId: COURSE, lessonId,
                progressPercent: 100, lastWatchedSecond: 600, completed: true,
            });
        }

        const { completeCourse } = await actions();
        const res: any = await completeCourse(COURSE);

        expect(res.success).toBe(true);
        expect(store.get(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`)?.completed).toBe(true);
    });
});

// ─── the readers, which had no coverage at all ───────────────────────────────

/**
 * `getCourseProgress`, `getLessonProgress` and `getCourseCertificate` were
 * entirely unexecuted. Two of them are only reachable through
 * components/lms/CourseProgressCard.tsx, which nothing renders — but this is a
 * "use server" module, so every export carries an action id the browser can
 * call whether or not a component imports it. The same argument that made
 * enrollInCourse worth gating makes these worth executing.
 *
 * On the return shapes: each success branch answers `data: { ... }` and each
 * failure branch answers a bare `progress: null` / `certificate: null` with no
 * `data` key. That reads like the inversion that made getUserEnrolledCourses
 * unusable, and it is not the same thing — there the SUCCESS branch was the
 * broken one, and callers here check `success` before reading `data`. Recorded
 * as observed rather than fixed, so a later reader does not take the
 * resemblance for the defect.
 */
describe('getCourseProgress', () => {
    it('reads the composite id rather than querying', async () => {
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE, progressPercent: 42,
            lastWatchedSecond: 300, completed: false,
        });
        // A second learner's row for the same course must not be reachable.
        store.seed(COLLECTIONS.COURSE_PROGRESS, `someone-else_${COURSE}`, {
            userId: 'someone-else', courseId: COURSE, progressPercent: 100, completed: true,
        });

        const res: any = await (await actions()).getCourseProgress(COURSE);

        expect(res.success).toBe(true);
        expect(res.data.progress.progressPercent).toBe(42);
        expect(res.data.progress.completed).toBe(false);
    });

    it('a learner with no record gets null, not a fabricated zero row', async () => {
        const res: any = await (await actions()).getCourseProgress(COURSE);

        expect(res.success).toBe(true);
        expect(res.data).toBeNull();
    });

    it('falls back to completionPercentage when progressPercent is absent', async () => {
        // The two names for one number that completeCourse writes in pairs.
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE, completionPercentage: 100, completed: true,
        });

        const res: any = await (await actions()).getCourseProgress(COURSE);

        expect(res.data.progress.progressPercent).toBe(100);
    });
});

describe('getLessonProgress', () => {
    it('returns the learner\'s own video position', async () => {
        seedRow({ secondsAgo: 60, second: 240, percent: 55 });

        const res: any = await (await actions()).getLessonProgress(LESSON);

        expect(res.success).toBe(true);
        expect(res.data.progress).toEqual({
            progressPercent: 55, lastWatchedSecond: 240, completed: false,
        });
    });

    it('is keyed to the caller, not to the lesson alone', async () => {
        store.seed(COLLECTIONS.LESSON_VIDEO_PROGRESS, `someone-else_${LESSON}`, {
            userId: 'someone-else', courseId: COURSE, lessonId: LESSON,
            progressPercent: 100, lastWatchedSecond: 999, completed: true,
        });

        const res: any = await (await actions()).getLessonProgress(LESSON);

        expect(res.data).toBeNull();
    });
});

describe('generateCourseCertificate', () => {
    function seedCompleted(completed: boolean): void {
        store.seed(COLLECTIONS.ACADEMY_COURSES, COURSE, {
            title: 'Export Documentation Fundamentals',
            modules: [{ id: 'm1', lessons: [{ id: 'l1' }] }],
        });
        store.seed(COLLECTIONS.COURSE_PROGRESS, `${LEARNER}_${COURSE}`, {
            userId: LEARNER, courseId: COURSE, progressPercent: completed ? 100 : 40, completed,
        });
    }

    it('refuses a course that is not complete', async () => {
        seedCompleted(false);

        const res: any = await (await actions()).generateCourseCertificate(COURSE, 'Anything At All');

        expect(res.success).toBe(false);
        expect(store.all(COLLECTIONS.COURSE_CERTIFICATES)).toHaveLength(0);
    });

    it('IGNORES THE TITLE THE CALLER SENDS', async () => {
        // The parameter is kept so existing callers compile, and the course
        // document decides what the credential says.
        seedCompleted(true);

        const res: any = await (await actions()).generateCourseCertificate(COURSE, 'Doctor of Everything');

        expect(res.success).toBe(true);
        const [, cert] = store.all(COLLECTIONS.COURSE_CERTIFICATES)[0];
        expect(cert.courseTitle).toBe('Export Documentation Fundamentals');
    });

    it('re-issuing returns the existing certificate rather than a second one', async () => {
        seedCompleted(true);
        const { generateCourseCertificate } = await actions();

        const first: any = await generateCourseCertificate(COURSE);
        const second: any = await generateCourseCertificate(COURSE);

        expect(second.success).toBe(true);
        expect(second.data.certificateId).toBe(first.data.certificateId);
        expect(store.all(COLLECTIONS.COURSE_CERTIFICATES)).toHaveLength(1);
    });
});

describe('getCourseCertificate', () => {
    it('returns nothing when none has been issued', async () => {
        const res: any = await (await actions()).getCourseCertificate(COURSE);

        expect(res.success).toBe(true);
        expect(res.data).toBeNull();
    });

    it('returns the caller\'s own certificate and not another learner\'s', async () => {
        store.seed(COLLECTIONS.COURSE_CERTIFICATES, 'c-theirs', {
            userId: 'someone-else', courseId: COURSE, courseTitle: 'Theirs',
            certificateNumber: 'CERT-1-abc',
        });
        store.seed(COLLECTIONS.COURSE_CERTIFICATES, 'c-mine', {
            userId: LEARNER, courseId: COURSE, userName: 'Amaka',
            courseTitle: 'Export Documentation Fundamentals', certificateNumber: 'CERT-2-def',
        });

        const res: any = await (await actions()).getCourseCertificate(COURSE);

        expect(res.data.certificate.id).toBe('c-mine');
        expect(res.data.certificate.certificateNumber).toBe('CERT-2-def');
    });
});
