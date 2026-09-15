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
     *   A whitespace-only URL is not a URL. It passes a truthy check, reaches
     *   next/image, and becomes a request that cannot succeed — which is one of
     *   the ways a card ends up showing its own title.
     */
    const usable = typeof src === "string" && src.trim().length > 0;

    if (!usable || failed) {
        return <div className={fallbackClassName} aria-hidden="true">{fallback}</div>;
    }

    return (
        <Image
            src={src!}
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
