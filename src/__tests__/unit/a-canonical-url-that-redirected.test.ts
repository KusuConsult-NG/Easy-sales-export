/**
 * @jest-environment node
 */

/**
 *   #902 THE SITE TOLD GOOGLE ITS CANONICAL HOST, AND ITS OWN MIDDLEWARE
 *   DISAGREED.
 *
 *   Found auditing the files no test had named — sitemap.ts, robots.ts and five
 *   module layouts were all on that list, and all ten declarations were the
 *   same mistake.
 *
 * ── THE TWO HALVES, AND WHICH ONE IS AUTHORITATIVE ──────────────────────────
 *
 *   lib/canonical-host has sent `easysalesexport.com` to
 *   `www.easysalesexport.com` since #494, and its header says why it is not a
 *   preference: the session cookie is set with NO `domain`, so it is host-only,
 *   and the CSRF cookie carries the `__Host-` prefix, which FORBIDS a domain
 *   attribute. Two hosts is two sessions. The app is deployed on the www host
 *   and #494 explicitly declined to reverse the direction to make a rule tidy:
 *   "The rule bends here, not the deployment."
 *
 *   So the served host is www, and every SEO declaration named the apex:
 *
 *       app/layout.tsx                    metadataBase, alternates.canonical,
 *                                         openGraph.url, and the Organization
 *                                         and WebSite JSON-LD urls
 *       five module layouts + marketplace alternates.canonical (and export's
 *                                         openGraph.url)
 *       marketplace/products/[id]         openGraph.url, per product
 *       app/sitemap.ts                    BASE_URL — ten static routes plus up
 *                                         to 500 products, 200 land listings
 *                                         and 100 courses
 *       app/robots.ts                     the sitemap it advertises, named as
 *                                         the apex FROM THE WWW HOST TOO
 *
 * ── WHY IT IS A DEFECT AND NOT UNTIDINESS ───────────────────────────────────
 *
 *   A `rel=canonical` that points at a URL which 301s is a weak signal — the
 *   crawler has to follow the hop and then decide which of the two the site
 *   meant, while the site is simultaneously asserting the one it redirects
 *   away from. The sitemap made it worse at scale: up to eight hundred URLs,
 *   every one a redirect, offered as the list of pages to index. And robots
 *   pointed a crawler that had ALREADY been moved to www back at the apex
 *   sitemap, so the hop could not be avoided by arriving correctly.
 *
 * ── WHAT IS DELIBERATELY UNCHANGED ──────────────────────────────────────────
 *
 *   THE FIVE OTHER DOMAINS. easysalesacademy.com, easysalesexportng.com,
 *   farmnation.ng, wave.ng and marketplace.easysalesexport.com are NOT the same
 *   case and are left exactly as they were: their canonical host is the apex,
 *   by modules.config's own declaration, and MODULE_WWW_REDIRECTS sends
 *   `www.<apex>` to `<apex>` for them. Changing those would break four module
 *   sites, which is the mistake #494's header warns about in as many words.
 *
 *   THE EMAIL LINKS. A link in a notification email that 301s costs the reader
 *   nothing and is not a canonical signal, and they are spread across a dozen
 *   action files with their own NEXTAUTH_URL fallbacks. Out of scope, and said
 *   here rather than left to look like an oversight.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/lib/testing/strip-comments';
import { ROOT_ORIGIN, canonicalUrl, canonicalHostFor, MODULE_WWW_REDIRECTS } from '@/lib/canonical-host';
import { HUB_MODULES } from '@/config/modules.config';
import { isPublicPath } from '@/lib/route-manifest';

/** The modules a stranger can open a landing page for — the sitemap's own filter. */
const PUBLIC_MODULES = Object.values(HUB_MODULES).filter((mod) => isPublicPath(`/${mod.slug}`));

const code = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), 'utf8'), { label: rel });

/** Every file that declared the hub's own origin. */
const DECLARERS = [
    'src/app/layout.tsx',
    'src/app/sitemap.ts',
    'src/app/robots.ts',
    'src/app/farm-nation/layout.tsx',
    'src/app/marketplace/page.tsx',
    'src/app/export/layout.tsx',
    'src/app/cooperatives/landing/layout.tsx',
    'src/app/wave/landing/layout.tsx',
    'src/app/academy/layout.tsx',
    'src/app/marketplace/products/[id]/layout.tsx',
];

describe('the host the platform serves, and the host it advertised', () => {
    it('THE MIDDLEWARE RULE IS THE ONE THAT WAS ALREADY TRUE (control)', () => {
        //   THE control. Everything below is "the declarations should match the
        //   redirect" — worth nothing if the redirect is not what I claim.
        expect(canonicalHostFor('easysalesexport.com')).toBe('www.easysalesexport.com');
        //   And already-there answers null, so no caller can write a loop.
        expect(canonicalHostFor('www.easysalesexport.com')).toBeNull();
    });

    it('ROOT_ORIGIN IS THAT HOST, AS AN ORIGIN', () => {
        expect(ROOT_ORIGIN).toBe('https://www.easysalesexport.com');
    });

    describe('canonicalUrl', () => {
        it('BUILDS A URL ON THE SERVED HOST', () => {
            expect(canonicalUrl('/export')).toBe('https://www.easysalesexport.com/export');
            expect(canonicalUrl('/marketplace/products/abc')).toBe(
                'https://www.easysalesexport.com/marketplace/products/abc');
        });

        it('AND THE ROOT HAS NO TRAILING SLASH', () => {
            //   `https://www.easysalesexport.com/` and `…com` are two URLs to a
            //   crawler, and the apex declaration this replaces had no slash.
            expect(canonicalUrl('/')).toBe('https://www.easysalesexport.com');
            expect(canonicalUrl()).toBe('https://www.easysalesexport.com');
        });

        it('AND A PATH WITHOUT ITS LEADING SLASH STILL LANDS RIGHT', () => {
            expect(canonicalUrl('academy')).toBe('https://www.easysalesexport.com/academy');
        });

        it('AND A PROTOCOL-RELATIVE PATH DOES NOT SURVIVE AS ONE', () => {
            /*
             *   Not a redirect guard and never reachable as one — this builds a
             *   canonical tag, not a Location header. It is asserted because the
             *   first version tested `startsWith('/')`, which safe-redirect-path's
             *   sweep refuses by name for exactly the `//host` case, and because
             *   collapsing it to one host-relative path is the right answer
             *   anyway.
             */
            expect(canonicalUrl('//evil.example/x')).toBe('https://www.easysalesexport.com/evil.example/x');
            expect(canonicalUrl('///')).toBe('https://www.easysalesexport.com');
            expect(new URL(canonicalUrl('//evil.example')).hostname).toBe('www.easysalesexport.com');
        });

        it('AND WHAT IT PRODUCES IS NEVER ITSELF REDIRECTED', () => {
            //   THE test, stated as a property rather than as a string: whatever
            //   canonicalUrl says, the middleware must have nothing to say about
            //   it. This is the assertion that would have caught the defect.
            for (const path of ['/', '/export', '/academy', '/marketplace', '/farm-nation']) {
                const host = new URL(canonicalUrl(path)).hostname;
                expect({ path, redirectsTo: canonicalHostFor(host) })
                    .toEqual({ path, redirectsTo: null });
            }
        });
    });

    it('NO DECLARATION NAMES THE HOST THE MIDDLEWARE REDIRECTS AWAY FROM', () => {
        /*
         *   The apex, spelled as an origin. Matching `https://easysalesexport.com`
         *   rather than the bare domain deliberately: the domain appears in
         *   `www.easysalesexport.com`, in `marketplace.easysalesexport.com` and
         *   in email addresses, none of which are this defect.
         */
        for (const rel of DECLARERS) {
            expect({ rel, apexOrigin: code(rel).includes('https://easysalesexport.com') })
                .toEqual({ rel, apexOrigin: false });
        }
    });

    it('AND EVERY ONE OF THEM GOES THROUGH THE SHARED RULE', () => {
        //   The vacuity guard on the assertion above: deleting the declarations
        //   would also remove the apex.
        for (const rel of DECLARERS) {
            expect({ rel, shared: /ROOT_ORIGIN|canonicalUrl/.test(code(rel)) })
                .toEqual({ rel, shared: true });
        }
    });

    it('AND THE OTHER MODULES KEEP THEIR APEX, WHICH IS THE OPPOSITE DIRECTION', () => {
        /*
         *   The guard against "fixing" this by rewriting every domain to www,
         *   which #494's header says would have taken four module sites down:
         *   DOMAIN_MAP carries www entries for only two of the six, so the
         *   middleware could not map the others' www host to a module at all.
         */
        for (const mod of PUBLIC_MODULES) {
            if (mod.domain.split('.').length !== 2) continue;
            expect({ domain: mod.domain, wwwGoesTo: canonicalHostFor(`www.${mod.domain}`) })
                .toEqual({ domain: mod.domain, wwwGoesTo: mod.domain });
            expect(canonicalHostFor(mod.domain)).toBeNull();
        }

        //   A subdomain is its own canonical host — there is no www.finance.
        expect(MODULE_WWW_REDIRECTS['www.finance.easysalesexport.com']).toBeUndefined();
    });
});

/*
 *   THE SECOND HALF OF #902, in the same two files: the module domains were
 *   hand-written, and two of the five were not hosts this platform serves.
 */
describe('the module domains the sitemap and robots advertise', () => {
    const sitemap = code('src/app/sitemap.ts');
    const robots = code('src/app/robots.ts');

    it('THE CONFIG SAYS WHAT THE SERVED DOMAINS ARE (control)', () => {
        //   THE control: the claim below is "the files disagreed with the
        //   config", which is worth nothing unless the config says what I say.
        const byDomain = Object.fromEntries(Object.values(HUB_MODULES).map((m) => [m.slug, m.domain]));

        expect(byDomain.wave).toBe('waveprogramme.com');
        expect(byDomain.marketplace).toBe('easysalesmarket.com');
        expect(byDomain.cooperatives).toBe('easysalescooperative.com');
        //   And these were the two the old list had right.
        expect(byDomain.academy).toBe('easysalesacademy.com');
        expect(byDomain['farm-nation']).toBe('farmnation.ng');
    });

    it('AND THE TWO HOSTS THE PLATFORM DOES NOT SERVE ARE GONE FROM BOTH', () => {
        /*
         *   THE test. Neither is in middleware's DOMAIN_MAP — which is derived
         *   from HUB_MODULES — so a crawler following either never reaches the
         *   WAVE or Marketplace module at all, and robots keyed its map on them,
         *   so the REAL module domains fell through to the hub's sitemap.
         */
        for (const ghost of ['wave.ng', 'marketplace.easysalesexport.com']) {
            expect({ ghost, inSitemap: sitemap.includes(ghost) }).toEqual({ ghost, inSitemap: false });
            expect({ ghost, inRobots: robots.includes(ghost) }).toEqual({ ghost, inRobots: false });
        }
    });

    it('AND EVERY PUBLIC MODULE IS NOW OFFERED, THE COOPERATIVE INCLUDED', () => {
        //   It was absent from both files while being a domain the middleware
        //   serves. Derived now, so the next module needs nobody to remember.
        expect(PUBLIC_MODULES.length).toBe(6);

        for (const mod of PUBLIC_MODULES) {
            expect({ slug: mod.slug, derived: sitemap.includes('MODULE_URLS') }).toEqual(
                { slug: mod.slug, derived: true });
        }
        //   The derivation itself, in both files — no literal per domain.
        for (const src of [sitemap, robots]) {
            expect(src).toContain('HUB_MODULES');
            expect(src).toContain('isPublicPath(`/${mod.slug}`)');
        }
    });

    it('AND THE MODULE WITH NO ROUTES IN THIS APP IS NOT OFFERED FOR INDEXING', () => {
        /*
         *   HUB_MODULES holds FINANCE at finance.easysalesexport.com and there
         *   is no `src/app/finance` in this application, so a sitemap entry for
         *   it would publish a 404. isPublicPath is the platform's own answer,
         *   and this is the vacuity guard on the filter above: deriving without
         *   filtering would pass every other assertion here.
         */
        expect(isPublicPath('/finance')).toBe(false);
        expect(PUBLIC_MODULES.map((m) => m.slug)).not.toContain('finance');
        expect(sitemap).not.toContain('finance.easysalesexport.com');
        expect(robots).not.toContain('finance.easysalesexport.com');
    });

    it('AND THE FILTER ADMITS THE SIX THAT DO HAVE A PUBLIC LANDING PAGE', () => {
        //   The other side of that guard: a filter that admitted nothing would
        //   also pass the assertion above and empty the sitemap.
        expect(PUBLIC_MODULES.map((m) => m.slug).sort())
            .toEqual(['academy', 'cooperatives', 'export', 'farm-nation', 'marketplace', 'wave']);
    });

    it('AND ROBOTS POINTS BOTH HUB HOSTS AT THE SAME SITEMAP', () => {
        const robots = code('src/app/robots.ts');

        //   It named the apex from the www host too, so a crawler that had
        //   already been redirected was sent back across the hop.
        expect(robots).toContain("'www.easysalesexport.com': `${ROOT_ORIGIN}/sitemap.xml`");
        expect(robots).toContain("'easysalesexport.com': `${ROOT_ORIGIN}/sitemap.xml`");
        //   Including the fallback for a host the map does not know.
        expect(robots).toContain('?? `${ROOT_ORIGIN}/sitemap.xml`');
    });
});
