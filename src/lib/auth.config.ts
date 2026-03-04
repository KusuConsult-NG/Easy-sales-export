import type { NextAuthConfig } from "next-auth";
import { isPublicPath, isProtectedPath } from "@/lib/route-manifest";

/**
 * Edge-compatible authentication configuration.
 * 
 * This file is imported by middleware.ts (Edge Runtime) and auth.ts (Node Runtime).
 * It MUST NOT import any Node.js libraries (like firebase-admin).
 */
export const authConfig = {
    trustHost: true, // IMPORTANT: Allows NextAuth to dynamically determine host in multi-domain Vercel deployments
    providers: [], // Providers are configured in auth.ts for Node runtime
    pages: {
        signIn: "/auth/login",
    },
    // ── THE FIX: Explicit Cookie Configuration for Edge Rewrites ─────────────
    // Vercel Middleware rewrites domains (e.g. /marketplace) internally. NextAuth's
    // default CSRF logic strictly validates the path and host of the cookie against
    // the rewritten URL. By forcing the `path: "/"` and `sameSite: "lax"`, we 
    // prevent NextAuth from rejecting cookies on dedicated domains.
    // Moved from auth.ts so Middleware can read cookies identical to the Server Actions.
    useSecureCookies: process.env.NODE_ENV === "production",
    cookies: {
        sessionToken: {
            name: process.env.NODE_ENV === "production" ? '__Secure-authjs.session-token' : 'authjs.session-token',
            options: {
                httpOnly: true,
                sameSite: "lax",
                path: "/",
                secure: process.env.NODE_ENV === "production",
            }
        },
        csrfToken: {
            name: process.env.NODE_ENV === "production" ? '__Host-authjs.csrf-token' : 'authjs.csrf-token',
            options: {
                httpOnly: true, // Prevents XSS theft
                sameSite: "lax",
                path: "/",      // CRITICAL: Must be root so edge routes don't isolate the cookie
                secure: process.env.NODE_ENV === "production",
            }
        }
    },
    callbacks: {
        authorized({ auth, request: { nextUrl } }: { auth: any; request: { nextUrl: URL } }) {
            const isLoggedIn = !!auth?.user;
            const { pathname } = nextUrl;

            // Module root redirects (these just redirect to landing pages)
            if (pathname === "/wave" || pathname === "/cooperatives") return true;

            // Uses route-manifest.ts — single source of truth for all route classification
            if (isPublicPath(pathname)) return true;

            if (isProtectedPath(pathname) && !isLoggedIn) {
                return false; // NextAuth redirects to signIn page
            }

            // All other routes: allow (individual layouts handle their own auth)
            return true;
        },
    },
} satisfies NextAuthConfig;
