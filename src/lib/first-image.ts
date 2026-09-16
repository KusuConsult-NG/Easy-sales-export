/**
 * The one rule for "show this record's picture".
 *
 *   #439 A LAND LISTING WITH NO `images` KEY TOOK THE WHOLE PUBLIC PROPERTY
 *   CATALOGUE DOWN.
 *
 * /farm-nation/properties rendered:
 *
 *     <Image src={property.images[0] || "/placeholder-land.jpg"} ... />
 *
 * `property.images` is `undefined` for a stored row that never had the key, and
 * `undefined[0]` THROWS. The throw happens inside the .map() that builds the
 * grid, so React unwinds the whole route into the Farm Nation error boundary —
 * every visitor, signed in or not, sees "Something went wrong! We encountered an
 * unexpected error while loading Farm Nation." One row, the entire page.
 *
 * Not argued — observed. The full Playwright run against the local stack failed
 * exactly one of 360 tests, "User can browse properties", and the snapshot
 * Playwright captured at the moment of failure is that error boundary rather
 * than the empty state. The database held three `verified` listings; one of
 * them carries no `images` key at all.
 *
 * WHY A MODULE AND NOT FOUR `?.`s. Fifteen call sites index `.images[0]`.
 * ELEVEN of them already guard it and FOUR did not — the shape this audit has
 * now found nine times (#425, #426, #429, #430, #431, #432, #433, #434, #438):
 * a rule stated by hand in every reader, and a fix that reaches most of them.
 * export/(app)/products even carries a comment spelling out this exact hazard.
 * The rule lives here once instead.
 *
 * AND THE GUARDS THAT EXISTED DID NOT ALL GUARD THE SAME THING. Five sites also
 * check the value starts with http:// or https://, because `next/image` THROWS
 * on a src that is neither an absolute URL nor a leading-slash path — so a row
 * holding a bare storage key crashes the page just as surely as a missing array,
 * and six of the eleven "guarded" sites were still open to that. One rule closes
 * both.
 */

import { PUBLIC_ASSETS } from "@/lib/public-assets.generated";

/**
 * A src `next/image` will accept: an absolute URL, or a path from the root.
 *
 * THE PROTOCOL-RELATIVE CASE WAS CAUGHT BY AN EXISTING RATCHET, NOT BY ME. This
 * read `src.startsWith("/")`, and #262's sweep — "no guard checks only for a
 * leading slash" — failed on the line. It was right to: `//evil.example/x.jpg`
 * starts with a slash and is a third-party fetch wearing a local path's
 * clothes. #262 found that shape in a redirect target; the same string is the
 * same hazard in an image src, and the sweep does not care which.
 */
function isRenderableSrc(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const src = value.trim();
    if (src === "") return false;
    if (src.startsWith("http://") || src.startsWith("https://")) return true;
    if (!src.startsWith("/") || src.startsWith("//")) return false;

    /*
     *   #831 AND A LOCAL PATH THIS APPLICATION NEVER SHIPPED IS NOT RENDERABLE
     *   EITHER.
     *
     *   From the owner's production log, on every render of one product:
     *
     *       ⨯ The requested resource isn't a valid image for
     *         /images/products/yams.jpg received null
     *
     *   `public/images/products/` has never existed in this repository. The path
     *   is in DATA — a row written by a seed or an import that pointed at a file
     *   nobody uploaded — so #829's sweep of src/ could not see it, and no
     *   change to src/ could fix it.
     *
     *   What the application CAN know is what it ships. The generated manifest
     *   beside this file is exactly that, so a stored local path that is not in
     *   it is dead and is treated as no image at all: the caller's placeholder
     *   renders, the optimiser is never asked, and the error stops.
     *
     *   ABSOLUTE URLs ARE UNTOUCHED, which is the important half — every image
     *   this platform actually uploads goes to Cloudinary and arrives as an
     *   https:// URL. This rule only ever governs paths that claim to be local,
     *   and the only local images that exist are the ones in the manifest.
     *
     *   The manifest is generated from disk and a test regenerates and compares
     *   it, so adding an asset without running `npm run assets:manifest` fails
     *   CI with the command to run rather than silently hiding the picture.
     */
    const [path] = src.split(/[?#]/);
    return PUBLIC_ASSETS.has(path);
}

/**
 * The first image of `images` that `next/image` can actually render, or null.
 *
 * Returns null — never throws and never returns an unusable string — for every
 * shape a stored document has been seen to hold: the key absent, null, a string
 * where an array belongs, an empty array, an array of empty strings, or an array
 * of bare storage keys. A caller renders its own placeholder on null, which is
 * what all fifteen sites already do on their own branch.
 *
 * It skips unusable entries rather than only inspecting index 0: a row whose
 * first image is a bare key and whose second is a real URL now shows the
 * picture, where indexing [0] showed a gap.
 */
export function firstImageSrc(images: unknown): string | null {
    if (!Array.isArray(images)) return null;
    // Indexed rather than `for…of`: this runs during render, so it must not
    // throw for ANY input, and an array-like that satisfies Array.isArray
    // without being iterable makes `for…of` raise "images is not iterable".
    // Its own test caught that, which is the whole reason the case is here.
    const length = Number((images as { length?: unknown }).length);
    if (!Number.isFinite(length)) return null;
    for (let i = 0; i < length; i += 1) {
        if (isRenderableSrc(images[i])) return (images[i] as string).trim();
    }
    return null;
}

/**
 * The same answer with a caller-chosen fallback, for the sites that always
 * render an <Image> rather than branching.
 */
export function firstImageSrcOr(images: unknown, fallback: string): string {
    return firstImageSrc(images) ?? fallback;
}

/**
 * One candidate, checked — for a gallery that indexes by something other than 0.
 *
 * /farm-nation/property/[id] renders `property.images[currentImageIndex]`. Its
 * surrounding `images && images.length > 0` guard does cover the missing-array
 * case, so that page was never open to #439's crash; what it was open to is the
 * other half — a stored entry that is a bare storage key rather than a URL,
 * which `next/image` throws on just as readily.
 */
export function imageSrcOr(value: unknown, fallback: string): string {
    return isRenderableSrc(value) ? value.trim() : fallback;
}

/**
 * One candidate, or null — for a caller whose renderer already knows what to
 * draw when there is no image.
 *
 *   #829. Every caller of `imageSrcOr` in this codebase passed a path to a file
 *   that does not exist: "/placeholder-land.jpg" and
 *   "/images/placeholder-product.jpg" are both absent from public/, and a sweep
 *   of every static asset path in src/ against the filesystem found three such
 *   placeholders referenced and never shipped.
 *
 *   The result was a guaranteed 404 on every item without a photo, followed by
 *   ThumbnailImage's own fallback rendering anyway — so the round trip bought
 *   nothing and the component's designed "no image" path never ran. A caller
 *   that has a fallback element wants null, not a fake URL.
 */
export function imageSrcOrNull(value: unknown): string | null {
    return isRenderableSrc(value) ? value.trim() : null;
}
