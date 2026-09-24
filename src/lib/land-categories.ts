/**
 * What kind of land this is — one vocabulary, for the five screens that had one
 * each.
 *
 *   THE OWNER: "searchLandListingsAction firing seven times in one second."
 *
 * ── THE SEVEN CALLS, COUNTED ────────────────────────────────────────────────
 *
 *   /farm-nation renders a "Farm Categories" grid of SIX tiles, each a
 *   `<Link>` to /farm-nation/properties, plus a "Browse All" link to the same
 *   route. Next.js prefetches a `<Link>` when it enters the viewport, and
 *   /farm-nation/properties is `force-dynamic` and runs
 *   searchLandListingsAction on every render.
 *
 *       6 category tiles + 1 browse link = 7 distinct prefetch targets
 *       = 7 identical unfiltered listing queries, in the second the grid
 *         scrolls into view, before the visitor has clicked anything.
 *
 *   That is the N+1: not a loop in a query, a loop in the MARKUP, where each
 *   iteration costs a server round trip.
 *
 * ── AND ALL SEVEN ANSWERED THE SAME QUESTION ────────────────────────────────
 *
 *   The tiles linked to `?category=Poultry%20Farms`. Three things were wrong
 *   with that, and together they are why this file exists:
 *
 *     THE PARAM NAME.   The properties screen reads `searchParams.get("type")`
 *                       and passes it to the action AS `category`. Nothing
 *                       anywhere reads `?category`, so the filter was dropped
 *                       on arrival and all six tiles showed the same unfiltered
 *                       list.
 *
 *     THE VALUES.       The landing page's six names — Arable Land, Leasing
 *                       Options, Poultry Farms, Fish Farms, Greenhouses,
 *                       Mixed-Use — appear in no other file and match no stored
 *                       value. The listing form writes farmland, ranch, forest,
 *                       mixed, orchard, aquaculture. So even under the right
 *                       param name, every tile would have filtered to nothing.
 *
 *     THE COUNTS.       The same page prints a count per tile from
 *                       `categoryCounts[name.toLowerCase().replace(/\s+/g,"_")]`
 *                       — "poultry_farms" — against counts keyed by the stored
 *                       value. No key ever matched, so every tile fell through
 *                       to the word "Browse". Six figures that could not be
 *                       right, and were therefore never shown; the defect was
 *                       invisible because its symptom was a fallback.
 *
 * ── FIVE COPIES, AND ONE OF THEM DISAGREED ──────────────────────────────────
 *
 *   The list was hand-written in five files:
 *
 *     list-land            farmland ranch forest mixed orchard aquaculture
 *     map filter           the same six, shorter labels
 *     browse dropdown      the same six, shorter labels again
 *     landing tiles        SIX DIFFERENT NAMES, matching nothing
 *     edit-property        farmland ranch commercial_farm agricultural_land
 *
 *   The last is the sharp one. A seller editing their own listing could set it
 *   to `commercial_farm`, a value neither the browse dropdown nor the map
 *   filter offers — so the parcel dropped out of both and could only be found
 *   by someone who already had its link. Invisible inventory, written by the
 *   platform's own form.
 *
 *   NOTHING STORED IS CHANGED. Rows already carrying `commercial_farm` or
 *   `agricultural_land` keep them, and LEGACY_LAND_CATEGORY_LABELS below is
 *   what stops those rows rendering as a raw slug now that no form offers the
 *   value. What changes is that no NEW row can be written with one.
 */

/** One kind of land, as every screen names it. */
export interface LandCategory {
    /** What is stored on the listing, and what the browse filter matches. */
    value: string;
    /** The short name — filters, tiles, chips. */
    label: string;
    /** The long name, for the form where someone is choosing for the first time. */
    detail: string;
    icon: string;
}

export const LAND_CATEGORIES: readonly LandCategory[] = [
    { value: "farmland",    label: "Farmland",      detail: "Farmland (Crop Cultivation)",        icon: "🌾" },
    { value: "ranch",       label: "Ranch",         detail: "Ranch/Pasture (Livestock)",          icon: "🐄" },
    { value: "forest",      label: "Forest Land",   detail: "Forest Land (Timber/Conservation)",  icon: "🌲" },
    { value: "mixed",       label: "Mixed-Use",     detail: "Mixed-Use Agricultural",             icon: "🌻" },
    { value: "orchard",     label: "Orchard",       detail: "Orchard/Plantation",                 icon: "🍊" },
    { value: "aquaculture", label: "Aquaculture",   detail: "Aquaculture/Fish Farm",              icon: "🐟" },
] as const;

export const LAND_CATEGORY_VALUES: readonly string[] =
    LAND_CATEGORIES.map((c) => c.value);

/**
 * The query parameter the browse screen reads.
 *
 *   Named here because the landing page wrote `?category` and the browse screen
 *   read `?type`, and neither file could see the other. A link built from this
 *   constant and a screen reading it cannot disagree again.
 */
export const LAND_CATEGORY_PARAM = "type";

/**
 * Categories no form offers any more, and which stored rows still carry.
 *
 * Read-only on purpose: this is how an existing listing keeps a readable name.
 * Adding to it would be adding a category, which belongs above.
 */
export const LEGACY_LAND_CATEGORY_LABELS: Readonly<Record<string, string>> = {
    commercial_farm: "Commercial Farm",
    agricultural_land: "Agricultural Land",
};

export function isLandCategory(value: unknown): boolean {
    return typeof value === "string" && LAND_CATEGORY_VALUES.includes(value);
}

/**
 * The name to print for a stored value.
 *
 * Falls back to the value itself rather than to "Other", because a row holding
 * something nobody recognises should say so on the screen where somebody can
 * act on it — not be quietly relabelled.
 */
export function landCategoryLabel(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) return "";
    const known = LAND_CATEGORIES.find((c) => c.value === value);
    if (known) return known.label;
    return LEGACY_LAND_CATEGORY_LABELS[value] ?? value;
}

/**
 * The browse URL for a category, or for everything.
 *
 * One builder, so a link and the screen it opens use the same parameter.
 */
export function landBrowseHref(value?: string): string {
    return value
        ? `/farm-nation/properties?${LAND_CATEGORY_PARAM}=${encodeURIComponent(value)}`
        : "/farm-nation/properties";
}

/**
 * Every category a listing belongs to, whatever shape the row stores.
 *
 *   THREE SHAPES, because three writers produced them and the search action
 *   already had to know about all three:
 *
 *     an ARRAY            ["farmland", "orchard"] — what the edit form writes
 *     a COMMA STRING      "farmland, orchard"
 *     a PLAIN STRING      "farmland"
 *
 *   The landing page's counter knew about none of them: it did
 *   `p.category || p.propertyType || "other"` and used the result as an object
 *   key, so an array row counted under the key "farmland,orchard" — a bucket no
 *   tile reads. A parcel offered two ways was therefore counted in neither.
 *
 *   Returns every value, so a parcel that is both is counted under both. That
 *   makes the tile figures sum to more than the listing count, which is correct
 *   — they are "how many parcels can I browse here", not a partition.
 */
export function landCategoriesOf(listing: unknown): string[] {
    const raw = (listing as { category?: unknown; propertyType?: unknown } | null)?.category
        ?? (listing as { propertyType?: unknown } | null)?.propertyType;

    const parts = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
            ? raw.split(",")
            : [];

    const seen = new Set<string>();
    for (const part of parts) {
        const value = typeof part === "string" ? part.trim() : "";
        if (value) seen.add(value);
    }
    return [...seen];
}
