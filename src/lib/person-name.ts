/**
 * How a person's name splits into parts, and joins back.
 *
 *   #452 THREE PLACES SPLIT A FULL NAME AND THEY DISAGREED, SO OPENING YOUR
 *   PROFILE AND PRESSING SAVE DUPLICATED YOUR MIDDLE NAME — ONCE PER SAVE.
 *
 *   Demonstrated with the three expressions copied verbatim out of the source,
 *   on a name stored exactly as registration writes it:
 *
 *       stored at registration : "Ada Ngozi Obi"
 *       after save 1           : "Ada Ngozi Ngozi Obi"
 *       after save 2           : "Ada Ngozi Ngozi Ngozi Obi"
 *       after save 3           : "Ada Ngozi Ngozi Ngozi Ngozi Obi"
 *
 *   THE THREE RULES
 *
 *     actions/auth.ts, registration            THREE parts. first = parts[0],
 *                                              other = parts.slice(1, -1),
 *                                              last = the final part. Correct,
 *                                              and it stores all three.
 *
 *     actions/profile.ts, getUserProfileAction TWO parts. first = parts[0],
 *                                              last = parts.slice(1).join(" ").
 *                                              It then OVERWROTE the stored
 *                                              firstName and lastName with its
 *                                              own worse answer.
 *
 *     actions/profile.ts, updateUserProfileAction
 *                                              rebuilt fullName as
 *                                              [first, other, last], with the
 *                                              TWO-part rule again as its
 *                                              fallback.
 *
 *   So the screen showed last = "Ngozi Obi" while otherName was still "Ngozi",
 *   the form sent both back untouched, and the writer joined them into
 *   "Ada Ngozi Ngozi Obi". Nothing was edited. The next load split THAT, and
 *   the copy count grew again.
 *
 *   A middle name is ordinary in Nigeria, so this reached most users who ever
 *   opened their profile — and it looked like the platform mangling their name
 *   rather than anything they did.
 *
 *   ONE RULE HERE. `splitFullName` is registration's — the one that was right —
 *   and `joinFullName` is its exact inverse, so the round trip is stable.
 */

export interface NameParts {
    first: string;
    /** Middle name(s). Everything between the first and last words. */
    other: string;
    last: string;
}

/**
 * Split a full name into first / other / last.
 *
 *   "Ada"                -> first "Ada"
 *   "Ada Obi"            -> first "Ada",                last "Obi"
 *   "Ada Ngozi Obi"      -> first "Ada", other "Ngozi", last "Obi"
 *   "Ada Ngozi Chi Obi"  -> first "Ada", other "Ngozi Chi", last "Obi"
 *
 * A single word is a FIRST name with no surname, not a surname with no first
 * name: it is what somebody types when they give one name, and the screens read
 * `firstName` for a greeting.
 */
export function splitFullName(fullName: string | null | undefined): NameParts {
    const parts = String(fullName ?? "").trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) return { first: "", other: "", last: "" };
    if (parts.length === 1) return { first: parts[0], other: "", last: "" };

    return {
        first: parts[0],
        other: parts.slice(1, -1).join(" "),
        last: parts[parts.length - 1],
    };
}

/**
 * Join name parts back into a full name — the exact inverse of splitFullName.
 *
 * `joinFullName(splitFullName(name))` returns `name` with its whitespace
 * normalised, for every name. That property is the whole point: the round trip
 * that corrupted a name is now the round trip that cannot.
 */
export function joinFullName(parts: Partial<NameParts> | null | undefined): string {
    return [parts?.first, parts?.other, parts?.last]
        .map((p) => String(p ?? "").trim())
        .filter(Boolean)
        .join(" ");
}

/**
 * The name parts for a stored user row.
 *
 * STORED VALUES WIN. Deriving from `fullName` is a fallback for rows written
 * before the parts were stored separately — it is not an improvement on what a
 * person typed into three separate boxes. getUserProfileAction derived
 * unconditionally and threw away the stored answer, which is half of #452.
 */
export function namePartsOf(row: {
    firstName?: unknown;
    otherName?: unknown;
    lastName?: unknown;
    fullName?: unknown;
} | null | undefined): NameParts {
    const stored = {
        first: String(row?.firstName ?? "").trim(),
        other: String(row?.otherName ?? "").trim(),
        last: String(row?.lastName ?? "").trim(),
    };

    // Any stored part means the row was written with them; a person with one
    // name legitimately has an empty `last`, and deriving over that would put
    // their surname back to something they removed.
    if (stored.first || stored.other || stored.last) return stored;

    return splitFullName(String(row?.fullName ?? ""));
}
