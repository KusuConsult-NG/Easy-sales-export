/**
 * What a profile actually HOLDS — #813.
 *
 *   THE DUPLICATE WORKLIST ASKED A QUESTION NOBODY LEFT CAN ANSWER.
 *
 *   `/admin/forensics/duplicates` shows three groups where two records share an
 *   address and neither points at the other, and it asks the operator to
 *   "choose the one that is the person". The owner's answer was that they
 *   cannot: they did not onboard these members and the staff who did have left.
 *
 *   That is not a gap in the operator. It is a question the screen should never
 *   have needed a human memory for. The platform holds the evidence — it knows
 *   which record placed the orders, holds the membership, sat the course and
 *   earned the certificate — and it was simply not showing it.
 *
 * ── AND THE DECISION IS SMALLER THAN IT LOOKS ───────────────────────────────
 *
 *   Worth stating plainly, because fear of an irreversible mistake is what
 *   stalls this screen:
 *
 *   NOTHING IS LOST BY CHOOSING. Superseding writes one pointer field.
 *   `resolveOwnedUserIds` walks that pointer BACKWARDS — it asks which rows
 *   point at the live id — so every order, listing, enrolment and membership
 *   filed under the superseded record becomes readable from the keeper. That is
 *   what the userId sweep put in place across all six modules.
 *
 *   AND IT IS REVERSIBLE. Clearing the pointer puts the group back exactly as
 *   it was. The ONE exception is money: a wallet balance moves only on an
 *   explicit, separately-consented second act, and that one does not come back
 *   by clearing a field.
 *
 *   So the footprint is not there to make the decision safe — it already is.
 *   It is there so the operator can make it on evidence instead of on nothing.
 *
 * ── IT FAILS LOUD, AND THAT IS THE WHOLE DESIGN ─────────────────────────────
 *
 *   A count that cannot be read must NEVER render as zero. "This record holds
 *   nothing" is precisely the sentence that would send an operator to discard
 *   the record that holds everything, and a failed query reported as 0 says it
 *   with total confidence.
 *
 *   So a failure is `null`, the screen renders it as "could not read", and the
 *   two states are never folded together. This is #313's rule applied to the
 *   one number that decides an identity.
 */

import { mapWithConcurrency } from "@/lib/bounded-concurrency";
import { COLLECTIONS } from "@/lib/types/firestore";
import { logger } from "@/lib/logger";

/**
 * Where a person's work lives, and the field it is filed under.
 *
 * NOT INVENTED HERE. Every pair is taken from a live `filterByOwner` call in
 * the application — the reads the modules themselves perform — because a
 * footprint that queried a field nothing writes would report zero for every
 * record and be worse than showing nothing at all.
 */
export const FOOTPRINT_SOURCES: readonly { label: string; collection: string; field: string }[] = [
    { label: "Orders placed", collection: COLLECTIONS.MARKETPLACE_ORDERS, field: "buyerId" },
    { label: "Products listed", collection: COLLECTIONS.PRODUCTS, field: "sellerId" },
    { label: "Cooperative loans", collection: COLLECTIONS.COOPERATIVE_LOANS, field: "memberId" },
    { label: "Loan applications", collection: COLLECTIONS.LOAN_APPLICATIONS, field: "userId" },
    { label: "Course enrolments", collection: COLLECTIONS.COURSE_ENROLLMENTS, field: "userId" },
    { label: "WAVE certificates", collection: COLLECTIONS.WAVE_CERTIFICATES, field: "userId" },
    { label: "Export slots", collection: COLLECTIONS.EXPORT_SLOTS, field: "userId" },
    { label: "Land offers made", collection: COLLECTIONS.LAND_OFFERS, field: "buyerId" },
    { label: "Withdrawals", collection: COLLECTIONS.WITHDRAWALS, field: "userId" },
];

/** A count, or `null` where the read failed. Never 0 for a failure. */
export type FootprintCounts = Record<string, number | null>;

/** Everything one profile holds, plus whether any read failed. */
export interface Footprint {
    counts: FootprintCounts;
    /** The rows found across every source that answered. */
    total: number;
    /** True when at least one source could not be read — so `total` is a floor. */
    incomplete: boolean;
}

interface CountableCollection {
    where(field: string, op: string, value: unknown): CountableCollection;
    count(): { get(): Promise<{ data(): { count?: number } }> };
}

interface FootprintDb {
    collection(name: string): CountableCollection;
}

/** How many of each source's rows name `id`. Bounded, and honest about failure. */
async function footprintFor(db: FootprintDb, id: string): Promise<Footprint> {
    const counts: FootprintCounts = {};
    let total = 0;
    let incomplete = false;

    //   Eight at a time, the bound used by every other fan-out in this codebase.
    const results = await mapWithConcurrency(
        FOOTPRINT_SOURCES, 8,
        async (source) => {
            try {
                const snap = await db.collection(source.collection)
                    .where(source.field, "==", id).count().get();
                const n = snap.data().count;
                return typeof n === "number" && Number.isFinite(n) ? n : null;
            } catch (error) {
                //   Logged, because a source that cannot be read is a fact about
                //   the platform and not only about this screen.
                logger.warn("[profile-footprint] could not count a source", {
                    id, collection: source.collection, field: source.field,
                    error: error instanceof Error ? error.message : String(error),
                });
                return null;
            }
        },
    );

    FOOTPRINT_SOURCES.forEach((source, i) => {
        const n = results[i];
        counts[source.label] = n;
        if (n === null) incomplete = true;
        else total += n;
    });

    return { counts, total, incomplete };
}

/**
 * The footprint of each id.
 *
 * Deliberately takes a LIST and not a group: the caller decides which profiles
 * are worth this, and the duplicate screen asks only for the handful that
 * genuinely need a decision. Running it over every candidate in 496 groups
 * would be nine count queries times twelve hundred records, to answer a
 * question 493 of those groups do not ask.
 */
export async function footprintsFor(
    db: FootprintDb, ids: readonly string[],
): Promise<Record<string, Footprint>> {
    const wanted = [...new Set(ids.filter(Boolean))];
    const out: Record<string, Footprint> = {};

    const results = await mapWithConcurrency(wanted, 4, (id) => footprintFor(db, id));
    wanted.forEach((id, i) => { out[id] = results[i]; });

    return out;
}

/**
 * Which id holds the most, or null when nothing distinguishes them.
 *
 * NOT A RECOMMENDATION, and deliberately not wired to one. The screen already
 * recommends a keeper using the ranking the LOGIN itself applies, and a second
 * recommendation from a different rule is how a tool comes to disagree with the
 * platform it describes. This only answers "is there a clear difference here",
 * so the screen can say so in words.
 *
 * A tie answers null. So does a group where any footprint is incomplete: a
 * floor cannot be compared against a total without possibly preferring the
 * record that merely READ successfully.
 */
export function clearlyRicher(footprints: Record<string, Footprint>): string | null {
    const entries = Object.entries(footprints);
    if (entries.length < 2) return null;
    if (entries.some(([, f]) => f.incomplete)) return null;

    const sorted = [...entries].sort((a, b) => b[1].total - a[1].total);
    const [topId, top] = sorted[0];
    const [, second] = sorted[1];

    if (top.total === 0) return null;
    return top.total > second.total ? topId : null;
}
