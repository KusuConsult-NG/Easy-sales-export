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

    // If it's a dedicated domain, we rewrite the URL transparently
    if (rewritePrefix && !pathname.startsWith(rewritePrefix) && !pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
        // Example: farmnation.ng/about -> /farm-nation/about
        const url = req.nextUrl.clone();
        url.pathname = `${rewritePrefix}${pathname === "/" ? "" : pathname}`;
        pathname = url.pathname; // Update local reference for subsequent auth checks

        // We do not return immediately because we still want to apply auth logic.
        // We will return a rewrite explicitly at the end of the middleware.
        // For now, we update the req object internally if possible, but NextAuth 
        // in middleware is tricky with rewrites. 
        // Next.js middleware best practice: return NextResponse.rewrite(url)
    }

    // Root/landing page is public
    if (pathname === "/" || Object.values(DOMAIN_MAP).includes(pathname)) {
        return response;
    }

    // Protected Routes Logic is now handled by authConfig.callbacks.authorized
    // But we can add extra custom logic here if needed, or rely on the authorized callback.
    // The previous implementation had manual redirect logic.
    // Let's migrate that logic to the authorized callback effectively, 
    // OR keep it here if we want explicit control.

    // WAVE route protection is handled by the `authorized` callback in auth.config.ts
    // which returns false for unauthenticated users on /wave/* (except public paths).

    // START: Manual Role Check (since authorized callback is boolean-only)
    // Admin routes require admin/super_admin role
    if (pathname.startsWith("/admin") && req.auth?.user) {
        const roles = (req.auth.user as any)?.roles || [];
        const isAdmin = roles.includes("admin") || roles.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", req.url));
        }
    }
    // END: Manual Role Check

    // Finally apply the rewrite if the domain was mapped, otherwise return the standard response string chain
    if (rewritePrefix && !req.nextUrl.pathname.startsWith(rewritePrefix) && !req.nextUrl.pathname.startsWith("/api") && !req.nextUrl.pathname.startsWith("/_next")) {
        const url = req.nextUrl.clone();
        url.pathname = `${rewritePrefix}${req.nextUrl.pathname === "/" ? "" : req.nextUrl.pathname}`;
        const finalResponse = NextResponse.rewrite(url);
        // Ensure headers merge
        response.headers.forEach((val, key) => finalResponse.headers.set(key, val));
        return finalResponse;
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
