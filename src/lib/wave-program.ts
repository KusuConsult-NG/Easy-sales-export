/**
 * What WAVE stands for.
 *
 *   #774 ONE PROGRAMME, FIVE EXPANSIONS, THREE OF THEM INVENTED.
 *
 *   The owner: "The WAVE acronym is Women Agro-Value Expansion program."
 *
 *   Swept across the repository, the letters were being expanded as:
 *
 *       Women Agro-Value Expansion            the real one
 *       Women Agro-processors Venture Empowerment    /auth/get-started
 *       Women in Agriculture                         /admin/wave
 *       Women in Agri-Ventures Excellence            /wave/access-denied
 *       Women in Agriculture Venture Excellence      the admin report export
 *
 *   Three of those are not abbreviations of anything — they are different
 *   programmes, written by somebody guessing from the letters. And of the four
 *   screens carrying them, two are the ones a member meets FIRST: the
 *   get-started page, where they choose which programme to join, and the
 *   access-denied page, which is all an ineligible applicant ever sees of it.
 *   The correct name was already sitting in the submission email the whole
 *   time.
 *
 *   A CONSTANT, because prose drifts and a constant cannot. The alternative —
 *   correcting four strings — leaves the fifth writer to guess again, which is
 *   how there came to be five.
 */

/**
 * The programme's name, expanded.
 *
 *   #785 / #788 CORRECTED BY THE OWNER TWICE MORE, AND THIS IS THE WHOLE POINT
 *        OF KEEPING IT IN ONE PLACE.
 *
 *   #774 was told "The WAVE acronym is Women Agro-Value Expansion program" and
 *   set that here. The owner's formal list then said "Ensure that RH-WAVE is
 *   consistently stated as 'Renewed Hope Women Agro Value Expansion'", and #785
 *   set that — WITHOUT the hyphen, following the list's spelling literally.
 *
 *   The owner's next message settles the spelling: "change Women Agro-Value
 *   Expansion Program to Renewed Hope Women Agro-Value Expansion Program". So
 *   the RENEWED HOPE prefix stays — it is what the RH in RH-WAVE stands for —
 *   and the hyphen comes back.
 *
 *   `Program` is NOT part of this constant, so the name composes: the sentence
 *   form is WAVE_PROGRAM_NAME below, and the formal designation appends
 *   "Programme" itself. Baking the word in here would produce "…Expansion
 *   Program Programme" in the formal line.
 */
export const WAVE_FULL_NAME = "Renewed Hope Women Agro-Value Expansion";

/**
 * The name as it is usually written in a sentence.
 *
 *   #788 "Renewed Hope Women Agro-Value Expansion Program" — the exact string
 *   the owner asked for, composed rather than repeated.
 */
export const WAVE_PROGRAM_NAME = `${WAVE_FULL_NAME} Program`;

/**
 * The formal designation, with the presidential mandate's own prefix.
 *
 *   #785 The name now CONTAINS "Renewed Hope", so the RH- prefix is no longer
 *   repeating something the rest of the string lacks. Kept because "RH-WAVE
 *   774" is the mandate's own designation and appears on official material.
 */
export const WAVE_FORMAL_NAME = `RH-WAVE 774 ${WAVE_FULL_NAME} Programme`;

/** "Renewed Hope Women Agro-Value Expansion (WAVE)" — a heading needing both. */
export const WAVE_NAME_WITH_ACRONYM = `${WAVE_FULL_NAME} (WAVE)`;

/**
 * The same name with the cooperative deed's dotted acronym.
 *
 *   #788 The Terms of Reference the cooperative onboarding shows defines the
 *   short form as "W.A.V.E." and then uses it throughout. Only the DEFINITION
 *   is a name; the later "W.A.V.E. project" references are that defined term
 *   and are left exactly as the document has them.
 */
export const WAVE_NAME_WITH_DOTTED_ACRONYM = `${WAVE_FULL_NAME} (W.A.V.E.)`;
