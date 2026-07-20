import { headers } from "next/headers";
import { HUB_MODULES } from "@/config/modules.config";

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
    const useSubdomains = process.env.USE_SUBDOMAINS === "true";
    const mainAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://easysalesexport.com";

    if (isDev || !useSubdomains) {
        return mainAppUrl;
    }

    // Look up domain dynamically from master configuration mapping
    const mod = Object.values(HUB_MODULES).find(m => m.slug === slug);
    if (mod) {
        return `https://${mod.domain}`;
    }

    return mainAppUrl;
}
