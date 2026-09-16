/**
 * Which of these courses has this learner bought outright?
 *
 *   #812 A COURSE BOUGHT OUTRIGHT OPENED NOWHERE THE PLAN GATE WAS ASKED.
 *
 *   checkCourseAccess takes THREE arguments:
 *
 *       checkCourseAccess(userPlan, courseTier, purchased)
 *
 *   #378 added the third — the fact that this learner bought THIS course,
 *   stamped on their progress row by academy-purchase-flow — and wired it into
 *   ONE of the ten places the rule is asked. COUNTED, at the time of this
 *   finding:
 *
 *       CourseDetailClient.tsx          passes it        1
 *       everywhere else                 omits it         9
 *
 *   The default is `false`, so every one of those nine silently answered "does
 *   their PLAN cover this tier" and told a paying learner no.
 *
 * ── WHAT IT COST, ON TWO SCREENS THE OWNER REPORTED ─────────────────────────
 *
 *   THE LIVE CLASS. _ac_live strips `roomKey` when the gate fails, and
 *   VideoClassroom refuses anything that is not a minted key — so a learner who
 *   had bought that exact course was shown
 *
 *       "This classroom is not open. Ask the instructor to start the class, or
 *        check that your plan includes this course."
 *
 *   while the class ran without them. The message tells them to check a plan,
 *   which is the thing they bought the course INSTEAD of. `recordingUrl` goes
 *   with it, so they could not watch it afterwards either.
 *
 *   THE COURSE ITSELF, which is worse. getCourseByIdAction — "this is where the
 *   content is served", by its own comment — ran stripLockedContent, which
 *   DELETES content, videoUrl, documentUrl and excelUrl from every lesson and
 *   marks it `locked: true`. The client then computed access CORRECTLY, because
 *   it is the one site that passes `purchased`, and rendered a course it had
 *   been told the learner could open with every video already removed from the
 *   payload.
 *
 *   So they paid, the page let them in, and there was nothing inside.
 *
 * ── WHY THIS IS A MODULE AND NOT NINE EDITS ─────────────────────────────────
 *
 *   The nine sites share a shape: they have a viewer and some course ids, and
 *   they need the third argument. Spelling the read out at each one is how the
 *   count became nine in the first place, and this audit's most repeated
 *   finding is a correct rule applied to some of the places it names — met
 *   twice in my own work already.
 *
 *   ONE READER, so a tenth call site starts by asking this.
 *
 * ── A FAILED READ IS NOT A PURCHASE ─────────────────────────────────────────
 *
 *   This function widens who sees paid content, so it fails CLOSED: a record
 *   that cannot be read resolves to "not purchased" and the caller falls back
 *   to the plan check, exactly as it behaved before. The failure is logged,
 *   because a learner wrongly refused the thing they paid for should leave a
 *   trace rather than a shrug.
 */

import { supabaseDb as db } from "@/lib/supabase-db";
import { logger } from "@/lib/logger";
import { isPurchasedCourse } from "@/lib/academy-plan";
import { userProgressPath } from "@/lib/academy-course-progress";

/**
 * The subset of `courseIds` this learner bought outright.
 *
 * One read per DISTINCT course rather than per row: the callers that need this
 * are listing pages, where the same course appears several times.
 *
 * @param userId    the viewer. An empty value returns an empty set — an
 *                  anonymous caller has bought nothing.
 * @param courseIds may contain duplicates and empty values; both are dropped.
 */
export async function purchasedCourseIds(
    userId: string | null | undefined,
    courseIds: ReadonlyArray<string | null | undefined>,
): Promise<Set<string>> {
    const purchased = new Set<string>();
    if (!userId) return purchased;

    const ids = [...new Set(
        courseIds.filter((id): id is string => typeof id === "string" && id.length > 0),
    )];
    if (ids.length === 0) return purchased;

    await Promise.all(ids.map(async (courseId) => {
        try {
            const doc = await db.doc(userProgressPath(userId, courseId)).get();
            if (doc.exists && isPurchasedCourse(doc.data() as any)) {
                purchased.add(courseId);
            }
        } catch (error) {
            //   Not silent. The consequence of this read failing is a paying
            //   learner being refused their own course, which is precisely the
            //   defect this module exists to end.
            logger.error("[academy] could not read a learner's course purchase record", {
                userId,
                courseId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }));

    return purchased;
}

/** Did this learner buy this one course outright? */
export async function hasPurchasedCourse(
    userId: string | null | undefined,
    courseId: string | null | undefined,
): Promise<boolean> {
    if (!courseId) return false;
    return (await purchasedCourseIds(userId, [courseId])).has(courseId);
}
