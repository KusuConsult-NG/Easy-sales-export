/**
 * What a number on an admin card looks like when it is not a number.
 *
 *   #822 THREE STATES, AND ONLY ONE OF THEM IS A DIGIT.
 *
 *   A stat tile can be in one of three conditions, and the whole of this
 *   finding is that they had been collapsed into one:
 *
 *       COUNTED       the database answered            "1,284"
 *       NOT YET       the read has not come back       "—"
 *       UNREADABLE    the read failed, or the field
 *                     is missing from the payload     "Unavailable"
 *
 *   Rendering the last two as `0` is what made the old screens dangerous: zero
 *   is a plausible answer, so nobody questions it. An empty review queue and a
 *   broken query looked identical, and so did a cooperative with no money.
 *
 * ── AND THE FIELD IS CHECKED, NOT JUST THE OBJECT ───────────────────────────
 *
 *   The first pass at this wrote `stats ? stats.pending.toLocaleString() : '—'`
 *   on every card. That guards the OBJECT and not the FIELD, so a payload that
 *   arrives partial — `{}`, or missing one key — is truthy and throws
 *
 *       TypeError: Cannot read properties of undefined (reading 'toLocaleString')
 *
 *   taking the whole screen down. #601's suite, which mounts every admin screen
 *   against a row carrying only an id, caught it immediately; that is precisely
 *   what it exists for. Guarding one and not the other is the same
 *   partial-application shape this audit keeps finding, committed while fixing
 *   an instance of it.
 */

/**
 * Format one figure for a card.
 *
 * @param value  what the server sent, if anything
 * @param failed true when the read is known to have failed, as opposed to not
 *               having returned yet — the difference between "Unavailable" and
 *               a placeholder.
 */
export function statText(value: unknown, failed = false): string {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value.toLocaleString();
    }
    return failed ? "Unavailable" : "—";
}

/**
 * The same decision for a money figure.
 *
 * Takes the formatter rather than importing one, so this module stays free of
 * the currency helper and can be used from anywhere.
 */
export function statMoney(
    value: unknown,
    format: (n: number) => string,
    failed = false,
): string {
    if (typeof value === "number" && Number.isFinite(value)) {
        return format(value);
    }
    return failed ? "Unavailable" : "—";
}
