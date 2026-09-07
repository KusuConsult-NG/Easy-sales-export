/**
 * GET /api/health
 *
 * Reports:
 *  1. `status` — Railway's health check reads this.
 *  2. `buildTime` — DeploymentWatcher polls every five minutes and offers a
 *     refresh when it changes, which is what stops ChunkLoadError mid-session
 *     when Railway swaps containers. Stamped at `next build` via next.config.ts.
 *  3. #470 the DEPLOYMENT FACTS — which commit and branch this container is
 *     actually running. A buildTime says an image was built, not what was in it:
 *     a failed build leaves the previous image serving under a plausible
 *     timestamp, and a redeploy of an old commit produces a new one. See
 *     lib/deployment-facts.ts for why that mattered and what it deliberately
 *     omits — this endpoint is unauthenticated.
 */

import { NextResponse } from "next/server";
import { deploymentFacts } from "@/lib/deployment-facts";

// BUILD_TIME is injected at build time (see next.config.ts).
// Falls back to the process start time so there's always a value.
const BUILD_TIME =
    process.env.NEXT_PUBLIC_BUILD_TIME ||
    process.env.BUILD_TIME ||
    new Date().toISOString();

export const dynamic = "force-dynamic";

export function GET() {
    return NextResponse.json(
        { status: "ok", buildTime: BUILD_TIME, ...deploymentFacts() },
        {
            status: 200,
            headers: {
                // Never cache — we need the real current value on every poll
                "Cache-Control": "no-store, no-cache, must-revalidate",
            },
        }
    );
}
