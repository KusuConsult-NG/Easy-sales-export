import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { NextResponse } from "next/server";

/**
 * Hub Middleware
 * 
 * Uses Edge-compatible authConfig to avoid importing firebase-admin.
 */

const { auth } = NextAuth(authConfig);

export default auth((req) => {
    const { pathname } = req.nextUrl;

    // Security Headers Logic (re-implemented here or imported from a utility if edge-safe)
    const response = NextResponse.next();
    addSecurityHeaders(response);

    // Root/landing page is public
    if (pathname === "/") {
        return response;
    }

    // Protected Routes Logic is now handled by authConfig.callbacks.authorized
    // But we can add extra custom logic here if needed, or rely on the authorized callback.
    // The previous implementation had manual redirect logic.
    // Let's migrate that logic to the authorized callback effectively, 
    // OR keep it here if we want explicit control.

    // WAVE route protection is handled by the `authorized` callback in auth.config.ts
    // which returns false for unauthenticated users on /wave/* (except public paths).

    // START: Manual Role Check (since authorized callback is boolean-only)
    // Admin routes require admin/super_admin role
    if (pathname.startsWith("/admin") && req.auth?.user) {
        const roles = (req.auth.user as any)?.roles || [];
        const isAdmin = roles.includes("admin") || roles.includes("super_admin");
        if (!isAdmin) {
            return NextResponse.redirect(new URL("/dashboard", req.url));
        }
    }
    // END: Manual Role Check

    return response;
});

/**
 * Add security headers to response
 */
function addSecurityHeaders(response: NextResponse): NextResponse {
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
    );
    return response;
}

export const config = {
    matcher: [
        "/((?!_next/static|_next/image|favicon.ico|images|grid.svg).*)",
    ],
};
