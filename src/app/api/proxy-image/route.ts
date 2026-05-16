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

const ALLOWED_HOSTS = [
    "res.cloudinary.com",
    "cloudinary.com",
];

function isAllowedUrl(raw: string): boolean {
    try {
        const { hostname } = new URL(raw);
        return ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
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
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream fetch failed: ${response.status}` },
                { status: 502 }
            );
        }

        const contentType = response.headers.get("content-type") ?? "image/jpeg";
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const dataUri = `data:${contentType};base64,${base64}`;

        return NextResponse.json({ dataUri });
    } catch (err) {
        console.error("[proxy-image] fetch error:", err);
        return NextResponse.json({ error: "Failed to fetch image" }, { status: 500 });
    }
}
