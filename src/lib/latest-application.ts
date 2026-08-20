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
 */

import { toMillis } from "@/lib/firestore-serialize";

/** How many of a member's applications a caller should read before deciding. */
export const APPLICATION_SCAN_LIMIT = 25;

/** Millis for the moment an application was submitted, 0 if unreadable. */
function submittedMillis(doc: any): number {
    const d = doc?.data?.() ?? {};
    return toMillis(d.submittedAt ?? d.createdAt);
}

/**
 * The newest document in `docs`, or null for an empty set.
 *
 * Stable: `docs` is copied before sorting, so the caller's snapshot order is
 * untouched.
 */
export function latestApplication<T = any>(docs: T[] | null | undefined): T | null {
    if (!docs || docs.length === 0) return null;

    return [...docs].sort((a, b) => submittedMillis(b) - submittedMillis(a))[0];
}
