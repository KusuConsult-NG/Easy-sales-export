/**
 * The member's MOST RECENT application, from a set of application documents.
 *
 * TWO DEFECTS IN ONE LINE OF QUERY
 * --------------------------------
 * Every fallback layer in module-access-check.ts, and the academy webhook
 * handler in infrastructure/payments/service.ts, read
 *
 *     .where("userId", "==", userId).limit(1)
 *
 * with no orderBy, then trusted whatever came back.
 *
 *   WHICH APPLICATION ANSWERED WAS ARBITRARY (#227). PostgREST returns rows in
 *   whatever order the plan produces — the adapter's fallback is `.order('id')`
 *   — so for a member with more than one application two identical requests
 *   could be decided by different records.
 *
 *   AND AN OLD APPROVAL OVERRODE A NEW REJECTION (#228). Apply, be approved.
 *   Reapply, be rejected — #210 revokes the module role and marks the
 *   registration rejected. The member then opens any page in the module: the
 *   JWT layer fails, the registration-status layer sees "rejected", and the
 *   fallback finds the OLD approved application and writes `status: "approved"`
 *   back over the rejection, role included. Persisted, on a page load.
 *
 * _checkAcademyStatusAction already sorted applications this way and took the
 * newest. The rule existed in the codebase; the two places that decide access
 * and fulfil payment did not use it. This is that rule, in one place, so a third
 * caller cannot quietly disagree with the first two.
 *
 * `toMillis` is the reader from #49: submittedAt arrives as a Timestamp, an ISO
 * string, or nothing at all depending on which path wrote the row, and
 * createdAt is the fallback because not every writer sets submittedAt.
 *
 *
 *   #412 AND WHEN NOTHING RECORDED A TIME, THE FIX HANDED THE DECISION STRAIGHT
 *   BACK TO THE QUERY PLANNER — AT THE WRONG END.
 *
 *   The comparator was `submittedMillis(b) - submittedMillis(a)` and nothing
 *   else. `toMillis` answers 0 for a value it cannot read, so for a set of
 *   documents where NO document carries a readable submittedAt or createdAt,
 *   every key is 0, every comparison is 0, the sort is a no-op, and this
 *   returned `docs[0]` — the incidental order of the snapshot. That is #49's
 *   "key is 0" shape sitting inside the fix for #227, and it gave back exactly
 *   the property #227 was written to remove.
 *
 *   AND IT LANDED ON THE OLDEST RECORD, NOT A RANDOM ONE. A query with no
 *   orderBy falls through to `.order('id')` ASCENDING in supabase-db.ts, so
 *   `docs[0]` is the LOWEST id — and the ids this codebase mints for
 *   applications embed the clock: `ACADEMY-${Date.now()}-…` (which is also the
 *   document id), `WAVE-${Date.now()}-…`, `EXPORT-ONBOARD-${Date.now()}-…`.
 *   Lowest id is therefore the OLDEST application. So in the one case this
 *   module could not read a timestamp it did not merely pick arbitrarily, it
 *   picked the inverse of its own rule — old approval, new rejection, #228
 *   again, in the function that exists to prevent it.
 *
 *   HOW REACHABLE IS IT. Every application writer in src/app/actions that this
 *   audit has read stamps submittedAt or createdAt, so no code path produces
 *   the all-unreadable set today. The rows that would are the ones Layers
 *   2.6–2.11 exist for — "legacy/bulk-imported members whose user documents were
 *   never backfilled", written outside this codebase — and with no live
 *   database available there is no way to check them from here. So this is
 *   stated as what it is: a contract this module did not keep, not a defect
 *   observed biting a named user.
 *
 *   FIXED, in three parts.
 *
 *     1. The tie is broken by the most recent moment anything is RECORDED to
 *        have happened to the row — updatedAt, reviewedAt, approvedAt,
 *        rejectedAt, whichever is latest. A decision writes at least one of
 *        these (the academy reviewer writes reviewedAt and no updatedAt, which
 *        is why this takes the max of all four rather than the first present
 *        one), so the record that was most recently DECIDED wins the tie, which
 *        is the question the callers are actually asking.
 *
 *     2. Failing that, the document id, DESCENDING. This is a determinism
 *        guarantee, not a correctness one: for the three time-encoded id
 *        schemes above it is the newest, and for a uuidv4 auto-id it is
 *        arbitrary — but it is arbitrary in a way THIS module states, rather
 *        than inherited from whatever order the query plan happened to
 *        produce. It is also the opposite end from the one that was being
 *        picked.
 *
 *     3. It says so. A set of two or more candidates with no readable time at
 *        all is now a warn line naming the ids and the choice, because the
 *        repair for that is in the DATA and nothing could see it from here.
 */

import { toMillis } from "@/lib/firestore-serialize";
import { logger } from "@/lib/logger";

/** How many of a member's applications a caller should read before deciding. */
export const APPLICATION_SCAN_LIMIT = 25;

/** Millis for the moment an application was submitted, 0 if unreadable. */
function submittedMillis(doc: any): number {
    const d = doc?.data?.() ?? {};
    return toMillis(d.submittedAt ?? d.createdAt);
}

/**
 * Millis for the LATEST moment anything is recorded to have happened to the
 * row — 0 if none of it is readable.
 *
 * The max rather than a `??` chain on purpose: markAcademyApplicationUnderReview
 * writes `reviewedAt` and `updatedAt`, but the manual-enrolment path writes
 * `reviewedAt` alone, and the legacy provisioning path writes `approvedAt` and
 * `updatedAt`. A first-present-wins chain would compare one row's updatedAt
 * against another row's reviewedAt and call the older one newer.
 */
function decidedMillis(doc: any): number {
    const d = doc?.data?.() ?? {};
    return Math.max(
        toMillis(d.updatedAt),
        toMillis(d.reviewedAt),
        toMillis(d.approvedAt),
        toMillis(d.rejectedAt),
    );
}

/** The document id, as a string — "" when there is none to read. */
function documentId(doc: any): string {
    const id = doc?.id;
    return typeof id === "string" ? id : (id == null ? "" : String(id));
}

/**
 * The rule, as one comparator: newest first.
 *
 * Submitted time, then decided time, then document id descending. Every step is
 * a tiebreak for the one above it, so a readable submittedAt still decides on
 * its own exactly as it did before #412 — the additions can only change the
 * outcome where the comparator used to return 0 and the answer came from the
 * snapshot's incidental order.
 */
function newestFirst(a: any, b: any): number {
    const bySubmitted = submittedMillis(b) - submittedMillis(a);
    if (bySubmitted !== 0) return bySubmitted;

    const byDecided = decidedMillis(b) - decidedMillis(a);
    if (byDecided !== 0) return byDecided;

    return documentId(b).localeCompare(documentId(a));
}

/**
 * `docs`, newest first.
 *
 * Stable: `docs` is copied before sorting, so the caller's snapshot order is
 * untouched. Array.prototype.sort mutates in place, and a caller that reads
 * `snapshot.docs` again after calling this would otherwise see it reordered.
 */
export function sortApplicationsNewestFirst<T = any>(docs: T[] | null | undefined): T[] {
    if (!docs || docs.length === 0) return [];

    const sorted = [...docs].sort(newestFirst);

    /**
     * The case the header is about. Nothing here can repair it — the missing
     * timestamps are in the data — so the least this can do is stop being
     * silent about which rows have the shape.
     */
    if (sorted.length > 1 && sorted.every((d) => submittedMillis(d) === 0)) {
        logger.warn(
            "[latestApplication] No candidate carries a readable submittedAt or createdAt — "
            + "the choice below is a tiebreak, not a date comparison. Backfill these rows.",
            {
                candidates: sorted.map((d) => documentId(d)),
                chose: documentId(sorted[0]),
            },
        );
    }

    return sorted;
}

/**
 * The newest document in `docs`, or null for an empty set.
 */
export function latestApplication<T = any>(docs: T[] | null | undefined): T | null {
    return sortApplicationsNewestFirst(docs)[0] ?? null;
}
