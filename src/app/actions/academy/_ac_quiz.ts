"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { hasAdminPermission } from "@/lib/admin-permissions";
import { recordAdminAction } from "@/lib/audit-log";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { editorQuestionsToModuleQuiz, DEFAULT_QUIZ_PASSING_SCORE } from "@/lib/academy-grading";
import type { Course, Quiz, QuizEditorQuestion } from "@/lib/types/academy-actions";

/**
 * Save (upsert) a quiz's questions and title to Firestore.
 * Used by the admin quiz editor page.
 */
export async function saveQuizAction(
    courseId: string,
    quizId: string,
    title: string,
    questions: QuizEditorQuestion[],
    /**
     *   #386 THE PASS MARK THE ONLY REACHABLE EDITOR COULD NOT SET.
     *
     *        _ac_progress grades a module quiz at
     *        `courseModule?.quiz?.passingScore ?? 95`, and this action had no
     *        parameter for it — it preserved a value if the module already
     *        carried one and otherwise wrote 95. The quiz editor at
     *        /admin/academy/[courseId]/quiz/[quizId] is the only quiz-authoring
     *        screen with a way in, so in practice EVERY quiz in this product is
     *        graded at 95% and no admin has ever been able to change it.
     *
     *        The unreachable editor #386 retired collected a passing score, a
     *        time limit, an attempt limit and two shuffle flags. Of those five,
     *        this is the only one the live grading path reads — so it is the one
     *        carried across, and the other four are recorded in
     *        lib/academy-quiz-api.ts rather than half-implemented here.
     *
     *        Optional, and undefined means "leave whatever the module has",
     *        so an existing quiz re-saved by an editor that does not send one
     *        does not silently move to the default.
     */
    passingScore?: number,
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        /**
         *   #264 THE ACADEMY ADMIN COULD NOT AUTHOR AN ACADEMY QUIZ.
         *
         *        This was a hand-written `admin || super_admin` pair, and
         *        `academy_admin` is in neither — while /admin is a protected
         *        area that role reaches. So the academy admin opened the quiz
         *        editor, the load failed with "Unauthorized: Admin access
         *        required", and Save failed the same way.
         *
         *        `academy:manage_quizzes` already existed for exactly this job
         *        and is already granted to super_admin, admin AND academy_admin.
         *        One place asked for it — api/admin/academy/quiz/create — which
         *        is not the editor. So that role could create a quiz through the
         *        API route and not save one through the only quiz-authoring
         *        screen the admin UI links to.
         *
         *        _ac_catalog.ts, two files away, carries the same correction for
         *        the same reason ("The ACADEMY admin could not edit an Academy
         *        course"). Same correction as #115, #122, #158, #195 and #242.
         */
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_quizzes")) {
            return { success: false as const, error: "Unauthorized: academy:manage_quizzes required", data: null };
        }

        if (!courseId || !quizId) {
            return { success: false as const, error: "Course ID and Quiz ID are required", data: null };
        }

        if (questions.length === 0) {
            return { success: false as const, error: "Quiz must have at least one question", data: null };
        }

        // Validate each question has exactly one correct answer
        for (const q of questions) {
            const correctCount = q.options.filter(o => o.isCorrect).length;
            if (correctCount !== 1) {
                return { success: false as const, error: `Question "${q.text.slice(0, 40)}..." must have exactly one correct answer`, data: null };
            }
        }

        // The pass mark, checked rather than trusted — #386.
        //
        // A "use server" parameter is whatever the caller sent, whatever its
        // declared type. A pass mark above 100 makes a quiz impossible to pass;
        // a negative one makes it impossible to fail. Refused rather than
        // clamped, for the reason lib/system-settings gives for the same choice:
        // a silently clamped figure is a wrong setting reported as a saved one.
        let checkedPassingScore: number | undefined;
        if (passingScore !== undefined) {
            const value = Number(passingScore);
            if (!Number.isFinite(value) || value < 0 || value > 100) {
                return { success: false as const, error: "Passing score must be between 0 and 100", data: null };
            }
            checkedPassingScore = Math.round(value);
        }

        // createdAt only when there is nothing to preserve.
        //
        // This was an unconditional `createdAt: serverTimestamp()` inside a
        // merge that runs on EVERY save, so the field meant "last saved" and
        // the quiz's real creation date was gone after the first edit — #257's
        // shape, in this file. Nothing reads it today, which is the reason to
        // correct it now rather than after something does.
        const quizRef = db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId);
        const existingQuiz = await quizRef.get();
        const existingCreatedAt = existingQuiz.exists ? existingQuiz.data()?.createdAt : undefined;

        await quizRef.set({
            courseId,
            title,
            questions,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: existingCreatedAt ?? FieldValue.serverTimestamp(),
            // #386 — mirrored so the editor reloads what the admin set. The
            // course module stays authoritative for grading; saveQuizAction
            // writes both in the same call, so the two cannot drift.
            passingScore: checkedPassingScore ?? undefined,
}, { merge: true });

        // And into the course document, which is where learners are graded.
        //
        // The write above is the whole of what this action used to do, and
        // COLLECTIONS.ACADEMY_QUIZZES is read by exactly one thing: getQuizAction,
        // called by the same editor page. No learner path touches it.
        // /academy/[courseId]/quiz/[moduleId] loads the quiz from
        // course.modules[].quiz via getCourseByIdAction, and _submitQuizScoreAction
        // grades against the same place.
        //
        // So the only quiz-authoring screen the admin UI links to — the "Edit Quiz"
        // button on every quiz lesson in the course editor — wrote to a store
        // nothing read. The admin was told the quiz was saved, could reopen it and
        // see it intact, and the learners were served nothing: `module.quiz` stayed
        // undefined, so `if (courseModule?.quiz && graded.passed)` never fired and
        // the module could not be completed.
        //
        // `quizId` is the LESSON id, so the module carrying that lesson is the one
        // whose quiz this is. A course that does not contain the lesson is left
        // alone rather than guessed at — the editor write above still succeeded,
        // which is exactly what happened before.
        try {
            const courseRef = db.collection(COLLECTIONS.ACADEMY_COURSES).doc(courseId);
            const courseSnap = await courseRef.get();

            if (courseSnap.exists) {
                const course = courseSnap.data() as Course;
                const modules = Array.isArray(course?.modules) ? course.modules : [];
                const index = modules.findIndex((m: any) =>
                    Array.isArray(m?.lessons) && m.lessons.some((l: any) => l?.id === quizId)
                );

                if (index >= 0) {
                    const existing = (modules[index] as any)?.quiz;
                    const updated = modules.map((m: any, i: number) =>
                        i === index
                            ? {
                                ...m,
                                quiz: {
                                    ...(existing ?? {}),
                                    id: quizId,
                                    title,
                                    questions: editorQuestionsToModuleQuiz(questions as any),
                                    // Kept if the module already had one. 95 is what
                                    // gradeModuleQuiz falls back to, so a module that
                                    // never had a pass mark keeps the same one it was
                                    // already being graded against.
                                    // #386 — the editor's figure wins, then
                                    // whatever the module already had, then the
                                    // fallback _ac_progress has always used.
                                    // Bounded here rather than trusted: this is
                                    // a "use server" parameter, so it is
                                    // whatever the caller sent, and a pass mark
                                    // above 100 makes a quiz unpassable while a
                                    // negative one makes it unfailable.
                                    passingScore: checkedPassingScore ?? (
                                        typeof existing?.passingScore === "number"
                                            ? existing.passingScore
                                            : DEFAULT_QUIZ_PASSING_SCORE
                                    ),
                                },
                            }
                            : m
                    );

                    await courseRef.update({
                        modules: updated,
                        updatedAt: FieldValue.serverTimestamp(),
                    });
                } else {
                    logger.warn(
                        `[saveQuizAction] Lesson ${quizId} is not in any module of course ${courseId}; ` +
                        `the quiz was saved but no learner will be graded on it.`
                    );
                }
            }
        } catch (syncErr) {
            // Non-fatal: the editor's own copy is written, so the admin does not
            // lose their work. Logged loudly because the learner-facing half is
            // the half that matters.
            logger.error(`[saveQuizAction] Failed to sync quiz ${quizId} into course ${courseId}:`, syncErr);
        }

        // Recorded, like every other permission-gated admin write.
        //
        // Surfaced by admin-action-audit-trail.test.ts the moment this action
        // moved onto a named permission (#264): it was gated all along and
        // recorded nothing. Worth recording on its own merits — this document
        // is the answer key that decides who passes a course and earns a
        // certificate, and 'quiz_created' vs 'quiz_updated' is the difference
        // between authoring one and rewriting the answers to a live one.
        await recordAdminAction({
            action: existingQuiz.exists ? 'quiz_updated' : 'quiz_created',
            userId: session.user.id,
            targetId: quizId,
            targetType: 'academy_quiz',
            details: `course ${courseId} · "${title}" · ${questions.length} question(s)`,
        });

        return { success: true, error: null, data: null };
    } catch (error) {
        logger.error("saveQuizAction error:", {
            quizId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to save quiz", data: null };
    }
}


/**
 * Load a quiz's questions from Firestore.
 */
async function _getQuizAction(
    quizId: string
): Promise<ActionResponse<any>> {
    try {
        // Admin, not merely signed in — this returns the answer key.
        //
        // The questions stored here carry `options[].isCorrect`, so the payload
        // below IS the answer key. A session check alone meant any signed-in
        // learner could call getQuizAction(lessonId) and read the answers to the
        // quiz they were about to sit.
        //
        // saveQuizAction directly above requires admin. The write to this
        // document was gated and the read of the same document was not, and the
        // only caller of either is the admin editor at
        // /admin/academy/[courseId]/quiz/[quizId].
        //
        // stripAnswerKey is not the tool here: it understands the course-module
        // and COLLECTIONS.QUIZZES shapes, and this is a third one. Withholding
        // the document from non-admins is both simpler and right, because
        // nothing but the editor is supposed to read it.
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        // The same permission as the write above (#264). The read and the write
        // are two halves of one screen, so they cannot disagree about who may
        // use it — and this one hands out the answer key, so it is the half
        // where disagreeing in the other direction would be worse.
        if (!hasAdminPermission(session?.user?.roles, "academy:manage_quizzes")) {
            return { success: false as const, error: "Unauthorized: academy:manage_quizzes required", data: null };
        }

        const doc = await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).get();

        if (!doc.exists) {
            return { success: true, error: null, data: null };
        }

        const data = doc.data()!;
        return {
            error: null, success: true as const,
            data: {
                title: data.title || "Module Quiz",
                questions: data.questions || [],
                // #386 — so the editor shows the pass mark that is stored
                // rather than resetting it to the default on every reload.
                passingScore: typeof data.passingScore === "number" ? data.passingScore : undefined,
            }
        };
    } catch (error) {
        logger.error("getQuizAction error:", {
            quizId,
            error: error instanceof Error ? error.message : String(error)
        });
        return { success: false as const, error: "Failed to load quiz", data: null };
    }
}


export const getQuizAction = withFlexibleSafeAction("getQuizAction", _getQuizAction);
