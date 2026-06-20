import { test, expect } from '@playwright/test';
import { loginAs, USERS } from '../../e2e/helpers/auth';

/**
 * Module Access Tests
 * Verifies that approved module users can reach their module dashboard after login.
 * Tests the full pipeline: NextAuth → JWT → middleware → module guard.
 */
test.describe('Module dashboard access for approved users', () => {
    test.describe.configure({ mode: 'serial' });

    test.beforeEach(async ({ page }) => {
        await page.context().clearCookies();
    });

    test('Marketplace buyer lands on marketplace after login', async ({ page }) => {
        await loginAs(page, USERS.buyer.email, USERS.buyer.password);
        // Should redirect to marketplace area, not generic dashboard
        await expect(page).toHaveURL(/\/marketplace/, { timeout: 15000 });
        // Page should not show an error
        await expect(page.locator('h1, h2').first()).not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
        await expect(page.locator('h1, h2').first()).not.toContainText('Access Denied', { ignoreCase: true, timeout: 15000 });
    });

    test('Academy student lands on academy after login', async ({ page }) => {
        await loginAs(page, USERS.academy.email, USERS.academy.password);
        await expect(page).toHaveURL(/\/academy/, { timeout: 15000 });
        await expect(page.locator('h1, h2').first()).not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
    });

    test('Cooperative member lands on cooperative after login', async ({ page }) => {
        await loginAs(page, USERS.cooperative.email, USERS.cooperative.password);
        await expect(page).toHaveURL(/\/cooperatives|cooperative/, { timeout: 15000 });
        await expect(page.locator('h1, h2').first()).not.toContainText('Error', { ignoreCase: true, timeout: 15000 });
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
