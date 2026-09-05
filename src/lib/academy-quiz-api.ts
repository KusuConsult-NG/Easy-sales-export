/**
 *   #386 A SECOND, COMPLETE, ENTIRELY EMPTY QUIZ SYSTEM.
 *
 *        The academy has two quiz implementations, and only one of them has
 *        ever held a quiz.
 *
 *        THE LIVE ONE stores a quiz on the course document, at
 *        `course.modules[].quiz`. saveQuizAction writes it, the learner screen
 *        at /academy/[courseId]/quiz/[moduleId] reads it through
 *        getCourseByIdAction, and _completeModuleAction grades against the same
 *        place. Every quiz that exists in this product is there.
 *
 *        THE OTHER ONE stores a quiz in COLLECTIONS.QUIZZES and attempts in
 *        COLLECTIONS.QUIZ_ATTEMPTS, through three API routes:
 *
 *            POST /api/admin/academy/quiz/create   the only writer of QUIZZES
 *            GET  /api/academy/quiz/[courseId]     lists that course's quizzes
 *            POST /api/academy/quiz/submit         grades one, records the
 *                                                  attempt, updates progress
 *
 *        It is the more featureful of the two: its editor sets a passing score,
 *        a time limit, a maximum number of attempts and two shuffle flags, and
 *        its submit route enforces the attempt limit and derives the attempt
 *        number rather than accepting it.
 *
 *   AND NONE OF THAT HAS EVER RUN, WHICH IS THE MEASUREMENT THAT DECIDES IT
 *
 *        COLLECTIONS.QUIZZES has exactly ONE writer — the create route above —
 *        and that route has exactly one caller: the admin screen at
 *        /admin/academy/courses/[courseId]/quiz, which #362 established has no
 *        way in. Nothing links it; no admin has ever opened it.
 *
 *        So the collection is empty and always has been. Which means:
 *
 *          - the learner screen at /academy/courses/[courseId]/quiz lists that
 *            store and would show an empty quiz list for every course;
 *          - the submit route 404s on every quizId, so it has never graded
 *            anything and never written a progress row;
 *          - QUIZ_ATTEMPTS has never been written, so the maxAttempts check
 *            counts zero prior attempts against a limit on a document that does
 *            not exist;
 *          - timeLimit, shuffleQuestions and shuffleAnswers are collected by a
 *            form nobody can open, stored nowhere anything reads.
 *
 *   THIS CORRECTS WHAT #384 RECORDED. That pass, deciding whether to retire
 *   these two screens, found that the UNLINKED pair sets five settings the
 *   linked pair does not and that only its submit route enforces maxAttempts —
 *   and concluded "the unwired pair is the COMPLETE, enforcing pair". Half of
 *   that is right: it is the more complete implementation. The other half is
 *   wrong, and the empty store is why. It enforces its limit over nothing, so
 *   NEITHER subsystem has ever applied an attempt limit to a real quiz. #384's
 *   own reversal was itself made on an incomplete measurement, which is worth
 *   saying plainly rather than quietly correcting.
 *
 *   RETIRED, NOT DELETED — the #379 pattern
 *
 *        The three routes refuse as their first statement, before a session is
 *        read. The implementations stay whole for whoever finishes the feature,
 *        behind ACADEMY_QUIZ_API — off unless set to the exact word "enabled",
 *        matching GDPR_PURGE_DELETE_AUTH, SEED_ALLOW_REMOTE, CLEANUP_ALLOW_REMOTE
 *        and MARKETPLACE_OFFLINE_CHECKOUT. A specific word rather than a truthy
 *        value, so a stray "1" cannot arm a second grading path beside the live
 *        one.
 *
 *        Turning it on is not a wiring change. It is a decision to grade
 *        learners from a different store, and it needs the existing quizzes
 *        migrated out of course.modules[].quiz first — otherwise every course
 *        that has a quiz today would have none.
 *
 *   WHAT WAS CARRIED ACROSS, AND WHAT DELIBERATELY WAS NOT
 *
 *        CARRIED: the passing score. _ac_progress grades at
 *        `courseModule?.quiz?.passingScore ?? 95` and the linked editor had no
 *        field for it, so every quiz authored through the door admins actually
 *        use was graded at 95% with no way to change it. That is a live gap
 *        this comparison exposed, and it is fixed on the live path.
 *
 *        NOT CARRIED: the attempt limit. The LIVE learner screen announces no
 *        limit — it says nothing about attempts anywhere — so adding one would
 *        change what a learner is allowed to do rather than repair a promise the
 *        product was failing to keep. That is a product decision, and unlike the
 *        navigation questions in #384 it is not one an audit can settle from the
 *        code. It is stated here rather than left implied: on the live path a
 *        learner may retake a module quiz without limit.
 */

/** The environment variable that arms the second quiz system. */
export const ACADEMY_QUIZ_API_ENV = "ACADEMY_QUIZ_API";

/** The one value that arms it. Anything else, including "1" and "true", does not. */
export const ACADEMY_QUIZ_API_ENABLED_VALUE = "enabled";

/** Is the COLLECTIONS.QUIZZES quiz system switched on? */
export function isAcademyQuizApiEnabled(): boolean {
    return process.env[ACADEMY_QUIZ_API_ENV] === ACADEMY_QUIZ_API_ENABLED_VALUE;
}

/**
 * What a caller is told, and what whoever enables this needs to know.
 *
 * Names the live path explicitly: a developer meeting this refusal should not
 * have to work out where quizzes actually live.
 */
export const ACADEMY_QUIZ_API_REFUSAL =
    "This quiz endpoint is retired. Academy quizzes are stored on the course "
    + "module and are authored at /admin/academy/[courseId]/quiz/[quizId] and "
    + "taken at /academy/[courseId]/quiz/[moduleId].";
