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
 *        reducing over it.
 *
 *        #454 CORRECTS THE SECOND HALF OF THAT SENTENCE. It used to read "and
 *        auth.config.ts reads the same object for cookie scoping". It does not.
 *        auth.config.ts imported HUB_MODULES and never referenced it, and its
 *        cookie options set NO `domain` at all — the session cookie is
 *        host-only and the CSRF cookie is `__Host-`, which forbids a domain
 *        attribute outright. Every module domain therefore has its own session,
 *        by design. The unused import is gone.
 *
 *        Comparing the two:
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
 *        DERIVED. HUB_MODULES is the source, so the fallback can no longer
 *        disagree with the router.
 *
 *   #445 AND THE SIX NEXT_PUBLIC_*_URL OVERRIDES ARE GONE — OWNER DECISION.
 *
 *        #367 kept them on the argument that a deployment might set one and
 *        removing the override would silently ignore it. That argument was
 *        weaker than it looked: all six names appeared in this repository ONLY
 *        here, nothing set them in any environment file, and the module that
 *        read them has no importers. They were the configuration surface of a
 *        feature with no consumers — a second, silent way to answer a question
 *        HUB_MODULES already answers, in a codebase where "two statements of
 *        one rule" has been the finding some thirty times.
 *
 *        The owner chose to retire them rather than build on them. A module's
 *        domain now has exactly one source: src/config/modules.config.ts, which
 *        middleware.ts and auth.config.ts already route and scope cookies on.
 *        To point a module elsewhere, change it there.
 */

const domainOf = (slug: string): string => {
    const mod = Object.values(HUB_MODULES).find((m) => m.slug === slug);
    // A slug that is not in HUB_MODULES is a typo in this file, not a runtime
    // condition. Naming it beats returning "https://undefined".
    if (!mod) throw new Error(`[external-domains] no HUB_MODULES entry for slug "${slug}"`);
    return `https://${mod.domain}`;
};

export const EXTERNAL_DOMAINS = {
    marketplace: domainOf("marketplace"),
    cooperatives: domainOf("cooperatives"),
    academy: domainOf("academy"),
    wave: domainOf("wave"),
    export: domainOf("export"),
    farmNation: domainOf("farm-nation"),
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
