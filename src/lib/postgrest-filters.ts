/**
 * How a Firestore-shaped filter is spelled as a PostgREST filter.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * #434 found `not-in` missing from the server adapter's JSONB switch, so it
 * fell through to an equality and "everything except these" returned nothing.
 * The same finding found `array-contains-any` emitting PostgREST's `ov` on a
 * JSONB path in BOTH adapters, which is SQL `&&`, which Postgres does not have
 * for jsonb.
 *
 * Two adapters, one wire format. Every time this repository has stated a rule
 * twice, a fix has reached one copy and not the other (#425, #426, #429, #430,
 * #431, #432, #433, and #434's own `ov` line). The spelling lives here once.
 *
 * EVERY FORM BELOW WAS EXERCISED AGAINST A REAL PostgREST v12.2.3
 * ---------------------------------------------------------------
 * Not against a spy, and not inferred from the documentation.
 * scripts/local-stack/up.sh brings up real PostgreSQL 16 and real PostgREST
 * with no Docker at all, and the observed answers are recorded beside each
 * function. What each of them corrects:
 *
 *   raw_data->"tags"=ov.["red"]                 42883 operator does not exist:
 *                                               jsonb && unknown
 *   or=(raw_data->tags.cs.["a,b"])              PGRST100, failed to parse logic
 *                                               tree — the comma splits it
 *   or=()                                       PGRST100, failed to parse
 *   in-list "say "no"" unescaped                the quote closes the member and
 *                                               the rest becomes new entries
 */

/**
 * One value, quoted for an in-list: `("pending","in progress")`.
 *
 * Reserved characters inside a quoted member are backslash-escaped. Verified:
 * `not.in.("say \"no\"")` and `not.in.("a,b")` each exclude exactly the row
 * holding that value, where the unescaped form did not.
 */
export function quoteForInList(value: unknown): string {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** `(a,b,c)` — the argument to PostgREST's `in` / `not.in`. */
export function inList(value: unknown): string {
    return `(${(Array.isArray(value) ? value : [value]).map(quoteForInList).join(',')})`;
}

/**
 * A value quoted for a LOGIC TREE — the `or=(…)` argument.
 *
 * Different from an in-list member: the logic-tree parser splits on commas and
 * parentheses, so a JSON payload has to be quoted whole. Verified —
 * `or=(raw_data->tags.cs.["a,b"])` is a parse error and
 * `or=(raw_data->tags.cs."[\"a,b\"]")` returns exactly the matching row.
 */
export function quoteForLogicTree(payload: string): string {
    return `"${payload.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * `array-contains-any` over a JSONB array, as an OR of `@>` containment tests.
 *
 * Postgres has no `&&` for jsonb, which is what both adapters used to emit;
 * `@>` it does have, and a disjunction of single-element containments is the
 * same question. Verified: over rows tagged ["red","blue"], ["green"] and
 * ["blue"], asking for red-or-green returns exactly the first two.
 *
 * AN EMPTY LIST MATCHES NOTHING, which is what the NATIVE branch already does —
 * `roles=ov.{}` returns no rows, measured. Matching it matters more than
 * matching Firestore, which rejects an empty array outright: a caller passing a
 * computed list that came back empty gets the same answer whichever column
 * shape the field happens to have, and a difference there is exactly the defect
 * #434 is about. `NOT (x @> [])` is false for every array, and an empty `or=()`
 * is a parse error, so the contradiction is spelled rather than left implicit.
 */
export function jsonbArrayContainsAnyClause(arrPath: string, value: unknown): string {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) return `${arrPath}.not.cs.${quoteForLogicTree('[]')}`;
    return values
        .map((v) => `${arrPath}.cs.${quoteForLogicTree(JSON.stringify([v]))}`)
        .join(',');
}
