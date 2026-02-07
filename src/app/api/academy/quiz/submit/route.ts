import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase";
import { doc, setDoc, getDoc, collection } from "firebase/firestore";

/**
 * API Route: Submit Quiz Attempt
 */
export async function POST(request: NextRequest) {
    try {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const { quizId, courseId, answers, attemptNumber, autoSubmit } = await request.json();

        if (!quizId || !courseId || !answers) {
            return NextResponse.json(
                { success: false, message: "Missing required fields" },
                { status: 400 }
            );
        }

        // Get quiz data to calculate score
        const quizRef = doc(db, "quizzes", quizId);
        const quizDoc = await getDoc(quizRef);

        if (!quizDoc.exists()) {
            return NextResponse.json(
                { success: false, message: "Quiz not found" },
                { status: 404 }
            );
        }

        const quizData = quizDoc.data();

        // Calculate score
        let totalPoints = 0;
        let earnedPoints = 0;

        quizData.questions.forEach((question: any) => {
            totalPoints += question.points;

            const userAnswer = answers[question.id];

            if (question.type === "mcq-single") {
                const correctAnswer = question.answers.find((a: any) => a.isCorrect);
                if (userAnswer === correctAnswer?.id) {
                    earnedPoints += question.points;
                }
            } else if (question.type === "mcq-multiple") {
                const correctAnswers = question.answers
                    .filter((a: any) => a.isCorrect)
                    .map((a: any) => a.id)
                    .sort();
                const userAnswers = (userAnswer as string[] || []).sort();

                if (JSON.stringify(correctAnswers) === JSON.stringify(userAnswers)) {
                    earnedPoints += question.points;
                }
            } else if (question.type === "true-false") {
                const correctAnswer = question.answers.find((a: any) => a.isCorrect);
                if (userAnswer === correctAnswer?.id) {
                    earnedPoints += question.points;
                }
            }
            // Short-answer questions require manual grading
        });

        const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        const passed = scorePercentage >= quizData.passingScore;

        // Save quiz attempt
        const attemptRef = doc(collection(db, "quiz_attempts"));
        await setDoc(attemptRef, {
            quizId,
            userId: session.user.id,
            courseId,
            attemptNumber,
            answers,
            score: scorePercentage,
            earnedPoints,
            totalPoints,
            passed,
            autoSubmit,
            startedAt: new Date(), // TODO: Track actual start time
            completedAt: new Date(),
            createdAt: new Date(),
        });

        // Update course progress if passed
        if (passed) {
            // TODO: Update course_progress collection
        }

        return NextResponse.json({
            success: true,
            message: passed ? "Congratulations! You passed!" : "You didn't pass this time. Try again!",
            attemptId: attemptRef.id,
            score: scorePercentage,
            passed
        });
    } catch (error) {
        console.error("Failed to submit quiz:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
