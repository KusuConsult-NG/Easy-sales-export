/**
 * Text search over the product catalogue.
 *
 * There is no full-text index behind this adapter, so a title search is a scan
 * plus a filter in memory. That is a limitation. What made it a DEFECT is where
 * the filter sat: both catalogue actions took a PAGE from the database —
 * `.orderBy("createdAt", "desc").limit(12)` — and only then filtered it by the
 * query. So the search never looked at the catalogue; it looked at the newest
 * twelve rows and told the buyer what it found there.
 *
 * A seller's product at position 13 by age was unfindable by name. The buyer
 * could type its exact title and be told "No products found". And the page's
 * `hasMore`/`lastId` came from the pre-filter page, so a search commonly
 * returned ZERO products with `hasMore: true` — an empty result beside a
 * "Load More" button that pages the whole catalogue twelve rows at a time.
 *
 * The helpers here move the filter in front of the pagination: scan a bounded
 * window in the database's order, match, and page the MATCHES. Bounded, because
 * an unbounded scan of a growing catalogue is its own defect — the cap is
 * reported by `truncated` so the caller can log it rather than silently claim
 * completeness.
 */

/**
 * How many rows a text search scans.
 *
 * The same figure the index-error fallback in _mp_catalog.ts already used, so
 * the two paths agree on how much of the catalogue a search sees. The adapter
 * caps any single read at 5,000 rows; this sits well inside that.
 */
export const PRODUCT_SEARCH_SCAN_LIMIT = 300;

/**
 * The category aliases the catalogue was built with, in one place.
 *
 * Products have been written with several spellings of the same category —
 * "roots", "roots_tubers", "tuber", "yam", "cassava" — so a filter for one has
 * to match all of them. This table existed twice, character for character, in
 * _buyer.ts and _mp_catalog.ts, and a THIRD reader,
 * getProductsByCategoryAction, matched the raw string with no mapping at all.
 * So "roots" returned different products depending on which action the page
 * happened to call.
 */
export const PRODUCT_CATEGORY_ALIASES: Readonly<Record<string, readonly string[]>> = {
    grains: ["grains", "cereal", "cereals"],
    roots: ["roots", "roots_tubers", "roots & tubers", "tuber", "tubers", "yam", "yams", "cassava"],
    vegetables: ["vegetables", "vegetable", "horticultural"],
    fruits: ["fruits", "fruit"],
    nuts: ["nuts", "nut", "seed", "seeds", "sesame", "sesame seeds", "sesame_seeds"],
    spices: ["spices", "spices_herbs_seasonings", "spices & herbs", "spices_herbs", "hibiscus", "zobo"],
    livestock: ["livestock"],
    poultry: ["poultry"],
    dairy: ["dairy", "dairy & eggs", "dairy_eggs"],
    processed: ["processed", "processed foods", "processed_foods", "natural_oils", "beverages"],
    organic: ["organic", "organics"],
    sea_foods: ["sea_foods", "fishery"],
    fishery: ["fishery", "sea_foods"],
};

/**
 * Every stored spelling of a requested category.
 *
 * An unknown category maps to itself, so a filter for something not in the table
 * still matches rows stored under exactly that name.
 */
export function categorySpellings(category: string): string[] {
    const key = String(category ?? "").toLowerCase();
    const mapped = PRODUCT_CATEGORY_ALIASES[key];
    return mapped ? [...mapped] : [String(category ?? "")];
}

/** A row this module can page: anything with an id. */
export interface Identified { id?: string | null }

/**
 * Does this product match the query?
 *
 * Title and description, case-insensitive, substring — the rule both actions
 * already applied, kept identical so moving the filter changes WHICH rows are
 * considered and nothing about what counts as a match.
 */
export function matchesProductQuery(product: unknown, query: string): boolean {
    const needle = String(query ?? "").toLowerCase().trim();
    if (needle === "") return true;

    const p = (product ?? {}) as Record<string, unknown>;
    const haystack = [p.title, p.description]
        .filter((v) => v !== null && v !== undefined)
        .map((v) => String(v))
        .join(" ")
        .toLowerCase();

    return haystack.includes(needle);
}

/** Filters a scanned window by the query. An empty query keeps everything. */
export function filterProductsByQuery<T>(products: readonly T[], query: string | undefined): T[] {
    if (!query || String(query).trim() === "") return [...products];
    return products.filter((p) => matchesProductQuery(p, query));
}

export interface FilteredPage<T> {
    page: T[];
    hasMore: boolean;
    lastId?: string;
}

/**
 * Pages an already-filtered list.
 *
 * `lastId` is the id of the final row the caller was served last time, so the
 * next page starts after it. An id that is no longer in the list — the product
 * was sold out, delisted, or edited out of the match — starts from the
 * beginning rather than silently serving nothing, which is what a `findIndex`
 * of -1 does when its result is used unchecked.
 */
export function pageFilteredProducts<T extends Identified>(
    products: readonly T[],
    lastId: string | undefined,
    limit: number,
): FilteredPage<T> {
    const size = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;

    let start = 0;
    if (lastId) {
        const at = products.findIndex((p) => String(p?.id ?? "") === String(lastId));
        if (at !== -1) start = at + 1;
    }

    const page = products.slice(start, start + size);
    const hasMore = products.length > start + size;

    return {
        page,
        hasMore,
        // Only offer a cursor when there is something after it. Handing back the
        // last id of the last page is what let a "Load More" button sit under a
        // list that had nothing more to load.
        lastId: hasMore && page.length > 0 ? String(page[page.length - 1]?.id ?? "") : undefined,
    };
}
