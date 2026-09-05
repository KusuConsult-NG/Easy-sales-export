/**
 *   #386 RETIRED — THE LEARNER QUIZ OVER AN EMPTY STORE.
 *
 *        This lists COLLECTIONS.QUIZZES through /api/academy/quiz/[courseId].
 *        That collection has one writer — an admin screen with no way in — so it
 *        holds no quizzes and never has, and this screen has shown an empty list
 *        for every course since it was written. A learner takes a module quiz at
 *        /academy/[courseId]/quiz/[moduleId], which reads the quiz stored on the
 *        course module, and the course page links to it per module.
 *
 *        The measurement, and what enabling it again would require, are in
 *        lib/academy-quiz-api.ts. The three API routes behind this screen refuse
 *        unless ACADEMY_QUIZ_API is set to the exact word "enabled"; nothing is
 *        deleted, and this URL keeps working by landing on the live screen.
 */

import { redirect } from "next/navigation";

export default async function RetiredLearnerQuizPage({ params }: { params: Promise<{ courseId: string }> }) {
    const { courseId } = await params;
    redirect(`/academy/${courseId}`);
}
