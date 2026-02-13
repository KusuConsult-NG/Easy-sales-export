import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { canAccessRoute } from "@/lib/role-app-mapping";
import type { UserRole } from "@/lib/types/roles";

/**
 * Enhanced Next.js Middleware for Route Protection
 * 
 * Features:
 * - Session timeout detect ion
 * - Feature toggle enforcement
 * - Multi-role access control with permissions matrix
 * - Security headers
 */

// Routes requiring any authenticated user
// Note: Module landing pages (/export, /marketplace, etc.) are now public
// Only the dashboard and actual authenticated features require login
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
    "/wave/application",
    "/wave/resources",
    "/cooperatives/dashboard",
    "/cooperatives/loans",
    "/cooperatives/savings",
    "/marketplace/onboarding",
    "/marketplace/buyer",
    "/marketplace/seller",
    "/marketplace/cart",
    "/marketplace/orders",
    "/marketplace/checkout",
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

    // CRITICAL: Skip middleware for all auth pages to prevent redirect loops
    // This includes: /auth/login, /auth/register, /marketplace/login, /export/login, etc.
    const isAuthPage = pathname.includes('/login') ||
        pathname.includes('/register') ||
        pathname === '/auth/signin' ||
        pathname === '/auth/signup';

    if (isAuthPage) {
        return NextResponse.next();
    }

    // Get session using getToken (Edge Runtime compatible)
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    const session = token ? { user: token } : null;

    // Check session timeout
    if (session) {
        const lastActivity = request.cookies.get("lastActivity")?.value;
        if (lastActivity) {
            const lastActivityTime = parseInt(lastActivity, 10);
            const now = Date.now();

            if (now - lastActivityTime > SESSION_TIMEOUT_MS) {
                // Session expired - redirect to module-specific login
                const { getLoginUrl } = await import('@/lib/auth-redirect');
                const loginPath = getLoginUrl(pathname, pathname);
                const loginUrl = new URL(loginPath, request.url);
                loginUrl.searchParams.set("error", "session_expired");

                const response = NextResponse.redirect(loginUrl);
                response.cookies.delete("lastActivity");
                return response;
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

    // VERIFICATION CHECK
    // Redirect unverified users to /verify-status
    if (session && isProtectedRoute && pathname !== "/verify-status") {
        if (session.user.verified === false) {
            return NextResponse.redirect(new URL("/verify-status", request.url));
        }
    }


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
            // Special case: allow dashboard access for all authenticated users
            if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
                // User is authenticated but lacks specific roles - allow dashboard access
                // Dashboard will show appropriate UI based on roles
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
        "connect-src 'self' https://*.firebaseio.com https://firebaseinstallations.googleapis.com https://firestore.googleapis.com https://api.paystack.co wss://*.firebaseio.com",
        "frame-src 'self' https://js.paystack.co https://checkout.paystack.com https://www.youtube.com https://youtube.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ];

    response.headers.set("Content-Security-Policy", cspDirectives.join("; "));

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
