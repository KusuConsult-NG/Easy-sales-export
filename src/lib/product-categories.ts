/**
 * The one list of categories a seller may file a product under.
 *
 *   #802 THREE DOORS, TWO VOCABULARIES, AND ONE OF THEM WAS NOT THE STORED ONE.
 *
 *   /marketplace/sell/create and /marketplace/seller/products/[id]/edit each
 *   carried an IDENTICAL eighteen-entry list of {value, label} pairs — values
 *   like "grains", which is what the database holds and what
 *   ProductCategorySchema accepts.
 *
 *   /marketplace/products/add carried its own list of ten BARE DISPLAY STRINGS:
 *
 *       "Grains & Cereals", "Tubers & Roots", "Fruits", "Vegetables",
 *       "Spices", "Nuts & Seeds", "Processed Foods", "Livestock Products",
 *       "Poultry Products", "Other"
 *
 *   and submitted the label as the value. Not one of those ten is in the enum —
 *   "Grains & Cereals" is not a spelling the table knows, and "Fruits" and
 *   "Processed Foods" fail on CASE alone, since z.enum is case-sensitive and
 *   the stored spellings are lowercase.
 *
 * ── WHAT THAT COST, AND THE SCHEMA SAID IT IN ADVANCE ───────────────────────
 *
 *   validations/marketplace.ts, on this exact hazard:
 *
 *       "a product stored as 'tubers' would have come back as 'other' — out of
 *        its own category filter, and described to its seller as uncategorised."
 *
 *   That is what happened to every product listed through the add form.
 *   LenientProductSchema heals the invalid value to the default, so the write
 *   succeeded, the seller saw a success toast, and the listing was quietly
 *   filed as "other": invisible to a buyer browsing its real category, and
 *   shown back to its own seller as uncategorised.
 *
 *   MEASURED, not inferred. Creating one product through the real form in the
 *   end-to-end suite (#798) makes the server log it on every read:
 *
 *       [serializeProduct] document did not satisfy its schema; healing
 *       {"id":"product_…","issues":["category: invalid_value"]}
 *
 * ── WHY THIS IS A MODULE AND NOT A THIRD COPY ───────────────────────────────
 *
 *   Two doors holding their own copy of one rule is how this module's creators
 *   already drifted twice — ProductSchema's own comments record certifications
 *   being dropped by one door and the initial status diverging between them,
 *   and #794 found the pricing bound on one write door and absent from three.
 *   A fourth copy would be the same bet.
 *
 *   The list lives here. Every door imports it, and
 *   `a-category-nobody-could-browse.test.ts` asserts that each value parses
 *   through ProductCategorySchema, so a category cannot be offered to a seller
 *   that the database will refuse to file it under.
 */

/** A category as a seller picks it: stored value, and the words on screen. */
export interface ProductCategoryOption {
    /** What is written to the product. Must satisfy ProductCategorySchema. */
    value: string;
    /** What the seller reads. Never submitted. */
    label: string;
}

/**
 * Every category a product may be listed under.
 *
 * The order is the order a seller sees, and it is the order the two doors that
 * already agreed were using — kept as-is so this change is a de-duplication
 * rather than a re-ordering nobody asked for.
 */
export const PRODUCT_CATEGORY_OPTIONS: readonly ProductCategoryOption[] = [
    { value: "poultry", label: "Poultry" },
    { value: "sea_foods", label: "Sea Foods" },
    { value: "horticultural", label: "Horticultural" },
    { value: "natural_oils", label: "Natural Oils" },
    { value: "spices_herbs_seasonings", label: "Spices, Herbs & Seasonings" },
    { value: "beverages", label: "Beverages" },
    { value: "dairy", label: "Dairy" },
    { value: "organics", label: "Organics" },
    { value: "gmos", label: "GMOs" },
    { value: "health_wellness", label: "Health & Wellness" },
    { value: "grains", label: "Grains & Cereals" },
    { value: "vegetables", label: "Vegetables" },
    { value: "fruits", label: "Fruits" },
    { value: "livestock", label: "Livestock" },
    { value: "fishery", label: "Fishery" },
    { value: "processed", label: "Processed Foods" },
    { value: "equipment", label: "Farm Equipment" },
    { value: "other", label: "Other" },
] as const;
