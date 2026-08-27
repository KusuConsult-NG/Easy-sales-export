/**
 * @jest-environment node
 */

/**
 * The certificate printed whatever the learner typed — #321.
 *
 * /api/academy/certificate/generate built its grade like this:
 *
 *     const { courseId, quizScore } = await request.json();
 *     ...
 *     grade: quizScore || progressData.quizScores?.[0]?.bestScore,
 *
 * `quizScore` is request BODY. Any learner who had completed a course could
 * POST { courseId, quizScore: 100 } and be issued a certificate saying 100.
 * Nothing checked it was a number, in range, or anywhere near the score the
 * platform had recorded. #285's shape — typing a value marked it verified — on
 * a document whose entire purpose is to be shown to somebody else as proof.
 *
 * The fallback could never fire either. quiz/submit writes
 * `[`quizScores.${moduleId}`]: scorePercentage` and academy-actions.ts types it
 * `Record<string, number>` — a map keyed by MODULE ID holding plain numbers. So
 * `[0]` indexes a key no module has and `.bestScore` reads a property off a
 * number. `bestScore` appears nowhere else in the codebase. There was no path
 * on which the platform's own score reached the certificate: #89's dead-key
 * shape underneath #43's caller-controlled one.
 *
 * The route also minted an auto-id per call while checking for duplicates on a
 * field written afterwards with no lock, so two concurrent POSTs produced two
 * certificates for one completion and orphaned the first.
 *
 * The endpoint has no caller — lib/academy-certificate.ts records that. It is
 * still a live authenticated POST endpoint, which is exactly what made #279
 * worth fixing.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { COLLECTIONS } from '@/lib/types/firestore';
import { courseGradeFromQuizScores } from '@/lib/academy-grading';

/** collection -> docId -> data */
let DOCS: Record<string, Record<string, any>> = {};
/** Every write, in order. */
let WRITES: Array<{ op: 'set' | 'update'; collection: string; id: string; data: any }> = [];

jest.mock('@/lib/supabase-db', () => ({
    supabaseDb: {
        collection: (name: string) => ({
            doc: (id?: string) => {
                const docId = id ?? `auto-${WRITES.length}`;
                return {
                    id: docId,
                    get: async () => ({
                        id: docId,
                        exists: Boolean(DOCS[name]?.[docId]),
                        data: () => DOCS[name]?.[docId],
                    }),
                    set: async (data: any) => {
                        WRITES.push({ op: 'set', collection: name, id: docId, data });
                        (DOCS[name] ||= {})[docId] = { ...data };
                    },
                    update: async (data: any) => {
                        WRITES.push({ op: 'update', collection: name, id: docId, data });
                        (DOCS[name] ||= {})[docId] = { ...(DOCS[name]?.[docId] ?? {}), ...data };
                    },
                };
            },
        }),
    },
}));

const mockSession: { session: any } = { session: null };
jest.mock('@/lib/session-guard', () => ({
    requireSession: async () => mockSession,
}));

function post(body: Record<string, unknown>) {
    return { json: async () => body } as any;
}

async function callRoute(body: Record<string, unknown>) {
    const { POST } = await import('@/app/api/academy/certificate/generate/route');
    const res: any = await POST(post(body));
    return { status: res.status ?? 200, body: await res.json() };
}

/** The certificate row the route wrote, if any. */
function issued() {
    return WRITES.find((w) => w.collection === COLLECTIONS.CERTIFICATES);
}

beforeEach(() => {
    jest.resetModules();
    // resetModules does NOT clear call history; both are needed.
    jest.clearAllMocks();
    DOCS = {};
    WRITES = [];
    mockSession.session = { user: { id: 'learner-1', email: 'l@x.com' } };

    DOCS[COLLECTIONS.USERS] = { 'learner-1': { name: 'Ada Lovelace', email: 'l@x.com' } };
    DOCS[COLLECTIONS.COURSE_PROGRESS] = {
        'learner-1_course-9': {
            userId: 'learner-1',
            courseId: 'course-9',
            completed: true,
            completionPercentage: 100,
            completedAt: '2026-03-01T00:00:00.000Z',
            // The real shape: module id -> percentage.
            quizScores: { 'mod-a': 80, 'mod-b': 60 },
        },
    };
    DOCS[COLLECTIONS.ACADEMY_COURSES] = { 'course-9': { title: 'Export Fundamentals' } };
});

describe('the grade comes from the record, not the request', () => {
    it('THE test: a claimed 100 does not reach the certificate', async () => {
        // The exploit, executed. Before the fix this issued a certificate
        // reading 100 to a learner whose recorded scores average 70.
        const { body } = await callRoute({ courseId: 'course-9', quizScore: 100 });

        expect(body.success).toBe(true);
        expect(issued()!.data.grade).toBe(70);
    });

    it('a claimed grade of any shape is ignored, not coerced', async () => {
        // There was no type check either, so a string went on verbatim.
        await callRoute({ courseId: 'course-9', quizScore: 'Distinction' });

        expect(issued()!.data.grade).toBe(70);
    });

    it('the honest request gets the same answer as the dishonest one', async () => {
        // The property that makes the fix a fix: the body cannot move the
        // number in either direction.
        await callRoute({ courseId: 'course-9' });
        const honest = issued()!.data.grade;

        WRITES = [];
        DOCS[COLLECTIONS.CERTIFICATES] = {};
        delete DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].certificateId;

        await callRoute({ courseId: 'course-9', quizScore: 3 });

        expect(issued()!.data.grade).toBe(honest);
    });

    it('the route no longer reads quizScore from the body at all', async () => {
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const rel = 'src/app/api/academy/certificate/generate/route.ts';
        const src = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

        // Comments removed first: the fix's own explanation quotes the old
        // destructure to say what was wrong with it, and a raw check fails on
        // the correction. Fourth gate in this audit to hit that.
        //
        // And the check is on the DESTRUCTURE, not on the bare word: the
        // replacement calls courseGradeFromQuizScores(progressData.quizScores),
        // and "quizScores" contains "quizScore", so `not.toContain` on the
        // substring failed against correct code. What must be absent is the
        // body ever yielding a grade.
        expect(src).toContain('const { courseId } = await request.json();');
        expect(src).not.toMatch(/\bquizScore\b/);
        expect(src).toContain('courseGradeFromQuizScores(progressData.quizScores)');
    });

    it('an ungraded completion records no grade rather than a zero', async () => {
        // null, not 0. A 0 on a certificate reads as a failing mark; "not
        // graded" is the truth and is a different statement.
        DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].quizScores = {};

        await callRoute({ courseId: 'course-9' });

        expect(issued()!.data.grade).toBeNull();
    });
});

describe('the grade helper itself', () => {
    it('averages the per-module percentages and rounds', () => {
        expect(courseGradeFromQuizScores({ a: 80, b: 60 })).toBe(70);
        expect(courseGradeFromQuizScores({ a: 80, b: 61 })).toBe(71); // 70.5 -> 71
        expect(courseGradeFromQuizScores({ a: 100 })).toBe(100);
    });

    it('returns null when nothing has been graded', () => {
        expect(courseGradeFromQuizScores({})).toBeNull();
        expect(courseGradeFromQuizScores(null)).toBeNull();
        expect(courseGradeFromQuizScores(undefined)).toBeNull();
    });

    it('drops non-numeric entries rather than producing NaN', () => {
        // A legacy row holding a string is the case that would otherwise print
        // "NaN" on somebody's credential.
        expect(courseGradeFromQuizScores({ a: 80, b: 'x' })).toBe(80);
        expect(courseGradeFromQuizScores({ a: 'x' })).toBeNull();
    });

    it('a zero score counts, and is not mistaken for absent', () => {
        expect(courseGradeFromQuizScores({ a: 0, b: 100 })).toBe(50);
        expect(courseGradeFromQuizScores({ a: 0 })).toBe(0);
    });

    it('reads the shape quiz/submit actually writes', async () => {
        // The dead-key half of the defect, pinned at both ends. quiz/submit
        // writes `quizScores.${moduleId}`, and the old read looked for
        // `[0].bestScore` — a key no module has, and a property numbers do not
        // have. If the writer's shape ever changes, this fails here rather than
        // silently emptying every certificate's grade again.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const rel = 'src/app/api/academy/quiz/submit/route.ts';
        const writer = stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel });

        expect(writer).toContain('[`quizScores.${moduleId}`]: scorePercentage');
    });

    it('bestScore is written by nothing, anywhere', async () => {
        const { execSync } = await import('child_process');

        // Against STRIPPED source. Both the route's fix and the grading
        // helper's doc name the dead field in order to explain it, so a raw
        // grep counts the correction as the defect — the same trap the
        // assertion above hit, and the third time in this file alone.
        const { readFileSync } = await import('fs');
        const { join } = await import('path');
        const { stripComments } = await import('@/lib/testing/strip-comments');

        const files = execSync('grep -rl "bestScore" src || true', {
            encoding: 'utf-8', cwd: process.cwd(),
        }).split('\n').filter((f) => f.trim() && !f.includes('__tests__'));

        const inCode = files.filter((rel) =>
            stripComments(readFileSync(join(process.cwd(), rel), 'utf-8'), { label: rel })
                .includes('bestScore'),
        );

        expect(inCode).toEqual([]);
    });
});

describe('one completion is one certificate', () => {
    it('a second call cannot mint a second certificate', async () => {
        // The lockless window: the duplicate check reads certificateId, which
        // is written after the certificate. Two concurrent calls both passed
        // it. A deterministic id makes the second write idempotent.
        const first = await callRoute({ courseId: 'course-9' });

        WRITES = [];
        // Simulate the racing caller: the progress record has NOT yet been
        // stamped, which is precisely the window that produced two rows.
        delete DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].certificateId;

        const second = await callRoute({ courseId: 'course-9' });

        expect(second.body.certificateId).toBe(first.body.certificateId);
        expect(Object.keys(DOCS[COLLECTIONS.CERTIFICATES])).toHaveLength(1);
    });

    it('the id is keyed on the learner and the course', async () => {
        await callRoute({ courseId: 'course-9' });

        expect(issued()!.id).toBe('learner-1_course-9');
    });

    it('a different learner on the same course gets their own', async () => {
        // The vacuity guard on the id scheme: keying it too coarsely would
        // satisfy the test above by giving everybody one certificate.
        await callRoute({ courseId: 'course-9' });

        mockSession.session = { user: { id: 'learner-2', email: 'm@x.com' } };
        DOCS[COLLECTIONS.USERS]['learner-2'] = { name: 'Grace Hopper' };
        DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-2_course-9'] = {
            userId: 'learner-2', courseId: 'course-9',
            completed: true, completionPercentage: 100,
            quizScores: { 'mod-a': 90 },
        };

        await callRoute({ courseId: 'course-9' });

        expect(Object.keys(DOCS[COLLECTIONS.CERTIFICATES]).sort())
            .toEqual(['learner-1_course-9', 'learner-2_course-9']);
    });
});

describe('the checks that were already right stay right', () => {
    it('an unauthenticated caller is refused', async () => {
        mockSession.session = null;

        const { status, body } = await callRoute({ courseId: 'course-9' });

        expect(status).toBe(401);
        expect(body.success).toBe(false);
        expect(issued()).toBeUndefined();
    });

    it('the certificate is issued to the SESSION, never to a claimed user', async () => {
        // The one thing this endpoint always got right, pinned so it stays
        // that way: userId comes from the session, so a body naming somebody
        // else cannot issue in their name.
        await callRoute({ courseId: 'course-9', userId: 'someone-else' });

        expect(issued()!.data.userId).toBe('learner-1');
    });

    it('an incomplete course is refused', async () => {
        DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].completed = false;
        DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].completionPercentage = 40;

        const { status, body } = await callRoute({ courseId: 'course-9' });

        expect(status).toBe(400);
        expect(body.message).toBe('Course not yet completed');
        expect(issued()).toBeUndefined();
    });

    it('a course the learner has no progress on is refused', async () => {
        const { status } = await callRoute({ courseId: 'course-never-taken' });

        expect(status).toBe(404);
        expect(issued()).toBeUndefined();
    });

    it('an already-issued certificate is returned, not reissued', async () => {
        DOCS[COLLECTIONS.COURSE_PROGRESS]['learner-1_course-9'].certificateId = 'existing-cert';

        const { body } = await callRoute({ courseId: 'course-9' });

        expect(body.certificateId).toBe('existing-cert');
        expect(issued()).toBeUndefined();
    });

    it('the row is marked as an academy-issued certificate', async () => {
        // recordType separates this from a file a user attached to their own
        // profile — only this kind may be publicly verified or counted as
        // earned. See lib/certificate-kind.
        const { ACADEMY_CERTIFICATE } = await import('@/lib/certificate-kind');

        await callRoute({ courseId: 'course-9' });

        expect(issued()!.data.recordType).toBe(ACADEMY_CERTIFICATE);
    });
});
