/**
 * Module-Specific Auth Redirect Helper
 *
 * Determines the correct auth page (login/register) based on the current pathname.
 * This ensures users see module-specific branding during authentication.
 *
 *   #367 NOTHING IMPORTS THIS FILE, AND NOTHING READS THE PARAMETER IT BUILDS.
 *
 *        Two independent facts, either of which makes the feature described
 *        above absent from the product:
 *
 *          1. No file in src/ imports getModuleAuthUrl, getLoginUrl or
 *             getRegisterUrl. middleware.ts builds its own login URL —
 *             `new URL(targetPath, req.nextUrl.origin)` with a callbackUrl and
 *             no module — and that is the redirect a signed-out visitor gets.
 *
 *          2. No file in src/ reads a `module` search parameter. Not
 *             src/app/auth/login/page.tsx, not src/app/auth/register/page.tsx,
 *             not a layout. So `?module=marketplace` would change nothing even
 *             if something did call this.
 *
 *        The module-specific branding this file's own comment promises has
 *        never appeared. That is the class this audit has hit repeatedly: a
 *        module that names itself the authority for something the application
 *        does not do (#355), and a value written that nothing reads (#335).
 *
 *        KEPT, NOT DELETED. The function is correct for the feature it
 *        describes, and the feature is a reasonable one. What is missing is the
 *        two halves that would make it real: a caller, and a login page that
 *        reads the parameter.
 *
 *        OWNER DECISION: build module-branded auth — wire this into
 *        middleware.ts's redirect and have the auth pages read `?module=` — or
 *        retire it. src/__tests__/unit/dead-module-authority.test.ts holds both
 *        facts so the answer stays visible.
 */

/**
 * Get module-specific auth URL based on current path
 * 
 * @param pathname - The current pathname (e.g., "/marketplace/onboarding")
 * @param type - The auth type: 'login' or 'register'
 * @returns The auth path with a module query param (e.g., "/auth/login?module=marketplace")
 * 
 * @example
 * getModuleAuthUrl("/marketplace/onboarding", "login") // "/auth/login?module=marketplace"
 * getModuleAuthUrl("/cooperatives/dashboard", "login") // "/auth/login?module=cooperatives"
 * getModuleAuthUrl("/dashboard", "login") // "/auth/login" (fallback)
 */
export function getModuleAuthUrl(pathname: string, type: 'login' | 'register'): string {
    // Marketplace module - violet theme
    if (pathname.startsWith('/marketplace')) {
        return type === 'login' ? `/auth/login?module=marketplace` : `/auth/register?module=marketplace`;
    }

    // Cooperatives module - purple theme
    if (pathname.startsWith('/cooperatives')) {
        return type === 'login' ? `/auth/login?module=cooperatives` : `/auth/register?module=cooperatives`;
    }

    // Export module - slate theme
    if (pathname.startsWith('/export')) {
        return type === 'login' ? `/auth/login?module=export` : `/auth/register?module=export`;
    }

    // Farm Nation module - emerald theme
    if (pathname.startsWith('/farm-nation')) {
        return type === 'login' ? `/auth/login?module=farm-nation` : `/auth/register?module=farm-nation`;
    }

    // WAVE module - default theme
    if (pathname.startsWith('/wave')) {
        return type === 'login' ? `/auth/login?module=wave` : `/auth/register?module=wave`;
    }

    // Academy module - if it has custom auth pages
    if (pathname.startsWith('/academy')) {
        return type === 'login' ? `/auth/login?module=academy` : `/auth/register?module=academy`;
    }

    // Default to Auth Portal for all other routes
    // (e.g., /dashboard, /settings, /admin, etc.)
    return '/auth/login';
}

/**
 * Get module-specific login URL with callback
 * 
 * @param pathname - The current pathname
 * @param callbackUrl - Optional callback URL after login
 * @returns Full login URL with query params
 */
export function getLoginUrl(pathname: string, callbackUrl?: string): string {
    const loginPath = getModuleAuthUrl(pathname, 'login');
    if (callbackUrl) {
        // Use URL API to properly append query params
        const url = new URL(loginPath, 'http://localhost');
        url.searchParams.set('callbackUrl', callbackUrl);
        return url.pathname + url.search;
    }
    return loginPath;
}

/**
 * Get module-specific register URL with return URL
 * 
 * @param pathname - The current pathname
 * @param returnUrl - Optional return URL after registration
 * @returns Full register URL with query params
 */
export function getRegisterUrl(pathname: string, returnUrl?: string): string {
    const registerPath = getModuleAuthUrl(pathname, 'register');
    if (returnUrl) {
        // Use URL API to properly append query params (handles existing params like ?module=...)
        const url = new URL(registerPath, 'http://localhost');
        url.searchParams.set('returnUrl', returnUrl);
        return url.pathname + url.search;
    }
    return registerPath;
}
