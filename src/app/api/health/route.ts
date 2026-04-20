/**
 * GET /api/health
 *
 * Lightweight health-check endpoint used by:
 *  1. Railway — healthcheckPath "/" already exists, but this gives richer info.
 *  2. DeploymentWatcher — client polls this to detect when a new Docker build
 *     has been deployed. BUILD_TIME is stamped at build time via next.config.ts
 *     NEXT_PUBLIC_BUILD_TIME so every new Railway deploy returns a different value.
 */

import { NextResponse } from "next/server";

// BUILD_TIME is injected at build time (see next.config.ts).
// Falls back to the process start time so there's always a value.
const BUILD_TIME =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    process.env.BUILD_TIME ||
    new Date().toISOString();

export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json(
        { status: "ok", buildTime: BUILD_TIME },
        {
            status: 200,
            headers: {
                // Never cache — we need the real current value on every poll
                "Cache-Control": "no-store, no-cache, must-revalidate",
            },
        }
    );
}
