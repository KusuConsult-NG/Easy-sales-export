/**
 * The flags and refusals for endpoints that are retired but kept.
 *
 * WHY THESE LIVE HERE AND NOT IN THE ROUTES
 * -----------------------------------------
 * A Next.js App Router `route.ts` may export ONLY its HTTP method handlers and
 * a fixed set of config keys (`dynamic`, `revalidate`, `runtime`, …). Anything
 * else fails the type Next generates for the route:
 *
 *     Type 'OmitWithTag<typeof import(".../route"), "POST" | ... >' does not
 *     satisfy the constraint '{ [x: string]: never; }'.
 *       Property 'legacyDocumentFallbackEnabled' is incompatible with index
 *       signature. Type '() => boolean' is not assignable to type 'never'.
 *
 * #431 and #432 each put a `legacy…Enabled()` helper and a RETIRED_MESSAGE next
 * to the handler they guard, which read naturally and does not compile.
 *
 * AND `npx tsc --noEmit` DOES NOT CATCH IT. The constraint lives in
 * the generated per-route file under `.next/types`, which only exists after `next build`. The gate
 * that does catch it is #328's whole-program typecheck — and running the test
 * suite BEFORE the build, as I did locally, has it read the types from an
 * earlier build and pass. CI builds first, so CI caught what my local run
 * could not. The lesson is about gate ORDER, not about the gate: build, then
 * test.
 *
 * WHY ONE MODULE FOR BOTH
 * ------------------------
 * Two retirements, one shape: a flag read at call time and a message naming the
 * path that works. Keeping them together makes the set of retired endpoints
 * something you can read in one place rather than discover one route at a time.
 */

const ENABLED = "enabled";

/**
 * #431 — GET /api/admin/documents/[docId].
 *
 * It reads `_document_uploads`, a table with no writer anywhere in this
 * repository and no migration creating it, so it could only ever 404. Seller
 * verification documents are stored on the verification record itself now.
 */
export function legacyDocumentFallbackEnabled(): boolean {
    return process.env.LEGACY_DOCUMENT_FALLBACK === ENABLED;
}

export const DOCUMENT_VIEWER_RETIRED_MESSAGE =
    "This document viewer is retired: nothing writes _document_uploads. "
    + "Seller verification documents are stored on the verification record itself.";

/**
 * #432 — POST /api/farm-nation/create-listing.
 *
 * It demanded a land title and survey plan and stored `placeholder_<filename>`
 * for both, uploading nothing. The live path is /farm-nation/list-land, which
 * uploads every image and document and calls submitLandListingAction.
 */
export function legacyLandListingApiEnabled(): boolean {
    return process.env.LEGACY_LAND_LISTING_API === ENABLED;
}

export const LAND_LISTING_API_RETIRED_MESSAGE =
    "This endpoint is retired: it could not store the land title or survey plan "
    + "it required. Submit through /farm-nation/list-land, which uploads them.";
