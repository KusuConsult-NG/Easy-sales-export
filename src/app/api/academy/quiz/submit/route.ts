export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { logger } from '@/lib/logger';
import { requireSession } from "@/lib/session-guard";
import { supabaseDb as db } from "@/lib/supabase-db";
import { COLLECTIONS } from "@/lib/types/firestore";
import { FieldValue } from "@/lib/firestore-compat";
import { gradeStoredQuiz } from "@/lib/academy-grading";

/**
 * API Route: Submit Quiz Attempt
 */
export async function POST(request: NextRequest) {
    try {
        const session = (await requireSession()).session;
        if (!session?.user) {
            return NextResponse.json(
                { success: false, message: "Unauthorized" },
                { status: 401 }
            );
        }

        const { quizId, courseId: claimedCourseId, answers, autoSubmit } = await request.json();

        if (!quizId || !claimedCourseId || !answers) {
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

        // The course credited is the quiz's course, not the caller's.
        //
        // The score was computed from `quizId`'s quiz and the progress was
        // written to `${userId}_${courseId}` with courseId taken from the
        // request body. Nothing compared the two, so a pass on any quiz could be
        // recorded against any course — including the grade that
        // /api/academy/certificate/generate puts on the certificate, which reads
        // progressData.quizScores.
        const courseId = quizData.courseId;
        if (!courseId) {
            return NextResponse.json(
                { success: false, message: "Quiz is not attached to a course" },
                { status: 409 }
            );
        }
        if (claimedCourseId !== courseId) {
            logger.warn("[quiz/submit] courseId in request does not match the quiz", {
                userId: session.user.id,
                quizId,
                claimed: claimedCourseId,
                actual: courseId,
            });
            return NextResponse.json(
                { success: false, message: "Quiz does not belong to that course" },
                { status: 400 }
            );
        }

        // maxAttempts is enforced here, having been enforced nowhere.
        //
        // The admin quiz editor collects it and defaults it to 3, the learner
        // screen prints "attempt N of {quiz.maxAttempts}", and no server code
        // ever read it. attemptNumber came from the request body and was stored
        // as given, while the fetch route returned a hardcoded `attemptNumber:
        // 1`. So the limit was decorative and the recorded number was whatever
        // the client said.
        const priorAttempts = await db.collection(COLLECTIONS.QUIZ_ATTEMPTS)
            .where("userId", "==", session.user.id)
            .where("quizId", "==", quizId)
            .get();

        const maxAttempts = Number.isFinite(quizData.maxAttempts) ? Number(quizData.maxAttempts) : 0;
        if (maxAttempts > 0 && priorAttempts.docs.length >= maxAttempts) {
            return NextResponse.json(
                { success: false, message: `No attempts remaining (${maxAttempts} used)` },
                { status: 429 }
            );
        }

        // Derived, not accepted.
        const attemptNumber = priorAttempts.docs.length + 1;

        const { earnedPoints, totalPoints, scorePercentage, passed } = gradeStoredQuiz(
            quizData.questions ?? [],
            answers,
            quizData.passingScore
        );

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
