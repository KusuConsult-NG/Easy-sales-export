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

/**
 * The type size a stat tile should render a value at, given the value.
 *
 *   #843 THE LAST ZERO OF A REVENUE FIGURE DROPPED ONTO ITS OWN LINE.
 *
 *   The owner: "the last zero broke and drop making the UI to look
 *   unprofessional … the cards should be fix to accomodate any number", against
 *
 *       Total Revenue
 *       ₦12,996,000
 *
 *   The tile carried `break-words`, added by #758 so that long PROSE values —
 *   "at least ₦1,234,567,890", "Unavailable" — could wrap instead of running
 *   into the label beneath. But `overflow-wrap: break-word` does not know the
 *   difference between prose and a number, and a formatted figure is ONE
 *   unbroken token, so it broke mid-digits.
 *
 *   THAT IS WORSE THAN UNTIDY. A currency amount split across two lines can be
 *   read as the wrong number — ₦12,996,00 with a stray 0 beneath it — on the
 *   tile an administrator uses to see what the platform has taken. #758's fix
 *   was right about prose and wrong about digits, and the two need separating
 *   rather than trading one off against the other.
 *
 * ── WHY A SIZE RULE RATHER THAN A SMALLER FIXED SIZE ────────────────────────
 *
 *   "Make it smaller" fixes today's longest figure and breaks on the next one:
 *   this platform's revenue grows, and ₦123,456,789,012 is two characters from
 *   the same defect. The size follows the VALUE, so a tile accommodates any
 *   number without anyone revisiting it — which is what was actually asked for.
 *
 *   Sized by character count rather than measured, because a measurement needs
 *   layout and this runs during render. `tabular-nums` is already on these
 *   tiles, so every digit is the same width and a count is a reliable proxy.
 */
export function statValueClass(value: unknown): string {
    const text = String(value ?? "");

    /*
     *   Prose keeps its wrapping. "Unavailable" and "at least ₦1,234,567,890"
     *   have somewhere sensible to break — a space — and #758's finding was
     *   that without it they overflowed the card. Detected by the presence of a
     *   space rather than by a list of known strings, so a phrase nobody has
     *   written yet is handled too.
     */
    const isProse = /\s/.test(text.trim());

    //   A number, a currency amount, or a single word: never broken apart.
    const wrap = isProse ? "break-words" : "whitespace-nowrap";

    const size =
        text.length <= 10 ? "text-2xl sm:text-3xl"
            : text.length <= 14 ? "text-xl sm:text-2xl"
                : text.length <= 18 ? "text-lg sm:text-xl"
                    : "text-base sm:text-lg";

    return `${size} ${wrap}`;
}
