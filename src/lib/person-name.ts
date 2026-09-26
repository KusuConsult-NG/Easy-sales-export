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
 *
 * ── #920 TWO MORE COPIES, FOUND LATER, AND WHAT IS STILL OUTSTANDING ────────
 *
 *   Both dropped the middle name, and both are now pointed here:
 *
 *     AcademyApplicationClient   LIVE. It built the academy application's stored
 *                                `personalInfo.fullName` as firstName + lastName
 *                                while the submit action wrote the same person's
 *                                user row as [first, other, last] — so one
 *                                submission produced two names, and the admin
 *                                applications screen (which prints, sorts and
 *                                exports personalInfo.fullName) showed the shorter
 *                                one.
 *
 *     firestore-serialize        DEAD. serializeUser has no callers, but it
 *                                OVERWROTE a stored three-part name with a
 *                                two-part derivation, so it would have become
 *                                live and wrong in the same moment.
 *
 *   THIRTY-THREE OCCURRENCES ACROSS TWENTY FILES still spell the join out
 *   inline instead of importing it — swept, not listed, because the first
 *   hand-built list of them missed six files by being case-sensitive on the
 *   middle-name token. They all agree with joinFullName today, which is why they
 *   are a ledger in one-door-parsed-and-the-other-did-not rather than a rewrite:
 *   the WAVE and shipment copies use a different field vocabulary (`otherNames`,
 *   `surname`), so folding them in is a mapping change of its own. #452's cost
 *   was three copies DISAGREEING, not three copies existing — and the
 *   twenty-first file is how the next disagreement starts, which is the argument
 *   this file was written to settle.
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
export function joinFullName(
    /*
     *   #943 WIDENED TO ADMIT null PARTS. The body already coerces with
     *   `String(p ?? "")`, so null was always handled; the TYPE refused it, and
     *   two call sites in export onboarding hold `string | null` locals. Coercing
     *   at those two sites would have put a `?? undefined` in the caller to
     *   satisfy a signature that lies about what the function accepts.
     */
    parts: Partial<Record<keyof NameParts, string | null | undefined>> | null | undefined,
): string {
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
    /**
     *   #943 WAVE AND SHIPMENTS SPELL TWO OF THESE DIFFERENTLY.
     *
     *   Six files store a name as `firstName / otherNames / surname`; eleven
     *   store `firstName / otherName / lastName`. one-door-parsed-and-the-other-
     *   did-not recorded that difference as the reason the WAVE copies were left
     *   out of #452's consolidation: "a mapping change of its own rather than a
     *   substitution".
     *
     *   The mapping belongs HERE rather than in a second reader beside this one.
     *   Two functions that each answer "what are this row's name parts" is the
     *   exact shape #452 was about — it cost three copies disagreeing and
     *   duplicating people's middle names once per profile save. A reader that
     *   knows both vocabularies cannot drift from itself.
     *
     *   Read only when the primary spelling is absent, so a row carrying both
     *   keeps the one #452 settled on.
     */
    otherNames?: unknown;
    surname?: unknown;
} | null | undefined): NameParts {
    const stored = {
        first: String(row?.firstName ?? "").trim(),
        other: String(row?.otherName ?? row?.otherNames ?? "").trim(),
        last: String(row?.lastName ?? row?.surname ?? "").trim(),
    };

    // Any stored part means the row was written with them; a person with one
    // name legitimately has an empty `last`, and deriving over that would put
    // their surname back to something they removed.
    if (stored.first || stored.other || stored.last) return stored;

    return splitFullName(String(row?.fullName ?? ""));
}
