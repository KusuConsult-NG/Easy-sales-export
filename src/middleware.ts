import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { canAccessRoute } from "@/lib/role-app-mapping";
import { rateLimit } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types/roles";

// Initialize NextAuth with Edge-safe config
const { auth } = NextAuth(authConfig);

/**
 * Enhanced Next.js Middleware for Route Protection
 * 
 * Features:
 * - Session timeout detection
 * - Feature toggle enforcement
 * - Multi-role access control with permissions matrix
 * - Security headers
 * 
 * FIX: Uses NextAuth v5 auth() wrapper for proper Edge Runtime session detection.
 */

// Routes requiring any authenticated user
const protectedRoutes = [
    "/dashboard",
    "/settings",
    "/admin",
    "/escrow",
    "/messages",
    "/profile",
    "/verify-id",
    "/vendor",
    "/land/submit",
    "/land/verify",
    "/wave/dashboard",
    "/wave/resources",
    "/wave/application",
    "/cooperatives/dashboard",
    "/cooperatives/loans",
    "/cooperatives/savings",
    "/cooperatives/onboarding",
    "/marketplace/buyer",
    "/marketplace/seller",
    "/marketplace/cart",
    "/marketplace/orders",
    "/marketplace/checkout",
    "/marketplace/onboarding",
    "/export/dashboard",
    "/export/onboarding",
    "/academy/dashboard",
    "/academy/application",
    "/farm-nation/dashboard",
    "/farm-nation/onboarding",
];

// Routes requiring MFA verification
const mfaProtectedRoutes = [
    "/admin",
    "/cooperatives/withdraw",
    "/loans/apply",
];

// Feature toggle mappings
const featureRoutes: Record<string, string> = {
    "/cooperatives/loans": "NEXT_PUBLIC_LOAN_APPLICATIONS_ENABLED",
    "/farm-nation/list-land": "NEXT_PUBLIC_LAND_LISTINGS_ENABLED",
};

// Session timeout (in milliseconds)
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || "30", 10) * 60 * 1000;

export default auth(async (request: NextRequest & { auth: any }) => {
    const pathname = request.nextUrl.pathname;

    // Get session from NextAuth wrapper (Edge-compatible)
    const session = request.auth;

    // 🛡️ SECURITY: Redis-based Session Revocation
    if (session?.user?.id) {
        try {
            const { redis } = await import("@/lib/redis");
            const isSuspended = await redis.get(`user:suspended:${session.user.id}`);

            if (isSuspended) {
                const response = NextResponse.redirect(new URL("/auth/login?error=account_suspended", request.url));
                response.cookies.delete("lastActivity");
                response.cookies.delete("next-auth.session-token");
                response.cookies.delete("__Secure-next-auth.session-token");
                return response;
            }
        } catch (error) {
            console.error("Redis suspension check failed:", error);
        }
    }

    // CRITICAL: Global Auth Enforcement - redirect module-specific auth pages
    const isModuleAuthPage = pathname.match(/^\/([^/]+)\/(login|register)$/);
    if (isModuleAuthPage) {
        const [, module, type] = isModuleAuthPage;
        if (module !== 'auth') {
            const globalAuthUrl = new URL(`/auth/${type}`, request.url);
            globalAuthUrl.searchParams.set('module', module);
            return NextResponse.redirect(globalAuthUrl);
        }
    }

    // CRITICAL: Allow access to all auth pages
    const isAuthPage = pathname.startsWith('/auth/');
    if (isAuthPage) {
        return NextResponse.next();
    }

    // CRITICAL: Allow access to onboarding/application pages WITHOUT role checks
    // These are where users GET their roles, so they must be publicly accessible to authenticated users
    const onboardingRoutes = [
        '/wave/application',
        '/marketplace/onboarding',
        '/export/onboarding',
        '/cooperatives/onboarding',
        '/farm-nation/onboarding',
        '/academy/setup',
        '/academy/application',
    ];

    const isOnboardingPage = onboardingRoutes.some(route => pathname.startsWith(route));
    if (isOnboardingPage && session) {
        // Allow any authenticated user to access onboarding pages
        return NextResponse.next();
    }

    // Check session timeout
    if (session) {
        const lastActivity = request.cookies.get("lastActivity")?.value;
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const now = Date.now();

            if (now - lastActivityTime > SESSION_TIMEOUT_MS) {
                const isProtectedRoute = protectedRoutes.some((route) =>
                    pathname.startsWith(route)
                );

                if (isProtectedRoute) {
                    const { getLoginUrl } = await import('@/lib/auth-redirect');
                    const loginPath = getLoginUrl(pathname, pathname);
                    const loginUrl = new URL(loginPath, request.url);
                    loginUrl.searchParams.set("error", "session_expired");

                    const response = NextResponse.redirect(loginUrl);
                    response.cookies.delete("lastActivity");
                    response.cookies.delete("next-auth.session-token");
                    response.cookies.delete("__Secure-next-auth.session-token");
                    return response;
                } else {
                    const response = NextResponse.next();
                    response.cookies.delete("lastActivity");
                    response.cookies.delete("next-auth.session-token");
                    response.cookies.delete("__Secure-next-auth.session-token");
                    return response;
                }
            }
        }
    }

    // Check if current route is protected
    const isProtectedRoute = protectedRoutes.some((route) =>
        pathname.startsWith(route)
    );

    // Redirect unauthenticated users to module-specific login
    if (isProtectedRoute && !session) {
        const { getLoginUrl } = await import('@/lib/auth-redirect');
        const loginPath = getLoginUrl(pathname, pathname);
        const loginUrl = new URL(loginPath, request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Multi-role authorization check
    if (session) {
        const userRoles = (session.user.roles && Array.isArray(session.user.roles))
            ? (session.user.roles as UserRole[])
            : [];

        const hasErrorParam = request.nextUrl.searchParams.has('error');

        // ADMIN ROUTE AUTHORIZATION
        if (pathname.startsWith('/admin')) {
            const { canAccessAdminRoute } = await import('@/lib/admin-permissions');

            if (!canAccessAdminRoute(userRoles, pathname)) {
                // Redirect to home page, not error dashboard
                return NextResponse.redirect(new URL("/", request.url));
            }
        }

        // Check if user has permission to access this route
        if (!hasErrorParam && !canAccessRoute(userRoles, pathname)) {
            if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
                // Allow dashboard access - it will redirect based on roles
            } else if (pathname.startsWith('/messages')) {
                // Messages route - approval check in layout
            } else {
                // CRITICAL FIX: Do NOT redirect to /dashboard?error=unauthorized
                // Instead, redirect to module selection so users can apply for the module
                logger.warn(`Access denied for user to ${pathname}, redirecting to module selection`);
                return NextResponse.redirect(new URL("/auth/get-started", request.url));
            }
        }
    }

    // Handle MFA enforcement
    const isMFAProtectedRoute = mfaProtectedRoutes.some((route) =>
        pathname.startsWith(route)
    );

    if (isMFAProtectedRoute && session) {
        const mfaVerified = request.cookies.get("mfa_verified")?.value === "true";

        if (!mfaVerified) {
            const mfaUrl = new URL("/settings/security/mfa", request.url);
            mfaUrl.searchParams.set("required", "true");
            mfaUrl.searchParams.set("redirect", pathname);
            return NextResponse.redirect(mfaUrl);
        }
    }

    // Check feature toggles
    for (const [route, envVar] of Object.entries(featureRoutes)) {
        if (pathname.startsWith(route)) {
            const isEnabled = process.env[envVar] === "true";
            if (!isEnabled) {
                return NextResponse.redirect(new URL("/dashboard?error=feature_disabled", request.url));
            }
        }
    }

    // Create response
    const response = NextResponse.next();

    // Update last activity timestamp
    if (session) {
        response.cookies.set("lastActivity", Date.now().toString(), {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: SESSION_TIMEOUT_MS / 1000,
        });
    }

    // Add security headers
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

    // Content Security Policy
    const cspDirectives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.paystack.co https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' https://maps.googleapis.com https://api.paystack.co https://*.upstash.io https://*.vercel.app",
        "frame-src https://js.paystack.co",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests"
    ];

    response.headers.set("Content-Security-Policy", cspDirectives.join("; "));

    return response;
});

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - public folder
         * - API routes (handled separately)
         */
        "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    ],
};
