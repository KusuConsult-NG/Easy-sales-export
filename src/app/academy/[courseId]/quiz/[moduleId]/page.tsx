/**
 * A module quiz — the server half. See #543 / #545.
 *
 * One read: the course, from which the client picks the module and its quiz.
 * It was made after the page had already been sent, downloaded and hydrated —
 * on a screen where a student is about to start a timed assessment, so the
 * waiting is the last thing anyone wants there.
 *
 * The RESULT is seeded rather than the quiz, because #492's rule lives on the
 * client: a REFUSED course read must not be shown as "quiz not found". Picking
 * the quiz out here would either lose that distinction or duplicate it.
 *
 * The ids are resolved here too. The client unwrapped `params` with React's
 * `use`, which is what a client page had to do; the server half awaits them
 * once and passes two strings.
 */

import { getCourseByIdAction } from "@/app/actions/academy";
import { rawSeed } from "@/lib/server-seed";
import QuizClient from "./QuizClient";

/**
 *   #562 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function QuizPage({
    params,
}: {
    params: Promise<{ courseId: string; moduleId: string }>;
}) {
    const { courseId, moduleId } = await params;

    const initial = rawSeed(
        "academy course for quiz", await getCourseByIdAction(courseId).catch(() => null),
    );

    return <QuizClient courseId={courseId} moduleId={moduleId} initial={initial} />;
}
