"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
import { editorQuestionsToModuleQuiz } from "@/lib/academy-grading";
import type { Course, Quiz, QuizEditorQuestion } from "@/lib/types/academy-actions";

/**
 * Save (upsert) a quiz's questions and title to Firestore.
 * Used by the admin quiz editor page.
 */
export async function saveQuizAction(
    courseId: string,
    quizId: string,
    title: string,
    questions: QuizEditorQuestion[]
): Promise<ActionResponse<null>> {
    try {
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false as const, error: "Unauthorized: Admin access required", data: null };
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

        await db.collection(COLLECTIONS.ACADEMY_QUIZZES).doc(quizId).set({
            courseId,
            title,
            questions,
            updatedBy: session.user.id,
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
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
                                    passingScore: typeof existing?.passingScore === "number"
                                        ? existing.passingScore
                                        : 95,
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
        if (!session?.user?.roles?.includes("admin") && !session?.user?.roles?.includes("super_admin")) {
            return { success: false as const, error: "Unauthorized: Admin access required", data: null };
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
