import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";

/**
 * API Route: Get Quiz for Student
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ courseId: string }> }
) {
    try {
        const { courseId } = await params;
        // Get quiz for the course
        const quizzesRef = collection(db, "quizzes");
        const q = query(
            quizzesRef,
            where("courseId", "==", courseId),
            orderBy("createdAt", "desc"),
            limit(1)
        );
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return NextResponse.json(
                { success: false, message: "No quiz found for this course" },
                { status: 404 }
            );
        }

        const quizDoc = snapshot.docs[0];
        const quizData = {
            id: quizDoc.id,
            ...quizDoc.data(),
            // Remove correct answer flags for student view
            questions: quizDoc.data().questions.map((q: any) => ({
                ...q,
                answers: q.answers?.map((a: any) => ({
                    id: a.id,
                    text: a.text,
                    // Don't send isCorrect to student
                })),
                // Don't send correctAnswer for short-answer questions
                correctAnswer: undefined,
            })),
        };

        // TODO: Get user's previous attempts to calculate attemptNumber
        const attemptNumber = 1;

        return NextResponse.json({
            success: true,
            quiz: quizData,
            attemptNumber
        });
    } catch (error) {
        console.error("Failed to fetch quiz:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
