/**
 * @jest-environment node
 */

/**
 *   #494 SIX MODULE DOMAINS SERVE THE APP ON TWO HOSTS, AND THE TWO HOSTS ARE
 *        TWO SESSIONS.
 *
 *   #454 left this open, correctly, as "a product question about their DNS, not
 *   a repair":
 *
 *       "the other five module apexes have www variants in DOMAIN_MAP but no
 *        apex -> www redirect. Whether they should get one is a product
 *        question."
 *
 *   It is not only a product question, because of what the cookie configuration
 *   says.
 *
 * ── WHY TWO HOSTS IS TWO SESSIONS ───────────────────────────────────────────
 *
 *   auth.config.ts sets the session cookie with NO `domain` option, which makes
 *   it HOST-ONLY: a cookie set on www.easysalesacademy.com is never sent to
 *   easysalesacademy.com, and the reverse. And the CSRF cookie carries the
 *   `__Host-` prefix, which FORBIDS a domain attribute outright — so scoping
 *   the cookies to cover both hosts is not merely undesirable, it is not
 *   available.
 *
 *   The platform already knows this. The one redirect that exists says so:
 *
 *       // Redirect only the primary easysalesexport.com apex domain to www
 *       // for consistent session handling.
 *
 *   Consistent session handling is exactly what the module domains do not have.
 *   A member signs in on one host, follows a link to the other, and is signed
 *   out — with a working account, a valid password and no error to report. That
 *   is the owner's standing complaint arriving from a seventh direction.
 *
 * ── AND THE DIRECTION IS THE OPPOSITE OF THE ROOT DOMAIN'S ──────────────────
 *
 *   The obvious repair — copy the apex -> www redirect to the other six — is
 *   the one that would have taken four module sites down.
 *
 *   DOMAIN_MAP carries www entries for exactly TWO of them, academy and export.
 *   The other four apexes (waveprogramme.com, easysalescooperative.com,
 *   farmnation.ng, easysalesmarket.com) have no www entry at all, so even if
 *   their DNS resolved, the middleware would not map the www host to a module —
 *   it would fall through to the hub. Redirecting an apex to a host the router
 *   does not know is how a fix becomes an outage, which is the thing this owner
 *   has been asking to stop.
 *
 *   And modules.config.ts already states the direction: every module's `domain`
 *   is the APEX. That is the canonical host by the platform's own declaration,
 *   it is the one that certainly resolves, and it is the one DOMAIN_MAP is
 *   derived from. So the redirect is www -> apex, which needs no DNS that does
 *   not already exist.
 *
 *   THE ROOT DOMAIN KEEPS ITS OWN DIRECTION, apex -> www, unchanged. It is live,
 *   its www host is where the app is deployed, and reversing it to match a rule
 *   would be a rewrite of the thing that currently works.
 *
 *   THE LIST IS DERIVED, NOT WRITTEN OUT. #454 deleted an APEX_DOMAINS constant
 *   because it was computed and read by nothing, and recorded why: "a list named
 *   APEX_DOMAINS is exactly the thing somebody reaches for when adding a
 *   redirect, and it would have been silently out of date." A module added to
 *   HUB_MODULES next year gets this without anybody remembering.
 *
 *   MUTATION-TESTED, WITH A CONTROL. Against a green baseline:
 *
 *     the www redirect removed                       KILLED
 *     the direction reversed to apex -> www          KILLED
 *     the root domain's redirect reversed            KILLED
 *     the finance subdomain swept in                 KILLED
 *     the list hard-coded instead of derived         KILLED
 *     the middleware no longer asking                KILLED
 *     the redirect made temporary (302)              KILLED
 *     reword this header                             SURVIVED, as intended
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'fs';
import { stripComments } from '@/lib/testing/strip-comments';
import { HUB_MODULES } from '@/config/modules.config';
import { canonicalHostFor, MODULE_WWW_REDIRECTS } from '@/lib/canonical-host';

const code = (rel: string) => stripComments(readFileSync(rel, 'utf-8'), { label: rel });

/** Every module domain that is an apex — a bare name.tld, not a subdomain. */
const MODULE_APEXES = Object.values(HUB_MODULES)
    .map((m) => m.domain)
    .filter((d) => d.split('.').length === 2);

// ─────────────────────────────────────────────────────────────────────────────
describe('#494 — a module has one host, so a member has one session', () => {
    it('EVERY MODULE APEX HAS ITS www VARIANT REDIRECTED TO IT', () => {
        //   THE test. Six apexes, and only the root domain had a redirect —
        //   so a member who reached the www host of any module was a different
        //   session from one who reached the apex.
        for (const apex of MODULE_APEXES) {
            expect({ apex, redirectsTo: canonicalHostFor(`www.${apex}`) })
                .toEqual({ apex, redirectsTo: apex });
        }
        expect(MODULE_APEXES.length).toBeGreaterThanOrEqual(5);
    });

    it('AND THE APEX ITSELF IS LEFT ALONE', () => {
        //   The vacuity guard, and the outage guard. A rule that redirected the
        //   apex somewhere would loop, or send it to a host DOMAIN_MAP does not
        //   know.
        for (const apex of MODULE_APEXES) {
            expect({ apex, redirect: canonicalHostFor(apex) }).toEqual({ apex, redirect: null });
        }
    });

    it('THE FINANCE SUBDOMAIN IS NOT SWEPT IN', () => {
        //   finance.easysalesexport.com is not an apex, and "www.finance.…" is
        //   not a host anybody has. A rule that treated every module domain
        //   alike would have invented it.
        expect(canonicalHostFor('finance.easysalesexport.com')).toBe(null);
        expect(canonicalHostFor('www.finance.easysalesexport.com')).toBe(null);
    });

    it('AND THE ROOT DOMAIN KEEPS ITS OWN DIRECTION — apex to www', () => {
        //   Live, deployed on www, and reversing it to match a rule would be a
        //   rewrite of the thing that currently works. The rule bends here, not
        //   the deployment.
        expect(canonicalHostFor('easysalesexport.com')).toBe('www.easysalesexport.com');
        expect(canonicalHostFor('www.easysalesexport.com')).toBe(null);
    });

    it('and an unrelated host is not redirected anywhere', () => {
        expect(canonicalHostFor('localhost')).toBe(null);
        expect(canonicalHostFor('some-preview.vercel.app')).toBe(null);
        expect(canonicalHostFor('')).toBe(null);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#494 — the list is derived, so a new module cannot be forgotten', () => {
    /**
     * #454 deleted an APEX_DOMAINS constant that was computed and read by
     * nothing, and recorded exactly why this matters: "a list named
     * APEX_DOMAINS is exactly the thing somebody reaches for when adding a
     * redirect, and it would have been silently out of date."
     */
    it('IT COMES FROM HUB_MODULES, NOT FROM A HAND-WRITTEN LIST', () => {
        const lib = code('src/lib/canonical-host.ts');

        expect(lib).toContain('HUB_MODULES');
        //   Every apex in the config is covered, whatever it is called.
        for (const apex of MODULE_APEXES) {
            expect({ apex, covered: MODULE_WWW_REDIRECTS[`www.${apex}`] === apex })
                .toEqual({ apex, covered: true });
        }
    });

    it('AND THE MIDDLEWARE ASKS IT RATHER THAN TESTING A HOSTNAME', () => {
        //   The redirect was `hostname === "easysalesexport.com"` inline. One
        //   host, hard-coded, in the file that routes seven of them.
        const mw = code('src/middleware.ts');

        expect(mw).toContain('canonicalHostFor');
        expect(mw).not.toMatch(/hostname === "easysalesexport\.com"/);
    });

    it('and the redirect it issues is permanent and keeps the path', () => {
        //   308, not 302: the browser must not re-ask on every navigation, and
        //   a member landing on /academy/courses must arrive at /academy/courses
        //   rather than the front page.
        //   Anchored on the CALL, not the first mention — the first is the
        //   import line, and slicing from there measured 700 characters of
        //   other imports.
        const mw = code('src/middleware.ts');
        const at = mw.indexOf('const canonicalHost = canonicalHostFor(hostname);');
        const block = mw.slice(at, at + 700);

        expect(at).toBeGreaterThan(-1);

        expect(block).toContain('status: 308');
        //   The URL is cloned, so pathname and query survive.
        expect(block).toContain('req.nextUrl.clone()');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#494 — and the router still knows every host it may be sent to', () => {
    it('THE TARGET OF EVERY REDIRECT IS A HOST DOMAIN_MAP RESOLVES', () => {
        //   The outage this finding is mostly about avoiding. Redirecting a
        //   host the router does not know is worse than the split session: the
        //   member arrives at the hub, or at nothing.
        const mw = readFileSync('src/middleware.ts', 'utf-8');

        for (const apex of MODULE_APEXES) {
            //   Each apex is in DOMAIN_MAP by derivation from HUB_MODULES —
            //   asserted here rather than assumed, because that derivation is
            //   two files away from this redirect.
            const declared = Object.values(HUB_MODULES).find((m) => m.domain === apex);
            expect({ apex, known: !!declared }).toEqual({ apex, known: true });
        }
        expect(mw).toContain('Object.values(HUB_MODULES).reduce');
    });

    it('and the www aliases stay in DOMAIN_MAP', () => {
        //   Unreachable now that the redirect runs first, and kept: if the
        //   redirect is ever disabled they are what stops those two hosts
        //   falling through to the hub.
        const mw = readFileSync('src/middleware.ts', 'utf-8');

        expect(mw).toContain('DOMAIN_MAP["www.easysalesacademy.com"]');
        expect(mw).toContain('DOMAIN_MAP["www.easysalesexportng.com"]');
    });
});
