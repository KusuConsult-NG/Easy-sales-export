export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { auth } from "@/lib/auth";
import { db } from "@/lib/firebase-admin";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "firebase-admin/firestore";

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

        // Get quiz data to calculate score (Admin SDK)
        const quizDoc = await db.collection(COLLECTIONS.QUIZZES).doc(quizId).get();

        if (!quizDoc.exists) {
            return NextResponse.json(
                { success: false, message: "Quiz not found" },
                { status: 404 }
            );
        }

        const quizData = quizDoc.data()!;

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
        });

        const scorePercentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
        const passed = scorePercentage >= quizData.passingScore;

        // Save quiz attempt (Admin SDK)
        const attemptRef = db.collection(COLLECTIONS.QUIZ_ATTEMPTS).doc();
        await attemptRef.set({
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
            completedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        });

        // Update course progress if passed
        if (passed) {
            const progressRef = db.collection(COLLECTIONS.COURSE_PROGRESS).doc(`${session.user.id}_${courseId}`);
            const progressDoc = await progressRef.get();

            const moduleId = quizData.moduleId || "module_unknown";
            const updateData: any = {
                [`quizScores.${moduleId}`]: scorePercentage,
                lastAccessedAt: FieldValue.serverTimestamp(),
            };

            if (progressDoc.exists) {
                const currentData = progressDoc.data()!;
                const completedQuizzes = new Set(currentData.completedQuizzes || []);
                completedQuizzes.add(moduleId);
                updateData.completedQuizzes = Array.from(completedQuizzes);
                await progressRef.set(updateData, { merge: true });
            } else {
                updateData.userId = session.user.id;
                updateData.courseId = courseId;
                updateData.completedQuizzes = [moduleId];
                updateData.createdAt = FieldValue.serverTimestamp();
                await progressRef.set(updateData);
            }
        }

        return NextResponse.json({
            success: true,
            message: passed ? "Congratulations! You passed!" : "You didn't pass this time. Try again!",
            attemptId: attemptRef.id,
            score: scorePercentage,
            passed
        });
    } catch (error) {
        logger.error("Failed to submit quiz:", error);
        return NextResponse.json(
            { success: false, message: "Internal server error" },
            { status: 500 }
        );
    }
}
