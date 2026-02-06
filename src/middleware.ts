import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Enhanced Next.js Middleware for Route Protection
 * 
 * Features:
 * - Session timeout detection
 * - Feature toggle enforcement
 * - Comprehensive role-based access control
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

// Routes requiring admin role
const adminRoutes = [
    "/admin/users",
    "/admin/export-windows",
    "/admin/audit-logs",
    "/admin/loans",
    "/admin/land-verification",
    "/admin/disputes",
    "/admin/engagement",
    "/admin/announcements",
    "/admin/content",
    "/admin/withdrawals",
    "/admin/content-approval", // New: Content approval system
    "/escrow/admin", // New: Escrow admin panel
    "/academy/admin", // New: LMS course management
    "/loans/approve", // New: Loan approval
];

// Routes requiring super_admin role
const superAdminRoutes = [
    "/admin/super/financial",
    "/admin/super/feature-toggles",
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

    const isAdminRoute = adminRoutes.some((route) => pathname.startsWith(route));
    const isSuperAdminRoute = superAdminRoutes.some((route) => pathname.startsWith(route));

    // Redirect unauthenticated users to login
    if (isProtectedRoute && !session) {
        const loginUrl = new URL("/auth/login", request.url);
        loginUrl.searchParams.set("callbackUrl", pathname);
        return NextResponse.redirect(loginUrl);
    }

    // Handle admin route authorization
    if (isAdminRoute) {
        if (!session) {
            const loginUrl = new URL("/auth/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return NextResponse.redirect(loginUrl);
        }

        // Check if user has admin or super_admin role
        if (session.user.role !== "admin" && session.user.role !== "super_admin") {
            return NextResponse.redirect(new URL("/dashboard", request.url));
        }
    }

    // Handle super admin route authorization
    if (isSuperAdminRoute) {
        if (!session) {
            const loginUrl = new URL("/auth/login", request.url);
            loginUrl.searchParams.set("callbackUrl", pathname);
            return NextResponse.redirect(loginUrl);
        }

        if (session.user.role !== "super_admin") {
            return NextResponse.redirect(new URL("/dashboard", request.url));
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
