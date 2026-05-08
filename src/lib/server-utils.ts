import { headers } from "next/headers";

/**
 * Get the base URL (protocol + host) of the current request.
 * Can only be used in Server Components and Server Actions.
 */
export async function getBaseUrl() {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") || headerList.get("host");
    const protocol = process.env.NODE_ENV === "development" ? "http" : "https";
    
    if (host) {
        return `${protocol}://${host}`;
    }
    
    return process.env.NEXT_PUBLIC_APP_URL || "https://easysalesexport.com";
}

/**
 * Get the module domain for a specific module slug.
 * Useful for constructing absolute URLs for other modules.
 */
export function getModuleDomain(slug: string) {
    const isDev = process.env.NODE_ENV === "development";
    if (isDev) {
        return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    }

    switch (slug) {
        case 'marketplace':
            return 'https://marketplace.easysalesexport.com';
        case 'cooperatives':
            return 'https://cooperatives.easysalesexport.com';
        case 'academy':
            return 'https://academy.easysalesexport.com';
        case 'export':
            return 'https://export.easysalesexport.com';
        case 'farm-nation':
            return 'https://farm-nation.easysalesexport.com';
        case 'wave':
            return 'https://wave.easysalesexport.com';
        default:
            return 'https://easysalesexport.com';
    }
}
