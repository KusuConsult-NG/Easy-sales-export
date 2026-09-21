import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * Module Access Tests
 *
 * Verifies that approved module users can reach their module dashboard after
 * login. Tests the full pipeline: NextAuth → JWT → middleware → module guard.
 *
 * ── WHAT CHANGED, AND WHY THESE TESTS STILL EARN THEIR KEEP ─────────────────
 *
 *   These used to assert that logging in LANDED the member inside their
 *   module — "Should redirect to marketplace area, not generic dashboard".
 *   getPostLoginRedirect no longer does that: it takes everyone to /dashboard,
 *   the hub that shows all six modules with their live application status.
 *
 *   The old behaviour dived into the FIRST approved entry of
 *   serviceRegistrations, and Object.entries is insertion order — so a member
 *   of three modules landed in whichever had been written to their record
 *   earliest, and never saw the other five at all.
 *
 *   THE PIPELINE THIS FILE EXISTS TO TEST IS UNCHANGED. "Can an approved
 *   member reach their module dashboard, with the guard letting them through
 *   and no Access Denied?" is still exactly the question — the member now
 *   arrives by navigating from the hub rather than by being thrown there. So
 *   each test signs in, checks the hub, and then goes to the module.
 *
 *   That is strictly more coverage than before: the old version could not tell
 *   "the guard admitted them" from "the redirect happened to point here".
 */
test.describe('Module dashboard access for approved users', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
    });

    /*
     *   WRITTEN OUT RATHER THAN SHARED THROUGH A HELPER.
     *
     *   The first version of this rewrite put the whole body in a
     *   reachesModule() helper, and no-test-can-pass-without-asserting failed
     *   the build for it: "NO ASSERTION AT ALL", three times. That guard is
     *   right — a test whose body holds no expect() can be turned into a no-op
     *   by one edit to a helper, under a name that still claims the behaviour
     *   is covered. Three lines of repetition is the cheaper side of that
     *   trade.
     */

    test('Marketplace buyer reaches marketplace after login', async ({ page }) => {
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        await page.goto('/marketplace/buyer/dashboard');
        await expect(page).toHaveURL(/\/marketplace/, { timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Access Denied', { ignoreCase: true, timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
    });

    test('Academy student reaches academy after login', async ({ page }) => {
        await loginAs(page, USERS.academy.email, USERS.academy.password);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        await page.goto('/academy/dashboard');
        await expect(page).toHaveURL(/\/academy/, { timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Access Denied', { ignoreCase: true, timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
    });

    test('Cooperative member reaches cooperative after login', async ({ page }) => {
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        await page.goto('/cooperatives/dashboard');
        await expect(page).toHaveURL(/\/cooperatives|cooperative/, { timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Access Denied', { ignoreCase: true, timeout: 15000 });
        await expect(page.locator('h1, h2').first())
            .not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
    });

    test('And the hub itself offers the other modules', async ({ page }) => {
        //   The point of the change, asserted rather than assumed: a member
        //   approved for ONE module can see the others exist. Previously they
        //   were dropped inside their own module and the hub was unreachable
        //   except by typing the URL.
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
        await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });

        const body = page.locator('body');
        await expect(body).toContainText(/academy/i, { timeout: 15000 });
        await expect(body).toContainText(/farm nation|farm-nation/i, { timeout: 15000 });
    });

    test('Login with wrong password shows error message', async ({ page }) => {
        await page.goto('/auth/login');
        await page.fill('input[name="email"]', USERS.buyer.email);
        await page.fill('input[name="password"]', 'WrongPassword!99');
        await page.click('button[type="submit"]');
        // Should stay on login page and show an error
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
        // Error message should be visible
        const errorEl = page.locator('[id="login-form-message"], [role="alert"], .text-red-600').first();
        await expect(errorEl).toBeVisible({ timeout: 5000 });
    });
});
