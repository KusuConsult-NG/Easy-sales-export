import type { NextAuthConfig } from "next-auth";
import { isPublicPath, isProtectedPath } from "@/lib/route-manifest";
import type { UserRole } from "@/lib/types/roles";
import { HUB_MODULES } from "@/config/modules.config";

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
    // Prevent Session Drops: Guarantee Edge and Node runtime use the EXACT same secret
    // Vercel sometimes injects AUTH_SECRET automatically, which conflicts if Node uses NEXTAUTH_SECRET.
    secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV !== "production" ? "e2e_development_auth_secret_placeholder_must_be_changed_in_production" : undefined),

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
                domain: (process.env.NODE_ENV === "production" && (process.env.NEXTAUTH_URL?.includes("easysalesexport.com") || process.env.AUTH_URL?.includes("easysalesexport.com"))) ? ".easysalesexport.com" : undefined,
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
        async jwt({ token, user }) {
            // Edge-compatible user info mapping (critical for Edge Middleware role detection)
            if (user) {
                token.id = user.id;
                token.email = user.email;
                token.name = user.name;
                token.image = user.image;
                token.roles = user.roles;
                token.verified = user.verified ?? true;
                token.onboardingCompleted = user.onboardingCompleted;
                token.sellerVerificationStatus = user.sellerVerificationStatus;
                token.serviceRegistrations = user.serviceRegistrations;
                token.currentModuleId = user.currentModuleId || "platform";
            }
            return token;
        },
        async session({ session, token }) {
            // Edge-compatible session mapping
            if (session?.user && token) {
                session.user.id = token.id as string;
                session.user.email = token.email as string;
                session.user.name = token.name as string;
                session.user.image = token.image as string | null;
                session.user.roles = (token.roles as UserRole[]) || [];
                session.user.verified = token.verified as boolean;
                session.user.onboardingCompleted = token.onboardingCompleted as boolean | undefined;
                session.user.sellerVerificationStatus = token.sellerVerificationStatus as string | undefined;
                session.user.serviceRegistrations = token.serviceRegistrations as Record<string, any> | undefined;
                session.user.currentModuleId = token.currentModuleId as string || "platform";
            }
            return session;
        },
        async authorized({ auth, request: { nextUrl } }: { auth: any; request: { nextUrl: URL } }) {
            const isLoggedIn = !!auth?.user;
            const { pathname } = nextUrl;
            console.log("AUTHORIZED CALLBACK RUNNING:", { pathname, isLoggedIn });

            // Module root redirects (these just redirect to landing pages)
            if (pathname === "/wave" || pathname === "/cooperatives") return true;

            // API routes should not be gated by NextAuth middleware (they handle their own security)
            if (pathname.startsWith("/api/")) return true;

            // Uses route-manifest.ts — single source of truth for all route classification
            if (isPublicPath(pathname)) return true;

            if (isProtectedPath(pathname) && !isLoggedIn) {
                console.log("AUTHORIZED CALLBACK RETURNING FALSE FOR:", pathname);
                return false; // NextAuth redirects to signIn page
            }

            // ── Platform-Wide Payment Gating ─────────────────────────────
            if (isLoggedIn) {
                const serviceRegs = auth.user.serviceRegistrations || {};
                
                // Identify which module is being accessed based on URL prefix
                const moduleMatch = pathname.match(/^\/(wave|cooperatives|academy|marketplace|farm-nation|export)/);
                if (moduleMatch) {
                    const rawSlug = moduleMatch[1]; // e.g. "farm-nation" (URL slug, used for redirect URLs)
                    // Map URL slugs to serviceRegistrations keys (camelCase Firestore keys)
                    const slugToKey: Record<string, string> = {
                        'farm-nation': 'farmNation',
                        'cooperatives': 'cooperatives',
                        'marketplace': 'marketplace',
                        'academy': 'academy',
                        'wave': 'wave',
                        'export': 'export',
                    };
                    const moduleId = slugToKey[rawSlug] ?? rawSlug;
                    const reg = serviceRegs[moduleId] || 
                                (moduleId === 'farmNation' ? serviceRegs['farm_nation'] : null) ||
                                (moduleId === 'cooperatives' ? serviceRegs['cooperative'] : null);
                    
                    // If they are deep in a module but haven't completed payment, redirect them to the module's onboarding/payment page
                    // Exceptions: allow access to onboarding/payment/verify-payment paths themselves to avoid loops
                    const isPaymentFlow = pathname.includes("/onboarding") || 
                                        pathname.includes("/payment") || 
                                        pathname.includes("/verify") ||
                                        pathname.includes("/setup") ||
                                        pathname.includes("/application");

                    const modulesRequiringPayment = ['cooperatives', 'academy'];
                    
                    // ── SCOPED MEMBERSHIP GUARD ─────────────────────────────────
                    // If accessing via a module-specific domain, ensure membership is active
                    const currentModule = Object.values(HUB_MODULES).find(m => m.slug === rawSlug || m.slug === moduleId);
                    
                    if (currentModule && !isPaymentFlow) {
                        const status = reg?.status || "pending";
                        const isApproved = status === "approved" || status === "active" || status === "paid";
                        
                        // If not approved and not on a public/onboarding path, redirect to onboarding
                        // Use rawSlug so the URL is valid (e.g. /farm-nation/onboarding not /farmNation/onboarding)
                        if (!isApproved) {
                            const redirectUrl = new URL(`/${rawSlug}/onboarding`, nextUrl.origin);
                            return Response.redirect(redirectUrl);
                        }
                    }

                    if (modulesRequiringPayment.includes(moduleId) && reg && reg.status === "approved" && reg.paymentStatus !== "completed" && !isPaymentFlow) {
                        // Redirect to the module's primary onboarding/payment entry point
                        // Use rawSlug for valid URL (e.g. /farm-nation/onboarding)
                        const redirectUrl = new URL(`/${rawSlug}/onboarding`, nextUrl.origin);
                        if (moduleId === 'academy') redirectUrl.pathname = '/academy/setup';
                        return Response.redirect(redirectUrl);
                    }
                }
            }

            // All other routes: allow (individual layouts handle their own auth)
            return true;
        },
    },
} satisfies NextAuthConfig;
