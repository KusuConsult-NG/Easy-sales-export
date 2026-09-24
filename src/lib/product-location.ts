/**
 * The nearest market, asked the same way by both product forms.
 *
 *   THE OWNER: "/marketplace/sell/create never asks for a nearest market, but
 *   the edit screen requires one — so those products can't be re-saved."
 *
 * ── TWO FORMS, TWO DIFFERENT QUESTIONS ──────────────────────────────────────
 *
 *   /marketplace/sell/create has a "Location & Delivery" section with State,
 *   LGA and Delivery Method, and no nearest market at all. Both creators then
 *   write the field anyway:
 *
 *       nearestMarket: formData.get("nearestMarket") as string || "Unknown"
 *
 *   /marketplace/seller/products/[id]/edit asks for it, labels it "Nearest
 *   Market *", and marks the input `required`.
 *
 *   So a seller who listed a product through the primary path — the one six
 *   links point at — opened the edit screen to find a field they had never
 *   been shown, already filled in with the word "Unknown", carrying an
 *   asterisk. That word is not their answer. It is what the server writes when
 *   nobody asked, presented back to them as data they entered.
 *
 * ── THE PLACEHOLDER IS NOT AN ANSWER ────────────────────────────────────────
 *
 *   Which is the whole rule here. `storedNearestMarket` gives back "" for the
 *   manufactured value, so the edit screen shows an empty box with its own
 *   placeholder — a question, which it is — rather than a fake answer. And
 *   NEITHER form requires it: a listing without a nearest market has been legal
 *   since the first one was written, and making it mandatory on the edit screen
 *   alone is what stranded these listings. A field that both forms ask and
 *   neither demands is the shape that cannot strand anybody.
 *
 *   NOTHING STORED CHANGES. A product whose row says "Unknown" keeps saying
 *   "Unknown" until its seller types something else; this decides what the
 *   FORM shows, not what the database holds.
 */

/** What the creators write when the form did not ask. Not a market name. */
export const NEAREST_MARKET_PLACEHOLDER = "Unknown";

/**
 * The seller's own answer, or "" when there is none.
 *
 * Case-insensitive, because the same word arrives from three writers and one
 * of them could easily be "unknown".
 */
export function storedNearestMarket(value: unknown): string {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed.toLowerCase() === NEAREST_MARKET_PLACEHOLDER.toLowerCase() ? "" : trimmed;
}

/** The label both forms use, so the two cannot describe one field differently. */
export const NEAREST_MARKET_LABEL = "Nearest Market";

/** The hint both forms use. */
export const NEAREST_MARKET_HINT = "e.g., Mile 12 Market";
