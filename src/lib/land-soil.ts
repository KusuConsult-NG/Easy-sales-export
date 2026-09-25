/**
 * WHAT KIND OF SOIL A PARCEL HAS, AND WHICH CROPS THAT SUITS.
 *
 *   #901 THREE VOCABULARIES FOR ONE ANSWER, AND THE READER USED THE ONE
 *   NOBODY WRITES.
 *
 *   Found auditing the files no test had named. The platform records a parcel's
 *   soil in three different spellings, on the same collection:
 *
 *       land/submit/page.tsx     SOIL_TYPES = ["Loamy", "Clay", "Sandy",
 *                                "Silty", "Peaty", "Chalky"]    — CAPITALISED,
 *                                written to `soilType`. The only form on the
 *                                platform that collects soil at all.
 *       SoilQuality (package)    'loamy' | 'clay' | 'sandy' | 'fertile' |
 *                                'mixed' | 'unknown' | 'excellent' | 'good' |
 *                                'fair' | 'poor'                — lower case,
 *                                on a FIELD OF ANOTHER NAME, `soilQuality`
 *       CROP_SOIL_MATRIX         "clayey" | "loamy" | "sandy"    — and
 *                                "clayey" is written by NOTHING
 *
 *   WHAT THAT COST. The crop filter on searchLandListingsAction reads
 *   `l.soilType.toLowerCase()` and asks whether the matrix's list contains it:
 *
 *       sugarcane   ["clayey"]            — the whole crop matched NOTHING
 *       rice        ["clayey", "loamy"]   — every clay parcel dropped
 *       maize       ["loamy", "clayey"]   — same
 *       wheat       ["clayey", "loamy"]   — same
 *
 *   A buyer searching for land to grow sugarcane got an empty grid however many
 *   clay parcels were listed, and the three others silently returned the loamy
 *   half of their answer. This is the class this audit meets most often, with
 *   the reader asking for a spelling no writer uses — and here the spelling is
 *   not even a near-miss of a stored value, it is a word that exists in one
 *   object literal and nowhere else in the repository.
 *
 * ── AND THE FIELD NAME, WHICH IS THE SAME DEFECT ONE LEVEL UP ───────────────
 *
 *   `soilQuality` is read by four screens — components/land/LandMap,
 *   land/verify, land/LandMapClient, and the search filter in land-actions —
 *   and written by ONE function, `createLandListing` in land-actions.ts, which
 *   has no caller anywhere in the application. So no live row carries it, and
 *   two of those four screens read it WITHOUT A GUARD:
 *
 *       LandMap.tsx:179     {listing.soilQuality.toUpperCase()} Soil
 *       land/verify:270     {listing.soilQuality.toUpperCase()}
 *
 *   both of which throw on every row the platform actually has. #598 found this
 *   exact shape in LandMapClient — "every one of these was read off the row
 *   inside a `.map`, so a listing with no `location` took the WHOLE MAP down
 *   rather than losing one pin's caption" — and guarded the grid it sits beside
 *   without entering the map component itself.
 *
 *   So `readSoil` accepts BOTH field names, the way lib/land-location accepts
 *   four shapes of `location` and lib/lease-term accepts two spellings of the
 *   term. Nothing is rewritten: the repair is at the read, which works on rows
 *   already stored.
 */

/**
 * The soils a seller may choose, in the spelling the form shows her.
 *
 * This list IS `land/submit`'s, promoted rather than redesigned: every stored
 * `soilType` on the platform came from it, and inventing a different set here
 * would make a fourth vocabulary while claiming to remove one.
 */
export const SOIL_TYPES = ["Loamy", "Clay", "Sandy", "Silty", "Peaty", "Chalky"] as const;

/** The water sources a seller may choose — `land/submit`'s list, for the same reason. */
export const WATER_SOURCES = [
    "Borehole", "River", "Stream", "Well", "Dam", "Rain-fed", "None",
] as const;

/**
 * The comparison key for a soil, whichever vocabulary it was written in.
 *
 * `clayey` folds to `clay` because that is the one true synonym among the
 * three lists — the matrix's word for the enum's and the form's value. Every
 * other difference between them is case, which lower-casing settles.
 *
 * Returns "" for anything that is not a non-empty string, so a caller can test
 * it without a second guard.
 */
export function soilKey(value: unknown): string {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!raw) return "";
    return raw === "clayey" ? "clay" : raw;
}

/** The same normalisation for a water source. `rain` and `rain-fed` are one answer. */
export function waterKey(value: unknown): string {
    const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!raw) return "";
    return raw === "rain-fed" || raw === "rainfed" ? "rain" : raw;
}

/**
 * The soil a stored listing records, or null when it records none.
 *
 * `soilType` first because it is what every live writer uses; `soilQuality`
 * second because it is what the type, the schema and four readers name, and a
 * row written by the dead creator would otherwise read as having no soil.
 */
export function readSoil(row: Record<string, any> | null | undefined): string | null {
    if (!row) return null;

    for (const candidate of [row.soilType, row.soilQuality]) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    return null;
}

/** The water source a stored listing records, or null. One field today, named here so it stays one. */
export function readWaterSource(row: Record<string, any> | null | undefined): string | null {
    if (!row) return null;
    return typeof row.waterSource === "string" && row.waterSource.trim()
        ? row.waterSource.trim()
        : null;
}

/**
 * Which soils suit which crop.
 *
 * Moved here from actions/land-listings.ts unchanged except for `clayey`, which
 * is now spelled the way the platform stores it. It lives beside `soilKey`
 * deliberately: the defect above was a lookup table and the vocabulary it looks
 * up being maintained in different files by different hands.
 */
export const CROP_SOIL_MATRIX: Record<string, string[]> = {
    rice: ["clay", "loamy"],
    maize: ["loamy", "clay"],
    beans: ["loamy", "sandy"],
    vegetables: ["loamy"],
    soybeans: ["loamy"],
    tomatoes: ["loamy"],
    pepper: ["loamy"],
    cassava: ["loamy", "sandy"],
    wheat: ["clay", "loamy"],
    sugarcane: ["clay"],
    groundnut: ["sandy", "loamy"],
    yams: ["sandy", "loamy"],
    coconut: ["sandy"],
    ginger: ["sandy", "loamy"],
    potatoes: ["sandy", "loamy"],
    sesame: ["loamy", "sandy"],
};

/** The soils that suit `crop`, or an empty list when the crop is not in the matrix. */
export function soilsForCrop(crop: unknown): string[] {
    const key = typeof crop === "string" ? crop.trim().toLowerCase() : "";
    return key && CROP_SOIL_MATRIX[key] ? [...CROP_SOIL_MATRIX[key]] : [];
}

/**
 * Whether this stored listing's soil suits `crop`.
 *
 * A listing with NO recorded soil does not suit a crop whose soils are known —
 * which is the behaviour the filter already had (`if (!l.soilType) return
 * false`) and is the honest answer: the platform cannot claim a parcel is
 * suitable when nobody said what its soil is.
 */
export function soilSuitsCrop(row: Record<string, any> | null | undefined, crop: unknown): boolean {
    const wanted = soilsForCrop(crop);
    if (wanted.length === 0) return false;

    const soil = soilKey(readSoil(row));
    if (!soil) return false;

    return wanted.some((s) => soilKey(s) === soil);
}
