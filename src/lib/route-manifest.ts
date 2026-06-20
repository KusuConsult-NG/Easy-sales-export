/**
 * Route Manifest — Single Source of Truth
 *
 * All route classification lives here. Both `auth.config.ts` and `middleware.ts`
 * import from this file. Adding a new route = one edit, one place.
 */

// ── Public routes ─────────────────────────────────────────────────────────────
// Accessible without authentication. Never gate these.
export const PUBLIC_PATHS = [
    "/",
    "/auth",
    "/about",
    "/contact",
    "/help",
    "/privacy",
    "/terms",
    "/refund-policy",
    "/get-started",
    "/land",
    // Module marketing / landing pages (read-only, no gated forms)
    "/wave/landing",
    "/wave/access-denied",
    "/wave",              // root → redirects to /wave/landing
    "/cooperatives/landing",
    "/cooperatives",      // root → redirects to /cooperatives/landing
    "/marketplace",       // public catalog landing
    "/marketplace/products", // public product browsing
    "/academy",           // public academy info page
    "/farm-nation",       // public farm-nation landing
    "/export",            // public export windows landing
    // Export windows — public investment catalog
    "/export/windows",
    "/windows",
] as const;

// ── Protected routes ──────────────────────────────────────────────────────────
// Require authentication. Unauthenticated users are redirected to /auth/login.
// Includes both fully-qualified paths (hub domain) and short-form paths
// (dedicated domains, where the module prefix is stripped before matching).
export const PROTECTED_PATHS = [
    "/dashboard",
    // Wave
    "/wave/briefing",
    "/wave/application",
    "/briefing",
    "/application",
    // Marketplace
    "/marketplace/buyer",
    "/marketplace/checkout",
    "/marketplace/success",
    "/marketplace/verify",
    "/marketplace/onboarding",
    "/marketplace/sell",
    "/marketplace/seller",
    "/marketplace/seller-verification",
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
    "/academy/dashboard",
    "/academy/progress",
    "/academy/my-courses",
    "/academy/courses",
    "/academy/live",
    "/academy/application",
    "/academy/payment",
    "/setup",
    // Farm Nation
    "/farm-nation/onboarding",
    "/farm-nation/checkout",
    "/farm-nation/(member)",
    "/farm-nation/list-land",
    // Export
    "/export/onboarding",
    "/export/buyer",
    "/export/(app)",
    "/onboarding",
    "/hub/register",
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
] as const;

// ── Shared domain paths ───────────────────────────────────────────────────────
// On dedicated module domains (e.g. easysalesexportacademy.com), these paths
// must be passed through untouched (not rewritten with a module prefix).
// For example: /cooperatives on the Academy domain must stay /cooperatives,
// not become /academy/cooperatives.
export const SHARED_DOMAIN_PATHS = [
    "/auth",
    "/dashboard",
    "/admin",
    "/profile",
    "/settings",
    "/messages",
    "/escrow",
    "/verify-id",
    "/verify-status",
    "/loans",
    "/favicon.ico",
    "/images",
    "/about",
    "/contact",
    "/privacy",
    "/terms",
    "/refund-policy",
    "/get-started",
    "/api",
    // Cross-module navigable paths: must never be rewritten
    "/cooperatives",
    "/marketplace",
    "/academy",
    "/farm-nation",
    "/export",
    "/wave",
    "/hub/register",
] as const;

// ── Gated path segments ───────────────────────────────────────────────────────
// Short-form segments that require authentication when accessed on a
// dedicated module domain (before the module prefix rewrite is applied).
export const GATED_SEGMENTS = [
    "/onboarding",
    "/checkout",
    "/payment",
    "/verify-payment",
    "/briefing",
    "/application",
    "/setup",
    "/buyer",
    "/seller",
    "/sell",
    "/list-land",
    "/dashboard",
    "/profile",
    "/settings",
    "/messages",
    "/escrow",
    "/loans",
    "/admin",
    "/verify-id",
    "/verify-status",
    "/vendor",
] as const;

// ── Matcher helpers ───────────────────────────────────────────────────────────

export function isPublicPath(pathname: string): boolean {
    return PUBLIC_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
    );
}

export function isProtectedPath(pathname: string): boolean {
    return PROTECTED_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
    );
}

export function isSharedDomainPath(pathname: string): boolean {
    return SHARED_DOMAIN_PATHS.some(
        (p) => pathname === p || pathname.startsWith(p + "/")
    );
}

export function isGatedSegment(pathname: string): boolean {
    return GATED_SEGMENTS.some(
        (seg) => pathname === seg || pathname.startsWith(seg + "/")
    );
}
