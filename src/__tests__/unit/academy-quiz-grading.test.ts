/**
 * @jest-environment node
 */

/**
 * The platform had two quiz paths and graded correctly on one of them.
 *
 * THE PATH THAT WORKED
 * --------------------
 * /api/academy/quiz/[courseId] strips isCorrect and correctAnswer before
 * sending a quiz, and /api/academy/quiz/submit re-reads the quiz from the
 * database and computes the score there. That is the right shape and it was
 * already in the codebase.
 *
 * THE PATH THAT DID NOT
 * ---------------------
 * Every layer of the server-action path failed independently:
 *
 *   1. getCourseByIdAction returned serializeDoc(courseDoc) — the whole course,
 *      including modules[].quiz.questions[].correctAnswer. The answer key was
 *      delivered to every learner's browser.
 *
 *   2. QuizComponent.tsx and academy/[courseId]/quiz/[moduleId]/page.tsx both
 *      graded client-side against that key:
 *
 *          if (answers[q.id] === q.correctAnswer) correct++;
 *          const calculatedScore = Math.round((correct / quiz.questions.length) * 100);
 *
 *   3. submitQuizScoreAction took `score: number` and stored it, marking the
 *      module complete when it cleared passingScore. It is a "use server"
 *      export, so it is a reachable endpoint whatever the UI does:
 *
 *          submitQuizScoreAction(myId, courseId, moduleId, 100)
 *
 *      was a passing grade on any module of any course, with no quiz involved.
 *      That feeds progress.completedModules, the 70/30 weighted overallProgress,
 *      and completedAt.
 *
 * Any one of the three would have been enough on its own. The fix is all three:
 * learners get the course without the key, both screens send answers, and the
 * action grades from the stored questions inside the transaction that reads
 * them.
 *
 * Admins still receive the key — /admin/academy/[courseId] is the course editor
 * and cannot edit questions it cannot see. Same shape as the email masking in
 * messages.ts.
 *
 * TWO MORE, ON THE ROUTE PATH
 * ---------------------------
 * courseId came from the request body. The score was computed from the quiz at
 * `quizId` and the progress written to `${userId}_${courseId}` — nothing
 * compared them, so a pass on any quiz could be recorded against any course,
 * including the grade /api/academy/certificate/generate reads back onto the
 * certificate.
 *
 * maxAttempts was decorative. The admin editor collects it and defaults it to
 * 3, the learner screen prints "attempt N of {quiz.maxAttempts}", the fetch
 * route returns a hardcoded `attemptNumber: 1`, and no server code read either.
 * QUIZ_ATTEMPTS was written by one file and read by none. So attempts were
 * unlimited and the recorded number was whatever the client sent.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { gradeStoredQuiz, gradeModuleQuiz, stripAnswerKey } from '@/lib/academy-grading';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function codeOnly(src: string): string {
    return src
        .split('\n')
        .filter((l) => {
            const t = l.trim();
            return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('{/*');
        })
        .join('\n');
}

const MODULE_QUIZ = [
    { id: 'q1', options: ['a', 'b'], correctAnswer: 0 },
    { id: 'q2', options: ['a', 'b'], correctAnswer: 1 },
    { id: 'q3', options: ['a', 'b'], correctAnswer: 1 },
    { id: 'q4', options: ['a', 'b'], correctAnswer: 0 },
];

const STORED_QUIZ = [
    { id: 'q1', type: 'mcq-single', points: 10, answers: [{ id: 'a' }, { id: 'b', isCorrect: true }] },
    { id: 'q2', type: 'mcq-multiple', points: 10, answers: [{ id: 'a', isCorrect: true }, { id: 'b' }, { id: 'c', isCorrect: true }] },
    { id: 'q3', type: 'true-false', points: 10, answers: [{ id: 't', isCorrect: true }, { id: 'f' }] },
];

describe('grading a module quiz', () => {
    it('scores from the stored answers', () => {
        expect(gradeModuleQuiz(MODULE_QUIZ, { q1: 0, q2: 1, q3: 1, q4: 0 }, 80))
            .toMatchObject({ scorePercentage: 100, passed: true });

        expect(gradeModuleQuiz(MODULE_QUIZ, { q1: 0, q2: 1, q3: 0, q4: 1 }, 80))
            .toMatchObject({ scorePercentage: 50, passed: false });
    });

    it('gives nothing for answers that were not sent', () => {
        expect(gradeModuleQuiz(MODULE_QUIZ, {}, 80).scorePercentage).toBe(0);
    });

    it('does not award a question whose answer was never set', () => {
        // undefined === undefined would otherwise be a free point on any
        // question an author left incomplete — and a submission that omits it
        // would score higher than one that answers.
        const broken = [{ id: 'q1', options: ['a', 'b'] }];

        expect(gradeModuleQuiz(broken, {}, 50).scorePercentage).toBe(0);
        expect(gradeModuleQuiz(broken, { q1: 0 }, 50).scorePercentage).toBe(0);
    });

    it('an empty quiz is not a pass', () => {
        expect(gradeModuleQuiz([], { q1: 0 }, 50)).toMatchObject({ scorePercentage: 0, passed: false });
    });
});

describe('grading a stored quiz', () => {
    it('handles all three question types', () => {
        expect(gradeStoredQuiz(STORED_QUIZ, { q1: 'b', q2: ['a', 'c'], q3: 't' }, 80))
            .toMatchObject({ earnedPoints: 30, totalPoints: 30, scorePercentage: 100, passed: true });
    });

    it('requires every correct option for mcq-multiple', () => {
        // A partial selection is not a pass on that question.
        expect(gradeStoredQuiz(STORED_QUIZ, { q1: 'b', q2: ['a'], q3: 't' }, 80).scorePercentage).toBe(67);
    });

    it('is not confused by the order of a multiple answer', () => {
        expect(gradeStoredQuiz(STORED_QUIZ, { q1: 'b', q2: ['c', 'a'], q3: 't' }, 80).scorePercentage).toBe(100);
    });

    it('treats a question with no points as worth one, not NaN', () => {
        // `totalPoints += question.points` with points undefined produced NaN,
        // and NaN >= passingScore is false — so an author omitting points
        // silently failed everyone.
        const noPoints = [{ id: 'q1', type: 'mcq-single', answers: [{ id: 'a', isCorrect: true }] }];
        const result = gradeStoredQuiz(noPoints, { q1: 'a' }, 50);

        expect(Number.isNaN(result.scorePercentage)).toBe(false);
        expect(result).toMatchObject({ totalPoints: 1, scorePercentage: 100, passed: true });
    });

    it('does not award a question with nothing marked correct', () => {
        const broken = [{ id: 'q1', type: 'mcq-single', points: 5, answers: [{ id: 'a' }, { id: 'b' }] }];

        expect(gradeStoredQuiz(broken, {}, 50).scorePercentage).toBe(0);
        expect(gradeStoredQuiz(broken, { q1: 'a' }, 50).scorePercentage).toBe(0);
    });
});

describe('the answer key does not leave the server for a learner', () => {
    const course = {
        id: 'c1',
        modules: [
            {
                id: 'm1',
                quiz: {
                    passingScore: 80,
                    questions: [
                        { id: 'q1', question: 'Which?', options: ['a', 'b'], correctAnswer: 1 },
                        { id: 'q2', question: 'Which?', answers: [{ id: 'a', text: 'A', isCorrect: true }] },
                    ],
                },
            },
        ],
    };

    it('removes correctAnswer and isCorrect', () => {
        const stripped: any = stripAnswerKey(course);
        const [q1, q2] = stripped.modules[0].quiz.questions;

        expect('correctAnswer' in q1).toBe(false);
        expect('isCorrect' in q2.answers[0]).toBe(false);
    });

    it('keeps everything a learner needs to answer', () => {
        // Vacuity guard: returning an empty object strips the key and the quiz.
        const stripped: any = stripAnswerKey(course);
        const [q1, q2] = stripped.modules[0].quiz.questions;

        expect(q1.question).toBe('Which?');
        expect(q1.options).toEqual(['a', 'b']);
        expect(q2.answers[0].text).toBe('A');
        expect(stripped.modules[0].quiz.passingScore).toBe(80);
        expect(stripped.id).toBe('c1');
    });

    it('does not mutate the document it was given', () => {
        // The same object is written back on the admin path.
        stripAnswerKey(course);

        expect((course.modules[0].quiz.questions[0] as any).correctAnswer).toBe(1);
    });

    it('leaves a course with no modules alone', () => {
        expect(stripAnswerKey({ id: 'x' } as any)).toEqual({ id: 'x' });
    });

    it('the course loader strips for learners and not for admins', () => {
        const actions = source('src/app/actions/academy/_ac_catalog.ts');

        // The admin keeps the key; everyone else is stripped. The value passed
        // to stripAnswerKey became `visible` when paid lesson material was gated
        // as well — see academy-content-gating.test.ts — so the rule is asserted
        // rather than the exact expression it was written as.
        expect(actions).toContain('viewerIsAdmin ? visible : stripAnswerKey(visible)');
        expect(actions).toContain('isAdmin(sessionResult.session?.user?.roles)');
    });
});

describe('the score is not accepted from the caller', () => {
    it('the action takes answers, not a number', () => {
        // THE test.
        const actions = source('src/app/actions/academy/_ac_progress.ts');

        expect(actions).toContain('answers: Record<string, number>,');
        expect(codeOnly(actions)).not.toContain('progress.quizScores[moduleId] = score;\n            progress.lastAccessedAt');
        expect(actions).toContain('gradeModuleQuiz(');
    });

    it('neither screen grades in the browser', () => {
        for (const file of [
            'src/components/academy/QuizComponent.tsx',
            'src/app/academy/[courseId]/quiz/[moduleId]/page.tsx',
        ]) {
            const code = codeOnly(source(file));

            expect(code).not.toContain('=== q.correctAnswer');
            expect(code).not.toContain('=== question.correctAnswer');
            expect(code).toContain('submitQuizScoreAction');
        }
    });

    it('the review is rendered from the server\'s per-question results', () => {
        // Marking the learner's own answer, not revealing the right one. The
        // component compared optIndex to question.correctAnswer, which is why
        // the key had to be in the browser at all.
        const quiz = source('src/components/academy/QuizComponent.tsx');

        expect(quiz).toContain('results[question.id] === true');
        expect(quiz).toContain('setResults(result.data.results');
    });

    it('grading returns which questions were right, not which answers were', () => {
        const graded = gradeModuleQuiz(MODULE_QUIZ, { q1: 0, q2: 0 }, 80);

        expect(graded.results).toEqual({ q1: true, q2: false, q3: false, q4: false });
        // And nothing in the result names the correct option.
        expect(JSON.stringify(graded)).not.toContain('correctAnswer');
    });

    it('both screens show the score the server returned', () => {
        // Vacuity guard: removing the client calculation without using the
        // server's answer leaves the learner with no score at all.
        for (const file of [
            'src/components/academy/QuizComponent.tsx',
            'src/app/academy/[courseId]/quiz/[moduleId]/page.tsx',
        ]) {
            expect(source(file)).toContain('result.data.score');
        }
    });

    it('both paths use the one grading module', () => {
        for (const file of [
            'src/app/actions/academy/_ac_progress.ts',
            'src/app/api/academy/quiz/submit/route.ts',
        ]) {
            expect(source(file)).toContain('@/lib/academy-grading');
        }
    });
});

describe('the route credits the quiz\'s own course', () => {
    const route = source('src/app/api/academy/quiz/submit/route.ts');

    it('takes courseId from the quiz document', () => {
        expect(route).toContain('const courseId = quizData.courseId');
        expect(route).toContain('claimedCourseId !== courseId');
    });

    it('refuses a quiz that names no course', () => {
        // Fails closed rather than writing progress to `${userId}_undefined`.
        expect(route).toContain('Quiz is not attached to a course');
    });

    it('the progress write uses the derived value', () => {
        expect(route).toContain('doc(`${session.user.id}_${courseId}`)');
    });
});

describe('maxAttempts is enforced, having been enforced nowhere', () => {
    const route = source('src/app/api/academy/quiz/submit/route.ts');

    it('counts the attempts already recorded', () => {
        expect(route).toContain('COLLECTIONS.QUIZ_ATTEMPTS');
        expect(route).toContain('.where("quizId", "==", quizId)');
        expect(route).toContain('.where("userId", "==", session.user.id)');
    });

    it('refuses once the limit is reached', () => {
        expect(route).toContain('priorAttempts.docs.length >= maxAttempts');
    });

    it('derives the attempt number instead of accepting it', () => {
        expect(route).toContain('const attemptNumber = priorAttempts.docs.length + 1');
        expect(codeOnly(route)).not.toContain('attemptNumber, autoSubmit } = await request.json()');
    });

    it('a quiz with no limit set is still usable', () => {
        // Vacuity guard: treating an unset maxAttempts as 0 would refuse every
        // attempt on every existing quiz, none of which have the field.
        expect(route).toContain('maxAttempts > 0 &&');
    });

    it('the admin editor and the learner screen both show the limit', () => {
        // Recorded because it is why this looked enforced: the number was
        // collected, stored and displayed.
        expect(source('src/app/admin/academy/courses/[courseId]/quiz/page.tsx')).toContain('maxAttempts');
        expect(source('src/app/academy/courses/[courseId]/quiz/page.tsx')).toContain('quiz.maxAttempts');
    });
});
