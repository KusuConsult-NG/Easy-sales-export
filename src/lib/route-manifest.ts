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
    // The short forms of /marketplace/checkout, /farm-nation/checkout,
    // /marketplace/buyer and /export/buyer. Both were listed only in the dead
    // GATED_SEGMENTS list removed below, so on easysalesmarket.com the checkout
    // page and on easysalesexportng.com the buyer area got no middleware gate —
    // the one case where that list's uselessness left a real hole rather than a
    // lost callbackUrl. Neither segment names a public page on any module
    // domain: every full-length form of both is already protected above.
    "/checkout",
    "/buyer",
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
    "/farm-nation/list-land",
    // Export
    "/export/onboarding",
    "/export/buyer",
    "/onboarding",
    "/hub/register",

    // ── Module member areas ───────────────────────────────────────────────
    // These live under Next.js ROUTE GROUPS — src/app/wave/(member),
    // /cooperatives/(member), /farm-nation/(member), /export/(app) — and a
    // route group is a folder convention that NEVER appears in the URL.
    //
    // Two of them were listed here by their folder name ("/farm-nation/(member)",
    // "/export/(app)") and the other two were not listed at all, so
    // isProtectedPath() returned false for every page in all four. That is not
    // an auth bypass — each group's layout calls requireHubRegistration() and
    // redirects — but the middleware gate is what attaches
    // `?callbackUrl=<path>`, and the layouts do not. A signed-out visitor
    // following a link to /cooperatives/withdraw was therefore sent to login
    // and then dropped on /dashboard (LoginForm's defaultCallbackUrl) instead
    // of the page they asked for. Same for a session that lapsed mid-visit.
    // It also meant every such hit paid a full Node render plus the module
    // access lookup rather than an edge redirect.
    //
    // Academy's (learner) group was already listed correctly, by real URL —
    // /academy/courses, /academy/my-courses, /academy/progress above. This
    // block brings the other four into line. The route-group-shaped entries
    // are gone; route-group-not-in-manifest.test.ts fails if either mistake
    // comes back or a new member page is added without an entry.
    "/wave/certificates",
    "/wave/dashboard",
    "/wave/earnings",
    "/wave/live-training",
    "/wave/profile",
    "/wave/resources",
    "/wave/shipments",
    "/wave/training",
    "/cooperatives/contribute",
    "/cooperatives/dashboard",
    "/cooperatives/directory",
    "/cooperatives/fixed-savings",
    "/cooperatives/history",
    "/cooperatives/id-card",
    "/cooperatives/loans",
    "/cooperatives/my-loans",
    "/cooperatives/my-savings",
    "/cooperatives/withdraw",
    "/cooperatives/withdrawals",
    "/farm-nation/dashboard",
    "/farm-nation/edit-property",
    "/farm-nation/inquiries",
    "/farm-nation/my-properties",
    "/farm-nation/my-purchases",
    "/export/dashboard",
    "/export/investments",
    "/export/opportunities",
    "/export/portfolio",
    "/export/products",
    "/export/transactions",

    // Short forms of the same pages, for the dedicated module domains, where
    // the module prefix is stripped from the URL and only added by the rewrite
    // LATER in middleware — the protection gate above it sees the short path.
    // Same convention as /briefing, /sell, /payment and /setup further up.
    //
    // "/products" is deliberately ABSENT. On easysalesmarket.com the public
    // catalogue is served at /products, and PROTECTED_PATHS is global: adding
    // it to cover /export/(app)/products on easysalesexportng.com would gate
    // marketplace's public catalogue for signed-out shoppers. Export's product
    // page keeps the layout guard alone on its own domain; that is the
    // pre-existing behaviour for all four groups, not a new gap.
    "/certificates",
    "/earnings",
    "/live-training",
    "/resources",
    "/shipments",
    "/training",
    "/contribute",
    "/directory",
    "/fixed-savings",
    "/history",
    "/id-card",
    "/my-loans",
    "/my-savings",
    "/withdraw",
    "/withdrawals",
    "/edit-property",
    "/inquiries",
    "/my-properties",
    "/my-purchases",
    "/list-land",
    "/investments",
    "/opportunities",
    "/portfolio",
    "/transactions",

    // ── Member and admin pages that sit under a PUBLIC prefix ─────────────
    // /marketplace and /land are public, and isPublicPath prefix-matches, so
    // every page beneath them was public unless named here. These are not:
    // each one either requires an approved seller, reads a single buyer's
    // order, or is an admin queue. Their server actions do check the caller —
    // /land/verify's queue was closed to non-admins in the Farm Nation pass —
    // so this is the navigation half of a guard the data half already has.
    "/marketplace/dashboard",
    "/marketplace/orders",
    "/marketplace/products/add",
    "/marketplace/village-market/seller",
    "/land/submit",
    "/land/verify",
    // Shared protected areas
    "/escrow",
    "/profile",
    "/settings",
    "/verify-id",
    "/verify-status",
    "/messages",
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

// ── Gated path segments — REMOVED ─────────────────────────────────────────────
// There was a GATED_SEGMENTS list here, and an isGatedSegment() to match it,
// described as "short-form segments that require authentication when accessed
// on a dedicated module domain". NOTHING IMPORTED EITHER ONE. Only two files
// read this module — middleware.ts takes isSharedDomainPath and isProtectedPath,
// auth.config.ts takes isPublicPath and isProtectedPath — so those 22 entries
// gated nothing, and adding a segment to them would have gated nothing either.
//
// That is worse than absent: it reads like a security control, so the next
// person to add a dedicated-domain page protects it there and believes they are
// done. The short-form paths that DO run are in PROTECTED_PATHS above, which is
// the list middleware actually consults; every segment this list carried is
// already there.
//
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
