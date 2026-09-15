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
 *   #785 CORRECTED BY THE OWNER, A SECOND TIME, AND THIS IS THE WHOLE POINT OF
 *        KEEPING IT IN ONE PLACE.
 *
 *   #774 was told "The WAVE acronym is Women Agro-Value Expansion program" and
 *   set that here. The owner's formal list now says:
 *
 *       "Ensure that RH-WAVE is consistently stated as 'Renewed Hope Women Agro
 *        Value Expansion' wherever it is referenced."
 *
 *   Two differences, both deliberate: the RENEWED HOPE prefix, which is what
 *   the RH in RH-WAVE stands for and was missing entirely, and no hyphen in
 *   "Agro Value".
 *
 *   Changing it is one line, and every one of the five screens follows. That is
 *   the entire argument for the constant — before #774 this correction would
 *   have meant finding six strings and would have missed at least one, which is
 *   exactly how there came to be six spellings.
 */
export const WAVE_FULL_NAME = "Renewed Hope Women Agro Value Expansion";

/** The name as it is usually written in a sentence. */
export const WAVE_PROGRAM_NAME = `${WAVE_FULL_NAME} Program`;

/**
 * The formal designation, with the presidential mandate's own prefix.
 *
 *   #785 The name now CONTAINS "Renewed Hope", so the RH- prefix is no longer
 *   repeating something the rest of the string lacks. Kept because "RH-WAVE
 *   774" is the mandate's own designation and appears on official material.
 */
export const WAVE_FORMAL_NAME = `RH-WAVE 774 ${WAVE_FULL_NAME} Programme`;

/** "Renewed Hope Women Agro Value Expansion (WAVE)" — a heading needing both. */
export const WAVE_NAME_WITH_ACRONYM = `${WAVE_FULL_NAME} (WAVE)`;
