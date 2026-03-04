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
