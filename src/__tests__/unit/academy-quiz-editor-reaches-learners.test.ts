/**
 * @jest-environment node
 */

/**
 * The only quiz editor the admin UI links to wrote where nothing read.
 *
 * THREE QUIZ STORES
 * -----------------
 * academy-grading.ts's header names two, and explains why the GRADING was
 * unified while the storage was left alone:
 *
 *   COLLECTIONS.QUIZZES        the API-route path
 *   course.modules[].quiz      the server-action path
 *
 * There is a third. COLLECTIONS.ACADEMY_QUIZZES is written by saveQuizAction
 * and read back by getQuizAction, and both are called by exactly one page —
 * /admin/academy/[courseId]/quiz/[quizId]. That page is reached from the
 * "Edit Quiz" button on every quiz lesson in the course editor, and it is the
 * ONLY quiz-authoring screen the admin UI links to at all.
 *
 * Nothing else reads that collection. The learner sits
 * /academy/[courseId]/quiz/[moduleId], which loads the quiz from
 * course.modules[].quiz through getCourseByIdAction, and _submitQuizScoreAction
 * grades against the same place.
 *
 * So an admin wrote a quiz, was told it saved, reopened the editor and saw it
 * intact — and the learners were served nothing. `module.quiz` stayed
 * undefined, so `if (courseModule?.quiz && graded.passed)` never fired, the
 * submission scored zero out of zero, and the module could not be completed.
 * That is why it was quiet: nothing errored, the quiz simply was not there.
 *
 * AND THE READ HANDED OUT THE ANSWERS
 * -----------------------------------
 * The questions in that collection carry `options[].isCorrect`, so the document
 * IS the answer key. saveQuizAction required admin; getQuizAction, reading the
 * same document, required only a session — so any signed-in learner could call
 * getQuizAction(lessonId) and read the answers to the quiz they were about to
 * sit.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { join } from 'path';
import { editorQuestionsToModuleQuiz, gradeModuleQuiz } from '@/lib/academy-grading';

const QUIZ = 'src/app/actions/academy/_ac_quiz.ts';
const PROGRESS = 'src/app/actions/academy/_ac_progress.ts';
const COURSE_EDITOR = 'src/app/admin/academy/[courseId]/page.tsx';
const LEARNER_QUIZ = 'src/app/academy/[courseId]/quiz/[moduleId]/page.tsx';

function source(rel: string): string {
    return readFileSync(join(process.cwd(), rel), 'utf-8');
}

function code(rel: string): string {
    return source(rel)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((l) => !l.trim().startsWith('//'))
        .map((l) => l.replace(/\s\/\/.*$/, ''))
        .join('\n');
}

/** A question as the editor stores it. */
const q = (id: string, correctIndex: number, texts: string[]) => ({
    id,
    text: `Question ${id}`,
    options: texts.map((t, i) => ({ id: `${id}-${i}`, text: t, isCorrect: i === correctIndex })),
});

describe('the conversion', () => {
    it('turns the correct-option FLAG into the correct-option INDEX', () => {
        const [converted] = editorQuestionsToModuleQuiz([q('a', 2, ['no', 'no', 'yes'])]);

        expect(converted).toEqual({
            id: 'a',
            question: 'Question a',
            options: ['no', 'no', 'yes'],
            correctAnswer: 2,
        });
    });

    it('and what it produces is what the grader actually grades', () => {
        // The two shapes are the point of the defect, so this asserts the
        // round trip rather than the field names alone.
        const questions = editorQuestionsToModuleQuiz([
            q('a', 0, ['right', 'wrong']),
            q('b', 1, ['wrong', 'right']),
        ]);

        const perfect = gradeModuleQuiz(questions, { a: 0, b: 1 }, 95);
        expect(perfect).toMatchObject({ scorePercentage: 100, passed: true });

        const half = gradeModuleQuiz(questions, { a: 0, b: 0 }, 95);
        expect(half).toMatchObject({ scorePercentage: 50, passed: false });
    });

    it('keeps the option order, because the answer is an index into it', () => {
        const [converted] = editorQuestionsToModuleQuiz([q('a', 3, ['w', 'x', 'y', 'z'])]);

        expect(converted.options).toEqual(['w', 'x', 'y', 'z']);
        expect(converted.options![converted.correctAnswer!]).toBe('z');
    });

    it('leaves correctAnswer UNSET when no option is marked — not -1', () => {
        // findIndex returns -1, and gradeModuleQuiz scores a question when
        // `typeof correctAnswer === "number" && answers[id] === correctAnswer`.
        // So storing -1 makes a submission of -1 a correct answer: a free point
        // on a question with no right answer. This is the case the grader's own
        // `typeof` guard exists for.
        const converted = editorQuestionsToModuleQuiz([
            { id: 'a', text: 'orphan', options: [] as any },
            { id: 'b', text: 'none marked', options: [{ id: 'b0', text: 'x', isCorrect: false }] },
        ]);

        expect(converted[0].correctAnswer).toBeUndefined();
        expect(converted[1].correctAnswer).toBeUndefined();

        const graded = gradeModuleQuiz(converted, { a: -1, b: -1 }, 95);
        expect(graded.results.a).toBe(false);
        expect(graded.results.b).toBe(false);
        expect(graded.scorePercentage).toBe(0);
    });

    it('and index 0 is still a real answer, not a falsy one', () => {
        // The obvious way to write the guard above — `index || undefined` —
        // would throw away the first option as an answer.
        const [converted] = editorQuestionsToModuleQuiz([q('a', 0, ['right', 'wrong'])]);

        expect(converted.correctAnswer).toBe(0);
        expect(gradeModuleQuiz([converted], { a: 0 }, 95).passed).toBe(true);
    });
});

describe('the editor now reaches the learner', () => {
    it('saveQuizAction writes the module quiz as well as its own copy', () => {
        const src = code(QUIZ);

        // THE test.
        expect(src).toContain('ACADEMY_QUIZZES');
        expect(src).toContain('ACADEMY_COURSES');
        expect(src).toContain('editorQuestionsToModuleQuiz(');
        expect(src).toContain('modules: updated');
    });

    it('into the module that CONTAINS the lesson, since quizId is a lesson id', () => {
        const src = code(QUIZ);

        expect(src).toContain('m.lessons.some((l: any) => l?.id === quizId)');
    });

    it('and leaves the course alone when no module owns that lesson', () => {
        // Guessing a module would attach a quiz to the wrong one.
        const src = code(QUIZ);

        expect(src).toContain('if (index >= 0)');
        expect(src).toContain('no learner will be graded on it');
    });

    it('without losing the pass mark the module already had', () => {
        const src = code(QUIZ);

        expect(src).toContain('typeof existing?.passingScore === "number"');
        // 95 is gradeModuleQuiz's own fallback, so a module that never had one
        // keeps the mark it was already being graded against.
        expect(src).toContain(': 95');
    });

    it('and a failure to sync does not lose the admin\'s work', () => {
        const src = code(QUIZ);
        const sync = src.slice(src.indexOf('const courseRef ='));

        expect(sync).toContain('catch (syncErr)');
    });
});

describe('the two ends this connects', () => {
    it('the admin course editor really does link to that editor page', () => {
        // Without this the defect is about an unreachable screen.
        expect(source(COURSE_EDITOR)).toContain('/admin/academy/${courseId}/quiz/${lesson.id}');
    });

    it('and the learner really is served from the course document', () => {
        expect(source(LEARNER_QUIZ)).toContain('getCourseByIdAction');
        expect(source(LEARNER_QUIZ)).not.toContain('getQuizAction');
    });

    it('and the grader really does read course.modules[].quiz', () => {
        const src = code(PROGRESS);

        expect(src).toContain('course.modules?.find((m) => m.id === moduleId)');
        expect(src).toContain('courseModule?.quiz?.questions');
        expect(src).toContain('if (courseModule?.quiz && graded.passed)');
    });
});

describe('the answer key in that collection', () => {
    it('getQuizAction requires the same permission as its writing sibling', () => {
        // BOTH halves were a hand-written `admin || super_admin` pair, and the
        // ACADEMY admin — the role the module exists for — was in neither
        // (#264). These two assertions pinned that literal, so they broke on
        // the fix rather than on a regression. They ask for the property now:
        // the guard is the named permission, and the read and the write agree.
        //
        // academy-quiz-editor-permission.test.ts executes both actions against
        // every admin role, which is the check that has teeth; this one keeps
        // the ORDER, which only source can show.
        const src = code(QUIZ);
        const read = src.slice(src.indexOf('async function _getQuizAction'));
        const write = src.slice(src.indexOf('export async function saveQuizAction'), src.indexOf('async function _getQuizAction'));

        expect(read).toContain('academy:manage_quizzes');
        expect(write).toContain('academy:manage_quizzes');
    });

    it('and refuses before it reads the document', () => {
        const src = code(QUIZ);
        const read = src.slice(src.indexOf('async function _getQuizAction'));
        const guard = read.indexOf('academy:manage_quizzes');
        const fetch = read.indexOf('ACADEMY_QUIZZES');

        expect(guard).toBeGreaterThan(-1);
        expect(fetch).toBeGreaterThan(guard);
    });

    it('which matters because the stored shape carries isCorrect per option', () => {
        // Not stripAnswerKey's shape — it knows correctAnswer and answers[],
        // not options[].isCorrect — so withholding is the only rule that works.
        const editorQuestion = q('a', 1, ['no', 'yes']);

        expect(editorQuestion.options.some((o) => o.isCorrect)).toBe(true);
    });
});
