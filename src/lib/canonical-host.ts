import { HUB_MODULES } from '@/config/modules.config';

/**
 *   #494 SIX MODULE DOMAINS SERVE THE APP ON TWO HOSTS, AND TWO HOSTS IS TWO
 *        SESSIONS.
 *
 *   #454 left this open as "a product question about their DNS, not a repair".
 *   The cookie configuration makes it more than that.
 *
 *   auth.config.ts sets the session cookie with NO `domain` option, so it is
 *   HOST-ONLY: a cookie set on www.easysalesacademy.com is never sent to
 *   easysalesacademy.com, or the reverse. And the CSRF cookie carries the
 *   `__Host-` prefix, which FORBIDS a domain attribute — so scoping the cookies
 *   across both hosts is not undesirable, it is unavailable.
 *
 *   The platform already knew this for its own root domain. The one redirect
 *   that existed says why, in its own comment: "for consistent session
 *   handling". Consistent session handling is precisely what the six module
 *   domains did not have. A member signs in on one host, follows a link to the
 *   other, and is signed out — with a working account and nothing to report.
 *
 * ── THE DIRECTION IS THE OPPOSITE OF THE ROOT DOMAIN'S, AND THAT IS WHY ─────
 *
 *   Copying the apex -> www redirect to the other six is the obvious repair and
 *   it would have taken four module sites down. DOMAIN_MAP carries www entries
 *   for TWO of them — academy and export. The other four apexes have none, so
 *   even with DNS the middleware would not map the www host to a module; it
 *   would fall through to the hub.
 *
 *   modules.config.ts already states the direction: every module's `domain` is
 *   the APEX. That is the canonical host by the platform's own declaration, it
 *   is the one that certainly resolves, and it is the one DOMAIN_MAP is derived
 *   from. So the redirect goes www -> apex and needs no DNS that does not
 *   already exist.
 *
 *   THE ROOT DOMAIN KEEPS ITS OWN DIRECTION. easysalesexport.com -> www is live,
 *   the app is deployed on that www host, and reversing it to make the rule
 *   tidy would rewrite the thing that currently works. The rule bends here, not
 *   the deployment.
 *
 * ── DERIVED, BECAUSE #454 SAID SO ───────────────────────────────────────────
 *
 *   #454 deleted an APEX_DOMAINS constant that was computed and read by
 *   nothing, and recorded why it mattered: "a list named APEX_DOMAINS is
 *   exactly the thing somebody reaches for when adding a redirect, and it would
 *   have been silently out of date." This is that list, read by the redirect,
 *   derived from the same config DOMAIN_MAP is built from — so a module added
 *   next year is covered without anybody remembering.
 */

/** The primary domain, which redirects the OTHER way. See the header. */
const ROOT_APEX = 'easysalesexport.com';
const ROOT_CANONICAL = `www.${ROOT_APEX}`;

/**
 * `www.<apex>` -> `<apex>`, for every module whose canonical domain is an apex.
 *
 * A domain with more than two labels is a SUBDOMAIN
 * (finance.easysalesexport.com), and its canonical host is itself: there is no
 * `www.finance.…` and inventing one would send a member to a host nobody has.
 */
export const MODULE_WWW_REDIRECTS: Record<string, string> = Object.values(HUB_MODULES)
    .map((mod) => mod.domain.toLowerCase())
    .filter((domain) => domain.split('.').length === 2)
    .reduce((acc, apex) => {
        acc[`www.${apex}`] = apex;
        return acc;
    }, {} as Record<string, string>);

/**
 * The host this request should be on, or `null` when it is already there.
 *
 * Returning null rather than the same host is deliberate: a caller that
 * redirects on any non-null answer cannot accidentally write a loop.
 */
export function canonicalHostFor(hostname: string | null | undefined): string | null {
    if (!hostname) return null;
    const host = hostname.trim().toLowerCase();
    if (!host) return null;

    //   The root domain, in its own direction.
    if (host === ROOT_APEX) return ROOT_CANONICAL;
    if (host === ROOT_CANONICAL) return null;

    const apex = MODULE_WWW_REDIRECTS[host];
    return apex ?? null;
}
