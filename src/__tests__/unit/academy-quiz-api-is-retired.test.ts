/**
 * @jest-environment node
 */

/**
 *   #386 A SECOND, COMPLETE, ENTIRELY EMPTY QUIZ SYSTEM — AND A CORRECTION TO
 *        WHAT #384 RECORDED ABOUT IT.
 *
 *        The academy has two quiz implementations. The live one stores a quiz on
 *        the course document at `course.modules[].quiz`; saveQuizAction writes
 *        it, the learner screen reads it, _completeModuleAction grades against
 *        it. The other stores quizzes in COLLECTIONS.QUIZZES and attempts in
 *        COLLECTIONS.QUIZ_ATTEMPTS, behind three API routes.
 *
 *        #384 compared the two while deciding whether to retire the second
 *        pair's screens, found that its editor sets five settings the live one
 *        does not and that only its submit route enforces maxAttempts, and
 *        concluded that "the unwired pair is the COMPLETE, enforcing pair".
 *
 *        THAT WAS HALF RIGHT, AND THE HALF THAT WAS WRONG IS THE ONE THAT
 *        MATTERS. COLLECTIONS.QUIZZES has exactly ONE writer —
 *        /api/admin/academy/quiz/create — and that route has exactly one caller:
 *        an admin screen with no way in. So the store is empty and always has
 *        been, and every one of those five settings, including the attempt
 *        limit, has only ever been enforced over nothing.
 *
 *        The true statement is that NEITHER subsystem has ever applied an
 *        attempt limit to a real quiz: the live one has no such code, and the
 *        other has no data.
 *
 *   WHAT THIS SUITE IS FOR
 *   ----------------------
 *   Three things, in order of how easily each could rot:
 *
 *   1. the premise — one writer, no reader outside the retired pair. If a second
 *      writer of QUIZZES ever appears, the retirement is wrong and this fails.
 *   2. the refusals, including that they come BEFORE a session is read, and that
 *      the flag needs the exact word.
 *   3. the one setting that was carried across to the live path, and the bound
 *      on it — a "use server" parameter is whatever the caller sent.
 */

import { describe, it, expect, beforeEach, afterAll, jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { stripComments } from '@/lib/testing/strip-comments';
import {
    isAcademyQuizApiEnabled,
    ACADEMY_QUIZ_API_ENV,
    ACADEMY_QUIZ_API_ENABLED_VALUE,
    ACADEMY_QUIZ_API_REFUSAL,
} from '@/lib/academy-quiz-api';
import { DEFAULT_QUIZ_PASSING_SCORE } from '@/lib/academy-grading';

const ROOT = process.cwd();
const code = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf-8'), { label: rel });

const CREATE = 'src/app/api/admin/academy/quiz/create/route.ts';
const LIST = 'src/app/api/academy/quiz/[courseId]/route.ts';
const SUBMIT = 'src/app/api/academy/quiz/submit/route.ts';
const ROUTES = [CREATE, LIST, SUBMIT];

const ACTION = 'src/app/actions/academy/_ac_quiz.ts';
const EDITOR = 'src/app/admin/academy/[courseId]/quiz/[quizId]/page.tsx';
const PROGRESS = 'src/app/actions/academy/_ac_progress.ts';

const originalFlag = process.env[ACADEMY_QUIZ_API_ENV];
beforeEach(() => { delete process.env[ACADEMY_QUIZ_API_ENV]; jest.clearAllMocks(); });
afterAll(() => {
    if (originalFlag === undefined) delete process.env[ACADEMY_QUIZ_API_ENV];
    else process.env[ACADEMY_QUIZ_API_ENV] = originalFlag;
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — the premise: the second store has one writer and no data', () => {
    /** Every non-test reference to a collection constant, with its file. */
    function refs(constant: string): string[] {
        return execSync(`grep -rn "COLLECTIONS.${constant}" src || true`, { encoding: 'utf-8', cwd: ROOT })
            .split('\n')
            .filter((l) => l.trim() && !l.includes('__tests__'))
            .filter((line) => {
                const [rel, lineno] = [line.split(':')[0], Number(line.split(':')[1])];
                if (!rel || !Number.isFinite(lineno)) return false;
                // Comments name these constants constantly — this file's own
                // header does. Re-read each hit from the stripped source.
                return (code(rel).split('\n')[lineno - 1] ?? '').includes(`COLLECTIONS.${constant}`);
            });
    }

    it('THE ONLY WRITER OF COLLECTIONS.QUIZZES IS THE RETIRED CREATE ROUTE', () => {
        const writers = refs('QUIZZES').filter((l) => /\.doc\(\)|\.add\(|\.set\(/.test(l));

        expect(writers.map((l) => l.split(':')[0])).toEqual([CREATE]);
    });

    it('and every reader of it is inside the retired subsystem too', () => {
        const files = [...new Set(refs('QUIZZES').map((l) => l.split(':')[0]))].sort();

        expect(files).toEqual([...ROUTES].sort());
    });

    it('and QUIZ_ATTEMPTS is touched by the retired submit route and nothing else', () => {
        const files = [...new Set(refs('QUIZ_ATTEMPTS').map((l) => l.split(':')[0]))];

        expect(files).toEqual([SUBMIT]);
    });

    it('the detector is not inert — it finds the LIVE store, which has many touchers', () => {
        // Positive control. Three of the four assertions above are "exactly this
        // one file", and a grep that had stopped working would satisfy none of
        // them — but the two `toEqual([])`-shaped risks below need a control
        // that proves refs() returns anything at all.
        expect(refs('ACADEMY_COURSES').length).toBeGreaterThan(3);
    });

    it('AND THE LIVE GRADING PATH READS THE COURSE MODULE, NOT EITHER COLLECTION', () => {
        // The fact that makes the retirement safe: no learner is graded from
        // QUIZZES, so switching it off changes nothing a learner sees.
        const progress = code(PROGRESS);

        expect(progress).toContain('courseModule?.quiz?.questions');
        expect(progress).not.toContain('COLLECTIONS.QUIZZES');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — the flag needs the exact word', () => {
    it('IS OFF WHEN UNSET', () => {
        expect(isAcademyQuizApiEnabled()).toBe(false);
    });

    it('and off for every truthy value that is not the word', () => {
        for (const v of ['1', 'true', 'TRUE', 'yes', 'on', 'Enabled', ' enabled', 'enabled ']) {
            process.env[ACADEMY_QUIZ_API_ENV] = v;
            expect({ v, on: isAcademyQuizApiEnabled() }).toEqual({ v, on: false });
        }
    });

    it('and on for the word itself — vacuity guard', () => {
        process.env[ACADEMY_QUIZ_API_ENV] = ACADEMY_QUIZ_API_ENABLED_VALUE;

        expect(isAcademyQuizApiEnabled()).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — all three routes refuse, before they read a session', () => {
    it('EVERY ROUTE CHECKS THE FLAG', () => {
        for (const rel of ROUTES) {
            expect({ rel, guarded: code(rel).includes('isAcademyQuizApiEnabled()') })
                .toEqual({ rel, guarded: true });
        }
    });

    it('AND THE CHECK COMES BEFORE requireSession — which is the point', () => {
        // A refusal after the session read is still a refusal, but it means the
        // retired endpoint is doing work on behalf of a caller it is about to
        // turn away. #379 put the same assertion on the offline checkouts.
        for (const rel of ROUTES) {
            const src = code(rel);
            const flagAt = src.indexOf('isAcademyQuizApiEnabled()');
            const sessionAt = src.indexOf('requireSession()');

            expect({ rel, ordered: flagAt > -1 && sessionAt > -1 && flagAt < sessionAt })
                .toEqual({ rel, ordered: true });
        }
    });

    it('and each says where quizzes actually live', () => {
        // A refusal that does not name the live path sends whoever meets it
        // looking in the wrong place — #379's reason for a per-case message.
        expect(ACADEMY_QUIZ_API_REFUSAL).toContain('/admin/academy/[courseId]/quiz/[quizId]');
        expect(ACADEMY_QUIZ_API_REFUSAL).toContain('/academy/[courseId]/quiz/[moduleId]');

        for (const rel of ROUTES) {
            expect({ rel, names: code(rel).includes('ACADEMY_QUIZ_API_REFUSAL') })
                .toEqual({ rel, names: true });
        }
    });

    it('and the implementations are still there, whole — nothing was deleted', () => {
        // The #379 pattern: retired, not removed. If somebody migrates the
        // quizzes and turns the flag on, this has to still work.
        expect(code(CREATE)).toContain('COLLECTIONS.QUIZZES');
        expect(code(SUBMIT)).toContain('maxAttempts');
        expect(code(SUBMIT)).toContain('COLLECTIONS.QUIZ_ATTEMPTS');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — the two screens over that store are retired', () => {
    const SCREENS: Array<[string, string]> = [
        ['src/app/academy/courses/[courseId]/quiz/page.tsx', '/academy/'],
        ['src/app/admin/academy/courses/[courseId]/quiz/page.tsx', '/admin/academy/'],
    ];

    it('BOTH REDIRECT TO THE LIVE SCREEN', () => {
        for (const [rel, target] of SCREENS) {
            const src = code(rel);

            expect({ rel, redirects: src.includes('redirect(') && src.includes(target) })
                .toEqual({ rel, redirects: true });
        }
    });

    it('and neither still fetches the retired API — vacuity guard', () => {
        for (const [rel] of SCREENS) {
            expect({ rel, fetches: code(rel).includes('/api/academy/quiz') || code(rel).includes('/api/admin/academy/quiz') })
                .toEqual({ rel, fetches: false });
        }
    });

    it('and each records why, including that the store was empty', () => {
        for (const [rel] of SCREENS) {
            const raw = readFileSync(join(ROOT, rel), 'utf-8');

            expect({ rel, recorded: raw.includes('#386 RETIRED') && raw.includes('COLLECTIONS.QUIZZES') })
                .toEqual({ rel, recorded: true });
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — the one setting carried across to the live path', () => {
    it('THE LIVE EDITOR CAN NOW SET A PASS MARK', () => {
        // The live gap the comparison exposed. _ac_progress grades at
        // `passingScore ?? 95` and this editor had no field for it, so every
        // quiz in the product was graded at 95% and no admin could change it.
        const editor = code(EDITOR);

        expect(editor).toContain('setPassingScore');
        expect(editor).toContain('aria-label="Passing score percentage"');
        expect(editor).toMatch(/saveQuizAction\([^)]*passingScore\)/);
    });

    it('and the action carries it onto the module the grader reads', () => {
        const action = code(ACTION);

        expect(action).toContain('passingScore?: number');
        expect(action).toContain('passingScore: checkedPassingScore ??');
    });

    it('A PASS MARK OUTSIDE 0–100 IS REFUSED, NOT CLAMPED', () => {
        // It is a "use server" parameter, so it is whatever the caller sent.
        // Above 100 makes a quiz unpassable; below 0 makes it unfailable.
        // Refused rather than clamped for lib/system-settings' stated reason: a
        // silently clamped figure is a wrong setting reported as a saved one.
        const action = code(ACTION);

        expect(action).toContain('value < 0 || value > 100');
        expect(action).toContain('Passing score must be between 0 and 100');
    });

    it('and an editor that sends nothing leaves the stored mark alone', () => {
        // The reason the parameter is optional. A caller that does not know
        // about pass marks must not silently move an existing quiz to the
        // default.
        const action = code(ACTION);
        // lastIndexOf, not indexOf: the FIRST occurrence is the editor's own
        // mirror document in ACADEMY_QUIZZES, which has no `existing` to fall
        // back to. The one that matters is the write onto the course module,
        // which is what the grader reads.
        const fallback = action.slice(action.lastIndexOf('passingScore: checkedPassingScore ??'));

        expect(fallback.slice(0, 300)).toContain('existing.passingScore');
        expect(fallback.slice(0, 300)).toContain('DEFAULT_QUIZ_PASSING_SCORE');
    });

    it('and the default is the number the grader has always used', () => {
        // Not a new figure: changing it would re-grade every existing quiz.
        expect(DEFAULT_QUIZ_PASSING_SCORE).toBe(95);
        expect(code(PROGRESS)).toContain('passingScore ?? 95');
    });

    it('the shared default is NOT exported from a "use server" module — #382', () => {
        // It is needed by both the action and the browser editor, and a value
        // exported from an action file fails the production build outright.
        expect(code('src/lib/academy-grading.ts')).toContain('export const DEFAULT_QUIZ_PASSING_SCORE');
        expect(code(ACTION)).not.toContain('export const DEFAULT_QUIZ_PASSING_SCORE');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#386 — what was deliberately NOT carried across', () => {
    it('THE LIVE PATH STILL IMPOSES NO ATTEMPT LIMIT, AND SAYS SO', () => {
        // Not an oversight. The live learner screen announces no limit — it
        // mentions attempts nowhere — so adding one would change what a learner
        // is allowed to do rather than repair a broken promise. Stated in
        // lib/academy-quiz-api.ts rather than left implied.
        const learner = code('src/app/academy/[courseId]/quiz/[moduleId]/page.tsx');

        expect(learner).not.toMatch(/attempt/i);
        // Matched on a phrase that does not straddle the comment's line wrap.
        expect(readFileSync(join(ROOT, 'src/lib/academy-quiz-api.ts'), 'utf-8'))
            .toContain('learner may retake a module quiz without limit');
    });

    it('and the correction to #384 is recorded where the decision lives', () => {
        // The claim "the unwired pair is the COMPLETE, enforcing pair" was made
        // on an incomplete measurement. Saying so beats quietly replacing it.
        const record = readFileSync(join(ROOT, 'src/lib/academy-quiz-api.ts'), 'utf-8');

        expect(record).toContain('THIS CORRECTS WHAT #384 RECORDED');
        expect(record).toContain('NEITHER subsystem has ever applied an attempt limit');
    });
});
