import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import { isSharedDomainPath, isGatedSegment } from "@/lib/route-manifest";

// Basic known malicious bot signatures (edge-safe, no state required)
const BLOCKED_USER_AGENTS = ["curl", "python-requests", "wget", "postman"];

// NOTE: Login brute-force rate limiting is handled server-side in lib/rate-limit.ts
// using Upstash Redis (survives Vercel cold starts). No in-memory Map is used here.
// This middleware intentionally has NO in-memory counters.

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

// ── All apex (non-www) hosts that should redirect to their www version ─────────
// Include every custom domain and every easysalesexport.com subdomain here.
// www.* hosts are NOT listed — they should never redirect (infinite loop).
const APEX_DOMAINS: readonly string[] = [
    // Main hub
    "easysalesexport.com",
    // Dedicated module domains (custom)
    "easysalesexportacademy.com",
    "easysalescooperative.com",
    "easysalesmarket.com",
    "waveprogramme.com",
    "farmnation.ng",
    "easysalesexportng.com",
    // Subdomain aliases under the hub (e.g. academy.easysalesexport.com)
    "marketplace.easysalesexport.com",
    "wave.easysalesexport.com",
    "academy.easysalesexport.com",
    "farmnation.easysalesexport.com",
    "farm-nation.easysalesexport.com",
    "cooperatives.easysalesexport.com",
    "export.easysalesexport.com",
];

const authMiddleware = auth((req: any) => {
    const { pathname } = req.nextUrl;
    // Railway proxies requests: the real browser domain arrives in x-forwarded-host,
    // while host contains the internal Railway service hostname. Prefer x-forwarded-host
    // so DOMAIN_MAP lookups correctly resolve waveprogramme.com, easysalescooperative.com, etc.
    const hostname = (
        req.headers.get("x-forwarded-host") ||
        req.headers.get("host") ||
        ""
    ).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
    const userAgent = req.headers.get("user-agent")?.toLowerCase() || "";

    // ── 0. Apex → www permanent redirect ─────────────────────────────────────
    // When a user types the bare domain (no www.), redirect them to www.
    // 308 Permanent Redirect: cached by browsers, preserves POST method.
    // Skipped for localhost, Railway preview URLs, and www.* hosts.
    if (APEX_DOMAINS.includes(hostname)) {
        const wwwUrl = req.nextUrl.clone();
        wwwUrl.host = `www.${hostname}`;
        wwwUrl.protocol = "https:";
        wwwUrl.port = "";
        return NextResponse.redirect(wwwUrl, { status: 308 });
    }

    // Security Headers are set by next.config.ts headers() — not here.
    // Middleware must not duplicate them (last-writer-wins causes conflicts).
    const response = NextResponse.next();
    
    // Attach an application version header to enable stale client recovery.
    // The client frontend can monitor this header in fetch responses to instantly
    // detect if their cached JS bundles are outdated and force a hard refresh.
    response.headers.set("x-app-version", process.env.NEXT_PUBLIC_APP_VERSION || "1.0.0");

    // 1. Basic Bot Rejection (edge-safe, stateless)
    // Skip /api routes — Paystack webhooks, health checks, and CI pings use curl legitimately.
    const isApiPath = pathname.startsWith("/api");
    const isBot = !isApiPath && BLOCKED_USER_AGENTS.some(bot => userAgent.includes(bot));
    if (isBot) {
        return new NextResponse("Forbidden - Bot Activity Detected", { status: 403 });
    }

    // Find if the incoming Host explicitly matches one of our dedicated module domains
    // Strip "www." prefix so both apex and www subdomains resolve to the same module
    const normalizedHostname = hostname.replace(/^www\./, "");
    let rewritePrefix = DOMAIN_MAP[normalizedHostname];

    // Fallback for subdomains under the main hub for testing (e.g. academy.easysalesexport.com)
    if (rewritePrefix === undefined && normalizedHostname.endsWith(".easysalesexport.com")) {
        const subdomain = normalizedHostname.replace(".easysalesexport.com", "");
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
        // Uses isSharedDomainPath from route-manifest.ts — single source of truth.

        // --- Case 0: Root "/" on domains that have a dedicated /landing sub-page ---
        // Only WAVE and Cooperatives have a /landing sub-page separate from their root page.
        // For those modules: waveprogramme.com/ → redirect to waveprogramme.com/wave/landing
        //
        // OTHER modules (academy, marketplace, farm-nation, export) use their root page.tsx
        // as the landing page directly. For those, skip Case 0 and let Case 3 handle the
        // rewrite: easysalesexportacademy.com/ → rewrite to /academy (the root page).
        //
        // We do root-level redirects HERE in the proxy (not in page.tsx) to avoid the
        // cross-domain redirect bug: server-side redirect() resolves against the rewritten
        // internal URL, not the user's actual browser domain.
        const MODULES_WITH_LANDING_SUBPAGE = new Set(["/wave", "/cooperatives"]);
        if (pathname === "/" && MODULES_WITH_LANDING_SUBPAGE.has(rewritePrefix)) {
            // Build the redirect URL using the real browser hostname (x-forwarded-host),
            // NOT req.url — which resolves to Railway's internal host and causes the
            // browser to land on www.easysalesexport.com instead of the custom domain.
            const landingUrl = new URL(`https://${hostname}${rewritePrefix}/landing`);
            return NextResponse.redirect(landingUrl, { status: 302 });
        }

        // --- Case 1: path already carries the module prefix → no rewrite needed ---
        if (pathname.startsWith(rewritePrefix)) {
            // Case 1: path already carries the module prefix — no rewrite needed.
            // Admin role guard runs below at line ~126 after the domain block.
        }
        // --- Case 3: path is NOT a shared route and NOT already prefixed ---
        // This also handles root "/" for modules without a /landing sub-page:
        //   easysalesexportacademy.com/ → rewrite to /academy (serves /academy/page.tsx)
        else if (!isSharedDomainPath(pathname)) {
            const url = req.nextUrl.clone();
            // Prepend the module prefix. For "/" this results in just the prefix (e.g. "/academy").
            url.pathname = pathname === "/" ? rewritePrefix : `${rewritePrefix}${pathname}`;
            const rewriteRes = NextResponse.rewrite(url);
            response.headers.forEach((v, k) => rewriteRes.headers.set(k, v));
            return rewriteRes;
        }

        // --- Case 2: shared routes fall through untouched.
    }

    // -----------------------------------------------------------------------
    // DEDICATED DOMAIN REGISTRATION GATE
    // Only redirects unauthenticated users to /auth/register for specific
    // "action" paths (forms, onboarding, checkout, etc.) that genuinely
    // require a registered account.
    //
    // Uses a BLOCKLIST (only gate what needs gating), NOT an allowlist.
    // This means new catalog/info pages are never accidentally blocked.
    // auth.config.authorized() handles all other session enforcement.
    // -----------------------------------------------------------------------
    if (rewritePrefix && !req.auth?.user) {
        // Uses isGatedSegment from route-manifest.ts — single source of truth.
        if (isGatedSegment(pathname)) {
            const registerUrl = new URL("/auth/register", req.url);
            registerUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
            return NextResponse.redirect(registerUrl);
        }
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

export default async function middleware(req: any, event: any) {
    const res = await authMiddleware(req, event);
    
    // EXPLICIT BYPASS: NextAuth automatically redirects authenticated users who try to 
    // access paths under `pages.signIn` to prevent them from seeing the login screen.
    // However, we want the Admin Login page to ALWAYS render, even if the user is 
    // currently authenticated as a standard user (so they can switch accounts or 
    // explicitly see the admin prompt).
    if (req.nextUrl.pathname === "/auth/login/admin" && res && res.status >= 300 && res.status <= 399) {
        const nextRes = NextResponse.next();
        res.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== 'location') {
                nextRes.headers.set(key, value);
            }
        });
        return nextRes;
    }
    // Return 401 JSON for unauthorized API requests instead of HTML redirect
    if (req.nextUrl.pathname.startsWith('/api/') && res && res.status >= 300 && res.status <= 399) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    
    return res;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|images|grid.svg).*)",
    ],
};
