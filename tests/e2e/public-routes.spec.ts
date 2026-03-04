import { test, expect } from '@playwright/test';

/**
 * Public Route Smoke Tests
 * 
 * Active (non-skipped) tests verifying the 5 most critical user journeys
 * that do not require authentication. These run on every CI push.
 * 
 * Run: npm run test:e2e -- tests/e2e/public-routes.spec.ts
 */

test.describe('Public Routes — Smoke Tests', () => {

    test('Hub landing page loads with visible heading', async ({ page }) => {
        await page.goto('/');
        // Page must load without error
        await expect(page).not.toHaveURL(/error/);
        // A visible heading must exist (not blank page)
        const heading = page.locator('h1, h2').first();
        await expect(heading).toBeVisible({ timeout: 10000 });
    });

    test('Marketplace public catalog loads without auth', async ({ page }) => {
        await page.goto('/marketplace/products');
        // Must NOT redirect to login (public route)
        await expect(page).not.toHaveURL(/\/auth\//);
        // Must show content (not a blank page)
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('Academy public page loads without auth', async ({ page }) => {
        await page.goto('/academy');
        // Must NOT redirect to login (public route)
        await expect(page).not.toHaveURL(/\/auth\//);
        await expect(page.locator('body')).not.toBeEmpty();
    });

    test('RBAC gate: /admin redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/admin');
        // Must redirect to login — the admin route is protected
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('RBAC gate: /dashboard redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/dashboard');
        // Must redirect to login
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('RBAC gate: /escrow redirects unauthenticated users to login', async ({ page }) => {
        await page.goto('/escrow');
        await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10000 });
    });

    test('Privacy and Terms pages are publicly accessible', async ({ page }) => {
        await page.goto('/privacy');
        await expect(page).not.toHaveURL(/\/auth\//);

        await page.goto('/terms');
        await expect(page).not.toHaveURL(/\/auth\//);
    });
});
