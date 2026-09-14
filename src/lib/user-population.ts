/**
 * Counting people rather than rows.
 *
 *   #747 THE HEADLINE "TOTAL USERS" COUNTED THE ROWS THE PLATFORM HAD ALREADY
 *        DECIDED WERE NOT PEOPLE.
 *
 *   The USERS collection holds two kinds of tombstone, and this audit has spent
 *   seven findings on the difference between them:
 *
 *     deleted: true    an account ERASED at the person's request. The scrub
 *                      leaves the row so referring records do not dangle, but
 *                      the person asked to be gone.
 *     _migratedTo      a profile SUPERSEDED by #724's duplicate resolver. It
 *                      and its target are ONE person, and the platform knows
 *                      it — that is what the field records.
 *
 *   `db.collection(USERS).count()` counts both. So the number an owner reads as
 *   "Total Users" is inflated by every erasure honoured and by every duplicate
 *   an admin has resolved. Resolving a duplicate never lowered it, which is the
 *   sharpest way to put it: the platform can KNOW two rows are one person and
 *   still report two.
 *
 * ── #735 BUILT THIS FOR THE FIGURE NEXT DOOR ────────────────────────────────
 *
 *   "Erasing an account made it count as an ACTIVE user" — because both
 *   tombstone operations write `updatedAt`, and active was `updatedAt >= 30
 *   days ago`. #735 fixed that figure with inclusion–exclusion, four lines
 *   above a raw `.count()` of the same collection for the total.
 *
 *   One of two, again. So the subtraction lives here now and both read it.
 *
 * ── WHY INCLUSION–EXCLUSION AND NOT A FILTER ────────────────────────────────
 *
 *   These are `.count()` aggregates: there are no rows to inspect, and the two
 *   conditions are on different fields, so a single query cannot express "has
 *   neither". A row that is BOTH erased and superseded would be removed twice,
 *   so it is added back — #735's note, kept because it is the part that is easy
 *   to get wrong.
 *
 *   And a NEGATIVE filter cannot be used instead. `_migratedTo != ""` matches
 *   rows that HAVE the field and no others: the adapter emits
 *   `raw_data->>'f' <> 'x'`, which is NULL — and therefore NOT TRUE — for a row
 *   missing the key. So `.where("_migratedTo", "==", "")` would match nothing
 *   at all rather than "every row without a pointer". That property is asserted
 *   in fake-db-matches-postgres, and loadNonContactableUserIds relies on it
 *   too.
 */

/** The two fields that mark a row as not a current person. */
export const TOMBSTONE_FIELDS = { erased: "deleted", superseded: "_migratedTo" } as const;

/**
 * The minimum shape this needs from a query: something that can be narrowed and
 * counted. Kept structural so the adapter and the fake both satisfy it without
 * importing either.
 */
export interface CountableQuery {
    where(field: string, op: string, value: unknown): CountableQuery;
    count(): { get(): Promise<{ data(): { count?: number | null } }> };
}

/**
 * How many rows in this query are neither erased nor superseded.
 *
 * Takes a QUERY rather than a collection so the same subtraction serves every
 * figure — the total, the recently-active window, the verified count — instead
 * of being rewritten per call site with its own filter already applied. That
 * matters for more than tidiness: `unverified = total - verified` is only
 * coherent if both sides counted the same population.
 */
export async function countLivePeople(query: CountableQuery): Promise<number> {
    const erased = TOMBSTONE_FIELDS.erased;
    const superseded = TOMBSTONE_FIELDS.superseded;

    const [allSnap, erasedSnap, supersededSnap, bothSnap] = await Promise.all([
        query.count().get(),
        query.where(erased, "==", true).count().get(),
        query.where(superseded, "!=", "").count().get(),
        query.where(erased, "==", true).where(superseded, "!=", "").count().get(),
    ]);

    const all = allSnap.data().count ?? 0;
    const tombstoned =
        (erasedSnap.data().count ?? 0)
        + (supersededSnap.data().count ?? 0)
        - (bothSnap.data().count ?? 0);

    //   Never below zero: a count that disagrees with its own subtrahend should
    //   read as "none", not as a negative figure on an admin dashboard. #735's
    //   guard, kept.
    return Math.max(0, all - tombstoned);
}
