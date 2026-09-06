/**
 * How a stored gender is read.
 *
 *   #464 THE WAVE ELIGIBILITY FORENSIC REPORTED 194 OF 200 PARTICIPANTS
 *   INELIGIBLE, INCLUDING PEOPLE WHOSE STORED GENDER IS "Female", IN A
 *   FEMALE-ONLY PROGRAMME.
 *
 *   From a real production scan:
 *
 *       Scanned 200 participants. Found 194 ineligible.
 *         013353e7-...  (Gender: Female)      <- flagged
 *         0avEMgtAcJ...  (Gender: male)       <- correctly flagged
 *         ...180 more    (Gender: other)      <- gender NOT KNOWN
 *
 *   THREE SPELLINGS OF ONE RULE, AND THEY DISAGREED
 *
 *     schemas.ts registration    z.enum(["Male", "Female", "male", "female"])
 *                                — all four are valid and all four get stored.
 *     schemas.ts WAVE form       z.literal("Female") — the programme's own
 *                                application REQUIRES the capitalised spelling.
 *     forensics.ts               `if (gender !== "female")` — exact, lower case.
 *
 *   So the check refused the exact spelling the WAVE application demands. Every
 *   participant who applied through the proper form was reported ineligible by
 *   the forensic meant to police that form.
 *
 *   AND THE NORMALISER ALREADY EXISTED. validations/user.ts has had
 *   `val.toLowerCase().trim()` in a zod preprocess all along — one place that
 *   knows how to read this field, not used by the check that needed it. Stated
 *   once here and shared, rather than a fourth spelling.
 *
 *   "UNKNOWN" IS NOT "MALE". Roughly 180 of those 194 stored "other", which is
 *   what the Firebase-era migration wrote when it had no gender to carry over.
 *   Reporting them as INELIGIBLE asserts something the data does not say. The
 *   comment directly above that check, about the date-of-birth half, had already
 *   drawn this exact distinction —
 *
 *       "A forensic that cannot see a date should say so — 'no finding' and
 *        'could not look' are different answers"
 *
 *   — and the gender line one statement below it kept conflating them. Hence
 *   three outcomes here, not two.
 */

export type Gender = 'male' | 'female';

/**
 * The stored value as one of the two the platform records, or `undefined` when
 * the row does not say.
 *
 * Case and surrounding space are normalised because registration stores four
 * spellings and hand-edited rows carry more. Anything else — "other", "", null,
 * a missing field — is UNKNOWN, deliberately indistinguishable from absent:
 * "other" is what the migration wrote when it had nothing, so it is not a third
 * gender the platform records, it is the absence of one.
 */
export function normaliseGender(value: unknown): Gender | undefined {
    if (typeof value !== 'string') return undefined;

    const normalised = value.toLowerCase().trim();
    if (normalised === 'male') return 'male';
    if (normalised === 'female') return 'female';
    return undefined;
}

/**
 * Whether a stored gender is definitely NOT the one required.
 *
 * `true` only when the row says so. An unknown gender returns `false`: a caller
 * that must act on "cannot tell" should use `genderOutcome` below.
 */
export function isDefinitelyNot(value: unknown, required: Gender): boolean {
    const gender = normaliseGender(value);
    return gender !== undefined && gender !== required;
}

/** What a scan should report about one stored gender. */
export type GenderOutcome = 'eligible' | 'ineligible' | 'unknown';

/**
 * The THREE answers a gender-gated check has, stated once.
 *
 *   #464 A MUTATION TEST IS WHY THIS IS A FUNCTION.
 *
 *   The three-way decision first lived as an inline branch inside the forensic
 *   scan, and the test for it read the SOURCE — asserting that `unknownGenderIds`
 *   and the phrase "gender not recorded" appeared. A mutant that pushed an
 *   unknown gender onto `ineligibleIds` while leaving both strings in place
 *   SURVIVED: the scan still said the words and did the opposite.
 *
 *   The behaviour that matters is not observable from the scan's output either,
 *   because the caller is a server action over a database. So the decision moved
 *   here, where it can be asked directly — the same reason aggregateProjection
 *   exists in supabase-db.ts.
 *
 *   `unknown` is deliberately its own answer rather than folded into either
 *   side. Reporting "cannot tell" as "ineligible" accuses somebody on the
 *   strength of a field the migration never filled in; reporting it as
 *   "eligible" hides a gap in the records. Both are worse than saying so.
 */
export function genderOutcome(value: unknown, required: Gender): GenderOutcome {
    const gender = normaliseGender(value);
    if (gender === undefined) return 'unknown';
    return gender === required ? 'eligible' : 'ineligible';
}
