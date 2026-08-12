/**
 * @jest-environment node
 */

/**
 * A learner could issue themselves a certificate for a course they never took,
 * bearing any title they chose.
 *
 * TWO DEFECTS THAT COMPOSE
 * ------------------------
 * `completeCourse(courseId)` set `completed: true` and `progressPercent: 100`
 * for anyone who asked. The only precondition was that a progress record
 * existed — which enrolling creates.
 *
 * `generateCourseCertificate(courseId, courseTitle)` then checked exactly that
 * flag, and wrote the caller's `courseTitle` onto the certificate, into the
 * notification and into the audit log.
 *
 * Together: enrol, call completeCourse, call generateCourseCertificate with a
 * title of your choosing, and receive a stored, numbered credential for a course
 * you never opened.
 *
 * THE PART THAT MAKES IT WORTH WRITING DOWN
 * -----------------------------------------
 * `updateLessonProgress`, in this same file, already defends against precisely
 * this. It compares elapsed wall-clock time against claimed watch time and
 * CLAMPS anything faster than 2x playback, logging "[LMS Progress Guard]
 * Watch-rate anomaly detected". Someone took real care that a learner cannot
 * skim a video — and the endpoint next door skipped the entire course in one
 * call.
 *
 * THE FIX
 * -------
 * Completion is derived from the records that guard produces: every lesson in
 * the course document must have a lesson-progress row marked completed. The
 * certificate takes its title from the course document; the parameter is kept so
 * callers still compile, and ignored.
 *
 * Both fail CLOSED. A course whose lessons cannot be read refuses completion,
 * because that is exactly the state a self-completer would want.
 *
 * NOT ASSERTED
 * ------------
 * That the watch-rate clamp itself works. It predates this change and is
 * untouched; testing it needs control of elapsed time between two writes, which
 * is a different exercise from the credential path covered here.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const LEARNER = 'learner-1';
const COURSE = 'course-1';

jest.mock('@/lib/audit-log', () => ({
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));
jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

function setSession(id: string) {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id, email: `${id}@e.com`, name: 'A Learner', roles: [] } },
        error: null,
    }));
}

const COURSE_DOC = {
    title: 'Export Documentation Fundamentals',
    modules: [
        { id: 'm1', title: 'Basics', lessons: [{ id: 'l1' }, { id: 'l2' }] },
        { id: 'm2', title: 'Practice', lessons: [{ id: 'l3' }] },
    ],
};

/**
 * Three different reads happen here — the course document, the course-progress
 * record and a query of lesson progress — so the mock answers by shape rather
 * than returning one snapshot for everything. A shared snapshot would let the
 * lesson check pass on the course document's own fields.
 */
function setWorld(opts: {
    course?: Record<string, any> | null;
    progressCompleted?: boolean;
    lessonsDone?: string[];
    certificateExists?: boolean;
} = {}) {
    const course = opts.course === undefined ? COURSE_DOC : opts.course;
    const lessonsDone = opts.lessonsDone ?? [];
    const lessonDocs = lessonsDone.map((id) => ({
        id: `${LEARNER}_${id}`,
        data: () => ({ userId: LEARNER, courseId: COURSE, lessonId: id, completed: true }),
    }));

    (global as any).mockFirestoreGet.mockImplementation((id: string) => {
        // The course-progress record uses a composite id.
        if (typeof id === 'string' && id.startsWith(`${LEARNER}_`)) {
            return Promise.resolve({
                exists: true, empty: false, docs: [],
                data: () => ({ completed: opts.progressCompleted ?? false, completedAt: null }),
            });
        }
        // A query result. The harness passes the COLLECTION NAME for a
        // `.where(...).get()`, not undefined — the first version of this fixture
        // keyed on undefined, so the lesson rows were never returned and every
        // learner looked as though they had finished nothing.
        if (id === 'lesson_video_progress') {
            return Promise.resolve({
                exists: false, empty: lessonDocs.length === 0, docs: lessonDocs, data: () => ({}),
            });
        }
        if (id === 'course_certificates') {
            return Promise.resolve({ exists: false, empty: !opts.certificateExists, docs: [], data: () => ({}) });
        }
        // The course document.
        return Promise.resolve(
            course === null
                ? { exists: false, empty: true, docs: [], data: () => undefined }
                : { exists: true, empty: false, docs: [], data: () => course }
        );
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() => Promise.resolve({
        exists: true, empty: false, docs: [],
        data: () => ({ completed: opts.progressCompleted ?? false }),
    }));
}

function allWrites(): Record<string, any>[] {
    const g = global as any;
    return [
        ...g.mockFirestoreUpdate.mock.calls,
        ...g.mockFirestoreSet.mock.calls,
        ...g.mockFirestoreAdd.mock.calls,
        ...g.mockFirestoreTxUpdate.mock.calls,
        ...g.mockFirestoreTxSet.mock.calls,
    ].map((c: any[]) => c[c.length - 1]).filter(Boolean);
}

async function complete() {
    const { completeCourse } = await import('@/app/actions/course-actions');
    return completeCourse(COURSE);
}

async function certify(title = 'Doctor of Everything') {
    const { generateCourseCertificate } = await import('@/app/actions/course-actions');
    return generateCourseCertificate(COURSE, title);
}

describe('completeCourse — completion is earned, not declared', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(LEARNER);
    });

    it('refuses a learner who has finished no lessons', async () => {
        // THE test. This call used to succeed on its own.
        setWorld({ lessonsDone: [] });

        const r: any = await complete();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not finished|incomplete/i);
        expect(allWrites().filter((p) => p && p.completed === true)).toEqual([]);
    });

    it('refuses a learner who has finished only some lessons', async () => {
        setWorld({ lessonsDone: ['l1', 'l2'] });

        const r: any = await complete();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/1 of 3/);
    });

    it('refuses when the course content cannot be read', async () => {
        // Fails closed. A course whose lessons are unreadable is exactly the
        // state a self-completer would want to engineer.
        setWorld({ course: null });

        const r: any = await complete();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/unavailable/i);
    });

    it('refuses a course with no lessons recorded', async () => {
        setWorld({ course: { title: 'Empty', modules: [] } });

        const r: any = await complete();

        expect(r.success).toBe(false);
    });

    it('completes for a learner who has finished every lesson', async () => {
        // Vacuity guard. Every refusal above is satisfied by an endpoint that
        // never completes anything, which would strand every genuine learner
        // short of their certificate.
        setWorld({ lessonsDone: ['l1', 'l2', 'l3'] });

        const r: any = await complete();

        expect(r.success).toBe(true);
        const patch = allWrites().find((p) => p && 'progressPercent' in p);
        expect(patch?.completed).toBe(true);
        expect(patch?.progressPercent).toBe(100);
    });
});

describe('generateCourseCertificate — the certificate says what the course is called', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setSession(LEARNER);
    });

    it('ignores the title the caller asked for', async () => {
        // THE test. These are numbered, stored and meant to be shown to
        // somebody else.
        setWorld({ progressCompleted: true, lessonsDone: ['l1', 'l2', 'l3'] });

        const r: any = await certify('Doctor of Everything');

        expect(r.success).toBe(true);
        const cert = allWrites().find((p) => p && 'certificateNumber' in p);
        expect(cert?.courseTitle).toBe('Export Documentation Fundamentals');
        expect(cert?.courseTitle).not.toBe('Doctor of Everything');
    });

    it('still refuses to certify an incomplete course', async () => {
        // The pre-existing check, which must survive the change.
        setWorld({ progressCompleted: false });

        const r: any = await certify();

        expect(r.success).toBe(false);
        expect(String(r.error)).toMatch(/not completed/i);
        expect(allWrites().filter((p) => p && 'certificateNumber' in p)).toEqual([]);
    });

    it('refuses when the course cannot be found, rather than inventing a title', async () => {
        setWorld({ progressCompleted: true, course: null });

        const r: any = await certify();

        expect(r.success).toBe(false);
        expect(allWrites().filter((p) => p && 'certificateNumber' in p)).toEqual([]);
    });

    it('records the holder from the session, not from anything supplied', async () => {
        setWorld({ progressCompleted: true });

        await certify();

        const cert = allWrites().find((p) => p && 'certificateNumber' in p);
        expect(cert?.userId).toBe(LEARNER);
    });
});
