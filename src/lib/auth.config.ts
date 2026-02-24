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
                // Module landing pages (public marketing pages)
                "/wave/landing",
                "/wave/briefing",
                "/wave/access-denied",
                "/cooperatives/landing",
                "/farm-nation",       // farm-nation root is a public landing
                "/marketplace",       // marketplace root is a public catalog
                "/marketplace/products",
                "/marketplace/buyer",
                "/marketplace/checkout",
                "/marketplace/success",
                "/marketplace/verify",
                "/export/buyer",
                "/academy",           // academy root is public info
                "/land",
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
                // Wave
                "/wave/application",
                "/application",
                // Marketplace
                "/marketplace/onboarding",
                "/marketplace/sell",
                "/marketplace/seller",
                "/onboarding",
                "/sell",
                "/seller",
                // Cooperatives
                "/cooperatives/onboarding",
                "/cooperatives/payment",
                "/cooperatives/verify-payment",
                "/payment",
                "/verify-payment",
                // Academy
                "/academy/setup",
                "/setup",
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
