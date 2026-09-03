/**
 * @jest-environment node
 */

/**
 *   #359 SIX NAVIGATION ITEMS LED TO not-found, INCLUDING THE ONLY "SETTINGS"
 *        LINK A SIGNED-IN MEMBER HAS AND TWO ON THE PUBLIC FOOTER.
 *
 *        #52 closed six dead internal links. It measured `href="/..."` in JSX.
 *        Every sidebar and footer in this codebase is a CONFIG TABLE —
 *        `{ name, href, icon }` objects — so none of them were measured, and
 *        six more were sitting there:
 *
 *          /settings               lib/sidebar-config.ts, the dashboard nav.
 *                                  src/app/settings/ holds exactly one route,
 *                                  settings/security/mfa, and no page.tsx of
 *                                  its own. Meanwhile route-manifest.ts lists
 *                                  "/settings" TWICE as a protected path —
 *                                  guarding a page that does not exist.
 *          /export/profile         ExportSidebar. No such directory.
 *          /farm-nation/profile    FarmNationSidebar. No such directory.
 *          /farm-nation/settings   FarmNationSidebar. No such directory.
 *          /faq                    WebsiteFooter — PUBLIC. No such directory.
 *          /security               WebsiteFooter — PUBLIC. No such directory.
 *
 *        WHERE THEY POINT NOW, AND WHY.
 *
 *        /profile is the settings screen. It already has general, security and
 *        preferences tabs, and its security tab is what links on to
 *        settings/security/mfa. So the two "Profile" links and the two
 *        "Settings" links come here; the page honours a `tab` query param now,
 *        so a link labelled Settings lands on preferences rather than dumping
 *        the member on "general".
 *
 *        /faq → /help, which carries the "Frequently Asked Questions" section
 *        this link was named for.
 *
 *        /security → /privacy, whose section 5 is "Data Security" — the
 *        nearest page that is actually true. Writing a security-practices page
 *        would mean inventing claims about this platform's security posture,
 *        which is an owner decision, not something to invent in an audit.
 *
 *        MY FIRST SWEEP REPORTED SEVEN. The seventh,
 *        /marketplace/seller/settings, is inside a commented-out line in
 *        MarketplaceSidebar.tsx — I had measured raw source instead of
 *        comment-stripped source, the same trap as #350/#354/#355 from the
 *        other side. The ratchet below strips comments first.
 *
 *        OWNER DECISION: write a real /security page for the public footer, or
 *        leave it pointing at the privacy policy.
 */

import { describe, it, expect } from '@jest/globals';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { stripComments } from '@/lib/testing/strip-comments';

const source = (rel: string) => stripComments(readFileSync(rel, 'utf-8'));

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

const SOURCE_FILES = walk(join(ROOT, 'src'))
    .map((f) => relative(ROOT, f))
    .filter((f) => /\.tsx?$/.test(f) && !f.includes('__tests__') && !f.includes('/testing/'));

/** Every route the app router actually serves, with groups stripped. */
const ROUTES: string[] = SOURCE_FILES
    .filter((f) => /\/page\.tsx?$/.test(f))
    .map((p) => p.replace(/^src\/app/, '').replace(/\/page\.tsx?$/, '').replace(/\/\([^)]+\)/g, '') || '/');

const ROUTE_SET = new Set(ROUTES);

/** Does a literal internal path resolve to a page, including dynamic segments? */
function routeExists(path: string): boolean {
    if (ROUTE_SET.has(path)) return true;
    return ROUTES.some((r) => {
        if (!/\[/.test(r)) return false;
        const rx = new RegExp(
            '^' + r.replace(/\[\[?\.\.\.[^\]]+\]\]?/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '$',
        );
        return rx.test(path);
    });
}

/** Literal internal links declared in config tables: `href: "/..."` and friends. */
function configLinks(file: string): string[] {
    const code = stripComments(readFileSync(join(ROOT, file), 'utf-8'));
    return [...code.matchAll(/(?:href|link|url|path|route|to)\s*:\s*["'](\/[A-Za-z0-9/_-]*)["']/g)]
        .map((m) => m[1] || '/')
        .filter((h) => !h.startsWith('/api'));
}

// ─────────────────────────────────────────────────────────────────────────────
describe('#359 — the measurement, and that it is not vacuous', () => {
    it('finds the app router', () => {
        expect(ROUTES.length).toBeGreaterThan(200);
        expect(ROUTE_SET.has('/profile')).toBe(true);
        expect(ROUTE_SET.has('/help')).toBe(true);
        expect(ROUTE_SET.has('/privacy')).toBe(true);
    });

    it('AND /settings STILL HAS NO PAGE — the finding, measured', () => {
        // The claim the whole repair rests on. If somebody builds a settings
        // page, this fails and the links can be revisited.
        expect(existsSync(join(ROOT, 'src/app/settings'))).toBe(true);
        expect(ROUTE_SET.has('/settings')).toBe(false);
        expect(ROUTE_SET.has('/settings/security/mfa')).toBe(true);
    });

    it('and the route manifest still guards it, which is how it hid', () => {
        // A protected path with no page reads as "this is a real screen".
        const manifest = source('src/lib/route-manifest.ts');

        expect(manifest.match(/"\/settings"/g) ?? []).toHaveLength(2);
    });

    it('the other four destinations never existed either', () => {
        for (const path of ['/export/profile', '/farm-nation/profile',
                            '/farm-nation/settings', '/faq', '/security']) {
            expect(ROUTE_SET.has(path)).toBe(false);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#359 — each dead link now points at a real page', () => {
    it('THE DASHBOARD SETTINGS LINK RESOLVES', () => {
        // THE test. This was the only Settings link a member had.
        const links = configLinks('src/lib/sidebar-config.ts');

        expect(links).not.toContain('/settings');
        expect(links).toContain('/profile?tab=preferences'.split('?')[0]);
        expect(source('src/lib/sidebar-config.ts'))
            .toContain('{ name: "Settings", href: "/profile?tab=preferences", icon: Settings }');
    });

    it('THE EXPORT SIDEBAR PROFILE LINK RESOLVES', () => {
        const links = configLinks('src/app/export/(app)/ExportSidebar.tsx');

        expect(links).not.toContain('/export/profile');
        expect(links).toContain('/profile');
    });

    it('BOTH FARM NATION LINKS RESOLVE', () => {
        const code = source('src/app/farm-nation/(member)/FarmNationSidebar.tsx');

        expect(code).not.toContain('/farm-nation/profile');
        expect(code).not.toContain('/farm-nation/settings');
        expect(code).toContain('href: "/profile"');
        expect(code).toContain('href: "/profile?tab=preferences"');
    });

    it('AND BOTH PUBLIC FOOTER LINKS RESOLVE', () => {
        // These were the worst of the six: every visitor to the site could
        // click them.
        const code = source('src/components/layout/WebsiteFooter.tsx');

        expect(code).toContain('{ name: "Security", href: "/privacy" }');
        expect(code).toContain('{ name: "FAQ", href: "/help" }');
    });

    it('and /help really does carry the FAQ this link is named for', () => {
        // Otherwise the link is honest about its destination and dishonest
        // about its content.
        expect(readFileSync('src/app/help/page.tsx', 'utf-8'))
            .toMatch(/Frequently Asked Questions/);
    });

    it('and /privacy really does cover data security', () => {
        expect(readFileSync('src/app/privacy/page.tsx', 'utf-8'))
            .toMatch(/Data Security/);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#359 — the profile page honours the tab the links ask for', () => {
    const code = source('src/app/profile/page.tsx');

    it('IT READS THE tab PARAM, WHICH IT DID NOT', () => {
        // Without this, a link labelled "Settings" lands on "general" and the
        // member has to find the tab themselves.
        expect(code).toContain("const requestedTab = searchParams.get('tab')");
        expect(code).toMatch(/requestedTab === 'security' \|\| requestedTab === 'preferences'\s*\?\s*requestedTab\s*:\s*'general'/);
    });

    it('and an unknown or absent tab still opens general', () => {
        // The other side: a junk param must not break the screen.
        expect(code).toContain("'general'");
        expect(code).not.toMatch(/useState<'general' \| 'security' \| 'preferences'>\(requestedTab as any\)/);
    });

    it('the three tabs it offers are the three the links can ask for', () => {
        // Vacuity guard on the param whitelist.
        expect(code).toContain("useState<'general' | 'security' | 'preferences'>");
        expect(code).toContain("activeTab === 'security'");
        expect(code).toContain("activeTab === 'preferences'");
    });

    it('and the security tab is still what reaches the MFA page', () => {
        // The reason /settings could point here at all.
        expect(code).toContain('router.push("/settings/security/mfa")');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('#359 — THE RATCHET: no navigation table names a page that does not exist', () => {
    it('finds the source tree, so this is not vacuous', () => {
        expect(SOURCE_FILES.length).toBeGreaterThan(400);
    });

    it('NO CONFIG-TABLE LINK IN src IS A 404', () => {
        // The class. #52 measured JSX `href="..."` and closed six; every nav in
        // this codebase is a config table instead, so it measured none of them.
        //
        // Comment-stripped, because my own first sweep reported
        // /marketplace/seller/settings — a line that is commented out.
        const dead: string[] = [];

        for (const file of SOURCE_FILES) {
            for (const link of configLinks(file)) {
                if (!routeExists(link)) dead.push(`${link} <- ${file}`);
            }
        }

        expect(dead.sort()).toEqual([]);
    });

    it('AND NEITHER IS ANY JSX href — #52\'s measurement, kept', () => {
        // Both shapes, so closing one cannot reopen the other.
        const dead: string[] = [];

        for (const file of SOURCE_FILES) {
            const code = stripComments(readFileSync(join(ROOT, file), 'utf-8'));
            for (const m of code.matchAll(/href=["{]\s*["']?(\/[A-Za-z0-9/_-]*)["']?\s*[}"']/g)) {
                const link = m[1] || '/';
                if (link.startsWith('/api')) continue;
                if (!routeExists(link)) dead.push(`${link} <- ${file}`);
            }
        }

        expect(dead.sort()).toEqual([]);
    });

    it('the ratchet can actually see a dead link', () => {
        // A ratchet that cannot fail is a comment. This proves the mechanism.
        expect(routeExists('/settings')).toBe(false);
        expect(routeExists('/profile')).toBe(true);
        expect(routeExists('/export/windows/some-id')).toBe(true);   // dynamic segment
    });
});
