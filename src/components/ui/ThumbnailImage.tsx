"use client";

/**
 * A card thumbnail that fails to a placeholder instead of to its own alt text.
 *
 *   #791 A BROKEN THUMBNAIL PRINTED THE ITEM'S TITLE ACROSS THE BADGES ON TOP
 *        OF IT.
 *
 *   Reported by the owner with a screenshot of /admin/academy: three course
 *   cards, each with its title overlapping the tier and level pills — "Advanced
 *   Agro-Export Market Analysis" with "Elite" and "Advanced" sitting on the
 *   words.
 *
 *   The text underneath was NOT a heading. It was the ALT TEXT of a broken
 *   image. The card renders
 *
 *       <div className="h-40 relative">
 *         <Image src={course.thumbnail} alt={course.title} fill />
 *         <div className="absolute top-4 right-4"> …tier… …level… </div>
 *       </div>
 *
 *   and when the thumbnail does not load, the browser paints `alt` inside the
 *   image's box — which is the same box the badges are absolutely positioned
 *   in, so they land on top of each other. The give-away in the screenshot is
 *   that the title appears TWICE: once as the broken image's alt, once in the
 *   card body below, where it belongs.
 *
 *   The empty-thumbnail case was already handled — a BookOpen icon. It is the
 *   PRESENT-BUT-BROKEN case that had nothing, because a truthy URL passes the
 *   `course.thumbnail ? … : …` guard and only fails later, in the browser.
 *
 * ── WHY A COMPONENT AND NOT AN onError AT EACH SITE ─────────────────────────
 *
 *   Because four cards already had one, hand-rolled, as
 *   `onError={e => (e.target as HTMLImageElement).style.display = 'none'}` —
 *   which works, and leaves an empty grey rectangle where a placeholder should
 *   be, and is a different answer at every site. Ten more had nothing. That
 *   spread is the shape this audit keeps meeting: a correct rule applied to
 *   some of the places it names.
 *
 *   `alt` IS KEPT, deliberately. It is what a screen reader announces when the
 *   image DOES load, and removing it to stop the visual collision would fix a
 *   layout bug by breaking accessibility. What changes is that a FAILED image
 *   is replaced by the placeholder, so there is no alt text to paint.
 */

import Image from "next/image";
import { useState, type ReactNode } from "react";
import { imageSrcOrNull } from "@/lib/first-image";

export interface ThumbnailImageProps {
    /** May be null, undefined or empty — that is the ordinary "no image" case. */
    src?: string | null;
    /** Describes the image for a screen reader when it loads. */
    alt: string;
    /** Shown when there is no image, and when one fails to load. */
    fallback: ReactNode;
    className?: string;
    sizes?: string;
    priority?: boolean;
    unoptimized?: boolean;
    /** Wrapper classes for the placeholder box. */
    fallbackClassName?: string;
}

export function ThumbnailImage({
    src,
    alt,
    fallback,
    className = "object-cover",
    sizes,
    priority,
    unoptimized,
    fallbackClassName = "absolute inset-0 flex items-center justify-center text-slate-300",
}: ThumbnailImageProps) {
    const [failed, setFailed] = useState(false);

    /*
     *   #875 THE SAME QUESTION EVERY OTHER RENDER SITE ASKS, ASKED HERE ONCE.
     *
     *   This used to be `typeof src === "string" && src.trim().length > 0` —
     *   a whitespace check, which is right as far as it goes and stops well
     *   short. A stored "/images/products/yams.jpg" is a non-empty string, and
     *   it reached the optimiser from every caller of this component:
     *
     *       ⨯ The requested resource isn't a valid image for
     *         /images/products/yams.jpg received null
     *
     *   `imageSrcOrNull` is the rule — an absolute URL, a runtime upload, or a
     *   local path this application actually ships, and nothing else. Asked in
     *   the SHARED component rather than at each of its callers, because the
     *   finding this comes from is precisely that a rule asked at each caller
     *   gets asked at most of them.
     *
     *   Nothing regresses for a caller that already guards: imageSrcOrNull is
     *   idempotent, so a value that passed once passes again.
     *
     *   And the onError below stays. This stops a request that CANNOT succeed;
     *   that catches the one that could have and did not — an expired
     *   Cloudinary URL, a deleted asset — which no static rule can know.
     */
    const usable = imageSrcOrNull(src);

    if (!usable || failed) {
        return <div className={fallbackClassName} aria-hidden="true">{fallback}</div>;
    }

    /*
     *   A LOCAL PREVIEW IS NOT next/image's JOB.
     *
     *   blob: and data: sources are bytes this document already holds. next/image
     *   wants a src it can route through the optimiser or at least parse as a
     *   URL with a host, and hands back "Failed to parse src" for a blob — so
     *   even with the guard above fixed, routing a preview through <Image>
     *   trades a blank placeholder for a thrown render.
     *
     *   A plain <img> is the correct element here: nothing to optimise, no
     *   remote host to allow-list, no layout shift to prevent because the box is
     *   already sized by the caller's wrapper. The onError below is kept, so a
     *   revoked object URL still falls back rather than painting its alt text —
     *   which is the whole reason this component exists.
     */
    if (usable.startsWith("blob:") || usable.startsWith("data:")) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={usable}
                alt={alt}
                className={`absolute inset-0 h-full w-full ${className}`}
                onError={() => setFailed(true)}
            />
        );
    }

    return (
        <Image
            src={usable}
            alt={alt}
            fill
            className={className}
            sizes={sizes}
            priority={priority}
            unoptimized={unoptimized}
            //   The whole point. Without this the browser keeps the broken
            //   <img> in the layout and paints `alt` inside it.
            onError={() => setFailed(true)}
        />
    );
}
