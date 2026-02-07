import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { canAccessRoute } from "@/lib/permissions";
import type { UserRole } from "@/lib/types/firestore";

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
const protectedRoutes = [
    "/dashboard",
    "/export",
    "/marketplace",
    "/cooperatives",
    "/wave",
    "/farm-nation",
    "/academy",
];

// Routes requiring MFA verification
const mfaProtectedRoutes = [
    "/admin", // All admin pages
    "/cooperatives/withdraw",
    "/export",
    "/loans/apply",
];

// Feature toggle mappings
const featureRoutes: Record<string, string> = {
    "/marketplace": "NEXT_PUBLIC_MARKETPLACE_ENABLED",
    "/export": "NEXT_PUBLIC_EXPORT_WINDOWS_ENABLED",
    "/wave": "NEXT_PUBLIC_WAVE_ENABLED",
    "/cooperatives/loans": "NEXT_PUBLIC_LOAN_APPLICATIONS_ENABLED",
    "/farm-nation/list-land": "NEXT_PUBLIC_LAND_LISTINGS_ENABLED",
};

// Session timeout (in milliseconds)
const SESSION_TIMEOUT_MS = parseInt(process.env.SESSION_TIMEOUT_MINUTES || "30", 10) * 60 * 1000;

export async function middleware(request: NextRequest) {
    const pathname = request.nextUrl.pathname;

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
                // Session expired
                const loginUrl = new URL("/auth/login", request.url);
                loginUrl.searchParams.set("error", "session_expired");
                loginUrl.searchParams.set("callbackUrl", pathname);

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

    // Redirect unauthenticated users to login
    if (isProtectedRoute && !session) {
        const loginUrl = new URL("/auth/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // NEW: Multi-role authorization check
    if (session && session.user.roles) {
        const userRoles = session.user.roles as UserRole[];

        // Check if user has permission to access this route
        if (!canAccessRoute(userRoles, pathname)) {
            // User doesn't have required roles for this route
            return NextResponse.redirect(new URL("/dashboard?error=unauthorized", request.url));
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

    // Content Security Policy
    response.headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://firebasestorage.googleapis.com https://firestore.googleapis.com;"
    );

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
