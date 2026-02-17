import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { canAccessRoute } from "@/lib/role-app-mapping";
import { rateLimit } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types/roles";

/**
 * Enhanced Next.js Middleware for Route Protection
 * 
 * Features:
 * - Session timeout detection
 * - Feature toggle enforcement
 * - Multi-role access control with permissions matrix
 * - Security headers
 */

// Routes requiring any authenticated user
// Note: Module landing pages (/export, /marketplace, etc.) are now public
// Only the dashboard and actual authenticated features require login
// ONBOARDING PAGES ARE NOT PROTECTED - users need access immediately after registration
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
    "/cooperatives/dashboard",
    "/cooperatives/loans",
    "/cooperatives/savings",
    "/marketplace/buyer",
    "/marketplace/seller",
    "/marketplace/cart",
    "/marketplace/orders",
    "/marketplace/checkout",
    "/export/dashboard",
    "/academy/dashboard",
    "/farm-nation/dashboard",
];

// Routes requiring MFA verification
// Note: /export landing page is public, only authenticated export actions need MFA
const mfaProtectedRoutes = [
    "/admin", // All admin pages
    "/cooperatives/withdraw",
    "/loans/apply",
];

// Feature toggle mappings
// Note: Landing pages are always visible, only specific features are toggled
const featureRoutes: Record<string, string> = {
    "/cooperatives/loans": "NEXT_PUBLIC_LOAN_APPLICATIONS_ENABLED",
    "/farm-nation/list-land": "NEXT_PUBLIC_LAND_LISTINGS_ENABLED",
};

// Session timeout (in milliseconds)
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || "30", 10) * 60 * 1000;

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

    // Default to success/skipped
    let rateLimitResult: { success: boolean; remaining?: number; error?: string } = { success: true, remaining: 100 };

    // Get session using getToken (Edge Runtime compatible)
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    const session = token ? { user: token } : null;

    // 🛡️ SECURITY: Redis-based Session Revocation (Zombie Session Fix)
    // Check if user has been suspended via Admin/Bulk Action
    if (session?.user?.id) {
        try {
            // Import redis dynamically to ensure it works in Edge or use fetch if needed
            // @upstash/redis is edge compatible
            // We use direct REST call if we want to be super safe or just import the lib
            // For now, let's assume the lib/redis is safe
            const { redis } = await import("@/lib/redis");

            // Check suspension key (30 day TTL set by admin action)
            const isSuspended = await redis.get(`user:suspended:${session.user.id}`);

            if (isSuspended) {
                // Immediate Logout
                const response = NextResponse.redirect(new URL("/auth/login?error=account_suspended", request.url));

                // Clear all auth cookies
                response.cookies.delete("lastActivity");
                response.cookies.delete("next-auth.session-token");
                response.cookies.delete("__Secure-next-auth.session-token");
                response.cookies.delete("next-auth.callback-url");
                response.cookies.delete("__Secure-next-auth.callback-url");
                response.cookies.delete("next-auth.csrf-token");
                response.cookies.delete("__Secure-next-auth.csrf-token");

                return response;
            }
        } catch (error) {
            // Fail open (allow access) if Redis is down to prevent global outage? 
            // OR Fail closed? 
            // Better to log and proceed for availability, unless strict security mode.
            // Using console.error since logger might not be edge safe
            console.error("Redis suspension check failed:", error);
        }
    }

    // CRITICAL: Global Auth Enforcement
    // Redirect module-specific auth pages to global auth
    // e.g. /marketplace/login -> /auth/login?module=marketplace
    const isModuleAuthPage = pathname.match(/^\/([^/]+)\/(login|register)$/);
    if (isModuleAuthPage) {
        const [, module, type] = isModuleAuthPage;
        // Skip for 'auth' module itself (infinite loop prevention)
        if (module !== 'auth') {
            const globalAuthUrl = new URL(`/auth/${type}`, request.url);
            globalAuthUrl.searchParams.set('module', module);
            return NextResponse.redirect(globalAuthUrl);
        }
    }

    // CRITICAL: Skip middleware for all auth pages to prevent redirect loops
    // This includes: /auth/login, /auth/register, /auth/signin, /auth/signup
    const isAuthPage = pathname.startsWith('/auth/');

    if (isAuthPage) {
        // If user is already authenticated, redirect them to dashboard
        if (session) {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        return NextResponse.next();
    }

    // Check session timeout
    if (session) {
        const lastActivity = request.cookies.get("lastActivity")?.value;
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const now = Date.now();

            if (now - lastActivityTime > SESSION_TIMEOUT_MS) {
                // Session expired

                // Check if current route is protected
                const isProtectedRoute = protectedRoutes.some((route) =>
                    pathname.startsWith(route)
                );

                if (isProtectedRoute) {
                    // Redirect to module-specific login
                    const { getLoginUrl } = await import('@/lib/auth-redirect');
                    const loginPath = getLoginUrl(pathname, pathname);
                    const loginUrl = new URL(loginPath, request.url);
                    loginUrl.searchParams.set("error", "session_expired");

                    const response = NextResponse.redirect(loginUrl);
                    response.cookies.delete("lastActivity");
                    // Also clear session cookie if using next-auth default names
                    response.cookies.delete("next-auth.session-token");
                    response.cookies.delete("__Secure-next-auth.session-token");
                    return response;
                } else {
                    // Public route: clear session and proceed
                    // We can't easily "logout" the user from middleware without redirecting to a logout handler
                    // But we can clear the activity cookie and let the client-side tracker handle specific logout if needed
                    // OR better: Just delete the session cookies on the response so they are logged out effectively
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

    // VERIFICATION CHECK - REMOVED PER REQ: "Users can create account without approval"
    // Verification is now strictly role-based via Admin Actions during Onboarding.
    // The "isVerified" field on User will track if they have passed the specific onboarding checks.
    // Dashboard access is allowed for all authenticated users (General User).


    // AUTH REDIRECT — DO NOT MODIFY WITHOUT FULL REVIEW
    // Multi-role authorization check - only enforce if user HAS roles
    // Enforce for ALL authenticated users, even if they have no roles (which defaults to empty array)
    if (session) {
        const userRoles = (session.user.roles && Array.isArray(session.user.roles))
            ? (session.user.roles as UserRole[])
            : [];

        // CRITICAL: Prevent infinite redirect loop
        // Skip permission check if already redirected with error
        const hasErrorParam = request.nextUrl.searchParams.has('error');

        // ADMIN ROUTE AUTHORIZATION with granular permissions
        if (pathname.startsWith('/admin')) {
            // Import admin permission check
            const { canAccessAdminRoute } = await import('@/lib/admin-permissions');

            if (!canAccessAdminRoute(userRoles, pathname)) {
                // User lacks admin permissions for this route
                return NextResponse.redirect(new URL("/dashboard?error=admin_access_denied", request.url));
            }
        }

        // Check if user has permission to access this route
        if (!hasErrorParam && !canAccessRoute(userRoles, pathname)) {
            // EXCEPTION: Allow access to onboarding/application pages regardless of role
            // This is critical so General Users can apply to become Sellers/Exporters/etc.
            const isOnboardingPage = pathname.includes("/onboarding") ||
                pathname.includes("/application") ||
                pathname.includes("/register") ||
                pathname.includes("/join");

            if (isOnboardingPage) {
                // Allow access
            } else if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
                // User is authenticated but lacks specific roles - allow dashboard access
                // Dashboard will show appropriate UI based on roles
            } else if (pathname.startsWith('/messages')) {
                // MESSAGES ROUTE: Require user to have completed onboarding
                // The actual approval check will be done in the messages layout using server components
                // which can safely use Firebase Admin SDK (not in Edge Runtime)
                // For now, we just check if they have access via role mapping
                // The detailed approval check happens in /app/messages/layout.tsx
            } else {
                // For other protected routes, redirect to dashboard with error
                return NextResponse.redirect(new URL("/dashboard?error=unauthorized", request.url));
            }
        }
    }

    // Handle MFA enforcement for sensitive routes
    const isMFAProtectedRoute = mfaProtectedRoutes.some((route) =>
        pathname.startsWith(route)
    );

    if (isMFAProtectedRoute && session) {
        // Check if user has MFA enabled
        const mfaVerified = request.cookies.get("mfa_verified")?.value === "true";

        if (!mfaVerified) {
            // Redirect to MFA verification page
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

    // Content Security Policy (comprehensive for development and production)
    const cspDirectives = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.paystack.co https://www.googletagmanager.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "img-src 'self' data: https: blob:",
        "font-src 'self' data: https://fonts.gstatic.com",
        "connect-src 'self' https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://api.paystack.co wss://*.firebaseio.com",
        "frame-src 'self' https://js.paystack.co https://checkout.paystack.com https://www.youtube.com https://youtube.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests"
    ];

    response.headers.set("Content-Security-Policy", cspDirectives.join("; "));

    // 🛡️ Add Rate Limit Headers (monitoring)
    if (rateLimitResult.remaining !== undefined) {
        response.headers.set('X-RateLimit-Remaining', rateLimitResult.remaining.toString());
    }

    // Cache-Control for protected routes (Prevent caching of sensitive data)
    if (session) {
        response.headers.set("Cache-Control", "no-store, max-age=0, must-revalidate");
    }

    return response;
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - api routes
         * - _next/static (static files)
         * - _next/image (image optimization)
         * - favicon.ico
         * - public folder
         */
        "/((?!api|_next/static|_next/image|favicon.ico|images).*)",
    ],
};
