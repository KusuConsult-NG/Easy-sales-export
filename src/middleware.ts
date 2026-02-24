import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

/**
 * Edge Rate Limiter
 * Tracks IPs in-memory. Since Vercel Edge functions are stateless, this resets 
 * on cold boots, but effectively mitigates rapid brute-force bursts.
 */
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

// Basic known malicious bot signatures
const BLOCKED_USER_AGENTS = ["curl", "python-requests", "wget", "postman"];

/**
 * Hub Middleware
 * 
 * Uses Edge-compatible authConfig to avoid importing firebase-admin.
 */

const { auth } = NextAuth(authConfig);

// Domain Mapping Configuration
const DOMAIN_MAP: Record<string, string> = {
    "easysalesexportacademy.com": "/academy",
    "easysalescooperative.com": "/cooperatives",
    "easysalesmarket.com": "/marketplace",
    "waveprogramme.com": "/wave",
    "farmnation.ng": "/farm-nation",
    "easysalesexportng.com": "/export",
    "easysalesexport.com": "", // Hub represents the root
};

export default auth((req: any) => {
    let { pathname } = req.nextUrl;
    const hostname = req.headers.get("host")?.replace(/:\d+$/, "") || "";
    const ip = req.headers.get("x-forwarded-for") || req.ip || "unknown_ip";
    const userAgent = req.headers.get("user-agent")?.toLowerCase() || "";

    // Security Headers Logic
    const response = NextResponse.next();
    addSecurityHeaders(response);

    // 1. Basic Bot Rejection
    const isBot = BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot));
    if (isBot) {
        return new NextResponse("Forbidden - Bot Activity Detected", { status: 403 });
    }

    // 2. Edge Rate Limiting Logic
    const now = Date.now();
    const clientRecord = rateLimitMap.get(ip) || { count: 0, lastReset: now };

    if (now - clientRecord.lastReset > RATE_LIMIT_WINDOW_MS) {
        // Reset window
        clientRecord.count = 1;
        clientRecord.lastReset = now;
    } else {
        clientRecord.count++;
    }

    rateLimitMap.set(ip, clientRecord);

    if (clientRecord.count > MAX_REQUESTS_PER_WINDOW) {
        // Enforce 429 Too Many Requests
        return new NextResponse("Too Many Requests - Rate Limit Exceeded", { status: 429, headers: { 'Retry-After': '60' } });
    }

    // 3. Multi-Domain Host-Based Routing
    // Find if the incoming Host explicitly matches one of our dedicated module domains
    let rewritePrefix = DOMAIN_MAP[hostname];

    // Fallback for subdomains under the main hub for testing (e.g. academy.easysalesexport.com)
    if (rewritePrefix === undefined && hostname.endsWith(".easysalesexport.com")) {
        const subdomain = hostname.replace(".easysalesexport.com", "");
        if (Object.values(DOMAIN_MAP).includes(`/${subdomain}`)) {
            rewritePrefix = `/${subdomain}`;
        }
    }

    // -----------------------------------------------------------------------
    // DEDICATED DOMAIN REWRITE
    // When a non-hub dedicated domain is detected (rewritePrefix is a non-empty
    // string), we handle distinct cases so the FULL application is accessible:
    //
    //  Case 1 — Path already includes the module prefix (e.g. /academy/courses)
    //            → pass-through with security headers.
    //
    //  Case 2 — Path is a global "shared" route (e.g. /auth, /dashboard)
    //            → pass-through untouched so it works on the dedicated domain.
    //
    //  Case 3 — All other paths (including root "/") are assumed to belong to 
    //            the module associated with this domain. We prepend the prefix.
    //            (e.g., /courses → rewrite to /academy/courses).
    // -----------------------------------------------------------------------
    if (rewritePrefix && !pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
        const SHARED_ROOT_PATHS = [
            "/auth", "/dashboard", "/admin", "/profile", "/settings",
            "/messages", "/escrow", "/verify-id", "/verify-status",
            "/loans", "/favicon.ico", "/images", "/about", "/contact",
            "/privacy", "/terms", "/refund-policy", "/get-started", "/api"
        ];

        const isSharedRoute = SHARED_ROOT_PATHS.some(
            (p) => pathname === p || pathname.startsWith(p + "/")
        );

        // --- Case 1: path already carries the module prefix → no rewrite needed ---
        if (pathname.startsWith(rewritePrefix)) {
            // Apply admin role guard on the already-prefixed path
            if (pathname.startsWith("/admin") && req.auth?.user) {
                const roles = (req.auth.user as any)?.roles || [];
                const isAdmin = roles.includes("admin") || roles.includes("super_admin");
                if (!isAdmin) {
                    return NextResponse.redirect(new URL("/dashboard", req.url));
                }
            }
        }
        // --- Case 3: path is NOT a shared route and NOT already prefixed ---
        else if (!isSharedRoute) {
            const url = req.nextUrl.clone();
            // Prepend the module prefix. Special case: if pathname is just "/", resulting path is rewritePrefix
            url.pathname = pathname === "/" ? rewritePrefix : `${rewritePrefix}${pathname}`;
            const rewriteRes = NextResponse.rewrite(url);
            response.headers.forEach((v, k) => rewriteRes.headers.set(k, v));
            return rewriteRes;
        }

        // --- Case 2: shared routes fall through untouched.
    }

    // Root/landing page is public (only reaches here for the hub domain)
    if (pathname === "/" || Object.values(DOMAIN_MAP).includes(pathname)) {
        return response;
    }

    // Admin route permission guard (role check — distinct from auth check)
    // Auth check is handled by authConfig.callbacks.authorized()
    if (pathname.startsWith("/admin") && req.auth?.user) {
        const roles = (req.auth.user as any)?.roles || [];
        const isAdmin = roles.includes("admin") || roles.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", req.url));
        }
    }

    return response;
});

/**
 * Add security headers to response
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
    );
    return response;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|images|grid.svg).*)",
    ],
};
