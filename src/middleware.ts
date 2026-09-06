import NextAuth from "next-auth";
import { hasWaveAccess } from "@/lib/wave-access";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";
import { buildCsp, generateNonce, NONCE_HEADER } from "@/lib/csp";
import { isSharedDomainPath, isProtectedPath } from "@/lib/route-manifest";

/**
 * Hub Middleware - Optimized for Edge Runtime
 * 
 * Performance Goal: Keep execution time under 50ms to prevent Vercel CPU timeouts.
 * Strategy: Move all complex RBAC and logic to Server Components/Layouts.
 */

const { auth } = NextAuth(authConfig);

import { HUB_MODULES } from "@/config/modules.config";

// Derive maps from HUB_MODULES
const DOMAIN_MAP: Record<string, string> = Object.values(HUB_MODULES).reduce((acc, mod) => {
    acc[mod.domain] = `/${mod.slug}`;
    return acc;
}, {} as Record<string, string>);

// Root domain alias
DOMAIN_MAP["easysalesexport.com"] = "";
// #454. farmnation.ng is the CANONICAL domain now (modules.config.ts), so it
// arrives through the derived map above and no longer needs adding by hand.
// These two remain as ALIASES, which is what they always were: old links and
// any DNS still pointing at the subdomain must keep landing on the module.
DOMAIN_MAP["farmnation.easysalesexport.com"] = "/farm-nation";
DOMAIN_MAP["farm-nation.easysalesexport.com"] = "/farm-nation";
// Explicit aliases for Academy and Export custom domains (www variants)
DOMAIN_MAP["www.easysalesacademy.com"] = "/academy";
DOMAIN_MAP["www.easysalesexportng.com"] = "/export";

/*
 *   #454 APEX_DOMAINS WAS COMPUTED HERE AND READ BY NOTHING.
 *
 *        It filtered HUB_MODULES for domains outside easysalesexport.com and
 *        appended the root — and no line in this file, or any other, consulted
 *        it. The apex redirect below tests `hostname === "easysalesexport.com"`
 *        directly.
 *
 *        Removed rather than left, because a list named APEX_DOMAINS is exactly
 *        the thing somebody reaches for when adding a redirect, and it would
 *        have been silently out of date. It was also the one place the
 *        farm-nation domain change would have altered behaviour — moving that
 *        module off easysalesexport.com adds it to a list nothing reads.
 *
 *        OPEN, AND NOT DECIDED HERE: the other five module apexes have www
 *        variants in DOMAIN_MAP but no apex -> www redirect. Whether they
 *        should get one is a product question about their DNS, not a repair.
 */

const authMiddleware = auth((req: any) => {
    const { pathname } = req.nextUrl;
    const hostname = (
        req.headers.get("x-forwarded-host") ||
        req.headers.get("host") ||
        ""
    ).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();


    // ── 1. Apex → www Redirect (High Priority) ──────────────────────────
    // Redirect only the primary easysalesexport.com apex domain to www for consistent session handling.
    if (hostname === "easysalesexport.com") {
        const wwwUrl = req.nextUrl.clone();
        wwwUrl.host = "www.easysalesexport.com";
        wwwUrl.protocol = "https:";
        wwwUrl.port = "";
        return NextResponse.redirect(wwwUrl, { status: 308 });
    }

    // ── 1.1. Authentication Protection Gate ────────────────────────────
    const isLoggedIn = !!req.auth;
    if (isProtectedPath(pathname) && !isLoggedIn) {
        const targetPath = (pathname.startsWith("/marketplace/checkout") || pathname.startsWith("/farm-nation/checkout"))
            ? "/auth/register"
            : "/auth/login";
        const loginUrl = new URL(targetPath, req.nextUrl.origin);
        loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
        return NextResponse.redirect(loginUrl);
    }

    // ── 1.2. Gender-based WAVE Program Restriction ─────────────────────
    if (isLoggedIn) {
        const isMale = req.auth?.user?.gender?.toLowerCase() === "male";
        const userCreatedAt = req.auth?.user?.createdAt;
        const userRoles = req.auth?.user?.roles || [];
        const serviceRegs = req.auth?.user?.serviceRegistrations || {};
        const isAdmin = userRoles.includes("admin") || userRoles.includes("super_admin");
        const hasWaveRole = userRoles.includes("wave_participant");
        
        // Define the cutoff date: June 17, 2026
        const CUTOFF_DATE = new Date("2026-06-17T00:00:00.000Z");
        const registeredOnOrAfterCutoff = !!userCreatedAt && new Date(userCreatedAt) >= CUTOFF_DATE;
        const isNewMaleUser = isMale && registeredOnOrAfterCutoff;

        // Stale-safe check: also allow if serviceRegistrations.wave is approved/active/pending/reviewing.
        //
        // The status list moved to @/lib/wave-access so the API routes can ask
        // the same question. /api/wave/training-sessions asked only for a
        // session and handed every meeting link to any signed-in account.
        const waveRegStatus = serviceRegs.wave?.status;
        const hasWaveAccessNow = hasWaveAccess({ roles: userRoles, waveRegStatus });

        // Strict enforcement: new male users (registered on/after June 17, 2026) are never allowed access.
        // Legacy male users are allowed only if they have pre-existing WAVE access.
        const isWaveBlocked = isMale && (isNewMaleUser || !hasWaveAccessNow);

        const normalizedHostname = hostname.replace(/^www\./, "");
        
        let rewritePrefix = DOMAIN_MAP[normalizedHostname];
        if (rewritePrefix === undefined && normalizedHostname.endsWith(".easysalesexport.com")) {
            const subdomain = normalizedHostname.replace(".easysalesexport.com", "");
            if (Object.values(DOMAIN_MAP).includes(`/${subdomain}`)) {
                rewritePrefix = `/${subdomain}`;
            }
        }

        if (isWaveBlocked && !isAdmin && (pathname.startsWith("/wave") || pathname.startsWith("/admin/wave") || rewritePrefix === "/wave")) {
            let hubOrigin = req.nextUrl.origin;
            if (normalizedHostname.endsWith(".easysalesexport.com")) {
                hubOrigin = "https://www.easysalesexport.com";
            } else {
                const hostParts = hostname.split(".");
                const isLocalhost = hostname.endsWith("localhost");
                const hasSubdomain = isLocalhost ? hostParts.length > 1 : hostParts.length > 2;
                if (hasSubdomain) {
                    const apexHost = isLocalhost ? "localhost" : hostParts.slice(1).join(".");
                    const portStr = req.nextUrl.port ? `:${req.nextUrl.port}` : "";
                    hubOrigin = `${req.nextUrl.protocol}//${apexHost}${portStr}`;
                }
            }
            const redirectUrl = new URL("/", hubOrigin);
            return NextResponse.redirect(redirectUrl);
        }
    }

    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-url", req.url);
    requestHeaders.set("x-invoke-path", pathname);

    // A per-request nonce, so the CSP can drop script-src 'unsafe-inline'.
    //
    // It goes on the REQUEST headers so the root layout can read it with
    // headers() and stamp it onto its three inline scripts, and on the RESPONSE
    // header so the browser accepts them. Both are required; either alone gives
    // a page whose scripts are blocked.
    //
    // The policy itself lives in src/lib/csp.ts and is shared with the static
    // fallback in next.config.ts, so the two allow-lists cannot drift.
    const nonce = generateNonce();
    requestHeaders.set(NONCE_HEADER, nonce);

    const response = NextResponse.next({
        request: {
            headers: requestHeaders,
        },
    });
    response.headers.set("x-app-version", process.env.NEXT_PUBLIC_APP_VERSION || "1.1.0");
    response.headers.set(
        "Content-Security-Policy",
        buildCsp({ nonce, isDev: process.env.NODE_ENV === "development" })
    );

    // ── 2. Domain Rewrite Logic (Module Silos) ─────────────────────────────────
    const normalizedHostname = hostname.replace(/^www\./, "");
    let rewritePrefix = DOMAIN_MAP[normalizedHostname];

    // Subdomain alias fallback
    if (rewritePrefix === undefined && normalizedHostname.endsWith(".easysalesexport.com")) {
        const subdomain = normalizedHostname.replace(".easysalesexport.com", "");
        if (Object.values(DOMAIN_MAP).includes(`/${subdomain}`)) {
            rewritePrefix = `/${subdomain}`;
        }
    }

    // Redirect `/landing` to `/` on domains that don't support a separate sub-landing page
    if (pathname === "/landing") {
        const hasSublanding = rewritePrefix === "/wave" || rewritePrefix === "/cooperatives";
        if (!hasSublanding) {
            const homeUrl = new URL("/", req.nextUrl.clone());
            return NextResponse.redirect(homeUrl, { status: 302 });
        }
    }

    if (rewritePrefix && rewritePrefix !== "" && rewritePrefix !== "/" && !pathname.startsWith("/api") && !pathname.startsWith("/_next") && !pathname.startsWith("/__session")) {
        // Redirect requests with redundant module prefix on subdomains/dedicated domains to the clean apex domain
        if (pathname === rewritePrefix || pathname.startsWith(rewritePrefix + "/")) {
            let hubOrigin = req.nextUrl.origin;
            const hostParts = hostname.split(".");
            const isLocalhost = hostname.endsWith("localhost");
            const hasSubdomain = isLocalhost ? hostParts.length > 1 : hostParts.length > 2;
            
            // Clean the path by removing the redundant rewritePrefix (e.g. /cooperatives/landing -> /landing)
            let cleanPath = pathname;
            if (pathname.startsWith(rewritePrefix)) {
                cleanPath = pathname.substring(rewritePrefix.length);
                if (!cleanPath.startsWith("/")) {
                    cleanPath = "/" + cleanPath;
                }
            }

            if (normalizedHostname.endsWith(".easysalesexport.com")) {
                const portStr = req.nextUrl.port ? `:${req.nextUrl.port}` : "";
                hubOrigin = `${req.nextUrl.protocol}//${normalizedHostname}${portStr}`;
            } else if (hasSubdomain) {
                const apexHost = isLocalhost ? "localhost" : hostParts.slice(1).join(".");
                const portStr = req.nextUrl.port ? `:${req.nextUrl.port}` : "";
                hubOrigin = `${req.nextUrl.protocol}//${apexHost}${portStr}`;
            } else {
                const isCustomModuleDomain = DOMAIN_MAP[normalizedHostname] && DOMAIN_MAP[normalizedHostname] !== "";
                if (isCustomModuleDomain) {
                    const portStr = req.nextUrl.port ? `:${req.nextUrl.port}` : "";
                    hubOrigin = `${req.nextUrl.protocol}//${normalizedHostname}${portStr}`;
                } else {
                    hubOrigin = isLocalhost ? `http://localhost:${req.nextUrl.port || 3000}` : "https://www.easysalesexport.com";
                }
            }
            
            const redirectUrl = new URL(cleanPath + req.nextUrl.search, hubOrigin);
            return NextResponse.redirect(redirectUrl, { status: 301 });
        }
        // Handle landing page redirects for modules with sub-landing pages
        const MODULES_WITH_LANDING_SUBPAGE = new Set(["/wave", "/cooperatives"]);
        if (pathname === "/" && MODULES_WITH_LANDING_SUBPAGE.has(rewritePrefix)) {
            const landingUrl = new URL("/landing", req.nextUrl.clone()); // Keeps same host
            return NextResponse.redirect(landingUrl, { status: 302 });
        }

        // Apply rewrite if not a shared route and not already prefixed
        if (!pathname.startsWith(rewritePrefix) && !isSharedDomainPath(pathname)) {
            const url = req.nextUrl.clone();
            url.pathname = pathname === "/" ? rewritePrefix : `${rewritePrefix}${pathname}`;
            const rewriteRes = NextResponse.rewrite(url, {
                request: {
                    headers: requestHeaders,
                },
            });
            response.headers.forEach((v, k) => rewriteRes.headers.set(k, v));
            return rewriteRes;
        }
    }

    // ── 3. Clean-up & Pass-through ───────────────────────────────────────────
    // RBAC and Gating are intentionally DEFERRED to layouts and authConfig 
    // to prevent Edge Runtime bottlenecks.
    return response;
});

export default async function proxy(req: any, event: any) {
    let res;
    try {
        res = await authMiddleware(req, event);
    } catch (error) {
        console.error("[Middleware Proxy Error] NextAuth crashed, likely due to a decryption secret mismatch:", error);
        
        // If it's a JWT decryption error or other NextAuth crash, heal the session by clearing cookies and redirecting to login
        const loginUrl = new URL("/auth/login?error=SessionError", req.nextUrl.origin);
        const errorRes = NextResponse.redirect(loginUrl);
        
        // Clear session cookies to break loop
        const tokenNames = ['authjs.session-token', '__Secure-authjs.session-token', 'next-auth.session-token', '__Secure-next-auth.session-token'];
        const hostname = (
            req.headers.get("x-forwarded-host") ||
            req.headers.get("host") ||
            ""
        ).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
        const hostParts = hostname.replace(/^www\./, "").split(".");
        const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1");
        const domain = (!isLocal && hostParts.length >= 2) ? `.${hostParts.slice(-2).join(".")}` : undefined;

        tokenNames.forEach(name => {
            if (domain) {
                errorRes.cookies.set(name, "", { domain, maxAge: 0, path: "/", secure: true });
            }
            errorRes.cookies.set(name, "", { maxAge: 0, path: "/", secure: true });
        });
        return errorRes;
    }
    
    // ── 4. Zombie Session Recovery ───────────────────────────────────────────
    // If the user has a session cookie but NextAuth redirected us to login (res.status 30x),
    // it means the token is invalid/expired (Zombie Session). We clear it to break the loop.
    const hasSessionCookie = req.cookies.has("authjs.session-token") || 
                           req.cookies.has("__Secure-authjs.session-token") ||
                           req.cookies.has("next-auth.session-token") ||
                           req.cookies.has("__Secure-next-auth.session-token");

    if (hasSessionCookie && res && res.status >= 300 && res.status <= 399) {
        const location = res.headers.get("location");
        if (location && (location.includes("/auth/login") || location.includes("/login"))) {
            const hostname = (
                req.headers.get("x-forwarded-host") ||
                req.headers.get("host") ||
                ""
            ).split(",")[0].trim().replace(/:\d+$/, "").toLowerCase();
            const hostParts = hostname.replace(/^www\./, "").split(".");
            const isLocal = hostname.includes("localhost") || hostname.includes("127.0.0.1");
            const domain = (!isLocal && hostParts.length >= 2) ? `.${hostParts.slice(-2).join(".")}` : undefined;
            
            const tokenNames = ['authjs.session-token', '__Secure-authjs.session-token', 'next-auth.session-token', '__Secure-next-auth.session-token'];
            
            tokenNames.forEach(name => {
                if (domain) {
                    (res as any).cookies.set(name, "", { domain, maxAge: 0, path: "/", secure: true });
                }
                (res as any).cookies.set(name, "", { maxAge: 0, path: "/", secure: true });
            });
        }
    }

    // Explicit bypass for Admin Login to prevent NextAuth session-collision redirects
    if (req.nextUrl.pathname === "/auth/login/admin" && res && res.status >= 300 && res.status <= 399) {
        const nextRes = NextResponse.next();
        res.headers.forEach((value: string, key: string) => {
            if (key.toLowerCase() !== 'location') nextRes.headers.set(key, value);
        });
        return nextRes;
    }

    // Force 401 JSON for unauthorized API requests (prevents HTML redirect loops in mobile apps)
    if (req.nextUrl.pathname.startsWith('/api/') && res && res.status >= 300 && res.status <= 399) {
        return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    
    return res;
}

export const config = {
    matcher: [
        "/((?!api/upload|_next/static|_next/image|favicon.ico|images|grid.svg).*)",
    ],
};
