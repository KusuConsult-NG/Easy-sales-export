import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { db } from "@/lib/firebase-admin";

/**
 * API Route: Get Quiz for Student
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ courseId: string }> }
) {
    try {
        const { courseId } = await params;

        // Get quiz for the course (Admin SDK)
        const snapshot = await db.collection("quizzes")
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
