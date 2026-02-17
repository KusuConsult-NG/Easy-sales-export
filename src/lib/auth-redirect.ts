/**
 * Module-Specific Auth Redirect Helper
 * 
 * Determines the correct auth page (login/register) based on the current pathname.
 * This ensures users see module-specific branding during authentication.
 */

/**
 * Get module-specific auth URL based on current path
 * 
 * @param pathname - The current pathname (e.g., "/marketplace/onboarding")
 * @param type - The auth type: 'login' or 'register'
 * @returns The module-specific auth path (e.g., "/marketplace/login")
 * 
 * @example
 * getModuleAuthUrl("/marketplace/onboarding", "login") // "/marketplace/login"
 * getModuleAuthUrl("/cooperatives/dashboard", "login") // "/cooperatives/login"
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
    return '/auth/get-started';
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
        return `${registerPath}?returnUrl=${encodeURIComponent(returnUrl)}`;
    }
    return registerPath;
}
