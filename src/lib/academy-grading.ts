/**
 * Grading a quiz, on the server, from the stored quiz.
 *
 * THE PLATFORM HAD BOTH IMPLEMENTATIONS
 * -------------------------------------
 * Academy quizzes are taken through two entirely separate paths, and only one
 * of them worked.
 *
 * The API route path is correct. /api/academy/quiz/[courseId] strips isCorrect
 * and correctAnswer before sending the quiz, and /api/academy/quiz/submit
 * re-reads the quiz from the database and computes the score there.
 *
 * The server-action path was not. All three layers failed independently:
 *
 *   1. getCourseByIdAction returned serializeDoc(courseDoc) — the whole course
 *      document, including modules[].quiz.questions[].correctAnswer. The answer
 *      key was delivered to every learner's browser.
 *
 *   2. QuizComponent.tsx graded in the browser:
 *
 *          quiz.questions.forEach((q) => {
 *              if (answers[q.id] === q.correctAnswer) correct++;
 *          });
 *          const calculatedScore = Math.round((correct / quiz.questions.length) * 100);
 *
 *   3. submitQuizScoreAction took `score: number` as a parameter and wrote it
 *      into progress.quizScores, then marked the module complete when it
 *      cleared passingScore. It is a "use server" export, so it is a reachable
 *      endpoint whatever the UI does — `submitQuizScoreAction(me, course, mod, 100)`
 *      was a passing grade on any module, with no quiz involved.
 *
 * Any one of those three would have been enough on its own.
 *
 * WHY BOTH SHAPES LIVE HERE
 * -------------------------
 * The two paths store questions differently, because they were built
 * separately:
 *
 *   COLLECTIONS.QUIZZES        question.answers[] with isCorrect, question.points,
 *                              question.type of mcq-single | mcq-multiple | true-false
 *   course.modules[].quiz      question.options[] with correctAnswer as an index,
 *                              no per-question points
 *
 * Unifying the storage is a migration. Unifying the GRADING is this file, so
 * there is one place that decides what a pass is — and so the next path added
 * cannot quietly grade in the browser because the server-side helper was
 * somewhere else.
 */

/** A question in COLLECTIONS.QUIZZES. */
export interface StoredQuizQuestion {
    id: string;
    type?: string;
    points?: number;
    answers?: Array<{ id: string; text?: string; isCorrect?: boolean }>;
}

/** A question in course.modules[].quiz. */
export interface ModuleQuizQuestion {
    id: string;
    options?: string[];
    correctAnswer?: number;
}

export interface GradeResult {
    earnedPoints: number;
    totalPoints: number;
    scorePercentage: number;
    passed: boolean;
    /**
     * Per-question: was the submitted answer right?
     *
     * Deliberately NOT the correct answer itself. The quiz screen marks each
     * question after submission, which it used to do by comparing against a key
     * it held locally. Sending back which questions were right restores that
     * without sending the key — a learner who submits nonsense to see the
     * answers gets told only that they were wrong.
     */
    results: Record<string, boolean>;
}

/**
 * Grades a COLLECTIONS.QUIZZES quiz.
 *
 * `answers` maps question id to the chosen answer id, or to an array of them
 * for mcq-multiple.
 */
export function gradeStoredQuiz(
    questions: StoredQuizQuestion[],
    answers: Record<string, unknown>,
    passingScore: number
): GradeResult {
    let totalPoints = 0;
    let earnedPoints = 0;
    const results: Record<string, boolean> = {};

    for (const question of questions ?? []) {
        // A question with no points set contributed NaN to the total, which made
        // every later comparison false and failed the learner silently. Treated
        // as one point, which is what an unweighted question is.
        const points = Number.isFinite(question.points) ? (question.points as number) : 1;
        totalPoints += points;

        const given = answers?.[question.id];
        const correctIds = (question.answers ?? [])
            .filter((a) => a.isCorrect)
            .map((a) => a.id);

        if (question.type === "mcq-multiple") {
            const givenIds = (Array.isArray(given) ? given : []).map(String).sort();
            const right = correctIds.length > 0 && JSON.stringify(correctIds.slice().sort()) === JSON.stringify(givenIds);
            results[question.id] = right;
            if (right) earnedPoints += points;
        } else {
            // mcq-single, true-false, and anything else with one right answer.
            //
            // correctIds.length > 0 matters: a question with no answer marked
            // correct otherwise awards the points to whoever submits undefined,
            // because undefined === undefined.
            const right = correctIds.length > 0 && correctIds[0] === given;
            results[question.id] = right;
            if (right) earnedPoints += points;
        }
    }

    const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

    return { earnedPoints, totalPoints, scorePercentage, passed: scorePercentage >= passingScore, results };
}

/**
 * Grades a course.modules[].quiz quiz.
 *
 * `answers` maps question id to the chosen option INDEX, which is what
 * QuizComponent already tracks in its own state.
 */
export function gradeModuleQuiz(
    questions: ModuleQuizQuestion[],
    answers: Record<string, unknown>,
    passingScore: number
): GradeResult {
    const list = questions ?? [];
    let earned = 0;
    const results: Record<string, boolean> = {};

    for (const question of list) {
        const correct = question.correctAnswer;
        // Same reasoning as above: without this, a question whose correctAnswer
        // was never set is a free point for a submission that omits it.
        const right = typeof correct === "number" && answers?.[question.id] === correct;
        results[question.id] = right;
        if (right) earned += 1;
    }

    const scorePercentage = list.length > 0 ? Math.round((earned / list.length) * 100) : 0;

    return {
        earnedPoints: earned,
        totalPoints: list.length,
        scorePercentage,
        passed: scorePercentage >= passingScore,
        results,
    };
}

/** A question as the admin quiz editor stores it, in COLLECTIONS.ACADEMY_QUIZZES. */
export interface EditorQuizQuestion {
    id: string;
    text: string;
    options: Array<{ id: string; text: string; isCorrect: boolean }>;
}

/**
 * Converts the admin editor's questions into the shape the learner is graded on.
 *
 * A THIRD QUIZ STORE, WHICH NOTHING READ
 * --------------------------------------
 * The header above names two storages, COLLECTIONS.QUIZZES and
 * course.modules[].quiz. There is a third: COLLECTIONS.ACADEMY_QUIZZES.
 *
 * saveQuizAction writes it, getQuizAction reads it back, and both are called by
 * one page — /admin/academy/[courseId]/quiz/[quizId], the editor reached from
 * the "Edit Quiz" button on every quiz lesson in the course editor. That is the
 * ONLY quiz-authoring screen the admin UI links to.
 *
 * No learner path reads that collection. /academy/[courseId]/quiz/[moduleId]
 * loads the quiz from course.modules[].quiz through getCourseByIdAction, and
 * _submitQuizScoreAction grades against the same place. So an admin could write
 * a quiz, be told it was saved, read it back in the editor unchanged — and the
 * learners were served nothing, because `module.quiz` was still undefined.
 *
 * `if (courseModule?.quiz && graded.passed)` in _submitQuizScoreAction is why
 * this was quiet: with no quiz on the module the submission scored zero out of
 * zero and the module was simply never completed.
 *
 * The editor's shape carries the correct answer as a flag on each option; the
 * graded shape carries it as the index of the correct option. saveQuizAction
 * already refuses a question that does not have exactly one correct option, so
 * the index below is always found.
 */
export function editorQuestionsToModuleQuiz(
    questions: EditorQuizQuestion[]
): ModuleQuizQuestion[] {
    return (questions ?? []).map((q) => {
        const options = q.options ?? [];
        const index = options.findIndex((o) => o.isCorrect);

        return {
            id: q.id,
            question: q.text,
            options: options.map((o) => o.text),
            // NOT -1 when nothing is marked correct.
            //
            // gradeModuleQuiz scores a question when
            // `typeof correctAnswer === "number" && answers[id] === correctAnswer`,
            // so storing -1 makes a submission of -1 a correct answer — a free
            // point on a question that has no right answer at all. Leaving it
            // undefined is what that guard was written for, and matches the
            // reasoning already applied to gradeStoredQuiz's missing points.
            //
            // saveQuizAction refuses a question without exactly one correct
            // option, so this arises only if the helper is reused elsewhere.
            // That is precisely when a quiet -1 would be missed.
            correctAnswer: index >= 0 ? index : undefined,
        };
    }) as ModuleQuizQuestion[];
}

/**
 * Removes the answer key from a course before it is sent to a learner.
 *
 * Returns a copy — mutating the document read from the database would strip the
 * answers from whatever else holds a reference to it, including the write path
 * that has to keep them.
 *
 * Admin callers are given the course intact: the course editor at
 * /admin/academy/[courseId] edits these questions and cannot do that without
 * the answers. That decision belongs to the caller, which knows who is asking.
 */
export function stripAnswerKey<T>(course: T): T {
    const c = course as any;
    if (!c || !Array.isArray(c.modules)) return course;

    return {
        ...c,
        modules: c.modules.map((mod: any) => {
            if (!mod?.quiz?.questions) return mod;
            return {
                ...mod,
                quiz: {
                    ...mod.quiz,
                    questions: mod.quiz.questions.map((q: any) => {
                        // Delete rather than set to undefined: a JSON response
                        // drops undefined keys, but a server action returns a
                        // structured-cloned object where `correctAnswer:
                        // undefined` is still an own property — and a client
                        // reading `q.correctAnswer` cannot tell the difference
                        // from the key being absent, but anything iterating keys
                        // can.
                        const { correctAnswer: _dropped, ...rest } = q ?? {};
                        return {
                            ...rest,
                            answers: Array.isArray(q?.answers)
                                ? q.answers.map((a: any) => {
                                      const { isCorrect: _also, ...keep } = a ?? {};
                                      return keep;
                                  })
                                : q?.answers,
                        };
                    }),
                },
            };
        }),
    } as T;
}
