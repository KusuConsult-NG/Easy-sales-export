/**
 * Academy course detail — the server half. See #543 / #545.
 *
 * The course and the member's progress were already parallel in the client and
 * are fetched here instead. The raw results are handed over: the client decides
 * enrolment and lesson state from them, and that stays in one place.
 */

import { auth } from "@/lib/auth";
import { getCourseByIdAction, getUserProgressAction } from "@/app/actions/academy";
import CourseDetailClient from "./CourseDetailClient";

/**
 *   #553 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CourseDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
    const { courseId } = await params;

    const session = await auth().catch(() => null);
    const userId = session?.user?.id;

    const [courseReq, progressReq] = userId
        ? await Promise.all([
            getCourseByIdAction(courseId).catch(() => null),
            getUserProgressAction(userId, courseId).catch(() => null),
        ])
        : [null, null];

    //   Both or neither: the client consumes the seed in one go, so a half-seed
    //   would render a course with no progress behind it.
    const initial = courseReq && progressReq ? { courseReq, progressReq } : null;

    return <CourseDetailClient courseId={courseId} initial={initial} />;
}
