import type { NextAuthConfig } from "next-auth";

/**
 * Edge-compatible authentication configuration.
 * 
 * This file is imported by middleware.ts (Edge Runtime) and auth.ts (Node Runtime).
 * It MUST NOT import any Node.js libraries (like firebase-admin).
 */
export const authConfig = {
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

            // Protected routes — require auth
            // These routes are entry points where users click from the homepage
            // after global auth and get the race condition redirect bug
            const protectedPaths = [
                "/dashboard",
                "/wave/application",
                "/marketplace/onboarding",
                "/marketplace/sell",
                "/marketplace/seller",
                "/cooperatives/onboarding",
                "/cooperatives/payment",
                "/cooperatives/verify-payment",
                "/academy/setup",
                "/escrow",
                "/profile",
                "/settings",
                "/verify-id",
                "/verify-status",
                "/messages",
                "/vendor",
                "/loans",
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
