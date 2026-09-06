import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session-guard";
import { isAdmin, hasAdminPermission } from "@/lib/admin-permissions";
import { logger } from "@/lib/logger";
import { rateLimit, createRateLimitResponse } from "@/lib/rate-limiter";
import { rateLimitConfig } from "@/lib/rate-limits.config";

export const maxDuration = 300; // 5 min timeout

/**
 * The estimate is as expensive as a send: same scan, same audiences.
 * Keyed on the account, matching /api/admin/broadcast/send.
 */
const estimateLimiter = rateLimit(rateLimitConfig.admin);

export async function POST(req: NextRequest) {
    try {
        // THE GUARD WAS SWITCHED OFF BY A QUERY PARAMETER.
        //
        //     const isTest = req.nextUrl.searchParams.get("debug") === "antigravity";
        //     if (!isTest) { ...requireSession + isAdmin... }
        //
        // So `POST /api/admin/broadcast/estimate?debug=antigravity` ran with no
        // session at all, and /api is not in PROTECTED_PATHS — the middleware
        // gates /admin, not /api/admin — so the route's own check was the only
        // one there was.
        //
        // What that returned to an anonymous caller: `count` and `totalMatches`
        // for any audience and state filter the caller posted, `moduleStats`,
        // and a `sample` of five real names and email addresses. Choose the
        // audience and you choose whose. It also ran the full collection scan
        // behind a 300-second budget, for anyone, as fast as requests could be
        // issued.
        //
        // "antigravity" appeared exactly once in the repository — here. Nothing
        // sends it: /admin/communications/broadcast POSTs the filters and no
        // query string. So it bought nothing, which is the argument for removing
        // it rather than narrowing it.
        //
        // This is the same defect #154 removed from getCleanBroadcastListAction,
        // where `process.env.ADMIN_OVERRIDE === "true"` skipped the same check
        // on the same data. That commit closed with "every caller ... the two
        // /api/admin/broadcast routes — so nothing legitimate changes", which
        // took the routes' own guards as given. One of them had a switch of its
        // own, and a query parameter is the worse of the two: an environment
        // variable needs deploy access, this needed a URL.
        const { session } = await requireSession();
        // #438: this was isAdmin(...) — true for ANY of the ten admin roles.
        // Named permission because sizing a platform-wide blast is the same decision as sending it, and broadcast/send already asks for this.
        if (!session?.user || !hasAdminPermission(session.user.roles, "announcements:manage")) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 403 });
        }

        const rateLimitResult = await estimateLimiter.check(session.user.id);
        if (!rateLimitResult.success) {
            return createRateLimitResponse(rateLimitResult);
        }

        // Read and log the body only after the caller has been admitted. It was
        // parsed and logged first, so an anonymous request wrote its own content
        // — a csv_upload audience carries the caller's address list — into our
        // logs before anything had asked who was calling.
        const filters = await req.json();
        logger.debug('[broadcast/estimate] filters received', { audience: filters?.audience });

        const { getCleanBroadcastList } = await import("@/lib/broadcast-logic");
        const listResult = await getCleanBroadcastList(filters);

        if (!listResult.success || !listResult.data) {
            return NextResponse.json({ success: false, error: listResult.error || "Failed to estimate recipients" }, { status: 500 });
        }

        // The sample is narrowed to name and email deliberately. This route does
        // not delegate to previewBroadcastAction — which it imported without
        // ever calling — because that returns whole recipient records in its
        // sample, carrying uid, state and lastActive as well.
        const responseData = {
            success: true,
            data: {
                count: listResult.data.count,
                totalMatches: listResult.data.originalDocCount,
                sample: listResult.data.recipients.slice(0, 5).map(r => ({ name: r.name, email: r.email })),
                moduleStats: listResult.data.moduleStats
            }
        };

        const response = NextResponse.json(responseData);
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');

        return response;
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
