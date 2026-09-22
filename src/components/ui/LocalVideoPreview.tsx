"use client";

/**
 * The video a person just picked, played back before it is uploaded.
 *
 *   THE OWNER: "when a user is adding a product, it doesnt show a preview of
 *   the image or video being added."
 *
 *   The images had a preview that had gone blank (see lib/first-image — a blob:
 *   URL was being refused). The VIDEO never had one at all: the add-product
 *   screen showed a green film icon, the file name and the size in megabytes,
 *   so the only confirmation that the right clip had been chosen was reading
 *   its filename.
 *
 * ── WHY A COMPONENT, AND WHY IT OWNS THE URL ────────────────────────────────
 *
 *   `URL.createObjectURL` allocates until it is revoked, and the sibling image
 *   preview calls it INLINE IN RENDER — so every keystroke elsewhere on the
 *   form mints another URL for the same file and leaks the last one. On a
 *   200MB clip (the limit this platform raised it to) that is worth avoiding.
 *
 *   Created in an effect keyed on the file and revoked on cleanup, so exactly
 *   one URL exists per chosen file and it is released when the file changes or
 *   the screen goes away.
 */

import { useEffect, useState } from "react";

export function LocalVideoPreview({ file, className = "" }: {
    file: File;
    className?: string;
}) {
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
        const objectUrl = URL.createObjectURL(file);
        setUrl(objectUrl);
        return () => {
            URL.revokeObjectURL(objectUrl);
            setUrl(null);
        };
    }, [file]);

    if (!url) return null;

    return (
        <video
            src={url}
            controls
            //   Not autoplaying: the person chose this file, they did not ask
            //   for it to start making noise. `preload="metadata"` is enough to
            //   paint the first frame, which is the confirmation they want.
            preload="metadata"
            className={className}
        />
    );
}
