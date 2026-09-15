/**
 *   #786 SORTING AN ADMIN LIST BY SOMETHING THAT IS NOT A COLUMN.
 *
 *   The owner: "Sorting/filtering by applicant name in the WAVE Admin Dashboard
 *   is not functioning correctly and returns an error."
 *
 *   The sort control on that dashboard offered "Sort by Date" and "Sort by
 *   Gender", and the action behind it typed `sortBy` as `"createdAt" |
 *   "gender"`. There was no name sort to be broken — an admin looking for a way
 *   to put 480 applications into the order of the name in the first column had
 *   none at all.
 *
 * ── WHY IT CANNOT BE DONE BY THE DATABASE ───────────────────────────────────
 *
 *   The name on the screen is not stored anywhere. extractCanonicalUser builds
 *   it from `verificationProfile`, then the user document, then whichever module
 *   registration happens to carry one — #754's header is the record of how many
 *   members have their real details under `serviceRegistrations.<module>`
 *   instead. So `orderBy("fullName")` would order by a field that is EMPTY on
 *   exactly those members, and Postgres sorts NULLs to one end without
 *   complaining. The admin would get a list that is sorted and visibly out of
 *   order, which is worse than a list that is not sorted at all.
 *
 *   So it is ordered here, on resolved rows, after the join.
 *
 * ── THE PRICE, STATED ───────────────────────────────────────────────────────
 *
 *   Sorting after the join means sorting the FETCH WINDOW, not the collection.
 *   That is exact for every applications tab — 480 rows against a 5,000 window —
 *   and a sample on the approved tab, where 15,128 accounts hold the role. The
 *   caller reports `sortIsPartial` when the window filled, because #772 is this
 *   codebase's record of what a sample presented as a total costs.
 */

/**
 * The sorts that are resolved in memory, named once.
 *
 * Both branches of the WAVE applications reader ask this, so a third sort added
 * later cannot be wired into one of them and forgotten in the other — which is
 * precisely what happened to gender, whose sort the approved tab returns a
 * hundred lines before ever reaching.
 */
export const IN_MEMORY_SORTS = ["gender", "name"] as const;

export function sortIsInMemory(sortBy: string | undefined): boolean {
    return (IN_MEMORY_SORTS as readonly string[]).includes(sortBy ?? "");
}

/** Milliseconds for a row's creation date, whichever shape it arrived in. */
function rowCreatedMs(row: any): number {
    const c = row?.data?.createdAt;
    if (c && typeof c === "object" && typeof c.seconds === "number") return c.seconds * 1000;
    const t = new Date(c ?? 0).getTime();
    return Number.isNaN(t) ? 0 : t;
}

/**
 * Order resolved admin rows by the column the admin picked. Sorts IN PLACE.
 *
 * TIES BREAK ON NEWEST-FIRST, so the order is total. Two applicants with the
 * same name would otherwise swap places between two loads of the same page,
 * which an admin reads as the data changing underneath them.
 *
 * A BLANK KEY SORTS LAST IN BOTH DIRECTIONS. "" compares before every letter,
 * so ascending would otherwise open on a block of rows whose name could not be
 * resolved — the least useful page of a list somebody opened in order to find a
 * name. Unknown is not a value at the start of the alphabet; it is the end of
 * the list.
 */
export function sortResolvedRows(
    rows: any[],
    sortBy: string | undefined,
    sortOrder: "asc" | "desc" | undefined,
): void {
    if (!sortIsInMemory(sortBy)) return;

    const dir = sortOrder === "asc" ? 1 : -1;
    const keyOf = (r: any) =>
        String((sortBy === "name" ? r?.user?.name : r?.user?.gender) ?? "")
            .trim()
            .toLowerCase();

    rows.sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        if (!ka !== !kb) return ka ? -1 : 1;
        if (ka !== kb) return dir * ka.localeCompare(kb);
        return rowCreatedMs(b) - rowCreatedMs(a);
    });
}
