import { test, expect } from '@playwright/test';

/**
 * Authentication E2E Tests
 * Tests login, logout, and session management
 */

test.describe('Authentication', () => {
    test.beforeEach(async ({ page }) => {
        page.on('console', msg => {
            if (msg.type() === 'error') console.log(`[Browser Error] ${msg.text()}`);
        });
        // Navigate to login page before each test
        await page.goto('/auth/login?module=cooperatives');
        await page.waitForLoadState('networkidle');
    });

    test('should display login page correctly', async ({ page }) => {
        await expect(page).toHaveTitle(/Easy Sales Export/);
        await expect(page.locator('h1')).toContainText('Welcome Back');
        await expect(page.locator('input[name="email"]')).toBeVisible();
        await expect(page.locator('input[name="password"]')).toBeVisible();
    });

    test('should show error for invalid credentials', async ({ page }) => {
        await page.fill('input[name="email"]', 'invalid@example.com');
        await page.fill('input[name="password"]', 'wrongpassword');
        await page.click('button[type="submit"]');

        // Wait for error message (include "attempts" for rate limit errors)
        await expect(page.locator('text=/invalid|error|incorrect|failed|attempts|registered/i').first()).toBeVisible({ timeout: 10000 });
    });

    test('should show error for empty fields', async ({ page }) => {
        // Disable HTML5 validation to test server-side validation
        await page.evaluate(() => {
            const form = document.querySelector('form');
            if (form) form.noValidate = true;
        });

        await page.click('button[type="submit"]');

        // Should see validation errors
        await expect(page.locator('text=/required|email|password|invalid/i').first()).toBeVisible();
    });

    test('rate-limit: shows feedback after multiple failed attempts', async ({ page }) => {
        // Submit 6 invalid login attempts — the Upstash limiter allows 5 before blocking
        for (let i = 0; i < 6; i++) {
            await page.fill('input[name="email"]', 'ratelimit-test@example.com');
            await page.fill('input[name="password"]', `wrongpassword${i}`);
            await page.click('button[type="submit"]');
            
            // Wait for error response before sending the next one to avoid disabled button locking
            await expect(page.locator('text=/invalid|error|incorrect|failed|attempts|registered/i').first()).toBeVisible({ timeout: 10000 });
        }
        // Should show rate-limit or attempt-count error message
        await expect(
            page.locator('text=/attempts|many|limit|try again/i')
        ).toBeVisible({ timeout: 15000 });
    });
});
