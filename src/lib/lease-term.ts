/**
 * HOW SHORT A LEASE MAY BE.
 *
 *   #895 THE OWNER: "lease can be within a range from 1year and above."
 *
 *   MEASURED FIRST, and there was no minimum anywhere. #861 added the term
 *   ("There should be duration for leasing or renting") as a free number with a
 *   months/years unit, and nothing since has bounded it:
 *
 *       list-land/page.tsx    <input type="number" min="1" …
 *                             placeholder="e.g., 3"    unit: Months | Years
 *       land-listings.ts      `durationValue > 0` — written when positive,
 *                             and otherwise unexamined
 *
 *   So the form's own worked example is a three-month term, and both the client
 *   and the server accept one.
 *
 * ── LEASE, AND DELIBERATELY NOT RENT ────────────────────────────────────────
 *
 *   The form treats the two together — `offersRental` is rent OR lease, and one
 *   duration field serves both — so the obvious implementation bounds both. The
 *   owner said LEASE, and the two are different things on this platform:
 *
 *     LEASE   a tenancy. #876 settled that its term is why a finalised lease
 *             must NOT transfer the title, and the owner confirmed the reading
 *             in the same sentence that asked for this rule.
 *     RENT    priced from the same `rentPrice`, but a season is a perfectly
 *             ordinary farmland rental — which is what the form's "e.g., 3"
 *             months was written for.
 *
 *   Bounding rent as well would refuse, tomorrow, listings that are legitimate
 *   today, on the strength of a word the owner did not use. That is the same
 *   discipline role-aliases applies to a spelling it is not sure of: "a guessed
 *   spelling is a guessed grant." A guessed minimum is a guessed refusal.
 *
 *   If rent should be bounded too it is one argument to this function, and the
 *   suite beside it says so in as many words.
 *
 * ── AND A PARCEL OFFERED BOTH WAYS ──────────────────────────────────────────
 *
 *   #869 made one listing able to be sale AND rent AND lease at once, and the
 *   term is a single field shared between them. So the rule is asked of what
 *   the listing OFFERS, not of its `type` label: if lease is among the options,
 *   the one term on the listing has to be a lease-length term.
 */

/** A year, in months. The unit the rule is expressed in. */
export const MINIMUM_LEASE_MONTHS = 12;

export type DurationUnit = "months" | "years";

export interface LeaseTermInput {
    /** True when the listing is offered on lease — `availableForLease`, or `type === "lease"`. */
    offersLease: boolean;
    durationValue: unknown;
    durationUnit: unknown;
}

/**
 * The term in whole months, or null when it cannot be read as one.
 *
 * `years` is the default because land-listings.ts already defaults the stored
 * unit that way (`data.durationUnit ?? "years"`), and two defaults that
 * disagree is the drift this codebase keeps finding.
 */
export function termInMonths(value: unknown, unit: unknown): number | null {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;

    return unit === "months" ? n : n * 12;
}

/**
 * The term a stored listing carries, whichever vocabulary wrote it.
 *
 *   #897 TWO CREATORS, TWO FIELD NAMES, ONE COLLECTION — AND ONE READER.
 *
 *   Found while applying #895 and worth its own note, because the rule it
 *   breaks is the one this audit meets most often:
 *
 *       land-listings.ts   submitLandListingAction writes
 *                          `durationValue` + `durationUnit`. This is the door
 *                          the listing FORM uses.
 *       _fn_listings.ts    listPropertyAction writes `leaseDuration`, a number
 *                          the type declares as MONTHS — and nothing else.
 *
 *   Both write LAND_LISTINGS. And the property page reads `durationValue`
 *   only, so a lease created through the second door shows NO TERM AT ALL —
 *   #861's finding verbatim, on rows written after it was fixed: "A listing
 *   offered for rent with no term tells a buyer nothing about what she is being
 *   offered."
 *
 *   ONE READER FOR BOTH SHAPES, the same answer lib/land-location gave when
 *   #689 found four spellings of a listing's location on this same collection.
 *   Rows already written either way are read correctly and nothing is
 *   rewritten.
 */
export function readLeaseTerm(
    row: Record<string, any> | null | undefined,
): { value: number; unit: DurationUnit } | null {
    if (!row) return null;

    const explicit = termInMonths(row.durationValue, row.durationUnit);
    if (explicit !== null) {
        return {
            value: Number(row.durationValue),
            //   `years` is the stored default — see termInMonths.
            unit: row.durationUnit === "months" ? "months" : "years",
        };
    }

    //   The second vocabulary. Declared in types/farm-nation-actions as
    //   "months, if type is lease", so it is read as months and not guessed.
    const legacy = termInMonths(row.leaseDuration, "months");
    if (legacy !== null) {
        return { value: Number(row.leaseDuration), unit: "months" };
    }

    return null;
}

/**
 * Why this term may not be listed, or null when it may.
 *
 * Returns a SENTENCE, because both callers show it to the person typing: the
 * form beside the field, and the action as its refusal. A rule that returns a
 * boolean makes each door invent its own wording, and then they disagree.
 */
export function leaseTermRefusal({
    offersLease, durationValue, durationUnit,
}: LeaseTermInput): string | null {
    if (!offersLease) return null;

    const months = termInMonths(durationValue, durationUnit);

    /*
     *   A MISSING TERM IS NOT THIS RULE'S REFUSAL. The form already marks the
     *   field required, and land-listings.ts deliberately omits the field
     *   entirely when it is absent (#861: "a sale carries no term at all rather
     *   than a zero somebody has to interpret"). Refusing here as well would
     *   make a listing that predates #861 un-editable, and this rule is about
     *   how SHORT a term may be, not whether one was given.
     */
    if (months === null) return null;

    if (months < MINIMUM_LEASE_MONTHS) {
        return "A lease must run for at least 1 year. Choose a longer term, "
            + "or list the land for rent instead if it is offered by the season.";
    }

    return null;
}
