import { test, expect, Page } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Every admin page must render for an admin.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application has 74 admin pages. Before this file, the browser suite
 * visited 7 of them — about 9% — while the admin panel is where refunds,
 * payouts, withdrawals, loan approvals and role grants happen. The rest had
 * never been opened by any check.
 *
 * That gap is not theoretical. NotificationCenter once crashed every page it
 * appeared on, for any user who had a notification, while the whole unit suite
 * stayed green: logic passing does not mean a page renders. A page that throws
 * on mount is invisible to every test in this repository except one that
 * actually loads it.
 *
 * WHAT IT ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
 * --------------------------------------------------
 * This is a SMOKE suite. Per page it asserts the server did not answer 5xx,
 * the page put something on screen, and no error boundary or Next.js error
 * overlay is showing. It does not test what any page DOES — that belongs in a
 * spec written for that feature, and several already exist.
 *
 * The bar is deliberately low so that it is meaningful: a failure here means
 * the page is broken for every admin, not that a selector moved.
 *
 * THE ROUTE LIST IS READ FROM THE FILESYSTEM, NOT HARDCODED
 * ---------------------------------------------------------
 * A checked-in list is a second copy of the routes, and this audit has found
 * the same failure repeatedly: two copies of one fact, drifted apart, with the
 * stale one deciding. Reading src/app/admin/(...)/page.tsx means a new admin
 * page is covered the moment it is added, without anybody remembering to come
 * back here.
 *
 * Dynamic segments ([id], [courseId]) are excluded: they need a real record to
 * be meaningful, and visiting them with a made-up id would assert nothing
 * except that a 404 renders. They are listed at the end of the run so the gap
 * stays visible rather than silently omitted.
 */

const APP_DIR = path.resolve(__dirname, '../../src/app');
const ADMIN_DIR = path.join(APP_DIR, 'admin');

function collectRoutes(dir: string): string[] {
    const found: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...collectRoutes(full));
        } else if (entry.name === 'page.tsx') {
            // "/admin/users" from ".../src/app/admin/users/page.tsx"
            const route = '/' + path.relative(APP_DIR, dir).split(path.sep)
                // Route groups like (member) are not part of the URL.
                .filter(segment => !(segment.startsWith('(') && segment.endsWith(')')))
                .join('/');
            found.push(route);
        }
    }
    return found;
}

const allAdminRoutes = collectRoutes(ADMIN_DIR).sort();
const dynamicRoutes = allAdminRoutes.filter(r => r.includes('['));
const staticRoutes = allAdminRoutes.filter(r => !r.includes('['));

/** Text that means the page failed rather than rendered. */
const FAILURE_MARKERS = [
    'Application error',              // Next.js client-side exception boundary
    'Unhandled Runtime Error',        // Next.js dev overlay
    'This page could not be found',   // 404
    'Internal Server Error',
];

async function assertRendered(page: Page, route: string) {
    // 1. Something is on screen. An empty body is a blank page, which is what a
    //    component throwing during render leaves behind in production.
    const body = page.locator('body');
    await expect(body).toBeVisible();
    const text = ((await body.innerText().catch(() => '')) || '').trim();
    expect(text.length, `${route} rendered an empty page`).toBeGreaterThan(0);

    // 2. No error boundary, overlay or 404.
    for (const marker of FAILURE_MARKERS) {
        expect(text, `${route} shows "${marker}"`).not.toContain(marker);
    }
}

test.describe('Admin pages render', () => {
    test.beforeEach(async ({ page }) => {
        await loginAs(page, USERS.admin.email, USERS.admin.password);
    });

    test('the route list was actually discovered', () => {
        // Without this, a broken path or a rename makes every test below
        // disappear and the suite goes green having checked nothing — the
        // vacuity failure this audit keeps finding.
        expect(staticRoutes.length).toBeGreaterThan(50);
        expect(staticRoutes).toContain('/admin');
        expect(staticRoutes).toContain('/admin/users');
    });

    for (const route of staticRoutes) {
        test(`renders ${route}`, async ({ page }) => {
            const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

            // A 5xx is the server failing outright. 4xx is allowed: some admin
            // areas legitimately answer 403/404 for a role this account lacks,
            // and that is a routing decision, not a crash.
            const status = response?.status() ?? 0;
            expect(status, `${route} answered ${status}`).toBeLessThan(500);

            await assertRendered(page, route);
        });
    }

    test.afterAll(() => {
        if (dynamicRoutes.length > 0) {
            // Reported, not hidden. A gap nobody can see is a gap nobody fixes.
            console.log(
                `\n[admin smoke] ${staticRoutes.length} static admin routes covered. ` +
                `${dynamicRoutes.length} dynamic routes NOT covered — each needs a real record:\n  ` +
                dynamicRoutes.join('\n  ') + '\n'
            );
        }
    });
});
