/**
 * Grouping a free-text answer for a breakdown chart.
 *
 *   #842 THREE HUNDRED AND THIRTY-FOUR FARMERS WERE REPORTED AS TWO HUNDRED
 *   AND SIX.
 *
 *   The owner, of the compliance report's "Business Types" panel:
 *
 *       Farmer 206 · Farmer112 · FARMER 11 · farmer 4 · Farmers 1
 *       Trader 60  · Trader 13 · TRADER 3
 *       Business 39 · Business 16 · BUSINESS 3 · business 2
 *       BUSINESSWOMAN 33 · BUSINESSWOMAN 4 · Business woman 1
 *
 *   `currentOccupation` is a free-text field, and the breakdown grouped on the
 *   raw string. So "Farmer" and "Farmer " — one trailing space — were two
 *   different occupations, and the largest group in the programme was split
 *   five ways and understated by 38%. Every real category was, and the chart
 *   ran to a hundred and thirty rows of near-duplicates.
 *
 *   On a COMPLIANCE REPORT that is not a cosmetic problem: the top occupation
 *   is the kind of figure that gets quoted to a funder, and it was wrong by more
 *   than a third.
 *
 * ── WHAT THIS NORMALISES, AND WHAT IT REFUSES TO ────────────────────────────
 *
 *   ONLY MECHANICAL DIFFERENCES. Case, surrounding whitespace, repeated inner
 *   whitespace, and a trailing full stop. Those are the same answer typed
 *   differently, and merging them decides nothing about anybody.
 *
 *   IT DOES NOT GUESS AT TYPOS. The same list contains `Farmeo`, `Fermer`,
 *   `Faremer`, `Farmar`, `Famer`, `Farma`, `Far` and `Treder`. Every one is
 *   almost certainly a misspelling — and "almost certainly" is exactly the
 *   standard this audit exists to refuse. Folding `Far` into `Farmer` by edit
 *   distance would also fold in whatever the next reader typed, silently, and a
 *   number nobody can reproduce from the data is worse than a long tail.
 *
 *   NOR DOES IT MERGE MEANINGS. `Trader and Farmer`, `FARMER/BUSINESSWOMAN` and
 *   `Community health extension worker CHEW and farming` are people doing two
 *   things. Splitting them into categories is a taxonomy decision the programme
 *   owns, not one a chart should make on its behalf.
 *
 *   The tail is REPORTED instead — see `groupFreeText`'s `longTail` — so the
 *   fact that the field is unconstrained free text is visible on the screen,
 *   which is the honest answer and the argument for constraining it at the form.
 */

/**
 * The key two answers must share to be counted as the same answer.
 *
 * Lower-cased, trimmed, inner runs of whitespace collapsed, and one trailing
 * full stop removed. Nothing else.
 */
export function groupingKey(value: string): string {
    return value
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\.$/, "")
        .toLowerCase();
}

export interface GroupedFreeText {
    /** Label → count, the label being the most common original spelling. */
    counts: Record<string, number>;
    /**
     * How many DISTINCT raw answers were seen, before normalising.
     *
     * The gap between this and `Object.keys(counts).length` is the measure of
     * how unconstrained the field is, and it is what tells an administrator that
     * the tail is data entry rather than genuine variety.
     */
    distinctRawValues: number;
    /** Groups with a single respondent — the unconstrained-free-text tail. */
    longTail: number;
}

/**
 * Count free-text answers, grouping ones that differ only mechanically.
 *
 * The DISPLAY label is the most frequent original spelling rather than the
 * lower-cased key, so the chart reads "Farmer" and not "farmer"; ties break on
 * the first one seen, which keeps the output stable for the same input.
 */
export function groupFreeText(values: readonly string[]): GroupedFreeText {
    const buckets = new Map<string, Map<string, number>>();
    const rawSeen = new Set<string>();

    for (const raw of values) {
        rawSeen.add(raw);
        const key = groupingKey(raw);
        if (!key) continue;

        const spellings = buckets.get(key) ?? new Map<string, number>();
        //   The spelling is recorded trimmed: a trailing space is invisible on a
        //   chart, so picking "Farmer " as the label would look like a bug.
        const display = raw.trim().replace(/\s+/g, " ");
        spellings.set(display, (spellings.get(display) ?? 0) + 1);
        buckets.set(key, spellings);
    }

    const counts: Record<string, number> = {};
    let longTail = 0;

    for (const spellings of buckets.values()) {
        let total = 0;
        let best = "";
        let bestCount = -1;
        for (const [spelling, n] of spellings) {
            total += n;
            if (n > bestCount) {
                best = spelling;
                bestCount = n;
            }
        }
        counts[best] = (counts[best] ?? 0) + total;
        if (total === 1) longTail += 1;
    }

    return { counts, distinctRawValues: rawSeen.size, longTail };
}
