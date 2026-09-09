/**
 * Academy live class — the server half. See #543 / #545.
 *
 * The course and its live sessions are independent reads keyed on the same id,
 * and the client awaited them one after the other. They run in parallel here,
 * and the raw results are handed over so the "which session is active" pick and
 * the synthesised-title fallback stay in the client, in one place.
 */

import { getCourseByIdAction, getLiveSessionsAction } from "@/app/actions/academy";
import AcademyLiveClassClient from "./AcademyLiveClassClient";

/**
 *   #549 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function AcademyLiveClassPage({ params }: { params: Promise<{ courseId: string }> }) {
    const { courseId } = await params;

    const [courseReq, liveRes] = await Promise.all([
        getCourseByIdAction(courseId).catch(() => null),
        getLiveSessionsAction(courseId).catch(() => null),
    ]);

    //   Both or neither: the client's loader consumes the seed in one go, so a
    //   half-seed would leave the live-session panel permanently empty.
    const initial = courseReq && liveRes ? { courseReq, liveRes } : null;

    return <AcademyLiveClassClient courseId={courseId} initial={initial} />;
}
