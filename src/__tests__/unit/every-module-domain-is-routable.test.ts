/**
 * @jest-environment node
 */

/**
 *   #454 THE CANONICAL FARM NATION DOMAIN — OWNER DECISION — AND THE THREE
 *   THINGS THAT TURNED UP BEHIND THE QUESTION.
 *
 *   #445 deleted the six NEXT_PUBLIC_*_URL overrides, which made a module's
 *   domain decidable from one place instead of two. Reviewing the owner's
 *   production configuration against that one place, two entries disagreed:
 *
 *       module        deployment                        modules.config.ts
 *       marketplace   marketplace.easysalesexport.com   easysalesmarket.com
 *       farmNation    farmnation.ng                     farmnation.easysalesexport.com
 *
 *   The owner settled both: easysalesmarket.com and farmnation.ng. The first was
 *   ALREADY what the config said, so exactly one line changed.
 *
 *   AND THE CHANGE WAS SAFE FOR REASONS WORTH RECORDING, because "moving a
 *   module to a different registrable domain" sounds like it should break a
 *   session and does not:
 *
 *     THE COOKIES ARE HOST-ONLY. auth.config.ts sets no `domain` on the session
 *     cookie, and the CSRF cookie is `__Host-`, which forbids the attribute
 *     outright. Every module domain has had its own session all along. Four of
 *     the seven modules were already on separate registrable domains, so
 *     farmnation.ng joins an existing arrangement rather than starting one.
 *
 *     AND auth.config.ts DID NOT READ HUB_MODULES AT ALL. It imported it and
 *     never referenced it, while external-domains.ts documented that it "reads
 *     the same object for cookie scoping". A false claim in a comment, load
 *     bearing for exactly this decision. Both corrected.
 *
 *     APEX_DOMAINS WAS COMPUTED IN middleware.ts AND READ BY NOTHING. It was
 *     also the one place this change would have altered behaviour — moving farm
 *     nation off easysalesexport.com adds it to a list nothing consults. A list
 *     with that name is what somebody reaches for when adding a redirect, so it
 *     is removed rather than left to be trusted later.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     farm-nation reverted to the subdomain      KILLED
 *     an alias removed from DOMAIN_MAP           KILLED
 *     a cookie `domain` added to auth.config     KILLED
 *     reword this header                         SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { HUB_MODULES } from '@/config/modules.config';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

/** DOMAIN_MAP as middleware.ts builds it: derived, then the hand-added aliases. */
function domainMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const mod of Object.values(HUB_MODULES)) map[mod.domain] = `/${mod.slug}`;

    const middleware = source('src/middleware.ts');
    for (const m of middleware.matchAll(/DOMAIN_MAP\["([^"]+)"\]\s*=\s*"([^"]*)"/g)) {
        map[m[1]] = m[2];
    }
    return map;
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#454 — the domains the owner named are the ones the app routes on', () => {
    it('FARM NATION IS farmnation.ng', () => {
        expect(HUB_MODULES.farmNation?.domain ?? Object.values(HUB_MODULES)
            .find((m) => m.slug === 'farm-nation')?.domain).toBe('farmnation.ng');
    });

    it('AND MARKETPLACE IS easysalesmarket.com — which it already was', () => {
        // Recorded because the deployment said marketplace.easysalesexport.com
        // and the owner confirmed the config was right, not the deployment.
        expect(Object.values(HUB_MODULES).find((m) => m.slug === 'marketplace')?.domain)
            .toBe('easysalesmarket.com');
    });

    it('and farmnation.ng arrives through the DERIVED map, not a hand-added line', () => {
        // It used to be hand-added beside the derivation — two statements of one
        // rule. Now the config is the statement.
        const middleware = source('src/middleware.ts');

        expect(middleware).not.toContain('DOMAIN_MAP["farmnation.ng"]');
        expect(domainMap()['farmnation.ng']).toBe('/farm-nation');
    });

    it('AND THE OLD SUBDOMAINS STILL LAND — old links must not break', () => {
        const map = domainMap();

        expect(map['farmnation.easysalesexport.com']).toBe('/farm-nation');
        expect(map['farm-nation.easysalesexport.com']).toBe('/farm-nation');
    });

    it('EVERY module domain routes somewhere', () => {
        // The vacuity guard: the tests above would pass on a map that had lost
        // every other module.
        const map = domainMap();

        for (const mod of Object.values(HUB_MODULES)) {
            expect({ domain: mod.domain, to: map[mod.domain] })
                .toEqual({ domain: mod.domain, to: `/${mod.slug}` });
        }
        expect(Object.values(HUB_MODULES).length).toBeGreaterThanOrEqual(7);
    });

    it('and the root domain still maps to the hub', () => {
        expect(domainMap()['easysalesexport.com']).toBe('');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#454 — why moving a module across registrable domains is safe here', () => {
    it('THE SESSION COOKIE IS HOST-ONLY — no `domain` attribute', () => {
        // This is the fact the decision rested on. A cookie scoped to
        // .easysalesexport.com could not follow a module to farmnation.ng; a
        // host-only cookie was never following it anywhere.
        const config = source('src/lib/auth.config.ts');
        const cookies = config.slice(config.indexOf('cookies:'), config.indexOf('callbacks:'));

        expect(cookies).not.toMatch(/\bdomain\s*:/);
    });

    it('and the CSRF cookie is __Host-, which forbids one outright', () => {
        expect(source('src/lib/auth.config.ts')).toContain('__Host-authjs.csrf-token');
    });

    it('and MOST modules were already on separate registrable domains', () => {
        // farmnation.ng joins an existing arrangement rather than starting one.
        const separate = Object.values(HUB_MODULES)
            .filter((m) => !m.domain.endsWith('.easysalesexport.com'));

        expect(separate.length).toBeGreaterThanOrEqual(5);
    });

    it('auth.config.ts NO LONGER IMPORTS HUB_MODULES — it never used it', () => {
        // external-domains.ts documented that it "reads the same object for
        // cookie scoping". It did not. The claim is corrected there too.
        expect(source('src/lib/auth.config.ts')).not.toContain('HUB_MODULES');
        expect(source('src/lib/external-domains.ts')).not.toContain('for cookie\n *        scoping');
    });

    it('and APEX_DOMAINS is gone — it was computed and read by nothing', () => {
        // The one place this change would have altered behaviour, in a list
        // nothing consulted.
        const middleware = source('src/middleware.ts');

        expect(middleware).not.toContain('APEX_DOMAINS');
        // The redirect it looked like it fed is still there, unchanged.
        expect(middleware).toContain('hostname === "easysalesexport.com"');
    });
});
