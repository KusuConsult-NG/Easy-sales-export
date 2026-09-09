/**
 * Academy lesson player — the server half. See #543 / #545.
 *
 * Three reads, already parallel in the client, fetched here instead. The RAW
 * results are handed over: the client walks the course to find the current
 * lesson and module, computes the next and previous lessons, and merges the
 * video progress. That derivation stays in one place.
 */

import { auth } from "@/lib/auth";
import { getCourseByIdAction, getUserProgressAction } from "@/app/actions/academy";
import { getLessonProgress } from "@/app/actions/course-actions";
import LessonClient from "./LessonClient";

/**
 *   #555 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function LessonPage({ params }: {
    params: Promise<{ courseId: string; lessonId: string }>;
}) {
    const { courseId, lessonId } = await params;

    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const [courseReq, progressReq, lessonProgressData] = userId
        ? await Promise.all([
            getCourseByIdAction(courseId).catch(() => null),
            getUserProgressAction(userId, courseId).catch(() => null),
            getLessonProgress(lessonId).catch(() => null),
        ])
        : [null, null, null];

    //   All three or none: the client consumes them together to build one view.
    const initial = courseReq && progressReq && lessonProgressData
        ? { courseReq, progressReq, lessonProgressData }
        : null;

    return <LessonClient courseId={courseId} lessonId={lessonId} initial={initial} />;
}
