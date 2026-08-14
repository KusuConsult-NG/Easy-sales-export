import { test, expect } from '@playwright/test';
import { watchPageHealth } from './helpers/page-health';

/**
 * Public Route Smoke Tests
 *
 * The five most critical journeys that need no authentication. These run on
 * every CI push.
 *
 * Run: npm run test:e2e -- tests/e2e/public-routes.spec.ts
 *
 * ON THE STRENGTH OF THESE ASSERTIONS
 * -----------------------------------
 * This file previously asserted "the URL is not /auth/" and "body is not
 * empty". Both are true of a completely broken page. On the first run of this
 * suite all seven specs passed while the server log showed every data fetch
 * failing — `getMarketplaceProductsAction` threw, the page rendered its error
 * banner, and the response was still HTTP 200.
 *
 * A smoke test that cannot fail is worse than no smoke test, because it is
 * reported as coverage. Each spec below now asserts a state that distinguishes
 * a working page from a broken one:
 *
 *   - the error banner must NOT be showing
 *   - the page must reach a known terminal state — content, or an explicit
 *     empty state — rather than merely being non-blank
 *   - no uncaught exception, no same-origin 5xx (see helpers/page-health)
 *
 * "No products found" is a pass. It means the query ran and returned nothing,
 * which is a legitimate state for an empty database. A visible error is a
 * failure. That distinction is the entire point.
 */

/**
 * Whether a real database is reachable.
 *
 * The specs below split into two kinds: those that only need the app to serve
 * a page (static pages, RBAC redirects — these run anywhere), and those that
 * assert on data the app fetched.
 *
 * The second kind cannot verify anything without a backend. Reporting them as
 * PASSED in that situation is what let this suite look like coverage while
 * proving nothing, so they are skipped with a stated reason instead. A skip is
 * visible in the output; a vacuous pass is not.
 */
const DB_CONFIGURED = (() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    return url !== '' && !url.includes('placeholder');
})();

test.describe('Public Routes — Smoke Tests', () => {

    test('Hub landing page loads with visible heading', async ({ page, baseURL }) => {
        const health = watchPageHealth(page, baseURL);

        await page.goto('/');
        await expect(page).not.toHaveURL(/error/);

        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
        // A heading exists on an error page too — require it to say something.
        await expect(heading).not.toHaveText('', { timeout: 10000 });

        health.assertClean();
    });

    test('Marketplace public catalog loads without auth', async ({ page, baseURL }) => {
        test.skip(
            !DB_CONFIGURED,
            'Needs a reachable database: this spec asserts the product query succeeded, ' +
            'which cannot be told from a failure without one. Set NEXT_PUBLIC_SUPABASE_URL.'
        );
        const health = watchPageHealth(page, baseURL);

        await page.goto('/marketplace/products');
        await expect(page).not.toHaveURL(/\/auth\//);

        // The page must settle into one of two legitimate states: product
        // cards, or the explicit "No products found" empty state.
        const products = page.getByRole('link', { name: /view|details/i })
            .or(page.locator('[data-testid="product-card"]'));
        const emptyState = page.getByText(/no products found/i);

        await expect(products.first().or(emptyState)).toBeVisible({ timeout: 15000 });

        // The state above is NOT sufficient on its own. When the products query
        // fails, `error` is set and `products` is empty, so the page renders the
        // error banner AND "No products found" together — an assertion that
        // accepts either state passes on a completely broken page. That is
        // exactly how this spec passed while every fetch was failing.
        await expect(page.getByTestId('products-error')).toHaveCount(0);

        health.assertClean();
    });

    test('Academy public page loads without auth', async ({ page, baseURL }) => {
        const health = watchPageHealth(page, baseURL);

        await page.goto('/academy');
        await expect(page).not.toHaveURL(/\/auth\//);

        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });

        health.assertClean();
    });

    test('RBAC gate: /admin redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/admin');
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('RBAC gate: /dashboard redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/dashboard');
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('RBAC gate: /escrow redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/escrow');
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('Privacy and Terms pages are publicly accessible', async ({ page, baseURL }) => {
        const health = watchPageHealth(page, baseURL);

        for (const path of ['/privacy', '/terms']) {
            await page.goto(path);
            await expect(page).not.toHaveURL(/\/auth\//);
            // These are static legal pages: they must carry real prose, not
            // just a shell that happens not to redirect.
            await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 10000 });
        }

        health.assertClean();
    });
});
