export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { isAcademyQuizApiEnabled, ACADEMY_QUIZ_API_REFUSAL } from "@/lib/academy-quiz-api";

/**
 * API Route: Get Quiz for Student
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ courseId: string }> }
) {
    try {
        // RETIRED — #386. First statement, before a session is read.
        //
        // COLLECTIONS.QUIZZES has one writer and no data: the only screen that
        // could author into it has no way in, so this whole subsystem has never
        // held a quiz. See lib/academy-quiz-api.ts for the measurement and for
        // what turning it back on would require.
        if (!isAcademyQuizApiEnabled()) {
            return NextResponse.json(
                { success: false, message: ACADEMY_QUIZ_API_REFUSAL },
                { status: 410 }
            );
        }

        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Authentication required" },
                { status: 401 }
            );
        }

        const { courseId } = await params;

        // Get quiz for the course (Admin SDK)
        const snapshot = await db.collection(COLLECTIONS.QUIZZES)
            .where("courseId", "==", courseId)
            .orderBy("createdAt", "desc")
            .limit(1)
            .get();

        if (snapshot.empty) {
            return NextResponse.json(
                { success: false, message: "No quiz found for this course" },
                { status: 404 }
            );
        }

        const quizDoc = snapshot.docs[0];
        const rawData = quizDoc.data();
        const quizData = {
            id: quizDoc.id,
            ...rawData,
            // Remove correct answer flags for student view
            questions: rawData.questions.map((q: any) => ({
                ...q,
                answers: q.answers?.map((a: any) => ({
                    id: a.id,
                    text: a.text,
                    // Don't send isCorrect to student
                })),
                correctAnswer: undefined,
            })),
        };

        return NextResponse.json({
            success: true,
            quiz: quizData,
            attemptNumber: 1,
        });
    } catch (error) {
        logger.error("Failed to fetch quiz:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
