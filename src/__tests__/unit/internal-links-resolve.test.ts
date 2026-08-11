/**
 * @jest-environment node
 */

/**
 * Every internal link must point at a route that exists.
 *
 * WHY
 * ---
 * Nine broken links were found by hand during the UI-wiring audit. Six were
 * wrong targets and were fixed then; three pointed at pages that had never been
 * built and were left:
 *
 *   /vendor/products/new          the vendor dashboard's "Add Product" button
 *   /farm-nation/my-transactions  a dashboard tile labelled "My Transactions"
 *   /activity                     "View All" on the activity feed
 *
 * All three now point at pages that already existed and do the job —
 * /marketplace/sell, /farm-nation/my-purchases, /dashboard/notifications.
 *
 * The worst of the earlier set was a `redirect()` sending signed-out users to
 * /marketplace/login, which does not exist: a 404 instead of the login form.
 * That is the failure mode this guards — a dead link is invisible until someone
 * clicks it, and nobody clicks their own "Add Product" button.
 *
 * WHAT IT CANNOT CHECK
 * --------------------
 * Template literals (`` href={`/orders/${id}`} ``) and computed hrefs are
 * skipped: the path is not known until runtime. Only literal internal paths are
 * resolved, which is where every one of the nine defects lived.
 */

import { describe, it, expect } from '@jest/globals';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

const APP = join(process.cwd(), 'src/app');
const ROOTS = [join(process.cwd(), 'src/app'), join(process.cwd(), 'src/components')];

/** Route paths the App Router will serve, with groups and params normalised. */
function routeSet(): Set<string> {
    const routes = new Set<string>();

    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (entry === 'page.tsx' || entry === 'page.ts' || entry === 'route.ts') {
                const rel = relative(APP, dir).split(/[\\/]/)
                    // (member) and similar route groups do not appear in URLs.
                    .filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')))
                    .join('/');
                routes.add('/' + rel);
            }
        }
    };
    walk(APP);
    routes.add('/');
    return routes;
}

/** Literal internal hrefs, with the file they came from. */
function collectLinks(): Array<{ file: string; href: string }> {
    const out: Array<{ file: string; href: string }> = [];
    const pattern = /(?:href|redirect\()\s*=?\s*["'](\/[^"'{}$]*)["']/g;

    const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else if (entry.endsWith('.tsx')) {
                const src = readFileSync(full, 'utf-8');
                for (const m of src.matchAll(pattern)) {
                    out.push({ file: relative(process.cwd(), full), href: m[1] });
                }
            }
        }
    };
    for (const r of ROOTS) if (existsSync(r)) walk(r);
    return out;
}

/** Does a literal path match a route, allowing for [param] segments? */
function resolves(href: string, routes: Set<string>): boolean {
    const path = href.split('?')[0].split('#')[0].replace(/\/$/, '') || '/';
    if (routes.has(path)) return true;

    const parts = path.split('/').filter(Boolean);
    for (const route of routes) {
        const rParts = route.split('/').filter(Boolean);
        if (rParts.length !== parts.length) continue;
        const match = rParts.every((seg, i) =>
            (seg.startsWith('[') && seg.endsWith(']')) || seg === parts[i]
        );
        if (match) return true;
    }
    return false;
}

describe('internal links', () => {
    const routes = routeSet();
    const links = collectLinks();

    it('finds routes and links to check (sanity)', () => {
        // Without this, a path change makes every assertion below vacuous by
        // checking an empty set — the failure mode that has bitten this suite
        // repeatedly.
        expect(routes.size).toBeGreaterThan(100);
        expect(links.length).toBeGreaterThan(50);
    });

    it('all resolve to a real route', () => {
        const broken = links
            // Files and API paths are not pages.
            .filter((l) => !/\.(png|jpg|jpeg|svg|webp|ico|pdf|xml|txt|json|css|js)$/i.test(l.href))
            .filter((l) => !l.href.startsWith('/api/'))
            .filter((l) => !resolves(l.href, routes));

        const unique = [...new Map(broken.map((b) => [b.href + b.file, b])).values()];

        if (unique.length > 0) {
            throw new Error(
                `\n\n🔗 ${unique.length} internal link(s) point at routes that do not exist:\n\n` +
                unique.map((b) => `  ${b.href}\n      ${b.file}`).join('\n') +
                `\n\nA dead link is invisible until someone clicks it, and nobody clicks\n` +
                `their own "Add Product" button. Point it at the page that does the job,\n` +
                `or build the page.\n`
            );
        }
        expect(unique).toEqual([]);
    });
});
