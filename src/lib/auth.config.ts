import type { NextAuthConfig } from "next-auth";
import { isPublicPath, isProtectedPath } from "@/lib/route-manifest";
import type { UserRole } from "@/lib/types/roles";
import { HUB_MODULES } from "@/config/modules.config";
import { logger } from "@/lib/logger";

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
                token.gender = user.gender;
                const userCreatedAt = (user as any).createdAt;
                if (userCreatedAt) {
                    const parseDate = (val: any): string | undefined => {
                        if (!val) return undefined;
                        try {
                            if (typeof val.toDate === "function") {
                                const d = val.toDate();
                                return isNaN(d.getTime()) ? undefined : d.toISOString();
                            }
                            const secs = typeof val._seconds === "number" ? val._seconds : val.seconds;
                            const nanos = typeof val._nanoseconds === "number" ? val._nanoseconds : val.nanoseconds;
                            if (typeof secs === "number") {
                                const ms = secs * 1000 + (typeof nanos === "number" ? nanos / 1000000 : 0);
                                const d = new Date(ms);
                                return isNaN(d.getTime()) ? undefined : d.toISOString();
                            }
                            const d = new Date(val);
                            return isNaN(d.getTime()) ? undefined : d.toISOString();
                        } catch {
                            return undefined;
                        }
                    };
                    token.createdAt = parseDate(userCreatedAt);
                }
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
                session.user.gender = token.gender as "male" | "female" | "other" | undefined;
                session.user.createdAt = token.createdAt as string | undefined;
            }
            return session;
        },
        async authorized({ auth, request: { nextUrl } }: { auth: any; request: { nextUrl: URL } }) {
            const isLoggedIn = !!auth?.user;
            const { pathname } = nextUrl;
            logger.debug("[Auth] authorized callback:", { pathname, isLoggedIn });

            // Module root redirects (these just redirect to landing pages)
            if (pathname === "/wave" || pathname === "/cooperatives") return true;

            // API routes should not be gated by NextAuth middleware (they handle their own security)
            if (pathname.startsWith("/api/")) return true;

            // Uses route-manifest.ts — single source of truth for all route classification
            if (isProtectedPath(pathname)) {
                if (!isLoggedIn) {
                    logger.debug("[Auth] authorized callback returning false for path", { pathname });
                    return false; // NextAuth redirects to signIn page
                }
            } else if (isPublicPath(pathname)) {
                return true;
            }

            // ── Platform-Wide Payment & Membership Gating ────────────────
            // Bypassed at the Middleware level to prevent Stale JWT Redirect Loops.
            // Active checks are delegated to layout-level server components (e.g., checkModuleAccess)
            // which query Firestore directly and are fully stale-JWT-safe.

            // All other routes: allow (individual layouts handle their own auth)
            return true;
        },
    },
} satisfies NextAuthConfig;
