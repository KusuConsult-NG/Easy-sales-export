import type { NextAuthConfig } from "next-auth";

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

            // Public routes — always allow (no auth required)
            const publicPaths = [
                "/",
                "/auth",
                "/api",
                "/about",
                "/contact",
                "/help",
                "/privacy",
                "/terms",
                "/refund-policy",
                "/get-started",
                "/land",
                // Module MARKETING / LANDING pages (read-only, no gated forms)
                "/wave/landing",
                "/wave/access-denied",
                "/wave",              // root → redirects to /wave/landing
                "/cooperatives/landing",
                "/cooperatives",      // root → redirects to /cooperatives/landing
                "/marketplace",       // public catalog landing
                "/marketplace/products", // public product browsing
                "/academy",           // public academy info page
                "/farm-nation",       // public farm-nation landing
                "/export",            // public export windows landing
                // Export windows — public investment catalog
                "/export/windows",
                "/windows",
            ];
            const isPublic = publicPaths.some(
                (p) => pathname === p || pathname.startsWith(p + "/")
            );

            // Module root redirects (these just redirect to landing pages)
            if (pathname === "/wave" || pathname === "/cooperatives") return true;
            if (isPublic) return true;

            // Protected routes — require auth.
            // Includes BOTH fully-qualified paths (for hub domain access, e.g.
            // /academy/setup) AND short-form paths (for dedicated domain access
            // where the module prefix is stripped, e.g. /setup on
            // easysalesexportacademy.com becomes /setup before rewrite).
            const protectedPaths = [
                "/dashboard",
                // Wave — application forms require auth
                "/wave/briefing",
                "/wave/application",
                "/briefing",
                "/application",
                // Marketplace — seller/buyer/checkout flows require auth
                "/marketplace/buyer",
                "/marketplace/checkout",
                "/marketplace/success",
                "/marketplace/verify",
                "/marketplace/onboarding",
                "/marketplace/sell",
                "/marketplace/seller",
                "/marketplace/seller-verification",
                "/sell",
                "/seller",
                // Cooperatives — all forms require auth
                "/cooperatives/onboarding",
                "/cooperatives/payment",
                "/cooperatives/verify-payment",
                "/payment",
                "/verify-payment",
                // Academy — setup/enrollment flow requires auth
                "/academy/setup",
                "/academy/(member)",
                "/setup",
                // Farm Nation — onboarding/checkout flows require auth
                "/farm-nation/onboarding",
                "/farm-nation/checkout",
                "/farm-nation/(member)",
                "/farm-nation/list-land",
                // Export — onboarding & buyer flows require auth
                "/export/onboarding",
                "/export/buyer",
                "/export/(app)",
                "/onboarding",
                // Shared protected areas
                "/escrow",
                "/profile",
                "/settings",
                "/verify-id",
                "/verify-status",
                "/messages",
                "/vendor",
                "/loans",
                "/admin",
            ];

            const isProtected = protectedPaths.some(
                (p) => pathname === p || pathname.startsWith(p + "/")
            );

            if (isProtected && !isLoggedIn) {
                return false; // NextAuth redirects to signIn page
            }

            // All other routes: allow (individual layouts handle their own auth)
            return true;
        },
    },
} satisfies NextAuthConfig;
