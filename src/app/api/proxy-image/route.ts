/**
 * /api/proxy-image
 *
 * Server-side proxy that fetches an external image (e.g. Cloudinary) and
 * returns it as a base64 data URI.  Because the fetch happens on the server
 * there are no browser CORS restrictions, so html2canvas can always render
 * the image without the canvas becoming "tainted".
 *
 * Usage:  GET /api/proxy-image?url=<encoded-image-url>
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { getImageKitId } from "@/lib/imagekit";

const ALLOWED_HOSTS = [
    "res.cloudinary.com",
    "cloudinary.com",
    "ik.imagekit.io",
];

/**
 * Largest image this will buffer.
 *
 * The response was read with arrayBuffer() and base64-encoded — which inflates
 * it by a third — with no ceiling. Any file reachable on an allowed host could
 * be pulled entirely into memory on request.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Is this a URL this server will fetch?
 *
 * The host check alone was not enough, for the reason #168 gave when it fixed
 * the same thing on the certificate upload route:
 *
 *     res.cloudinary.com is Cloudinary's SHARED delivery domain — every
 *     customer serves from it, under /<cloud_name>/. Allowing the hostname
 *     allowed any file hosted by anyone on Cloudinary, so the check read as a
 *     restriction and was close to none.
 *
 * That fix pinned the cloud name. This route kept the hostname check, so this
 * server would fetch any Cloudinary customer's content and hand it back
 * base64-encoded to a logged-in caller.
 */
function isAllowedUrl(raw: string): boolean {
    try {
        const parsed = new URL(raw);

        if (parsed.protocol !== "https:") return false;

        const hostAllowed = ALLOWED_HOSTS.some(
            (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
        );
        if (!hostAllowed) return false;

        const isCloudinary = parsed.hostname === "res.cloudinary.com"
            || parsed.hostname.endsWith(".cloudinary.com");
        const isImageKit = parsed.hostname === "ik.imagekit.io"
            || parsed.hostname.endsWith(".imagekit.io");

        const firstSegment = parsed.pathname.split("/").filter(Boolean)[0];

        if (isCloudinary) {
            const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
            // Fails closed rather than treating an unset variable as a match for
            // whatever the first path segment happens to be.
            if (!cloudName) return false;
            return firstSegment === cloudName;
        }

        if (isImageKit) {
            //   FAILS CLOSED when nothing configures the account, exactly as
            //   the Cloudinary branch beside this one does. See lib/imagekit.
            const imageKitId = getImageKitId();
            if (!imageKitId) return false;
            return firstSegment === imageKitId;
        }

        return false;
    } catch {
        return false;
    }
}

export async function GET(req: NextRequest) {
    // Auth guard — only logged-in users can use this proxy
    const sessionResult = await requireSession();
    if (!sessionResult.session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = req.nextUrl.searchParams.get("url");

    if (!url) {
        return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
    }

    const decoded = decodeURIComponent(url);

    if (!isAllowedUrl(decoded)) {
        return NextResponse.json({ error: "URL host not permitted" }, { status: 403 });
    }

    try {
        const response = await fetch(decoded, {
            // Server-side fetch — no browser CORS restrictions apply
            headers: { "User-Agent": "EasySalesExport/1.0 ImageProxy" },
            // Redirects are NOT followed.
            //
            // The allow-list is checked on the URL the caller supplied, and
            // fetch follows redirects by default — so the host this server
            // actually retrieved from did not have to be an allowed one. A
            // check that only inspects the first hop is not a check on where
            // the request ends up.
            redirect: "manual",
        });

        if (response.status >= 300 && response.status < 400) {
            return NextResponse.json(
                { error: "Upstream redirected; only direct image URLs are proxied" },
                { status: 502 }
            );
        }

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream fetch failed: ${response.status}` },
                { status: 502 }
            );
        }

        const contentType = response.headers.get("content-type") ?? "image/jpeg";

        // It is an image proxy. Anything else reaching a data: URI is a
        // different feature nobody asked for.
        if (!contentType.startsWith("image/")) {
            return NextResponse.json(
                { error: "Upstream did not return an image" },
                { status: 415 }
            );
        }

        // Checked before reading where the header is honest, and again after,
        // because Content-Length is optional and a server may omit or lie.
        const declared = Number(response.headers.get("content-length") ?? NaN);
        if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) {
            return NextResponse.json({ error: "Image too large" }, { status: 413 });
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_IMAGE_BYTES) {
            return NextResponse.json({ error: "Image too large" }, { status: 413 });
        }

        const base64 = Buffer.from(buffer).toString("base64");
        const dataUri = `data:${contentType};base64,${base64}`;

        return NextResponse.json({ dataUri });
    } catch (err) {
        console.error("[proxy-image] fetch error:", err);
        return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
    }
}
