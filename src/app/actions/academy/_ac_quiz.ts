"use server";

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from '@/lib/logger';
import { FieldValue } from "@/lib/firestore-compat";
import { requireSession } from "@/lib/session-guard";
import { COLLECTIONS } from "@/lib/types/firestore";
import { withFlexibleSafeAction, ActionResponse } from "@/lib/safe-action";
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
        const sessionResult = await requireSession();
        if (!sessionResult.session) return { success: false as const, error: 'Unauthorized', data: null };
        const { session } = sessionResult;

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
