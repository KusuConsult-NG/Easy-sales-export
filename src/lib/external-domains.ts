import { HUB_MODULES } from "@/config/modules.config";

/**
 * External Domain Configuration
 *
 * Where each federated module lives, for building a cross-domain link.
 *
 *   #367 THIS FILE WAS A SECOND STATEMENT OF THE MODULE DOMAIN MAP, AND TWO OF
 *        ITS SIX ENTRIES HAD DRIFTED FROM THE ONE THE ROUTER USES.
 *
 *        The six domains were written out by hand here. The domain the
 *        application actually routes on comes from HUB_MODULES in
 *        src/config/modules.config.ts — middleware.ts builds its DOMAIN_MAP by
 *        reducing over it, and auth.config.ts reads the same object for cookie
 *        scoping. Comparing the two:
 *
 *          module        this file (was)                    HUB_MODULES
 *          ------------  --------------------------------  ------------------------------
 *          marketplace   marketplace.easysalesexport.com   easysalesmarket.com
 *          farmNation    farmnation.ng                     farmnation.easysalesexport.com
 *          cooperatives  easysalescooperative.com          same
 *          academy       easysalesacademy.com              same
 *          wave          waveprogramme.com                 same
 *          export        easysalesexportng.com             same
 *
 *        Nothing imports this file, so the drift cost nothing — yet. It is
 *        exactly the shape that does cost something later: the obvious-looking
 *        module name, exporting the obvious-looking constant, holding an answer
 *        two entries different from the live one. The first caller to reach for
 *        it would have sent marketplace and Farm Nation users to a domain the
 *        router does not canonically serve.
 *
 *        DERIVED NOW. HUB_MODULES is the source; the env overrides are kept so
 *        a deployment can still point a module elsewhere, and the fallback can
 *        no longer disagree with the router.
 *
 *        NOTE ON THOSE ENV VARS. All six NEXT_PUBLIC_*_URL names appear in this
 *        repository ONLY here. Nothing else reads them, and nothing set them —
 *        they are the configuration surface of a module with no consumers.
 *        Kept, because a deployment may set them and removing the override
 *        would silently ignore it.
 */

const withEnv = (slug: string, override: string | undefined): string => {
    if (override) return override;
    const mod = Object.values(HUB_MODULES).find((m) => m.slug === slug);
    // A slug that is not in HUB_MODULES is a typo in this file, not a runtime
    // condition. Naming it beats returning "https://undefined".
    if (!mod) throw new Error(`[external-domains] no HUB_MODULES entry for slug "${slug}"`);
    return `https://${mod.domain}`;
};

export const EXTERNAL_DOMAINS = {
    marketplace: withEnv("marketplace", process.env.NEXT_PUBLIC_MARKETPLACE_URL),
    cooperatives: withEnv("cooperatives", process.env.NEXT_PUBLIC_COOPERATIVES_URL),
    academy: withEnv("academy", process.env.NEXT_PUBLIC_ACADEMY_URL),
    wave: withEnv("wave", process.env.NEXT_PUBLIC_WAVE_URL),
    export: withEnv("export", process.env.NEXT_PUBLIC_EXPORT_URL),
    farmNation: withEnv("farm-nation", process.env.NEXT_PUBLIC_FARM_NATION_URL),
} as const;

export type ExternalDomain = keyof typeof EXTERNAL_DOMAINS;

/**
 * Get redirect URL for a specific module
 */
export function getModuleUrl(module: ExternalDomain, path: string = ''): string {
    const baseUrl = EXTERNAL_DOMAINS[module];
    return path ? `${baseUrl}${path}` : baseUrl;
}

/**
 * Redirect to external module domain.
 *
 * Browser only. It used to touch `window` unconditionally, so a server render
 * got a bare ReferenceError naming nothing useful.
 */
export function redirectToModule(module: ExternalDomain, path: string = '') {
    if (typeof window === "undefined") {
        throw new Error(
            "[external-domains] redirectToModule() is a browser navigation. " +
            "On the server, use redirect() from next/navigation with getModuleUrl().",
        );
    }
    window.location.href = getModuleUrl(module, path);
}
