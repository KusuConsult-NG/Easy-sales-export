/**
 * @jest-environment node
 */

/**
 * course-actions.ts, the half that had never run (lines 20–206 uncovered):
 * lesson progress, enrolment and the read endpoints.
 *
 *   #236 getUserEnrolledCourses COMPUTED THE ANSWER AND RETURNED NULL.
 *
 *        const enrollments = serializeDocs(snapshot.docs);
 *        return { error: null, success: true as const, data: null };
 *
 *        The list was built on one line and thrown away on the next — success,
 *        with nothing in it, for every caller, always. And the catch branch
 *        returned `courses: []` while the success branch returned `data`, so
 *        even a caller prepared to read either shape got null from one and a
 *        different key from the other. The completion suite next door
 *        (course-completion.test.ts) records the same disease in its own
 *        fixture history: an answer that is computed but never delivered looks
 *        exactly like an empty database.
 *
 * The rest of this file executes behaviour that predates the audit and now has
 * a harness: the enrolment duplicate check, the progress composite ids, and
 * the watch-rate clamp's write path.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { installFakeDb, type FakeDbHandle } from '@/lib/testing/fake-db';
import { COLLECTIONS } from '@/lib/types/firestore';

jest.mock('@/lib/redis', () => ({
    getCached: async () => null, setCache: async () => undefined,
    deleteCache: async () => undefined, deleteCachePattern: async () => undefined, redis: null,
}));

jest.mock('@/lib/audit-log', () => ({
    recordAdminAction: (p: any) => (global as any).mockRecordAdminAction(p),
    createAdminAuditLog: jest.fn(async () => ({})),
    logAdminAction: jest.fn(async () => ({})),
}));

jest.mock('@/app/actions/notifications', () => ({
    createNotificationAction: jest.fn(async () => ({})),
}));

const mockRequireSession = jest.fn() as jest.Mock<any>;
jest.mock('@/lib/session-guard', () => ({
    requireSession: (...a: any[]) => mockRequireSession(...a),
}));

let store: FakeDbHandle;

const LEARNER = 'learner-1';
const ENROLLMENTS = COLLECTIONS.COURSE_ENROLLMENTS;
const PROGRESS = COLLECTIONS.COURSE_PROGRESS;
const VIDEO = COLLECTIONS.LESSON_VIDEO_PROGRESS;

const actions = async () => await import('@/app/actions/course-actions');

const actAs = (id: string | null) =>
    mockRequireSession.mockResolvedValue(
        id === null
            ? { session: null, error: { error: 'Unauthorized' } }
            : { session: { user: { id, email: `${id}@e.com`, name: 'A Learner', roles: [] } }, error: null });

beforeEach(() => {
    jest.clearAllMocks();
    store = installFakeDb();
    actAs(LEARNER);
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#236 — getUserEnrolledCourses returns what it found', () => {
    it('RETURNS THE ENROLMENTS, NOT NULL', async () => {
        store.seed(ENROLLMENTS, 'e1', {
            userId: LEARNER, courseId: 'c1', status: 'active',
            enrolledAt: '2026-01-01T00:00:00.000Z',
        });
        store.seed(ENROLLMENTS, 'e2', {
            userId: LEARNER, courseId: 'c2', status: 'active',
            enrolledAt: '2026-02-01T00:00:00.000Z',
        });

        const res = await (await actions()).getUserEnrolledCourses() as any;

        // Was: success with data: null, the computed list discarded.
        expect(res.success).toBe(true);
        expect(res.data.enrollments).toHaveLength(2);
        expect(res.data.enrollments.map((e: any) => e.courseId).sort()).toEqual(['c1', 'c2']);
    });

    it('and only ACTIVE enrolments, only THIS learner\'s', async () => {
        store.seed(ENROLLMENTS, 'mine-active', { userId: LEARNER, courseId: 'c1', status: 'active' });
        store.seed(ENROLLMENTS, 'mine-dropped', { userId: LEARNER, courseId: 'c2', status: 'dropped' });
        store.seed(ENROLLMENTS, 'theirs', { userId: 'someone-else', courseId: 'c3', status: 'active' });

        const res = await (await actions()).getUserEnrolledCourses() as any;

        expect(res.data.enrollments).toHaveLength(1);
        expect(res.data.enrollments[0].courseId).toBe('c1');
    });

    it('an empty answer is an empty list, not null', async () => {
        const res = await (await actions()).getUserEnrolledCourses() as any;
        expect(res.success).toBe(true);
        expect(res.data.enrollments).toEqual([]);
    });

    it('refuses a caller with no session', async () => {
        actAs(null);
        expect(await (await actions()).getUserEnrolledCourses()).toMatchObject({ success: false });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('enrollInCourse', () => {
    it('creates the enrolment and a zeroed progress record', async () => {
        const res = await (await actions()).enrollInCourse({ courseId: 'c1' } as any) as any;

        expect(res.success).toBe(true);
        expect(store.size(ENROLLMENTS)).toBe(1);
        const progress = store.get(PROGRESS, `${LEARNER}_c1`);
        expect(progress).toBeDefined();
        expect(progress!.progressPercent).toBe(0);
        expect(progress!.completed).toBe(false);
    });

    it('refuses a second enrolment in the same course', async () => {
        await (await actions()).enrollInCourse({ courseId: 'c1' } as any);

        const res = await (await actions()).enrollInCourse({ courseId: 'c1' } as any) as any;

        expect(res.success).toBe(false);
        expect(res.error).toMatch(/already enrolled/i);
        expect(store.size(ENROLLMENTS)).toBe(1);
    });

    it('rejects a courseId the schema refuses', async () => {
        const res = await (await actions()).enrollInCourse({ courseId: '' } as any) as any;
        expect(res.success).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('lesson progress round-trips through its composite id', () => {
    const heartbeat = async (over: Record<string, unknown> = {}) =>
        (await actions()).updateLessonProgress({
            courseId: 'c1', lessonId: 'l-100', progressPercent: 40, lastWatchedSecond: 120, ...over,
        } as any);

    it('writes under userId_lessonId and reads back the same way', async () => {
        expect(await heartbeat()).toMatchObject({ success: true });

        expect(store.get(VIDEO, `${LEARNER}_l-100`)).toMatchObject({
            userId: LEARNER, courseId: 'c1', lessonId: 'l-100',
            progressPercent: 40, lastWatchedSecond: 120, completed: false,
        });

        const read = await (await actions()).getLessonProgress('l-100') as any;
        expect(read.data.progress).toMatchObject({ progressPercent: 40, lastWatchedSecond: 120 });
    });

    it('marks the lesson completed at 95 percent', async () => {
        await heartbeat({ progressPercent: 96 });
        expect(store.get(VIDEO, `${LEARNER}_l-100`)?.completed).toBe(true);
    });

    it('getCourseProgress reads the composite course record', async () => {
        store.seed(PROGRESS, `${LEARNER}_c1`, {
            userId: LEARNER, courseId: 'c1',
            progressPercent: 55, lastWatchedSecond: 0, completed: false, completedAt: null,
        });

        const res = await (await actions()).getCourseProgress('c1') as any;
        expect(res.data.progress.progressPercent).toBe(55);
    });

    it('and falls back to completionPercentage for legacy rows', async () => {
        // Two spellings exist; the reader must serve rows written under either.
        store.seed(PROGRESS, `${LEARNER}_c1`, {
            userId: LEARNER, courseId: 'c1',
            completionPercentage: 70, completed: false, completedAt: null,
        });

        const res = await (await actions()).getCourseProgress('c1') as any;
        expect(res.data.progress.progressPercent).toBe(70);
    });

    it('a missing record is success with null, not an error', async () => {
        const res = await (await actions()).getCourseProgress('none') as any;
        expect(res).toMatchObject({ success: true, data: null });
    });
});
