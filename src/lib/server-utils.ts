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

    // The apex domain does NOT serve this app — it is a redirector that answers
    // GET / with a 301 and rejects POST with 405. Anything built from it and
    // then POSTed to (a Paystack callback_url, an auth callback) fails, because
    // non-browser clients do not follow redirects.
    //
    // That is not hypothetical: the Paystack webhook was configured on the apex
    // and every delivery was dropped with a 405, which is why fulfilment fell
    // entirely to the client callback and 297 memberships had to be repaired.
    //
    // The host header above is the normal path and already yields www. This is
    // the fallback for when there is no request context, and it must not hand
    // back a host that cannot serve a POST.
    return process.env.NEXT_PUBLIC_APP_URL || "https://www.easysalesexport.com";
}

/**
 * Get the module domain for a specific module slug.
 * Useful for constructing absolute URLs for other modules.
 */
export function getModuleDomain(slug: string) {
    const isDev = process.env.NODE_ENV === "development";
    const useSubdomains = process.env.USE_SUBDOMAINS === "true";
    // www, not the apex — see the note in getBaseUrl above.
    const mainAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.easysalesexport.com";

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
