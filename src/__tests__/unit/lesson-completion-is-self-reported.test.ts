/**
 * @jest-environment node
 */

/**
 *   #283 A "WATCH TO COMPLETE" SECURITY CONTROL THAT WAS ENTIRELY INSIDE A
 *        BLOCK COMMENT.
 *
 *        _completeLessonAction carried a 24-line gate under the banner
 *
 *            🔒 SECURITY FIX: Enforce "Watch to Complete" logic
 *
 *        and every line of the enforcement was commented out, with the note
 *        "(Bypassed to allow self-paced manual completion)" and three
 *        unresolved authoring questions left in it — "Allow if admin (for
 *        testing) ?? No, enforce for everyone for now." A reader saw a security
 *        banner and a check; neither ran. #314's shape exactly.
 *
 *        AND IT WAS NOT ENFORCED IN THE BROWSER EITHER, which corrects how this
 *        was first recorded. handleMarkComplete in the lesson page calls the
 *        action unconditionally with no watch check of any kind. The rule was
 *        enforced NOWHERE.
 *
 *   THE DECISION: SELF-PACED STAYS, AND THE EVIDENCE IS RECORDED.
 *
 *        Re-enabling the gate would refuse completion to every learner whose
 *        video-progress row is missing — every lesson completed before that
 *        pipeline existed, anyone on a connection too poor to stream, anyone
 *        whose heartbeat dropped. That is a lockout on a live platform, and the
 *        bypass was a deliberate product choice with a stated reason.
 *
 *        But a self-report presented as a verified fact is the defect #321
 *        fixed for certificate grades. So the completion now CARRIES the watch
 *        figure it was measured against. Nobody is refused; nothing is
 *        pretended.
 *
 *        It also stops the watch data being write-only. updateLessonProgress
 *        clamps it against a watch-rate anomaly (2.0x + 10s grace) so a client
 *        cannot fast-forward the counter — a real control whose output nothing
 *        read.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const ROOT = process.cwd();
const source = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf-8');

const PROGRESS = 'src/app/actions/academy/_ac_progress.ts';
const LESSON_PAGE = 'src/app/academy/[courseId]/lesson/[lessonId]/page.tsx';
const WRITER = 'src/app/actions/course-actions.ts';

const LEARNER = 'learner-1';
const COURSE = 'course-1';
const LESSON = 'lesson-1';

const courseDoc = {
    id: COURSE,
    modules: [{ id: 'm1', lessons: [{ id: LESSON, videoUrl: 'https://v/1' }] }],
};

/** Routes reads by document id, so the watch row can be varied independently. */
function setDocs(opts: { watched?: number | 'missing' | 'throws'; videoUrl?: string | null } = {}) {
    const course = opts.videoUrl === null
        ? { id: COURSE, modules: [{ id: 'm1', lessons: [{ id: LESSON }] }] }
        : courseDoc;

    const progress = { completedLessons: [], completedModules: [], _version: 0 };

    (global as any).mockFirestoreGet.mockImplementation((key: string) => {
        if (key === `${LEARNER}_${LESSON}`) {
            if (opts.watched === 'throws') return Promise.reject(new Error('read failed'));
            if (opts.watched === 'missing' || opts.watched === undefined) {
                return Promise.resolve({ exists: false, data: () => null });
            }
            return Promise.resolve({ exists: true, data: () => ({ progressPercent: opts.watched }) });
        }
        if (key === COURSE) return Promise.resolve({ exists: true, data: () => course });
        return Promise.resolve({ exists: true, data: () => progress });
    });
    (global as any).mockFirestoreTxGet.mockImplementation(() =>
        Promise.resolve({ exists: true, data: () => ({ ...progress }) }));
}

async function complete() {
    (global as any).mockRequireSession.mockImplementation(() => Promise.resolve({
        session: { user: { id: LEARNER, email: 'l@e.test', roles: ['user'] } }, error: null,
    }));
    const { completeLessonAction } = await import('@/app/actions/academy/_ac_progress');
    return completeLessonAction(LEARNER, COURSE, LESSON) as any;
}

/** What the transaction wrote onto the progress row. */
function writtenProgress(): any {
    const calls = (global as any).mockFirestoreTxSet.mock.calls as any[];
    return calls.length ? calls[calls.length - 1][1] : undefined;
}

beforeEach(() => {
    jest.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — nobody is refused, which is the half that stays', () => {
    it('A LEARNER WHO WATCHED NOTHING IS STILL ALLOWED TO COMPLETE', async () => {
        // THE test for the decision. The commented-out gate would have refused
        // this with "Please start watching the video to track your progress",
        // and so would every learner whose heartbeat never reached the server.
        setDocs({ watched: 'missing' });

        const res = await complete();

        expect(res.success).toBe(true);
    });

    it('and so is one who watched 4% of it', async () => {
        setDocs({ watched: 4 });

        expect((await complete()).success).toBe(true);
    });

    it('and a failed read of the watch row is not a refusal either', async () => {
        // #313. "We could not measure" is not "they watched none of it", and
        // neither is grounds for refusing a completion this platform does not
        // gate anyway.
        setDocs({ watched: 'throws' });

        expect((await complete()).success).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — but the completion carries what it was measured against', () => {
    it('RECORDS THE WATCH PERCENTAGE AT COMPLETION', async () => {
        // The other half. A self-report with the measurement attached is not
        // the same object as a bare claim — #321's move for certificate grades.
        setDocs({ watched: 4 });

        await complete();

        expect(writtenProgress()?.lessonWatchEvidence?.[LESSON]).toEqual({
            selfReported: true,
            watchedPercentAtCompletion: 4,
        });
    });

    it('and marks it self-reported with NO percentage when there is nothing to measure', async () => {
        // Distinct from "watched 0%". Collapsing the two is what made this look
        // enforced in the first place.
        setDocs({ watched: 'missing' });

        const evidence = writtenProgress.length >= 0 ? (await complete(), writtenProgress()) : null;

        expect(evidence?.lessonWatchEvidence?.[LESSON]).toEqual({ selfReported: true });
        expect(evidence?.lessonWatchEvidence?.[LESSON])
            .not.toHaveProperty('watchedPercentAtCompletion');
    });

    it('a lesson with no video records no percentage, rather than a misleading zero', async () => {
        setDocs({ videoUrl: null });

        await complete();

        expect(writtenProgress()?.lessonWatchEvidence?.[LESSON]).toEqual({ selfReported: true });
    });

    it('and an unreadable watch row records the completion without inventing a figure', async () => {
        setDocs({ watched: 'throws' });

        await complete();

        expect(writtenProgress()?.lessonWatchEvidence?.[LESSON]).toEqual({ selfReported: true });
    });

    it('the completion itself still happens — vacuity guard on all of the above', async () => {
        setDocs({ watched: 100 });

        await complete();

        expect(writtenProgress()?.completedLessons).toContain(LESSON);
        expect(writtenProgress()?.lessonWatchEvidence?.[LESSON].watchedPercentAtCompletion).toBe(100);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — the file no longer claims a control it does not perform', () => {
    it('THE COMMENTED-OUT GATE IS GONE, BANNER AND ALL', () => {
        const text = raw(PROGRESS);

        // The banner was the whole problem: a reader saw a lock and a rule.
        expect(text).not.toContain('🔒 SECURITY FIX: Enforce "Watch to Complete"');
        // And the dead enforcement, including the refusals it would have sent.
        expect(text).not.toContain('Please watch at least 90% to complete');
        expect(text).not.toContain('Please start watching the video to track your progress');
        // Including the unresolved authoring notes left inside it.
        expect(text).not.toContain('Allow if admin (for testing)');
    });

    it('and says plainly that completion is self-reported', () => {
        const text = raw(PROGRESS);

        expect(text).toContain('COMPLETION IS SELF-REPORTED');
        expect(text).toContain('WHAT WOULD BE NEEDED TO ENFORCE IT');
    });

    it('the browser does not gate it either, which the note records as a correction', () => {
        // Measured, not quoted. The lesson page calls the action with no watch
        // check, so "enforced only in the browser" was wrong in both halves.
        const page = source(LESSON_PAGE);
        const handler = page.slice(
            page.indexOf('async function handleMarkComplete'),
            page.indexOf('function getNextLesson'),
        );

        expect(handler.length).toBeGreaterThan(100);      // vacuity guard on the slice
        expect(handler).toContain('completeLessonAction(');
        expect(handler).not.toMatch(/progressPercent|watched|90/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#283 — the watch data it records is real, and no longer write-only', () => {
    it('the writer still clamps a client that fast-forwards the counter', () => {
        // The reason recording the figure is worth anything. If the number were
        // whatever the browser claimed, attaching it would be theatre.
        const writer = source(WRITER);

        expect(writer).toContain('maxSpeedMultiplier');
        expect(writer).toContain('maxAllowedIncrease');
        expect(writer).toMatch(/progressIncreaseSeconds > maxAllowedIncrease/);
    });

    it('and the completion path is now a reader of it', () => {
        const src = source(PROGRESS);

        expect(src).toContain('COLLECTIONS.LESSON_VIDEO_PROGRESS');
        expect(src).toContain('watchedPercentAtCompletion');
    });
});
