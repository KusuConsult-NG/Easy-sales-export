/**
 * Academy course catalogue — the server half. See #543 / #545.
 *
 * The two reads are independent — the catalogue and the member's own
 * enrolments — and were awaited in series in the client. They run in parallel
 * here, and the raw results are handed over so the "which courses am I enrolled
 * in" derivation stays in one place.
 */

import { getCoursesAction, getEnrolledCoursesWithDetailsAction } from "@/app/actions/academy";
import CourseCatalogClient from "./CourseCatalogClient";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CourseCatalogPage() {
    const [coursesRes, enrollRes] = await Promise.all([
        getCoursesAction(48).catch(() => null),
        getEnrolledCoursesWithDetailsAction().catch(() => null),
    ]);

    //   Both or neither: the client skips its whole load when seeded, so a
    //   half-seed would leave the enrolment marks permanently missing.
    const initial = coursesRes && enrollRes ? { coursesRes, enrollRes } : null;

    return <CourseCatalogClient initial={initial} />;
}
