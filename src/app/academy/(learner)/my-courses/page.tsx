/**
 * Academy "my courses" — the server half. See #543 for the pattern and #545
 * for the ledger this batch is working through.
 */

import { getEnrolledCoursesWithDetailsAction, type EnrolledCourseWithDetails } from "@/app/actions/academy";
import MyCoursesClient from "./MyCoursesClient";

/**
 *   #546 EXPLICITLY DYNAMIC — this page reads a session, so Next cannot
 *   prerender it. Saying so stops the build-time probe and the misleading
 *   "couldn't be rendered statically" stack traces it produces (see #543).
 */
export const dynamic = "force-dynamic";

export default async function MyCoursesPage() {
    const result = await getEnrolledCoursesWithDetailsAction().catch(() => null);
    const initial = result?.success
        ? ((result.data?.courses as EnrolledCourseWithDetails[]) ?? [])
        : null;

    return <MyCoursesClient initial={initial} />;
}
