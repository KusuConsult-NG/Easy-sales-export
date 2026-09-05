/**
 *   #386 RETIRED — THE ADMIN QUIZ EDITOR FOR AN EMPTY STORE.
 *
 *        The only writer of COLLECTIONS.QUIZZES, through
 *        /api/admin/academy/quiz/create — and nothing has ever linked here, so
 *        nothing has ever been written. It is the richer of the two editors: it
 *        sets a time limit, an attempt limit and two shuffle flags that the live
 *        editor does not. Those settings are not lost so much as never used;
 *        only one of them, the passing score, describes something the live
 *        grading path actually reads, and #386 added that field to the editor
 *        admins can reach. The course editor at /admin/academy/[courseId] opens
 *        that one from every quiz lesson.
 *
 *        The measurement, and what enabling it again would require, are in
 *        lib/academy-quiz-api.ts. The three API routes behind this screen refuse
 *        unless ACADEMY_QUIZ_API is set to the exact word "enabled"; nothing is
 *        deleted, and this URL keeps working by landing on the live screen.
 */

import { redirect } from "next/navigation";

export default async function RetiredAdminQuizPage({ params }: { params: Promise<{ courseId: string }> }) {
    const { courseId } = await params;
    redirect(`/admin/academy/${courseId}`);
}
