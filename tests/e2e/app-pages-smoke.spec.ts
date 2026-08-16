import { test, expect, Page } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every page in the application must render for the person it is meant for.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application has 240 page routes. Before the two smoke files, the browser
 * suite visited 39 of them — about one in six. The rest had never been opened
 * by any check, so a page that throws on mount was invisible to everything in
 * this repository.
 *
 * That is not hypothetical here. NotificationCenter crashed every page it
 * appeared on for any user with a notification, while the entire unit suite
 * stayed green. Logic passing does not mean a page renders.
 *
 * tests/e2e/admin-pages-smoke.spec.ts covers /admin. This file covers the rest.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * --------------------------------------------------
 * Per page: the server did not answer 5xx, something reached the screen, and
 * no error boundary or Next.js error overlay is showing. It does not test what
 * any page DOES — that belongs in a spec written for that feature, and many
 * already exist.
 *
 * The bar is deliberately low so a failure means something: the page is broken
 * for everyone, not that a selector moved.
 *
 * WHY EACH PAGE GETS A SPECIFIC PERSONA
 * -------------------------------------
 * Module pages are behind role guards. Visiting /cooperatives/savings as an
 * admin proves nothing about whether a cooperative member can use it — the
 * guard would redirect, the page would render as a redirect target, and the
 * test would pass having never loaded the page under test. Each route prefix
 * is therefore mapped to the persona that actually owns it, and pages open to
 * anyone are visited signed out.
 *
 * THE ROUTE LIST IS READ FROM THE FILESYSTEM
 * ------------------------------------------
 * A checked-in list is a second copy of the routes, and this audit keeps
 * finding the same failure: two copies of one fact, drifted apart, with the
 * stale one deciding. Reading src/app means a new page is covered the moment
 * it is added.
 */

const APP_DIR = path.resolve(__dirname, '../../src/app');

function collectRoutes(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectRoutes(full));
        } else if (entry.name === 'page.tsx') {
            const route = '/' + path.relative(APP_DIR, dir).split(path.sep)
                // Route groups like (member) are not part of the URL.
                .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
                .join('/');
            found.push(route === '/' ? '/' : route.replace(/\/$/, ''));
        }
    }
    return found;
}

/**
 * Which persona owns which area.
 *
 * `null` means "visit signed out" — a page anyone can reach. Longest prefix
 * wins, so /marketplace/seller can differ from /marketplace.
 */
const PERSONA_BY_PREFIX: Array<{ prefix: string; user: keyof typeof USERS | null }> = [
    { prefix: '/marketplace/seller', user: 'seller' },
    { prefix: '/marketplace/buyer', user: 'buyer' },
    { prefix: '/marketplace', user: 'buyer' },
    { prefix: '/vendor', user: 'seller' },
    { prefix: '/cooperatives', user: 'cooperative' },
    { prefix: '/academy', user: 'academy' },
    { prefix: '/wave', user: 'wave' },
    { prefix: '/export', user: 'export' },
    { prefix: '/farm-nation', user: 'seller' },
    { prefix: '/land', user: 'seller' },
    { prefix: '/loans', user: 'user' },
    { prefix: '/dashboard', user: 'user' },
    { prefix: '/messages', user: 'user' },
    { prefix: '/profile', user: 'user' },
    { prefix: '/settings', user: 'user' },
    { prefix: '/escrow', user: 'buyer' },
    { prefix: '/verify-id', user: 'user' },
    { prefix: '/verify-status', user: 'user' },
    // Everything else — landing, auth, legal — is public.
];

function personaFor(route: string): keyof typeof USERS | null {
    const match = PERSONA_BY_PREFIX
        .filter(entry => route === entry.prefix || route.startsWith(entry.prefix + '/'))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
    return match ? match.user : null;
}

const allRoutes = Array.from(new Set(collectRoutes(APP_DIR))).sort();
const dynamicRoutes = allRoutes.filter(r => r.includes('['));
const staticRoutes = allRoutes.filter(r => !r.includes('['))
    // /admin has its own file, with its own admin login.
    .filter(r => !r.startsWith('/admin'));

/** Grouped so each persona logs in once rather than once per page. */
const byPersona = new Map<string, string[]>();
for (const route of staticRoutes) {
    const key = personaFor(route) ?? '__public__';
    byPersona.set(key, [...(byPersona.get(key) ?? []), route]);
}

const FAILURE_MARKERS = [
    'Application error',            // Next.js client-side exception boundary
    'Unhandled Runtime Error',      // Next.js dev overlay
    'Internal Server Error',
];

async function assertRendered(page: Page, route: string) {
    const body = page.locator('body');
    await expect(body).toBeVisible();

    // An empty body is what a component throwing during render leaves behind.
    const text = ((await body.innerText().catch(() => '')) || '').trim();
    expect(text.length, `${route} rendered an empty page`).toBeGreaterThan(0);

    for (const marker of FAILURE_MARKERS) {
        expect(text, `${route} shows "${marker}"`).not.toContain(marker);
    }
}

test.describe('Application pages render', () => {
    test('the route list was actually discovered', () => {
        // Without this, a broken path makes every test below disappear and the
        // suite goes green having checked nothing.
        expect(staticRoutes.length).toBeGreaterThan(100);
        expect(staticRoutes).toContain('/');
        expect(byPersona.size).toBeGreaterThan(5);
    });

    for (const [persona, routes] of byPersona) {
        test.describe(`as ${persona === '__public__' ? 'a signed-out visitor' : persona}`, () => {
            test.beforeEach(async ({ page }) => {
                if (persona !== '__public__') {
                    const account = USERS[persona as keyof typeof USERS];
                    await loginAs(page, account.email, account.password);
                }
            });

            for (const route of routes) {
                test(`renders ${route}`, async ({ page }) => {
                    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

                    // 5xx is the server failing. 4xx is allowed: a guard
                    // answering 403/404 for this persona is a routing decision,
                    // not a crash.
                    const status = response?.status() ?? 0;
                    expect(status, `${route} answered ${status}`).toBeLessThan(500);

                    await assertRendered(page, route);
                });
            }
        });
    }

    test.afterAll(() => {
        if (dynamicRoutes.length > 0) {
            // Reported, not hidden. A gap nobody can see is a gap nobody fixes.
            console.log(
                `\n[app smoke] ${staticRoutes.length} static non-admin routes covered. ` +
                `${dynamicRoutes.length} dynamic routes NOT covered — each needs a real record.\n`
            );
        }
    });
});
