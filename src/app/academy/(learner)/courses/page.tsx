/**
 * Academy course catalogue — the server half. See #543 / #545.
 *
 * The two reads are independent — the catalogue and the member's own
 * enrolments — and were awaited in series in the client. They run in parallel
 * here, and the raw results are handed over so the "which courses am I enrolled
 * in" derivation stays in one place.
 */

import { getCoursesAction, getEnrolledCoursesWithDetailsAction, getMyAcademyStandingAction } from "@/app/actions/academy";
import CourseCatalogClient from "./CourseCatalogClient";
import { seedOrNull } from "@/lib/server-seed";

/**
 *   #547 EXPLICITLY DYNAMIC — reads a session, so Next cannot prerender it (#543).
 */
export const dynamic = "force-dynamic";

export default async function CourseCatalogPage() {
    /*
     *   The standing joins the two reads already running here, so reading it
     *   LIVE costs no extra round trip. See getMyAcademyStandingAction: the
     *   client used to take the plan off the JWT, which is up to eight hours
     *   old, and showed "Buy for NGN x" to learners who had already paid.
     */
    const [coursesRes, enrollRes, standingRes] = await Promise.all([
        getCoursesAction(48).catch(() => null),
        getEnrolledCoursesWithDetailsAction().catch(() => null),
        getMyAcademyStandingAction().catch(() => null),
    ]);

    //   #552's shared unwrapper rather than an inline `?.success ? … : null`:
    //   it logs WHY a seed is missing, so a refused read is distinguishable
    //   from one that threw instead of both silently becoming null.
    const standing = seedOrNull("academy standing", standingRes);

    //   Both or neither: the client skips its whole load when seeded, so a
    //   half-seed would leave the enrolment marks permanently missing.
    const initial = coursesRes && enrollRes ? { coursesRes, enrollRes } : null;

    return <CourseCatalogClient initial={initial} standing={standing} />;
}
